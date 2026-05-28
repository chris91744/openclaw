function createPricingSettings(deps) {
  const {
    PRICING_SETTINGS_TTL_MS,
    cleanObject,
    toNullableNumber,
    supabaseRequest,
  } = deps;

  let activePricingSettings = null;

  function normalizePricingNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function createEmptyPricingSettings() {
    return { multiplier: {}, fill: {}, labor: {}, material: {}, frame: {} };
  }

  function normalizePricingSettingsRows(rows = [], source = 'live') {
    const settings = createEmptyPricingSettings();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.category || !row?.item_key) continue;
      const value = normalizePricingNumber(row.value);
      if (value === null) continue;
      if (!settings[row.category]) settings[row.category] = {};
      settings[row.category][row.item_key] = {
        value,
        display_name: row.display_name,
        unit: row.unit,
        cost_type: row.cost_type,
      };
    }
    return {
      settings,
      source,
      loaded_at: Date.now(),
      rows_count: Array.isArray(rows) ? rows.length : 0,
    };
  }

  function setActivePricingSettingsFromRows(rows, source = 'test') {
    activePricingSettings = normalizePricingSettingsRows(rows, source);
    return activePricingSettings;
  }

  function clearActivePricingSettings() {
    activePricingSettings = null;
  }

  function hasFreshPricingSettings() {
    return Boolean(
      activePricingSettings &&
      Date.now() - activePricingSettings.loaded_at < PRICING_SETTINGS_TTL_MS
    );
  }

  async function loadLivePricingSettings({ force = false } = {}) {
    if (!force && hasFreshPricingSettings()) return activePricingSettings;
    const rows = await supabaseRequest(
      'pricing_settings',
      'GET',
      undefined,
      '?select=category,item_key,value,display_name,unit,cost_type,sort_order&order=sort_order.asc'
    );
    activePricingSettings = normalizePricingSettingsRows(rows, 'pricing_settings');
    const missing = ['passthrough', 'material'].filter(key => (
      normalizePricingNumber(activePricingSettings.settings.multiplier?.[key]?.value) === null
    ));
    if (missing.length) {
      throw new Error(`Live pricing_settings is missing multiplier row(s): ${missing.join(', ')}`);
    }
    return activePricingSettings;
  }

  async function ensureLivePricingSettingsForCalculatedPricing() {
    return loadLivePricingSettings();
  }

  function getLivePricingMultiplier(costType) {
    if (costType !== 'passthrough' && costType !== 'material') return 1;
    const value = normalizePricingNumber(activePricingSettings?.settings?.multiplier?.[costType]?.value);
    if (value !== null && value > 0) return value;
    throw new Error(`Live pricing_settings multiplier "${costType}" is required for calculated quote pricing.`);
  }

  function getPricingSettingValue(category, itemKey) {
    return normalizePricingNumber(activePricingSettings?.settings?.[category]?.[itemKey]?.value);
  }

  function getActivePricingSettingsReceipt() {
    if (!activePricingSettings) return null;
    return {
      source: activePricingSettings.source,
      rows_count: activePricingSettings.rows_count,
      loaded_at: activePricingSettings.loaded_at,
    };
  }

  const PASSTHROUGH_COST_KEYS = new Set(['frame', 'springs', 'legs', 'webbing']);
  const MATERIAL_COST_KEYS = new Set(['foam', 'fill', 'seat_foam', 'back_foam', 'seat_fill', 'back_fill', 'frame_padding', 'arm_foam', 'wrap']);

  function lineNeedsLivePricingMultiplier(line) {
    const value = cleanObject(line);
    if (!value) return false;
    if (toNullableNumber(value.final) !== null || toNullableNumber(value.multiplier) !== null) return false;
    if (toNullableNumber(value.raw) !== null) return true;
    const qty = toNullableNumber(value.qty ?? value.quantity ?? value.hours ?? value.yardage);
    const rate = toNullableNumber(value.rate ?? value.costPerYard);
    return qty !== null && rate !== null;
  }

  function costBreakdownNeedsLivePricingSettings(costBreakdown) {
    const breakdown = cleanObject(costBreakdown);
    if (!breakdown) return false;
    return Object.entries(breakdown).some(([key, line]) => (
      (PASSTHROUGH_COST_KEYS.has(key) || MATERIAL_COST_KEYS.has(key)) &&
      lineNeedsLivePricingMultiplier(line)
    ));
  }

  function costBreakdownLivePricingTypes(costBreakdown) {
    const breakdown = cleanObject(costBreakdown);
    const types = new Set();
    if (!breakdown) return types;
    Object.entries(breakdown).forEach(([key, line]) => {
      if (!lineNeedsLivePricingMultiplier(line)) return;
      if (PASSTHROUGH_COST_KEYS.has(key)) types.add('passthrough');
      if (MATERIAL_COST_KEYS.has(key)) types.add('material');
    });
    return types;
  }

  function getPricingOptionsForBreakdown(costBreakdown) {
    const types = costBreakdownLivePricingTypes(costBreakdown);
    const multipliers = {};
    if (types.has('passthrough')) multipliers.passthrough = getLivePricingMultiplier('passthrough');
    if (types.has('material')) multipliers.material = getLivePricingMultiplier('material');
    return { multipliers };
  }

  return {
    clearActivePricingSettings,
    setActivePricingSettingsFromRows,
    loadLivePricingSettings,
    ensureLivePricingSettingsForCalculatedPricing,
    costBreakdownNeedsLivePricingSettings,
    getPricingOptionsForBreakdown,
    getLivePricingMultiplier,
    getPricingSettingValue,
    getActivePricingSettingsReceipt,
  };
}

module.exports = { createPricingSettings };
