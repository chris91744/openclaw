const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  HANDOFF_SCHEMA_VERSION,
  MAX_BODY_TEXT_CHARS,
  buildQuoteHandoffPacket,
  createQuoteHandoff,
  validateQuoteHandoffPacket
} = require('./handoff');

function sampleInput(overrides = {}) {
  return {
    provider: 'microsoft',
    mailbox: 'chris@prestigiocustom.com',
    mailboxKey: 'chris',
    threadDetail: {
      conversationId: 'conversation-123',
      subject: 'Tigertail // Family Patio Sectional',
      messages: [
        {
          id: 'message-1',
          subject: 'Tigertail // Family Patio Sectional',
          from: 'Designer <designer@example.com>',
          to: ['chris@prestigiocustom.com'],
          cc: ['assistant@example.com'],
          date: '2026-05-16T12:00:00.000Z',
          body: 'Can you quote replacement patio cushions from the attached drawing?',
          hasAttachments: true
        }
      ]
    },
    attachments: [
      {
        name: 'sectional-drawing.pdf',
        contentType: 'application/pdf',
        size: 1234,
        capture: 'metadata_only'
      }
    ],
    mailroomTask: {
      title: 'QUOTE: Tigertail - family patio sectional',
      summary: 'Designer asked for replacement patio cushions.',
      nextAction: 'Review dimensions and draft missing-info questions.'
    },
    ...overrides
  };
}

test('buildQuoteHandoffPacket creates a read-only mailroom packet for Codex review', () => {
  const packet = buildQuoteHandoffPacket(sampleInput(), {
    now: new Date('2026-05-16T12:05:00.000Z')
  });

  assert.equal(packet.schemaVersion, HANDOFF_SCHEMA_VERSION);
  assert.equal(packet.sourceType, 'email');
  assert.equal(packet.sourceKey, 'mailroom:microsoft:chris:conversation-123:message-1');
  assert.equal(packet.createdAt, '2026-05-16T12:05:00.000Z');
  assert.equal(packet.sourcePacket.provider, 'microsoft');
  assert.equal(packet.sourcePacket.mailbox, 'chris@prestigiocustom.com');
  assert.equal(packet.sourcePacket.threadId, 'conversation-123');
  assert.equal(packet.sourcePacket.messageId, 'message-1');
  assert.equal(packet.sourcePacket.attachmentCount, undefined);
  assert.deepEqual(packet.attachmentManifest, [
    {
      filename: 'sectional-drawing.pdf',
      path: null,
      contentType: 'application/pdf',
      size: 1234,
      sha256: null,
      capture: 'metadata_only',
      source: null,
      messageId: null
    }
  ]);
  assert.deepEqual(packet.candidateQuoteDraft, {
    clientId: null,
    projectId: null,
    sidemark: null,
    items: []
  });
  assert.deepEqual(packet.safety, {
    canSendEmail: false,
    canSaveQuote: false,
    canCallXero: false,
    canActivate: false
  });
  assert.deepEqual(validateQuoteHandoffPacket(packet), []);
});

test('createQuoteHandoff writes idempotently into the inbox queue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-handoff-'));
  const inboxDir = path.join(root, 'prestigio', 'quote-intake-handoffs', 'inbox');

  const first = createQuoteHandoff(sampleInput(), {
    inboxDir,
    now: new Date('2026-05-16T12:05:00.000Z')
  });
  const second = createQuoteHandoff(sampleInput(), {
    inboxDir,
    now: new Date('2026-05-16T12:06:00.000Z')
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.path, second.path);
  assert.equal(fs.existsSync(first.path), true);

  const saved = JSON.parse(fs.readFileSync(first.path, 'utf8'));
  assert.equal(saved.sourceKey, 'mailroom:microsoft:chris:conversation-123:message-1');
  assert.equal(saved.createdAt, '2026-05-16T12:05:00.000Z');
});

test('body text is capped so Mailroom cannot drop huge raw threads into the queue', () => {
  const hugeBody = 'x'.repeat(MAX_BODY_TEXT_CHARS + 100);
  const packet = buildQuoteHandoffPacket(sampleInput({
    threadDetail: {
      conversationId: 'conversation-huge',
      messages: [
        {
          id: 'message-huge',
          subject: 'Huge quote request',
          from: 'designer@example.com',
          date: '2026-05-16T12:00:00.000Z',
          body: hugeBody
        }
      ]
    }
  }));

  assert.equal(packet.sourcePacket.bodyText.length, MAX_BODY_TEXT_CHARS);
  assert.equal(packet.sourcePacket.bodyTextTruncated, true);
});

test('thread hasAttachments is preserved as metadata-only evidence when no manifest is available', () => {
  const packet = buildQuoteHandoffPacket(sampleInput({
    attachments: [],
    attachmentManifest: [],
    threadDetail: {
      conversationId: 'conversation-attachments',
      subject: 'Quote request with attachments',
      messages: [
        {
          id: 'message-with-attachments',
          subject: 'Quote request with attachments',
          from: 'designer@example.com',
          date: '2026-05-16T12:00:00.000Z',
          body: 'Please see attached.',
          hasAttachments: true
        }
      ]
    }
  }));

  assert.deepEqual(packet.attachmentManifest, [
    {
      filename: null,
      path: null,
      contentType: null,
      size: null,
      sha256: null,
      capture: 'metadata_only',
      source: 'message_has_attachments',
      messageId: 'message-with-attachments'
    }
  ]);
});

test('attachment manifest preserves recovered inline image lineage', () => {
  const packet = buildQuoteHandoffPacket(sampleInput({
    attachments: [
      {
        id: 'inline-octet',
        name: 'image002.png',
        originalName: 'image002',
        path: '/tmp/mail/attachments/message-1/image002.png',
        contentType: 'image/png',
        originalContentType: 'application/octet-stream',
        detectedContentType: 'image/png',
        contentId: 'farley-plan',
        referencedBy: 'cid:farley-plan',
        source: 'inline_attachment',
        size: 68,
        sha256: 'abc123'
      }
    ]
  }));

  assert.equal(packet.attachmentManifest[0].filename, 'image002.png');
  assert.equal(packet.attachmentManifest[0].attachmentId, 'inline-octet');
  assert.equal(packet.attachmentManifest[0].originalName, 'image002');
  assert.equal(packet.attachmentManifest[0].contentId, 'farley-plan');
  assert.equal(packet.attachmentManifest[0].originalContentType, 'application/octet-stream');
  assert.equal(packet.attachmentManifest[0].detectedContentType, 'image/png');
  assert.equal(packet.attachmentManifest[0].referencedBy, 'cid:farley-plan');
});

test('validation rejects quote items and send/save/Xero control fields', () => {
  const packet = buildQuoteHandoffPacket(sampleInput());
  packet.candidateQuoteDraft.items.push({ category: 'seating' });
  assert.match(validateQuoteHandoffPacket(packet).join(' '), /cannot include quote items/i);

  const hostile = buildQuoteHandoffPacket(sampleInput());
  hostile.sourcePacket.send = true;
  assert.match(validateQuoteHandoffPacket(hostile).join(' '), /forbidden control field/i);

  const snakeCaseHostile = buildQuoteHandoffPacket(sampleInput());
  snakeCaseHostile.sourcePacket.send_email = true;
  assert.match(validateQuoteHandoffPacket(snakeCaseHostile).join(' '), /forbidden control field/i);

  const nestedHostile = buildQuoteHandoffPacket(sampleInput());
  nestedHostile.knownFacts.push({
    label: 'Unsafe',
    value: {
      create_xero_quote: true
    }
  });
  assert.match(validateQuoteHandoffPacket(nestedHostile).join(' '), /forbidden control field/i);

  const capabilityHostile = buildQuoteHandoffPacket(sampleInput());
  capabilityHostile.assumptions.push({
    label: 'Unsafe',
    value: {
      can_send_email: true,
      can_save_quote: true,
      call_xero: true
    }
  });
  assert.match(validateQuoteHandoffPacket(capabilityHostile).join(' '), /forbidden control field/i);

  const unsafeSafetyBlock = buildQuoteHandoffPacket(sampleInput());
  unsafeSafetyBlock.safety.can_send_email = true;
  assert.match(validateQuoteHandoffPacket(unsafeSafetyBlock).join(' '), /unexpected key/i);
});

test('writer refuses an inbox path that resolves outside the requested queue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-handoff-escape-'));
  const actual = path.join(root, 'actual-inbox');
  const outside = path.join(root, 'outside');
  const symlink = path.join(root, 'symlink-inbox');
  fs.mkdirSync(actual, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, symlink);

  assert.throws(
    () => createQuoteHandoff(sampleInput(), {
      inboxDir: symlink,
      allowedRootDir: actual
    }),
    /outside the allowed handoff root/i
  );
});
