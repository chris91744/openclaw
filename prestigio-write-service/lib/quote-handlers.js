const crypto = require('crypto');

function createQuoteHandlers(deps) {
  const {
    fs,
    path,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    HEADERS,
    MAX_QUOTE_IMAGE_BYTES,
    MAX_QUOTE_ATTACHMENT_BYTES,
    QUOTE_IMAGE_BUCKET,
    QUOTE_ATTACHMENT_BUCKET,
    stableJson,
    cleanText,
    cleanObject,
    cleanArray,
    cleanEmail,
    toNullableNumber,
    formatMoney,
    roundCurrency,
    buildModernQuoteUrl,
    quotePlanContracts,
    quotePlanHandoff,
    normalizeDraftItem,
    buildDraftQuoteDescription,
    getDraftQuoteSiteVisitTotal,
    sumDraftQuoteItems,
    ensureLivePricingSettingsForCalculatedPricing,
    costBreakdownNeedsLivePricingSettings,
    hasDirectSellPriceUpdate,
    assertQuoteRevisionManualPricingAllowed,
    assertQuoteRevisionStructuredPayloadAllowed,
    buildQuoteRevisionItemUpdates,
    mergeQuoteRevisionPatchIntoItem,
    applyQuoteRevisionItemPatch,
    quoteCompileClient,
  } = deps;

const maxQuoteAttachmentBytes = Number(MAX_QUOTE_ATTACHMENT_BYTES || MAX_QUOTE_IMAGE_BYTES || 10 * 1024 * 1024);
const quoteAttachmentBucket = QUOTE_ATTACHMENT_BUCKET || QUOTE_IMAGE_BUCKET;

async function compileDraftQuoteItems(items, fields = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  quoteCompileClient.assertDraftManualPricingAllowed(items, fields);
  const needsCompile = items.some(item => quoteCompileClient.itemNeedsCompile(item));
  if (!needsCompile) return items;
  await ensureLivePricingSettingsForCalculatedPricing();
  for (let index = 0; index < items.length; index += 1) {
    items[index] = quoteCompileClient.compileDraftQuoteItem(items[index]);
  }
  return items;
}

function normalizeDraftQuoteItemsForPayloadGate(items) {
  if (typeof quoteCompileClient.normalizeDraftQuoteItemsForPayloadGate !== 'function') return items;
  return quoteCompileClient.normalizeDraftQuoteItemsForPayloadGate(items);
}

function buildDraftQuoteItemSnapshot(payload) {
  if (typeof quotePlanHandoff?.buildQuotedPlanSnapshot === 'function') {
    return quotePlanHandoff.buildQuotedPlanSnapshot(payload);
  }
  return null;
}

function draftItemsNeedLivePricingSettings(items) {
  return Array.isArray(items) && items.some(item => {
    const formData = cleanObject(item?.form_data) || {};
    return costBreakdownNeedsLivePricingSettings(item?.cost_breakdown || item?.lineItems || formData.cost_breakdown);
  });
}

async function ensureLivePricingSettingsForDraftItems(items) {
  if (draftItemsNeedLivePricingSettings(items)) {
    await ensureLivePricingSettingsForCalculatedPricing();
  }
}

function revisionOperationsNeedLivePricingSettings(operations) {
  return Array.isArray(operations) && operations.some(op => (
    op?.op === 'update_item' &&
    (
      costBreakdownNeedsLivePricingSettings(op?.updates?.cost_breakdown) ||
      (op?.updates?.form_data !== undefined && !hasDirectSellPriceUpdate(op?.updates))
    )
  ));
}
function hostWorkspaceDir() {
  return process.env.OPENCLAW_WORKSPACE_DIR || '/Users/chrisreyes/.openclaw/workspace';
}

function attachmentRoots() {
  const workspace = hostWorkspaceDir();
  const roots = [
    path.resolve(workspace, 'mail-chris', 'attachments'),
    path.resolve(workspace, 'mail', 'attachments'),
    path.resolve(workspace, 'mail-gmail', 'attachments'),
    path.resolve('/Users/chrisreyes/.openclaw/workspace/mail-chris/attachments'),
    path.resolve('/Users/chrisreyes/.openclaw/workspace/mail/attachments'),
    path.resolve('/Users/chrisreyes/.openclaw/workspace/mail-gmail/attachments'),
    path.resolve('/home/node/.openclaw/workspace/mail-chris/attachments'),
    path.resolve('/home/node/.openclaw/workspace/mail/attachments'),
    path.resolve('/home/node/.openclaw/workspace/mail-gmail/attachments')
  ];
  return Array.from(new Set(roots));
}

function normalizeAttachmentPath(filePath) {
  const raw = String(filePath || '').trim();
  const containerPrefix = '/home/node/.openclaw/workspace';
  if (raw === containerPrefix || raw.startsWith(containerPrefix + path.sep)) {
    return path.join(hostWorkspaceDir(), raw.slice(containerPrefix.length));
  }
  const hostPrefix = '/Users/chrisreyes/.openclaw/workspace';
  if (hostWorkspaceDir().startsWith('/home/node/') && raw.startsWith(hostPrefix + path.sep)) {
    return path.join('/home/node/.openclaw/workspace', raw.slice(hostPrefix.length));
  }
  return raw;
}

function isAllowedAttachmentPath(filePath) {
  const resolved = path.resolve(normalizeAttachmentPath(filePath));
  return attachmentRoots().some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function sanitizeStorageName(value) {
  return String(value || 'image')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 160) || 'image';
}

function inferQuoteAttachmentContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return null;
}

function isImageContentType(contentType) {
  return String(contentType || '').toLowerCase().startsWith('image/');
}

function isPublicUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function filenameFromUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    return name || 'Attachment';
  } catch (_) {
    const raw = String(value || '').split('?')[0].split('#')[0];
    return raw.split('/').pop() || 'Attachment';
  }
}

function getAttachmentPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (
    value.path ||
    value.file_path ||
    value.filePath ||
    value.local_path ||
    value.localPath ||
    value.absolute_path ||
    value.absolutePath ||
    null
  );
}

function getAttachmentUrl(value) {
  if (typeof value === 'string' && isPublicUrl(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (
    value.url ||
    value.publicUrl ||
    value.public_url ||
    value.href ||
    null
  );
}

function getAttachmentFilename(value, fallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = cleanText(value.filename || value.name || value.fileName || value.originalFilename, 500);
    if (name) return name;
  }
  const url = getAttachmentUrl(value);
  if (url) return filenameFromUrl(url);
  const filePath = getAttachmentPath(value);
  if (filePath) return path.basename(filePath);
  return fallback || 'Attachment';
}

function getAttachmentContentType(value, filePath) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const type = cleanText(value.contentType || value.content_type || value.mimeType || value.mime_type || value.type, 100);
    if (type && type.includes('/')) return type;
    if (type === 'pdf') return 'application/pdf';
  }
  const url = getAttachmentUrl(value);
  if (url) return inferQuoteAttachmentContentType(filenameFromUrl(url));
  return filePath ? inferQuoteAttachmentContentType(filePath) : null;
}

function publicSourceAttachment(value) {
  const url = getAttachmentUrl(value);
  if (!url || !isPublicUrl(url)) return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const filename = getAttachmentFilename(value, filenameFromUrl(url));
  const contentType = getAttachmentContentType(value, null);
  return {
    ...source,
    url,
    filename,
    ...(contentType ? { contentType } : {}),
  };
}

async function uploadQuoteAttachmentFile(filePath, options = {}) {
  const { imageOnly = false, bucket = quoteAttachmentBucket } = options;
  const normalizedPath = normalizeAttachmentPath(filePath);
  if (!normalizedPath || !isAllowedAttachmentPath(normalizedPath)) {
    throw new Error(`Quote attachment path is outside allowed mail attachment roots: ${filePath}`);
  }
  const stat = fs.statSync(normalizedPath);
  if (!stat.isFile()) {
    throw new Error(`Quote attachment path is not a file: ${filePath}`);
  }
  const maxBytes = imageOnly ? MAX_QUOTE_IMAGE_BYTES : maxQuoteAttachmentBytes;
  if (stat.size > maxBytes) {
    throw new Error(`Quote attachment is too large: ${path.basename(normalizedPath)}`);
  }
  const contentType = inferQuoteAttachmentContentType(normalizedPath);
  if (!contentType || (imageOnly && !isImageContentType(contentType))) {
    const label = imageOnly ? 'Reference image' : 'Quote attachment';
    throw new Error(`${label} type is not supported: ${path.basename(normalizedPath)}`);
  }

  const storageName = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${sanitizeStorageName(path.basename(normalizedPath))}`;
  const body = fs.readFileSync(normalizedPath);
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(storageName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'false'
    },
    body
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Quote attachment upload failed ${res.status}: ${text}`);
  }

  return {
    url: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(storageName)}`,
    filename: path.basename(normalizedPath),
    contentType,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    storageBucket: bucket,
  };
}

async function uploadQuoteImage(filePath) {
  const uploaded = await uploadQuoteAttachmentFile(filePath, {
    imageOnly: true,
    bucket: QUOTE_IMAGE_BUCKET,
  });
  return uploaded.url;
}

async function resolveDraftReferenceImages(item) {
  const candidates = [
    ...cleanArray(item.reference_images),
    ...cleanArray(item.referenceImages),
    ...cleanArray(item.reference_image_paths),
    ...cleanArray(item.referenceImagePaths)
  ].filter(Boolean);

  if (!candidates.length) return null;

  const urls = [];
  for (const candidate of candidates) {
    const url = getAttachmentUrl(candidate);
    if (url && isPublicUrl(url)) {
      urls.push(url);
    } else {
      const filePath = getAttachmentPath(candidate);
      if (filePath) urls.push(await uploadQuoteImage(filePath));
    }
  }
  return urls.length ? urls : null;
}

function collectDraftSourceAttachmentEntries(item) {
  const formData = cleanObject(item?.form_data) || {};
  return [
    ...cleanArray(item.sourceAttachments),
    ...cleanArray(item.source_attachments),
    ...cleanArray(item.sourceAttachmentPaths),
    ...cleanArray(item.source_attachment_paths),
    ...cleanArray(item.attachment_paths),
    ...cleanArray(item.attachments),
    ...cleanArray(formData.sourceAttachments),
    ...cleanArray(formData.source_attachments),
    ...cleanArray(formData.sourceAttachmentPaths),
    ...cleanArray(formData.source_attachment_paths),
    ...cleanArray(formData.attachment_paths),
  ].filter(Boolean);
}

function dedupeSourceAttachments(attachments) {
  const seen = new Set();
  return attachments.filter((attachment) => {
    const key = `${attachment.url || ''}:${attachment.filename || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveDraftSourceAttachments(item) {
  const entries = collectDraftSourceAttachmentEntries(item);
  if (!entries.length) return null;

  const attachments = [];
  for (const entry of entries) {
    const publicAttachment = publicSourceAttachment(entry);
    if (publicAttachment) {
      attachments.push(publicAttachment);
      continue;
    }

    const filePath = getAttachmentPath(entry);
    if (!filePath) continue;
    const uploaded = await uploadQuoteAttachmentFile(filePath, { imageOnly: false });
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    const filename = getAttachmentFilename(entry, uploaded.filename);
    attachments.push({
      ...source,
      url: uploaded.url,
      filename,
      contentType: getAttachmentContentType(entry, filePath) || uploaded.contentType,
      sha256: uploaded.sha256,
      storageBucket: uploaded.storageBucket,
      source: source.source || 'mail_attachment',
      uploadedBy: 'prestigio-write-service',
    });
  }

  return attachments.length ? dedupeSourceAttachments(attachments) : null;
}

function assertLocalAttachmentUsable(filePath, { imageOnly = false } = {}) {
  const normalizedPath = normalizeAttachmentPath(filePath);
  if (!normalizedPath || !isAllowedAttachmentPath(normalizedPath)) {
    throw new Error(`Quote attachment path is outside allowed mail attachment roots: ${filePath}`);
  }
  const stat = fs.statSync(normalizedPath);
  if (!stat.isFile()) {
    throw new Error(`Quote attachment path is not a file: ${filePath}`);
  }
  const maxBytes = imageOnly ? MAX_QUOTE_IMAGE_BYTES : maxQuoteAttachmentBytes;
  if (stat.size > maxBytes) {
    throw new Error(`Quote attachment is too large: ${path.basename(normalizedPath)}`);
  }
  const contentType = inferQuoteAttachmentContentType(normalizedPath);
  if (!contentType || (imageOnly && !isImageContentType(contentType))) {
    const label = imageOnly ? 'Reference image' : 'Quote attachment';
    throw new Error(`${label} type is not supported: ${path.basename(normalizedPath)}`);
  }
}

function assertDraftAttachmentReferencesValid(items) {
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    const label = `Draft quote item ${index + 1}`;
    const referenceCandidates = [
      ...cleanArray(item.reference_images),
      ...cleanArray(item.referenceImages),
      ...cleanArray(item.reference_image_paths),
      ...cleanArray(item.referenceImagePaths),
    ].filter(Boolean);
    referenceCandidates.forEach((candidate) => {
      const url = getAttachmentUrl(candidate);
      if (url && isPublicUrl(url)) return;
      const filePath = getAttachmentPath(candidate);
      if (!filePath) {
        throw new Error(`${label} reference image must include a public URL or allowed mail attachment path.`);
      }
      assertLocalAttachmentUsable(filePath, { imageOnly: true });
    });

    collectDraftSourceAttachmentEntries(item).forEach((candidate) => {
      const url = getAttachmentUrl(candidate);
      if (url && isPublicUrl(url)) return;
      const filePath = getAttachmentPath(candidate);
      if (!filePath) {
        throw new Error(`${label} source attachment must include a public URL or allowed mail attachment path.`);
      }
      assertLocalAttachmentUsable(filePath, { imageOnly: false });
    });
  });
}

async function buildDraftQuotePayload(fields) {
  const quote = cleanObject(fields.quote) || {};
  if (quote.grand_total !== undefined || quote.grandTotal !== undefined) {
    throw new Error(
      'create-draft-quote must omit quote.grand_total. The write service derives quote totals from item pricing and site visit fields.',
    );
  }
  await compileDraftQuoteItems(fields.items, fields);
  await ensureLivePricingSettingsForDraftItems(fields.items);
  const items = Array.isArray(fields.items) ? fields.items.map((item, index) => normalizeDraftItem(item, index)) : [];

  if (items.length === 0) {
    throw new Error('create-draft-quote requires at least one item');
  }
  if (!quote.client_id) {
    throw new Error('create-draft-quote requires quote.client_id. Resolve or confirm the client before writing.');
  }

  const siteVisitTotal = getDraftQuoteSiteVisitTotal(quote);
  const itemTotal = sumDraftQuoteItems(items);
  return {
    quote: {
      client_id: quote.client_id,
      project_id: quote.project_id || null,
      sidemark: cleanText(quote.sidemark || quote.project_name || quote.client_name || 'Draft Quote', 500),
      status: 'draft',
      grand_total: Math.round((itemTotal + siteVisitTotal) * 100) / 100,
      site_visit_hours: toNullableNumber(quote.site_visit_hours),
      site_visit_rate: toNullableNumber(quote.site_visit_rate),
      site_visit_total: siteVisitTotal > 0 ? siteVisitTotal : toNullableNumber(quote.site_visit_total),
      description: cleanText(quote.description, 3000) || buildDraftQuoteDescription(items)
    },
    items: await Promise.all(items.map(async (item, index) => {
      const quantity = toNullableNumber(item.quantity) || 1;
      const sellPrice = toNullableNumber(item.sell_price ?? item.price ?? item.total);
      const category = cleanText(item.category, 100) || cleanText(item.item_type || item.type, 100);
      const itemName = cleanText(item.item_name || item.name || item.item || category || `Draft item ${index + 1}`, 500);
      const description = cleanText(item.description || itemName, 5000);
      const referenceImages = await resolveDraftReferenceImages(item);
      const sourceAttachments = await resolveDraftSourceAttachments(item);
      const formData = cleanObject(item.form_data) || {
        quote_intake_draft: true,
        source: 'stitch',
        assumptions: Array.isArray(item.assumptions) ? item.assumptions : [],
        client_questions: Array.isArray(item.client_questions) ? item.client_questions : [],
        fabric_notes: cleanText(item.fabric_notes || item.com_notes, 1000),
        com_yardage: toNullableNumber(item.com_yardage || item.estimated_fabric_yardage),
        confidence: cleanText(item.confidence, 200)
      };
      const formDataWithAttachments = sourceAttachments
        ? { ...formData, sourceAttachments }
        : formData;
      const payload = {
        item_type: cleanText(item.item_type || item.type || itemName, 200),
        item_name: itemName,
        category,
        description,
        width: toNullableNumber(item.width),
        depth: toNullableNumber(item.depth),
        height: toNullableNumber(item.height),
        quantity,
        room: cleanText(item.room || item.sidemark_room, 500),
        sidemark: cleanText(item.sidemark || item.room || itemName, 500),
        reference_images: referenceImages,
        sell_price: sellPrice,
        cost_breakdown: cleanObject(item.cost_breakdown),
        form_data: formDataWithAttachments,
        estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || item.com_yardage),
        status: 'quote',
        quote_item_status: 'quoted'
      };
      payload.quoted_plan_snapshot = buildDraftQuoteItemSnapshot(payload);
      return payload;
    }))
  };
}

async function supabaseRequest(table, method, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      ...HEADERS,
      Prefer: 'return=representation'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${table} ${method} ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

async function fetchProjectForDraftQuote(projectId) {
  const cleanProjectId = cleanText(projectId, 100);
  if (!cleanProjectId) return null;

  const rows = await supabaseRequest(
    'projects',
    'GET',
    undefined,
    `?select=id,name,client_id,clients(id,name,company)&id=eq.${encodeURIComponent(cleanProjectId)}&limit=1`
  );
  const project = Array.isArray(rows) ? rows[0] : rows;
  return project || null;
}

async function resolveDraftQuoteClientFromProject(fields) {
  if (!fields || fields.action !== undefined) return fields;
  const quote = cleanObject(fields.quote);
  if (!quote || !quote.project_id) return fields;

  const project = await fetchProjectForDraftQuote(quote.project_id);
  if (!project?.id) {
    throw new Error(`create-draft-quote could not find project_id ${quote.project_id}`);
  }
  if (!project.client_id) {
    throw new Error(`create-draft-quote project ${quote.project_id} has no client_id`);
  }

  if (quote.client_id && quote.client_id !== project.client_id) {
    throw new Error(`create-draft-quote quote.client_id does not match the selected project's client_id`);
  }

  fields.quote = {
    ...quote,
    client_id: quote.client_id || project.client_id,
    project_name: quote.project_name || project.name || undefined,
    client_name: quote.client_name || project.clients?.company || project.clients?.name || undefined
  };
  return fields;
}

async function findExistingClient(client) {
  const name = cleanText(client.name || client.company, 500);
  const email = cleanEmail(client.email);
  const candidates = [];

  if (email) {
    candidates.push(
      supabaseRequest('clients', 'GET', undefined, `?select=id,name,company,email&email=ilike.${encodeURIComponent(email)}&limit=5`)
        .catch(() => [])
    );
  }
  if (name) {
    const term = encodeURIComponent(`*${name}*`);
    candidates.push(
      supabaseRequest('clients', 'GET', undefined, `?select=id,name,company,email&or=(name.ilike.${term},company.ilike.${term})&limit=10`)
        .catch(() => [])
    );
  }

  const results = (await Promise.all(candidates)).flat();
  const seen = new Set();
  return results.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

async function createClientProject(fields) {
  const clientInput = cleanObject(fields.client) || {};
  const projectInput = cleanObject(fields.project) || null;
  const clientName = cleanText(clientInput.name || clientInput.company, 500);

  if (!clientName) {
    throw new Error('create-client-project requires client.name or client.company');
  }

  const existingClients = await findExistingClient(clientInput);
  if (existingClients.length > 0) {
    return {
      message: `Possible existing client match found. Did not create a duplicate.`,
      duplicate_risk: true,
      existing_clients: existingClients
    };
  }

  const clientPayload = {
    name: cleanText(clientInput.name, 500) || clientName,
    company: cleanText(clientInput.company, 500),
    email: cleanEmail(clientInput.email),
    phone: cleanText(clientInput.phone, 100),
    address: cleanText(clientInput.address, 1000)
  };

  const clientRows = await supabaseRequest('clients', 'POST', clientPayload, '?select=*');
  const client = Array.isArray(clientRows) ? clientRows[0] : clientRows;
  if (!client?.id) {
    throw new Error('Client insert did not return an id');
  }

  let project = null;
  if (projectInput && cleanText(projectInput.name, 500)) {
    const projectPayload = {
      name: cleanText(projectInput.name, 500),
      client_id: client.id,
      status: cleanText(projectInput.status, 100) || 'quoting',
      due_date: cleanText(projectInput.due_date, 50)
    };
    try {
      const projectRows = await supabaseRequest('projects', 'POST', projectPayload, '?select=*');
      project = Array.isArray(projectRows) ? projectRows[0] : projectRows;
    } catch (err) {
      await supabaseRequest('clients', 'DELETE', undefined, `?id=eq.${client.id}`);
      throw err;
    }
  }

  return {
    message: project
      ? `Created client ${client.name || client.company} and project ${project.name}`
      : `Created client ${client.name || client.company}`,
    client,
    project
  };
}

async function createDraftQuote(fields) {
  const payload = await buildDraftQuotePayload(fields);
  const quoteRows = await supabaseRequest('quotes', 'POST', payload.quote, '?select=*');
  const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
  if (!quote?.id) {
    throw new Error('Draft quote insert did not return an id');
  }

  const itemPayloads = payload.items.map(item => ({ ...item, quote_id: quote.id }));
  let items = [];
  try {
    items = await supabaseRequest('order_items', 'POST', itemPayloads, '?select=id,item_name,sidemark,sell_price,quantity,status,quote_item_status');
  } catch (err) {
    await supabaseRequest('quotes', 'DELETE', undefined, `?id=eq.${quote.id}`);
    throw err;
  }

  return {
    message: `Created draft quote ${quote.quote_number || quote.id} with ${itemPayloads.length} item(s)`,
    quote_url: buildModernQuoteUrl(quote.id),
    quote,
    items
  };
}


function quoteRevisionItemLineTotal(item) {
  return roundCurrency((Number(item.sell_price) || 0) * (Number(item.quantity) || 1));
}

function quoteRevisionShortText(value, max = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function quoteRevisionHasUnsafeStatus(item) {
  const statuses = [item.status, item.item_status, item.quote_item_status]
    .filter(Boolean)
    .map(status => String(status).toLowerCase());
  return statuses.some(status => [
    'won',
    'approved',
    'ordered',
    'in_production',
    'in-production',
    'production',
    'complete',
    'completed',
    'received'
  ].includes(status));
}


async function resolveExistingQuote(quoteInput) {
  const quote = cleanObject(quoteInput) || {};
  let query = '?select=*&limit=2';
  if (quote.quote_id || quote.id) {
    query += `&id=eq.${encodeURIComponent(quote.quote_id || quote.id)}`;
  } else if (quote.xero_quote_number) {
    query += `&xero_quote_number=eq.${encodeURIComponent(quote.xero_quote_number)}`;
  } else if (quote.quote_number) {
    query += `&quote_number=eq.${encodeURIComponent(quote.quote_number)}`;
  } else {
    throw new Error('revise-existing-quote requires quote_id, xero_quote_number, or quote_number');
  }

  const rows = await supabaseRequest('quotes', 'GET', undefined, query);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No matching quote found');
  }
  if (rows.length > 1) {
    throw new Error('Quote lookup matched more than one quote; use quote_id');
  }
  return rows[0];
}

async function fetchExistingQuoteItems(quoteId) {
  const query = `?select=*&quote_id=eq.${encodeURIComponent(quoteId)}&order=created_at.asc`;
  const rows = await supabaseRequest('order_items', 'GET', undefined, query);
  return Array.isArray(rows) ? rows : [];
}

function buildResolvedQuoteRevisionPlan(fields, quote, items) {
  const operations = cleanArray(fields.operations);
  if (operations.length === 0) {
    throw new Error('revise-existing-quote requires at least one operation');
  }

  const unsupported = operations.filter(op => !['remove_item', 'update_item'].includes(op.op));
  if (unsupported.length) {
    throw new Error(`Unsupported revision operation(s): ${unsupported.map(op => op.op).join(', ')}`);
  }

  const itemById = new Map(items.map(item => [item.id, item]));
  const removeIds = new Set();
  const removed = [];
  const updated = [];
  const updatePatches = new Map();

  for (const op of operations) {
    if (!op.item_id) {
      throw new Error(`${op.op} operation missing item_id`);
    }
    const item = itemById.get(op.item_id);
    if (!item) {
      throw new Error(`Item ${op.item_id} does not belong to quote ${quote.id}`);
    }
    if (item.po_id) {
      throw new Error(`Refusing to revise item ${op.item_id}; it is tied to PO ${item.po_id}`);
    }
    if (quoteRevisionHasUnsafeStatus(item)) {
      throw new Error(`Refusing to revise item ${op.item_id}; status is no longer a quote-only row`);
    }

    if (op.op === 'remove_item') {
      if (removeIds.has(op.item_id)) {
        throw new Error(`Duplicate remove_item operation for ${op.item_id}`);
      }
      if (updatePatches.has(op.item_id)) {
        throw new Error(`Item ${op.item_id} cannot be both updated and removed`);
      }
      removeIds.add(op.item_id);
      removed.push({ item, reason: op.reason || '' });
      continue;
    }

    if (op.op === 'update_item') {
      if (removeIds.has(op.item_id)) {
        throw new Error(`Item ${op.item_id} cannot be both removed and updated`);
      }
      if (updatePatches.has(op.item_id)) {
        throw new Error(`Duplicate update_item operation for ${op.item_id}`);
      }
      assertQuoteRevisionManualPricingAllowed(fields, op);
      assertQuoteRevisionStructuredPayloadAllowed(fields, op);
      const patch = buildQuoteRevisionItemUpdates(op.updates);
      if (!Object.keys(patch).length) {
        throw new Error(`update_item operation for ${op.item_id} has no supported updates`);
      }
      const mergedPatch = mergeQuoteRevisionPatchIntoItem(item, patch);
      updatePatches.set(op.item_id, mergedPatch);
      updated.push({ before: item, after: applyQuoteRevisionItemPatch(item, mergedPatch), patch: mergedPatch, reason: op.reason || '' });
    }
  }

  const finalItems = items
    .filter(item => !removeIds.has(item.id))
    .map(item => updatePatches.has(item.id) ? applyQuoteRevisionItemPatch(item, updatePatches.get(item.id)) : item);
  if (finalItems.length === 0) {
    throw new Error('Revision would remove every quote item; refusing');
  }

  const itemTotalBefore = roundCurrency(items.reduce((sum, item) => sum + quoteRevisionItemLineTotal(item), 0));
  const itemTotalAfter = roundCurrency(finalItems.reduce((sum, item) => sum + quoteRevisionItemLineTotal(item), 0));
  const siteVisitTotal = roundCurrency(quote.site_visit_total || 0);
  const beforeTotal = roundCurrency(itemTotalBefore + siteVisitTotal);
  const afterTotal = roundCurrency(itemTotalAfter + siteVisitTotal);

  const expected = cleanObject(fields.expected) || {};
  if (expected.before_total !== undefined && roundCurrency(expected.before_total) !== beforeTotal) {
    throw new Error(`Expected before_total ${formatMoney(expected.before_total)} but current quote totals ${formatMoney(beforeTotal)}`);
  }
  if (expected.after_total !== undefined && roundCurrency(expected.after_total) !== afterTotal) {
    throw new Error(`Expected after_total ${formatMoney(expected.after_total)} but revision would total ${formatMoney(afterTotal)}`);
  }

  return {
    quote: {
      id: quote.id,
      sidemark: quote.sidemark || null,
      status: quote.status || null,
      quote_number: quote.quote_number || null,
      xero_quote_number: quote.xero_quote_number || null,
      xero_quote_id: quote.xero_quote_id || null
    },
    revision_reason: cleanText(fields.revision_reason, 1000),
    totals: {
      before: beforeTotal,
      after: afterTotal,
      site_visit_total: siteVisitTotal
    },
    remove_item_ids: Array.from(removeIds),
    update_item_patches: Object.fromEntries(updatePatches.entries()),
    removed: removed.map(({ item, reason }) => ({
      id: item.id,
      item_type: item.item_type || null,
      custom_name: item.custom_name || item.sidemark || null,
      description: quoteRevisionShortText(item.description),
      quantity: Number(item.quantity) || 1,
      sell_price: Number(item.sell_price) || 0,
      line_total: quoteRevisionItemLineTotal(item),
      reason
    })),
    updated: updated.map(({ before, after, patch, reason }) => ({
      id: before.id,
      custom_name: before.custom_name || before.sidemark || null,
      quantity_before: Number(before.quantity) || 1,
      quantity_after: Number(after.quantity) || 1,
      sell_price_before: Number(before.sell_price) || 0,
      sell_price_after: Number(after.sell_price) || 0,
      line_total_before: quoteRevisionItemLineTotal(before),
      line_total_after: quoteRevisionItemLineTotal(after),
      fields: Object.keys(patch),
      reason
    })),
    kept: finalItems.map(item => ({
      id: item.id,
      item_type: item.item_type || null,
      custom_name: item.custom_name || item.sidemark || null,
      description: quoteRevisionShortText(item.description),
      quantity: Number(item.quantity) || 1,
      sell_price: Number(item.sell_price) || 0,
      line_total: quoteRevisionItemLineTotal(item)
    })),
    source_context: cleanObject(fields.source_context) || null
  };
}

function summarizeResolvedQuoteRevisionPlan(plan) {
  const label = plan.quote.xero_quote_number || plan.quote.quote_number || plan.quote.id;
  const lines = [
    `Revise existing quote ${label}${plan.quote.sidemark ? ` / ${plan.quote.sidemark}` : ''}`,
    `Total: ${formatMoney(plan.totals.before)} -> ${formatMoney(plan.totals.after)}`,
    '',
    'Remove:'
  ];
  for (const item of plan.removed) {
    lines.push(`- ${item.quantity} x ${formatMoney(item.sell_price)} = ${formatMoney(item.line_total)} | ${item.custom_name || item.item_type || item.id}`);
    if (item.description) lines.push(`  ${item.description}`);
    if (item.reason) lines.push(`  Reason: ${item.reason}`);
  }
  if (plan.updated.length) {
    lines.push('', 'Update:');
    for (const item of plan.updated) {
      lines.push(`- ${item.custom_name || item.id}: ${formatMoney(item.line_total_before)} -> ${formatMoney(item.line_total_after)} | fields: ${item.fields.join(', ')}`);
      if (item.reason) lines.push(`  Reason: ${item.reason}`);
    }
  }
  lines.push('', 'Keep:');
  for (const item of plan.kept) {
    lines.push(`- ${item.quantity} x ${formatMoney(item.sell_price)} = ${formatMoney(item.line_total)} | ${item.custom_name || item.item_type || item.id}`);
    if (item.description) lines.push(`  ${item.description}`);
  }
  if (plan.quote.xero_quote_id || plan.quote.xero_quote_number) {
    lines.push('', 'Xero note: this revises Prestigio only. Use the normal resend/update-to-Xero flow afterward so Xero/PDF match.');
  }
  return lines.join('\n');
}

function computeResolvedQuoteRevisionDigest(plan) {
  const secret = process.env.STITCH_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!secret) return null;
  return crypto
    .createHmac('sha256', secret)
    .update(stableJson({ action: 'revise-existing-quote', plan }))
    .digest('base64url');
}

function buildQuoteDescriptionFromRemainingItems(items) {
  return cleanArray(items)
    .map(item => cleanText(item.description, 1000))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000) || null;
}

function syncPreparedQuoteRevisionSnapshot(patch) {
  const snapshot = cleanObject(patch.quoted_plan_snapshot);
  if (!snapshot) return;

  const snapshotItem = cleanObject(snapshot.item) || {};
  const snapshotFormData = cleanObject(snapshot.form_data) || {};
  patch.quoted_plan_snapshot = {
    ...snapshot,
    item: {
      ...snapshotItem,
      reference_images: patch.reference_images !== undefined
        ? patch.reference_images
        : snapshotItem.reference_images,
    },
    form_data: patch.form_data !== undefined
      ? patch.form_data
      : snapshotFormData,
  };
}

async function prepareQuoteRevisionItemPatchForWrite(patch) {
  const prepared = { ...patch };
  const referenceImages = await resolveDraftReferenceImages(prepared);
  if (referenceImages) {
    prepared.reference_images = referenceImages;
  }
  delete prepared.reference_image_paths;
  delete prepared.referenceImagePaths;

  const sourceAttachments = await resolveDraftSourceAttachments(prepared);
  if (sourceAttachments) {
    prepared.form_data = {
      ...(cleanObject(prepared.form_data) || {}),
      sourceAttachments,
    };
  }
  delete prepared.sourceAttachments;
  delete prepared.source_attachments;
  delete prepared.sourceAttachmentPaths;
  delete prepared.source_attachment_paths;
  delete prepared.attachment_paths;
  delete prepared.attachments;

  syncPreparedQuoteRevisionSnapshot(prepared);
  return prepared;
}

async function reviseExistingQuote(fields) {
  const quote = await resolveExistingQuote(fields.quote);
  const items = await fetchExistingQuoteItems(quote.id);
  const plan = buildResolvedQuoteRevisionPlan(fields, quote, items);
  const remainingItems = items
    .filter(item => !plan.remove_item_ids.includes(item.id))
    .map(item => {
      const patch = plan.update_item_patches[item.id];
      return patch ? applyQuoteRevisionItemPatch(item, patch) : item;
    });

  for (const [itemId, patch] of Object.entries(plan.update_item_patches)) {
    const preparedPatch = await prepareQuoteRevisionItemPatchForWrite(patch);
    await supabaseRequest(
      'order_items',
      'PATCH',
      { ...preparedPatch, updated_at: new Date().toISOString() },
      `?id=eq.${encodeURIComponent(itemId)}&select=*`
    );
  }

  if (plan.remove_item_ids.length) {
    await supabaseRequest(
      'order_items',
      'DELETE',
      undefined,
      `?id=in.(${plan.remove_item_ids.map(id => encodeURIComponent(id)).join(',')})`
    );
  }

  const quoteRows = await supabaseRequest(
    'quotes',
    'PATCH',
    {
      grand_total: plan.totals.after,
      description: buildQuoteDescriptionFromRemainingItems(remainingItems),
      updated_at: new Date().toISOString()
    },
    `?id=eq.${encodeURIComponent(quote.id)}&select=*`
  );
  const updatedQuote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;

  return {
    message: `Revised quote ${quote.xero_quote_number || quote.quote_number || quote.id}: ${formatMoney(plan.totals.before)} -> ${formatMoney(plan.totals.after)}`,
    quote: updatedQuote,
    removed_item_ids: plan.remove_item_ids,
    updated_item_ids: plan.updated.map(item => item.id),
    kept_item_ids: plan.kept.map(item => item.id),
    before_total: plan.totals.before,
    after_total: plan.totals.after,
    xero_note: (quote.xero_quote_id || quote.xero_quote_number)
      ? 'Prestigio was revised locally. Use the normal resend/update-to-Xero flow so Xero and the client PDF match.'
      : null
  };
}
async function callEdgeFunction(action, fields) {
  const payload = { action, ...fields };
  const functionName =
    action === 'apply-credit' ? 'xero-apply-credit' :
    action === 'search-xero-invoices' ? 'xero-search-invoices' :
    action === 'search-xero-quotes' ? 'xero-search-quotes' :
    action === 'search-xero-bank-transactions' ? 'xero-search-bank-transactions' :
    action === 'search-xero-credit-notes' ? 'xero-search-credit-notes' :
    action === 'create-invoice' ? 'xero-create-invoice' :
    action === 'record-payment' ? 'xero-record-payment' :
    action === 'email-invoice' ? 'xero-email-invoice' :
    action === 'send-invoice-email' ? 'xero-send-invoice-email' :
    action === 'create-xero-contact' ? 'xero-create-contact' :
    'stitch-write';
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Edge function ${res.status}: ${body}`);
  }

  try {
    return JSON.parse(body);
  } catch (_) {
    return { message: body };
  }
}
  return {
    draftItemsNeedLivePricingSettings,
    ensureLivePricingSettingsForDraftItems,
    compileDraftQuoteItems,
    normalizeDraftQuoteItemsForPayloadGate,
    assertDraftAttachmentReferencesValid,
    revisionOperationsNeedLivePricingSettings,
    normalizeAttachmentPath,
    isAllowedAttachmentPath,
    resolveDraftReferenceImages,
    resolveDraftSourceAttachments,
    buildDraftQuotePayload,
    supabaseRequest,
    resolveDraftQuoteClientFromProject,
    createClientProject,
    createDraftQuote,
    resolveExistingQuote,
    fetchExistingQuoteItems,
    buildResolvedQuoteRevisionPlan,
    summarizeResolvedQuoteRevisionPlan,
    computeResolvedQuoteRevisionDigest,
    reviseExistingQuote,
    callEdgeFunction,
  };
}

module.exports = { createQuoteHandlers };
