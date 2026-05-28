function createOrchestrator(deps) {
  const {
    fs,
    path,
    ACTION_FIELDS,
    CONFIRMABLE_ACTIONS,
    LEGACY_REQUEST_FILE,
    REQUEST_DIR,
    writeResponse,
    sanitizeRequestId,
    isStableFile,
    listPendingRequestFiles,
    ensureBusDirs,
    cleanupOldBusFiles,
    resolveDraftQuoteClientFromProject,
    normalizeDraftQuoteItemsForPayloadGate,
    assertDraftAttachmentReferencesValid,
    compileDraftQuoteItems,
    ensureLivePricingSettingsForDraftItems,
    revisionOperationsNeedLivePricingSettings,
    ensureLivePricingSettingsForCalculatedPricing,
    resolveExistingQuote,
    fetchExistingQuoteItems,
    buildResolvedQuoteRevisionPlan,
    computeResolvedQuoteRevisionDigest,
    summarizeResolvedQuoteRevisionPlan,
    computeConfirmDigest,
    buildConfirmSummary,
    summarizeCompiledDraftItemsForPreview,
    getPayloadGate,
    createDraftQuote,
    createClientProject,
    reviseExistingQuote,
    callEdgeFunction,
  } = deps;

let lastLegacyMtime = 0;
let watcherBusy = false;
let lastCleanupAt = 0;

async function processWriteRequest(request, { requestId, legacy = false } = {}) {
  const action = request.action;
  console.log(`[write] ${action} item_id=${request.item_id || '(none)'}`);

  const allowedFields = ACTION_FIELDS[action];
  if (!allowedFields) {
    writeResponse({
      success: false,
      action: action,
      error: `Unknown action: ${action}`,
      completed_at: new Date().toISOString()
    }, { requestId, legacy });
    return;
  }

  const fields = {};
  for (const key of allowedFields) {
    if (request[key] !== undefined) {
      fields[key] = request[key];
    }
  }

  if (action === 'create-draft-quote') {
    try {
      if (typeof normalizeDraftQuoteItemsForPayloadGate === 'function') {
        fields.items = normalizeDraftQuoteItemsForPayloadGate(fields.items);
      }
      if (typeof assertDraftAttachmentReferencesValid === 'function') {
        assertDraftAttachmentReferencesValid(fields.items);
      }
      getPayloadGate().validateCreateDraftQuote(
        { quote: fields.quote, items: fields.items, source_context: fields.source_context },
        fields,
      );
      await resolveDraftQuoteClientFromProject(fields);
      await compileDraftQuoteItems(fields.items, fields);
      await ensureLivePricingSettingsForDraftItems(fields.items);
    } catch (err) {
      writeResponse({
        success: false,
        action: action,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.internal_blocker ? { internal_blocker: true } : {}),
        ...(Array.isArray(err.missing_pricing_rows) ? { missing_pricing_rows: err.missing_pricing_rows } : {}),
        ...(err.pricing_lineage ? { pricing_lineage: err.pricing_lineage } : {}),
        completed_at: new Date().toISOString()
      }, { requestId, legacy });
      return;
    }
  }

  if (action === 'revise-existing-quote') {
    try {
      if (revisionOperationsNeedLivePricingSettings(fields.operations)) {
        await ensureLivePricingSettingsForCalculatedPricing();
      }
      const quote = await resolveExistingQuote(fields.quote);
      const items = await fetchExistingQuoteItems(quote.id);
      const plan = buildResolvedQuoteRevisionPlan(fields, quote, items);
      const digest = computeResolvedQuoteRevisionDigest(plan);
      if (!digest) {
        writeResponse({
          success: false,
          error: 'Missing confirmation secret for confirmable action',
          completed_at: new Date().toISOString()
        }, { requestId, legacy });
        return;
      }
      if (!fields.confirmed) {
        writeResponse({
          success: false,
          requires_confirmation: true,
          action: action,
          summary: summarizeResolvedQuoteRevisionPlan(plan),
          confirm_digest: digest,
          completed_at: new Date().toISOString()
        }, { requestId, legacy });
        return;
      }
      if (fields.confirm_digest !== digest) {
        writeResponse({
          success: false,
          error: 'DIGEST_MISMATCH',
          message: 'Confirmation digest does not match. The quote or payload may have changed.',
          completed_at: new Date().toISOString()
        }, { requestId, legacy });
        return;
      }
    } catch (err) {
      writeResponse({
        success: false,
        action: action,
        error: err.message,
        completed_at: new Date().toISOString()
      }, { requestId, legacy });
      return;
    }
  }

  if (action !== 'revise-existing-quote' && CONFIRMABLE_ACTIONS.includes(action)) {
    const digest = computeConfirmDigest(action, fields);
    if (!digest) {
      writeResponse({
        success: false,
        error: 'Missing confirmation secret for confirmable action',
        completed_at: new Date().toISOString()
      }, { requestId, legacy });
      return;
    }

    if (!fields.confirmed) {
      const previewResponse = {
        success: false,
        requires_confirmation: true,
        action: action,
        summary: buildConfirmSummary(action, fields),
        confirm_digest: digest,
        completed_at: new Date().toISOString()
      };
      if (action === 'create-draft-quote' && typeof summarizeCompiledDraftItemsForPreview === 'function') {
        previewResponse.compiled_items = summarizeCompiledDraftItemsForPreview(fields.items);
      }
      writeResponse(previewResponse, { requestId, legacy });
      return;
    }

    if (fields.confirm_digest !== digest) {
      writeResponse({
        success: false,
        error: 'DIGEST_MISMATCH',
        message: 'Confirmation digest does not match. The payload may have changed.',
        completed_at: new Date().toISOString()
      }, { requestId, legacy });
      return;
    }
  }

  try {
    const result = action === 'create-draft-quote'
      ? await createDraftQuote(fields)
      : action === 'create-client-project'
        ? await createClientProject(fields)
        : action === 'revise-existing-quote'
          ? await reviseExistingQuote(fields)
          : await callEdgeFunction(action, fields);
    writeResponse({
      success: true,
      action: action,
      item_id: request.item_id || request.order_item_id || null,
      message: result.message || 'OK',
      result: result,
      completed_at: new Date().toISOString()
    }, { requestId, legacy });
    console.log(`[done] ${action} item_id=${request.item_id || '(none)'}`);
  } catch (err) {
    console.error(`[error] ${action}: ${err.message}`);
    writeResponse({
      success: false,
      action: action,
      item_id: request.item_id || request.order_item_id || null,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.internal_blocker ? { internal_blocker: true } : {}),
      ...(Array.isArray(err.missing_pricing_rows) ? { missing_pricing_rows: err.missing_pricing_rows } : {}),
      ...(err.pricing_lineage ? { pricing_lineage: err.pricing_lineage } : {}),
      completed_at: new Date().toISOString()
    }, { requestId, legacy });
  }
}

function maybeCleanupBusFiles() {
  if (Date.now() - lastCleanupAt < 60_000) return;
  cleanupOldBusFiles();
  lastCleanupAt = Date.now();
}

async function processLegacyRequest() {
  if (!fs.existsSync(LEGACY_REQUEST_FILE)) return;
  const stat = fs.statSync(LEGACY_REQUEST_FILE);
  const mtime = stat.mtimeMs;
  if (mtime <= lastLegacyMtime) return;
  if (!isStableFile(LEGACY_REQUEST_FILE)) return;
  lastLegacyMtime = mtime;

  const raw = fs.readFileSync(LEGACY_REQUEST_FILE, 'utf8');
  const request = JSON.parse(raw);
  const requestId = request.requestId ? sanitizeRequestId(request.requestId) : undefined;
  await processWriteRequest(request, { requestId, legacy: true });
}

async function processRequestFile(filePath) {
  const requestId = sanitizeRequestId(path.basename(filePath, '.json'));
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const request = JSON.parse(raw);
    await processWriteRequest(request, { requestId, legacy: false });
  } catch (err) {
    console.error(`[watcher error] ${err.message}`);
    writeResponse({
      success: false,
      error: err.message,
      completed_at: new Date().toISOString()
    }, { requestId, legacy: false });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {
      // best effort cleanup
    }
  }
}

async function checkForRequest() {
  if (watcherBusy) return;
  watcherBusy = true;
  try {
    ensureBusDirs();
    maybeCleanupBusFiles();

    for (const filePath of listPendingRequestFiles(REQUEST_DIR)) {
      await processRequestFile(filePath);
    }

    await processLegacyRequest();
  } catch (err) {
    console.error(`[watcher error] ${err.message}`);
  } finally {
    watcherBusy = false;
  }
}
  return {
    processWriteRequest,
    processLegacyRequest,
    processRequestFile,
    checkForRequest,
    maybeCleanupBusFiles,
  };
}

module.exports = { createOrchestrator };
