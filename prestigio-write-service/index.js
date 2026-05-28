const http = require('http');
const fs = require('fs');
const path = require('path');

const { quotePlanContracts, quoteDescriptionGenerators, pillowCalc, cushionCalc, reupholsteryCalc, restuffingCalc, patioCalc, softgoodsCalc, ottomanCalc, bedCalc, seatingCalc } = require('./lib/shared-app-modules');
const utils = require('./lib/utils');
const { createPricingCalculators } = require('./lib/pricing-calculators');
const { createPricingSettings } = require('./lib/pricing-settings');
const { createCategoryRegistry } = require('./lib/category-registry');
const { createMergeRevisionPatch } = require('./lib/merge-revision-patch');
const { createBus } = require('./lib/bus');
const { createConfirmModule, ACTION_FIELDS, CONFIRMABLE_ACTIONS } = require('./lib/confirm');
const { createDraftNormalizers } = require('./lib/draft-normalizers');
const { createQuoteHandlers } = require('./lib/quote-handlers');
const { createOrchestrator } = require('./lib/orchestrator');
const { createQuoteCompileClient } = require('./lib/quote-compile-client');

const {
  stableJson,
  toNullableNumber,
  cleanText,
  cleanObject,
  cleanArray,
  cleanEmail,
  normalizeKey,
  titleCaseLabel,
  formatMoney,
  roundCurrency,
  roundQuoteBuilderPrice,
} = utils;

// --- Config ---
const PORT = 3006;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MOUNT_PATH = process.env.MOUNT_PATH || '/data';
const LEGACY_REQUEST_FILE = path.join(MOUNT_PATH, 'write-request.json');
const LEGACY_RESPONSE_FILE = path.join(MOUNT_PATH, 'write-response.json');
const REQUEST_DIR = path.join(MOUNT_PATH, 'write-requests');
const RESPONSE_DIR = path.join(MOUNT_PATH, 'write-responses');
const POLL_INTERVAL_MS = 1000;
const REQUEST_STABILITY_MS = 250;
const FILE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUOTE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QUOTE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const QUOTE_IMAGE_BUCKET = 'quote-images';
const QUOTE_ATTACHMENT_BUCKET = process.env.QUOTE_ATTACHMENT_BUCKET || QUOTE_IMAGE_BUCKET;
const PRICING_SETTINGS_TTL_MS = Number(process.env.PRESTIGIO_PRICING_SETTINGS_TTL_MS || 5 * 60 * 1000);
const KNOWN_PILLOW_FILL_KEYS = new Set(['down-50', 'down-25', 'down-100', 'angel-hair', 'elite-fiber', 'other']);
const PRESTIGIO_APP_BASE_URL = (process.env.PRESTIGIO_APP_BASE_URL || 'https://app.prestigio.la').replace(/\/+$/, '');

const bus = createBus({
  MOUNT_PATH,
  LEGACY_REQUEST_FILE,
  LEGACY_RESPONSE_FILE,
  REQUEST_DIR,
  RESPONSE_DIR,
  REQUEST_STABILITY_MS,
  FILE_TTL_MS,
  PRESTIGIO_APP_BASE_URL,
});

const {
  ensureBusDirs,
  writeResponse,
  buildModernQuoteUrl,
  isStableFile,
  listPendingRequestFiles,
  cleanupOldBusFiles,
  sanitizeRequestId,
} = bus;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function supabaseRequest(table, method, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${table} ${method} ${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

const pricingSettings = createPricingSettings({
  PRICING_SETTINGS_TTL_MS,
  cleanObject,
  toNullableNumber,
  supabaseRequest,
});

const {
  clearActivePricingSettings,
  setActivePricingSettingsFromRows,
  loadLivePricingSettings,
  ensureLivePricingSettingsForCalculatedPricing,
  costBreakdownNeedsLivePricingSettings,
  getPricingOptionsForBreakdown,
  getLivePricingMultiplier,
  getPricingSettingValue,
  getActivePricingSettingsReceipt,
} = pricingSettings;

const { getPayloadGate } = require('./lib/payload-gate-client');

const quoteCompileClient = createQuoteCompileClient({
  pillowCalc,
  cushionCalc,
  reupholsteryCalc,
  restuffingCalc,
  patioCalc,
  softgoodsCalc,
  ottomanCalc,
  bedCalc,
  seatingCalc,
  cleanObject,
  cleanArray,
  normalizeKey,
  toNullableNumber,
  getPricingSettingValue,
  getLivePricingMultiplier,
  getActivePricingSettingsReceipt,
});

const pricingCalculators = createPricingCalculators({
  quoteDescriptionGenerators,
  getPricingOptionsForBreakdown,
  getLivePricingMultiplier,
  cleanObject,
  toNullableNumber,
  roundQuoteBuilderPrice,
});

const {
  normalizeQuoteRevisionCostBreakdownLines,
  calculateReupholsteryUnitPriceFromBreakdown,
  calculatePillowUnitPriceFromBreakdown,
  calculateCushionUnitPriceFromBreakdown,
  calculateSeatingUnitPriceFromBreakdown,
  calculateBedUnitPriceFromBreakdown,
  calculateOttomanUnitPriceFromBreakdown,
  calculateSoftgoodsUnitPriceFromBreakdown,
  calculatePatioUnitPriceFromBreakdown,
  calculateRestuffingUnitPriceFromBreakdown,
} = pricingCalculators;

const draftNormalizers = createDraftNormalizers({
  quoteDescriptionGenerators,
  KNOWN_PILLOW_FILL_KEYS,
  cleanText,
  cleanObject,
  cleanArray,
  normalizeKey,
  titleCaseLabel,
  toNullableNumber,
  formatMoney,
  normalizeQuoteRevisionCostBreakdownLines,
  calculateReupholsteryUnitPriceFromBreakdown,
  calculatePillowUnitPriceFromBreakdown,
  calculateCushionUnitPriceFromBreakdown,
  calculateSeatingUnitPriceFromBreakdown,
  calculateBedUnitPriceFromBreakdown,
  calculateOttomanUnitPriceFromBreakdown,
  calculateSoftgoodsUnitPriceFromBreakdown,
  calculatePatioUnitPriceFromBreakdown,
  calculateRestuffingUnitPriceFromBreakdown,
});

const categoryRegistry = createCategoryRegistry({
  normalizeKey,
  cleanObject,
  cleanArray,
  calculateReupholsteryUnitPriceFromBreakdown,
  calculatePillowUnitPriceFromBreakdown,
  calculateCushionUnitPriceFromBreakdown,
  calculateSeatingUnitPriceFromBreakdown,
  calculateBedUnitPriceFromBreakdown,
  calculateOttomanUnitPriceFromBreakdown,
  calculateSoftgoodsUnitPriceFromBreakdown,
  calculatePatioUnitPriceFromBreakdown,
  calculateRestuffingUnitPriceFromBreakdown,
  buildReupholsteryDescription: draftNormalizers.buildReupholsteryDescription,
  buildPillowDescription: draftNormalizers.buildPillowDescription,
  buildCushionDescription: draftNormalizers.buildCushionDescription,
  buildBedDescription: draftNormalizers.buildBedDescription,
  buildOttomanDescription: draftNormalizers.buildOttomanDescription,
  buildSoftgoodsDescription: draftNormalizers.buildSoftgoodsDescription,
  buildPatioDescription: draftNormalizers.buildPatioDescription,
  buildRestuffingDescription: draftNormalizers.buildRestuffingDescription,
  quoteDescriptionGenerators,
  syncReupholsteryFormBooleans: draftNormalizers.syncReupholsteryFormBooleans,
  REUPHOLSTERY_BOOLEAN_FIELD_MAP: draftNormalizers.REUPHOLSTERY_BOOLEAN_FIELD_MAP,
});

const { applyRevisionPricing, applyRevisionDescription } = categoryRegistry;

const mergeRevisionPatch = createMergeRevisionPatch({
  quotePlanContracts,
  stableJson,
  normalizeKey,
  cleanText,
  cleanObject,
  cleanArray,
  toNullableNumber,
  normalizeQuoteRevisionCostBreakdownLines,
  applyRevisionPricing,
  applyRevisionDescription,
  syncReupholsteryFormBooleans: draftNormalizers.syncReupholsteryFormBooleans,
});

const {
  buildQuoteRevisionItemUpdates,
  assertQuoteRevisionManualPricingAllowed,
  assertAppQuoteTaxonomyAllowed,
  hasDirectSellPriceUpdate,
  isDescriptionAffectingQuotePatch,
  mergeQuoteRevisionPatchIntoItem,
  applyQuoteRevisionItemPatch,
  assertQuoteRevisionPricingLineageConsistent,
} = mergeRevisionPatch;

const {
  normalizeDraftItem,
  sumDraftQuoteItems,
  getDraftQuoteSiteVisitTotal,
  summarizeDraftQuotePricingModes,
  summarizeDraftQuoteCostLines,
  summarizeCompiledDraftItemsForPreview,
} = draftNormalizers.finalizeDraftItemHelpers(assertAppQuoteTaxonomyAllowed);

const confirmModule = createConfirmModule({
  stableJson,
  cleanObject,
  cleanArray,
  cleanText,
  formatMoney,
  sumDraftQuoteItems,
  getDraftQuoteSiteVisitTotal,
  summarizeDraftQuotePricingModes,
  summarizeDraftQuoteCostLines,
});

const { buildConfirmSummary, computeConfirmDigest } = confirmModule;

const quoteHandlers = createQuoteHandlers({
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
  normalizeDraftItem,
  buildDraftQuoteDescription: draftNormalizers.buildDraftQuoteDescription,
  getDraftQuoteSiteVisitTotal,
  sumDraftQuoteItems,
  ensureLivePricingSettingsForCalculatedPricing,
  costBreakdownNeedsLivePricingSettings,
  hasDirectSellPriceUpdate,
  assertQuoteRevisionManualPricingAllowed,
  buildQuoteRevisionItemUpdates,
  mergeQuoteRevisionPatchIntoItem,
  applyQuoteRevisionItemPatch,
  quoteCompileClient,
});

const orchestrator = createOrchestrator({
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
  resolveDraftQuoteClientFromProject: quoteHandlers.resolveDraftQuoteClientFromProject,
  normalizeDraftQuoteItemsForPayloadGate: quoteHandlers.normalizeDraftQuoteItemsForPayloadGate,
  assertDraftAttachmentReferencesValid: quoteHandlers.assertDraftAttachmentReferencesValid,
  compileDraftQuoteItems: quoteHandlers.compileDraftQuoteItems,
  ensureLivePricingSettingsForDraftItems: quoteHandlers.ensureLivePricingSettingsForDraftItems,
  revisionOperationsNeedLivePricingSettings: quoteHandlers.revisionOperationsNeedLivePricingSettings,
  ensureLivePricingSettingsForCalculatedPricing,
  resolveExistingQuote: quoteHandlers.resolveExistingQuote,
  fetchExistingQuoteItems: quoteHandlers.fetchExistingQuoteItems,
  buildResolvedQuoteRevisionPlan: quoteHandlers.buildResolvedQuoteRevisionPlan,
  computeResolvedQuoteRevisionDigest: quoteHandlers.computeResolvedQuoteRevisionDigest,
  summarizeResolvedQuoteRevisionPlan: quoteHandlers.summarizeResolvedQuoteRevisionPlan,
  computeConfirmDigest,
  buildConfirmSummary,
  summarizeCompiledDraftItemsForPreview,
  getPayloadGate,
  createDraftQuote: quoteHandlers.createDraftQuote,
  createClientProject: quoteHandlers.createClientProject,
  reviseExistingQuote: quoteHandlers.reviseExistingQuote,
  callEdgeFunction: quoteHandlers.callEdgeFunction,
});

const { checkForRequest } = orchestrator;

if (require.main === module) {
  setInterval(() => {
    checkForRequest().catch(err => {
      console.error(`[watcher error] ${err.message}`);
    });
  }, POLL_INTERVAL_MS);

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'prestigio-write-service' }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`Prestigio write service running on port ${PORT}`);
    console.log(`Watching ${LEGACY_REQUEST_FILE} and ${REQUEST_DIR} for write requests`);
    console.log(`Health: http://localhost:${PORT}/health`);
  });
}

module.exports = {
  buildConfirmSummary,
  assertDraftManualPricingAllowed: quoteCompileClient.assertDraftManualPricingAllowed,
  assertDraftMaterialsValid: quoteCompileClient.assertDraftMaterialsValid,
  assertDraftAttachmentReferencesValid: quoteHandlers.assertDraftAttachmentReferencesValid,
  assertQuoteRevisionManualPricingAllowed,
  assertQuoteRevisionPricingLineageConsistent,
  clearActivePricingSettings,
  getDraftQuoteSiteVisitTotal,
  isAllowedAttachmentPath: quoteHandlers.isAllowedAttachmentPath,
  isDescriptionAffectingQuotePatch,
  loadLivePricingSettings,
  mergeQuoteRevisionPatchIntoItem,
  normalizeAttachmentPath: quoteHandlers.normalizeAttachmentPath,
  resolveDraftSourceAttachments: quoteHandlers.resolveDraftSourceAttachments,
  buildDraftQuotePayload: quoteHandlers.buildDraftQuotePayload,
  reviseExistingQuote: quoteHandlers.reviseExistingQuote,
  setActivePricingSettingsFromRows,
  summarizeDraftQuotePricingModes,
  summarizeCompiledDraftItemsForPreview,
  sumDraftQuoteItems,
  getPayloadGate,
  normalizeDraftQuoteItemsForPayloadGate: quoteHandlers.normalizeDraftQuoteItemsForPayloadGate,
  compileDraftQuoteItems: quoteHandlers.compileDraftQuoteItems,
};
