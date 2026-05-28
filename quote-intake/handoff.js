const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HANDOFF_SCHEMA_VERSION = 'quote_request_mailroom_handoff.v0';
const MAX_BODY_TEXT_CHARS = 24000;
const SAFE_RELATIVE_FILE_RE = /^[a-zA-Z0-9._-]+\.json$/;
const FORBIDDEN_KEYS = new Set([
  'activate',
  'activation',
  'approval',
  'approved',
  'canactivate',
  'cancallxero',
  'cansavequote',
  'cansendemail',
  'callxero',
  'createxeroquote',
  'delete',
  'deposit',
  'emaildraft',
  'emaildraftid',
  'idempotencykey',
  'quoteid',
  'quote_id',
  'save',
  'savequote',
  'send',
  'sendemail',
  'status',
  'update',
  'xero',
  'xeroquoteid'
]);
const CANONICAL_SAFETY_PATHS = new Set([
  'safety.canSendEmail',
  'safety.canSaveQuote',
  'safety.canCallXero',
  'safety.canActivate'
]);

function asString(value) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string || null;
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'microsoft' || provider === 'microsoft_graph') return 'microsoft';
  if (provider === 'gmail' || provider === 'google') return 'gmail';
  return provider || 'unknown';
}

function normalizeMailbox(value) {
  return asString(value) || null;
}

function sanitizeToken(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
  return cleaned || fallback;
}

function hashShort(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function normalizeSourceKey(input) {
  const source = input.sourcePacket || input.source || {};
  const threadDetail = input.threadDetail || {};
  const latest = latestMessage(Array.isArray(threadDetail.messages) ? threadDetail.messages : []);
  const provider = normalizeProvider(input.provider || source.provider);
  const mailbox = sanitizeToken(input.mailboxKey || source.mailboxKey || source.mailbox || 'mailbox', 'mailbox');
  const threadId = asString(input.threadId || source.threadId || source.conversationId || threadDetail.conversationId || latest.conversationId);
  const messageId = asString(input.messageId || source.messageId || source.id || latest.id);
  const stableId = threadId || messageId || asString(input.requestId) || hashShort(JSON.stringify(source));
  return [
    'mailroom',
    provider,
    mailbox,
    sanitizeToken(stableId, hashShort(JSON.stringify(source))),
    sanitizeToken(messageId || stableId, hashShort(stableId))
  ].join(':');
}

function safeFileNameForSourceKey(sourceKey) {
  return `${sourceKey.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)}.json`;
}

function truncateBodyText(value, limit = MAX_BODY_TEXT_CHARS) {
  const body = String(value || '').replace(/\r\n/g, '\n');
  if (body.length <= limit) {
    return { bodyText: body, bodyTextTruncated: false };
  }
  return {
    bodyText: body.slice(0, limit),
    bodyTextTruncated: true
  };
}

function latestMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return {};
  return messages[messages.length - 1] || {};
}

function threadBodyText(threadDetail, fallbackBodyText) {
  const messages = Array.isArray(threadDetail && threadDetail.messages)
    ? threadDetail.messages
    : [];
  if (!messages.length) return fallbackBodyText || '';
  return messages
    .map((message) => {
      const from = asString(message.from) || 'unknown sender';
      const date = asString(message.date || message.receivedDateTime) || 'unknown date';
      const body = asString(message.body || message.preview || message.bodyPreview) || '';
      return `From: ${from}\nDate: ${date}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  const normalized = {
    filename: asString(attachment.filename || attachment.name || attachment.originalName || attachment.id),
    path: asString(attachment.path),
    contentType: asString(attachment.contentType),
    size: attachment.size === null || attachment.size === undefined || attachment.size === ''
      ? null
      : Number.isFinite(Number(attachment.size))
        ? Number(attachment.size)
        : null,
    sha256: asString(attachment.sha256),
    capture: asString(attachment.capture) || (attachment.path ? 'path_reference' : 'metadata_only'),
    source: asString(attachment.source),
    messageId: asString(attachment.messageId)
  };
  const attachmentId = asString(attachment.attachmentId || attachment.id);
  const contentId = asString(attachment.contentId);
  const originalName = asString(attachment.originalName);
  const originalContentType = asString(attachment.originalContentType);
  const detectedContentType = asString(attachment.detectedContentType);
  const referencedBy = asString(attachment.referencedBy);
  if (attachmentId) normalized.attachmentId = attachmentId;
  if (contentId) normalized.contentId = contentId;
  if (originalName) normalized.originalName = originalName;
  if (originalContentType) normalized.originalContentType = originalContentType;
  if (detectedContentType) normalized.detectedContentType = detectedContentType;
  if (referencedBy) normalized.referencedBy = referencedBy;
  return normalized;
}

function attachmentManifest(input) {
  const source = input.sourcePacket || input.source || {};
  const threadDetail = input.threadDetail || {};
  const explicitAttachments = []
    .concat(Array.isArray(source.attachments) ? source.attachments : [])
    .concat(Array.isArray(input.attachments) ? input.attachments : [])
    .concat(Array.isArray(input.attachmentManifest) ? input.attachmentManifest : []);
  const messageAttachmentHints = Array.isArray(threadDetail.messages)
    ? threadDetail.messages
      .filter((message) => message && message.hasAttachments === true)
      .map((message) => ({
        filename: null,
        path: null,
        contentType: null,
        size: null,
        capture: 'metadata_only',
        source: 'message_has_attachments',
        messageId: message.id || null
      }))
    : [];
  const attachments = explicitAttachments.length
    ? explicitAttachments
    : messageAttachmentHints;
  return attachments.map(normalizeAttachment).filter(Boolean);
}

function collectForbiddenKeys(value, pathParts = [], output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, pathParts.concat(String(index)), output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;

  Object.entries(value).forEach(([key, nested]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const pathName = pathParts.concat(key).join('.');
    if (FORBIDDEN_KEYS.has(normalized)) {
      output.push(pathName);
      return;
    }
    collectForbiddenKeys(nested, pathParts.concat(key), output);
  });
  return output;
}

function buildSourcePacket(input) {
  const source = input.sourcePacket || input.source || {};
  const threadDetail = input.threadDetail || {};
  const messages = Array.isArray(threadDetail.messages) ? threadDetail.messages : [];
  const latest = latestMessage(messages);
  const body = truncateBodyText(threadBodyText(threadDetail, source.bodyText || source.body || input.bodyText));
  return {
    provider: normalizeProvider(source.provider || input.provider),
    mailbox: normalizeMailbox(source.mailbox || input.mailbox),
    mailboxKey: asString(source.mailboxKey || input.mailboxKey),
    threadId: asString(source.threadId || source.conversationId || threadDetail.conversationId || latest.conversationId),
    messageId: asString(source.messageId || source.id || input.messageId || latest.id),
    subject: asString(source.subject || threadDetail.subject || latest.subject),
    from: asString(source.from || source.sender || latest.from),
    to: asArray(source.to || latest.to),
    cc: asArray(source.cc || latest.cc),
    receivedAt: asString(source.receivedAt || source.date || latest.date || latest.receivedDateTime),
    bodyText: body.bodyText,
    bodyTextTruncated: body.bodyTextTruncated,
    attachments: attachmentManifest(input)
  };
}

function buildMailroomTask(input) {
  const task = input.mailroomTask || {};
  return {
    todoistTaskId: asString(task.todoistTaskId || input.todoistTaskId),
    title: asString(task.title),
    summary: asString(task.summary),
    latestMessage: asString(task.latestMessage),
    whatTheyNeed: asString(task.whatTheyNeed),
    bottomLine: asString(task.bottomLine),
    nextAction: asString(task.nextAction)
  };
}

function buildQuoteHandoffPacket(input = {}, options = {}) {
  const sourceKey = normalizeSourceKey(input);
  const sourcePacket = buildSourcePacket(input);
  const createdAt = asString(input.createdAt) || (options.now ? options.now.toISOString() : new Date().toISOString());
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    requestId: asString(input.requestId) || sourceKey,
    sourceKey,
    sourceType: 'email',
    createdAt,
    sourcePacket,
    attachmentManifest: sourcePacket.attachments,
    mailroomTask: buildMailroomTask(input),
    knownFacts: Array.isArray(input.knownFacts) ? input.knownFacts : [],
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
    candidateQuoteDraft: {
      clientId: null,
      projectId: null,
      sidemark: null,
      items: []
    },
    safety: {
      canSendEmail: false,
      canSaveQuote: false,
      canCallXero: false,
      canActivate: false
    }
  };
}

function validateQuoteHandoffPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== 'object') {
    return ['Handoff packet must be an object.'];
  }
  if (packet.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    errors.push('Unsupported quote handoff schema version.');
  }
  if (!asString(packet.sourceKey)) {
    errors.push('Handoff packet requires sourceKey.');
  }
  if (!packet.sourcePacket || typeof packet.sourcePacket !== 'object') {
    errors.push('Handoff packet requires sourcePacket.');
  }
  if (!packet.safety || packet.safety.canSendEmail !== false || packet.safety.canSaveQuote !== false || packet.safety.canCallXero !== false || packet.safety.canActivate !== false) {
    errors.push('Handoff packet must explicitly block send, save, Xero, and activation.');
  }
  if (packet.safety && typeof packet.safety === 'object') {
    const extraSafetyKeys = Object.keys(packet.safety).filter((key) => !CANONICAL_SAFETY_PATHS.has(`safety.${key}`));
    if (extraSafetyKeys.length) {
      errors.push(`Handoff packet safety block contains unexpected key: safety.${extraSafetyKeys[0]}.`);
    }
  }
  if (!packet.candidateQuoteDraft || !Array.isArray(packet.candidateQuoteDraft.items) || packet.candidateQuoteDraft.items.length !== 0) {
    errors.push('Mailroom handoff cannot include quote items.');
  }
  const forbidden = collectForbiddenKeys(packet).filter((key) => !CANONICAL_SAFETY_PATHS.has(key));
  if (forbidden.length) {
    errors.push(`Handoff packet contains forbidden control field: ${forbidden[0]}.`);
  }
  return errors;
}

function ensureWithinDirectory(filePath, rootDir, allowedRootDir) {
  fs.mkdirSync(rootDir, { recursive: true });
  const resolvedRoot = fs.realpathSync(rootDir);
  if (allowedRootDir) {
    fs.mkdirSync(allowedRootDir, { recursive: true });
    const resolvedAllowedRoot = fs.realpathSync(allowedRootDir);
    if (resolvedRoot !== resolvedAllowedRoot && !resolvedRoot.startsWith(resolvedAllowedRoot + path.sep)) {
      throw new Error('Quote handoff inbox is outside the allowed handoff root.');
    }
  }
  const parentDir = path.dirname(filePath);
  fs.mkdirSync(parentDir, { recursive: true });
  const resolvedParent = fs.realpathSync(parentDir);
  if (resolvedParent !== resolvedRoot && !resolvedParent.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Quote handoff output path escapes the handoff queue.');
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
}

function writeQuoteHandoffPacket(packet, options = {}) {
  const inboxDir = options.inboxDir;
  if (!inboxDir) {
    throw new Error('writeQuoteHandoffPacket requires inboxDir.');
  }
  const errors = validateQuoteHandoffPacket(packet);
  if (errors.length) {
    throw new Error(errors[0]);
  }
  const fileName = safeFileNameForSourceKey(packet.sourceKey);
  if (!SAFE_RELATIVE_FILE_RE.test(fileName)) {
    throw new Error('Quote handoff filename is not safe.');
  }
  const filePath = path.join(inboxDir, fileName);
  ensureWithinDirectory(filePath, inboxDir, options.allowedRootDir);
  if (fs.existsSync(filePath)) {
    return {
      created: false,
      sourceKey: packet.sourceKey,
      path: filePath,
      packet
    };
  }
  writeJsonAtomic(filePath, packet);
  return {
    created: true,
    sourceKey: packet.sourceKey,
    path: filePath,
    packet
  };
}

function createQuoteHandoff(input = {}, options = {}) {
  const packet = buildQuoteHandoffPacket(input, options);
  return writeQuoteHandoffPacket(packet, options);
}

module.exports = {
  HANDOFF_SCHEMA_VERSION,
  MAX_BODY_TEXT_CHARS,
  buildQuoteHandoffPacket,
  validateQuoteHandoffPacket,
  writeQuoteHandoffPacket,
  createQuoteHandoff,
  __test: {
    collectForbiddenKeys,
    normalizeSourceKey,
    safeFileNameForSourceKey,
    truncateBodyText
  }
};
