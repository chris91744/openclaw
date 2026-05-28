function createDraftNormalizers(deps) {
  const {
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
  } = deps;

  let assertAppQuoteTaxonomyAllowed = deps.assertAppQuoteTaxonomyAllowed || (() => {});

  function setAssertAppQuoteTaxonomyAllowed(fn) {
    assertAppQuoteTaxonomyAllowed = fn;
  }

function buildDraftQuoteDescription(items) {
  return (items || [])
    .map(item => cleanText(item.description, 500))
    .filter(Boolean)
    .join('; ')
    .slice(0, 3000) || null;
}


const REUPHOLSTERY_TYPE_LABELS = {
  sofa: 'SOFA',
  chair: 'CHAIR',
  sectional: 'SECTIONAL',
  loveseat: 'LOVESEAT',
  ottoman: 'OTTOMAN',
  bench: 'BENCH',
  headboard: 'HEADBOARD',
  antique: 'ANTIQUE PIECE',
  chaise_lounge: 'CHAISE LOUNGE',
  cushion_pad: 'CUSHION PAD',
  barstool: 'BARSTOOL',
  fully_upholstered_bed: 'FULLY UPHOLSTERED BED'
};

const REUPHOLSTERY_SCOPE_LABELS = {
  full: 'FULL REUPHOLSTERY',
  'seat-only': 'SEAT ONLY',
  'back-only': 'BACK ONLY',
  'cushions-only': 'CUSHIONS ONLY',
  'arms-only': 'ARMS ONLY',
  partial: 'PARTIAL REUPHOLSTERY'
};

const REUPHOLSTERY_CONDITION_LABELS = {
  excellent: 'EXCELLENT - SWAP FABRIC ONLY',
  good: 'GOOD - NEW FABRIC + NEW FILLS',
  fair: 'FAIR - NEW FABRIC, FILLS, AND MINOR FRAME REPAIRS',
  poor: 'POOR - FULL STRIP-DOWN AND MAJOR RESTORATION'
};

const REUPHOLSTERY_VALID = {
  type: new Set(Object.keys(REUPHOLSTERY_TYPE_LABELS)),
  scope: new Set(Object.keys(REUPHOLSTERY_SCOPE_LABELS)),
  condition: new Set(Object.keys(REUPHOLSTERY_CONDITION_LABELS)),
  materialType: new Set(['fabric', 'leather']),
  seatStyle: new Set(['tight', 'loose', 'attached']),
  backStyle: new Set(['tight', 'loose-back-cushion', 'loose-pillow', 'attached-pillow', 'channeled', 'tufted']),
  seam: new Set(['not-specified', 'blind-seam', 'self-welt', 'contrast-welt', 'double-welt', 'single-topstitch', 'double-topstitch', 'cot', 'flange']),
  insert: new Set(['foam', 'foam-dacron', 'down-25', 'down-50', 'angel-hair', 'elite-fiber', 'spring-down']),
  foamType: new Set(['dryfast', 'foam18', 'hrfoam']),
  foamThickness: new Set(['1', '2', '3', '4', '5', '6'])
};


function normalizeReupholsteryType(value) {
  const raw = cleanText(value, 100) || '';
  const normalized = normalizeKey(raw);
  if (REUPHOLSTERY_VALID.type.has(normalized)) return normalized;
  if (normalized === 'reupholstery' || normalized === 'reupholster-sofa') return 'sofa';
  if (normalized.includes('sofa')) return 'sofa';
  return normalized;
}

function assertAllowed(field, value, allowed, { required = false } = {}) {
  const normalized = normalizeKey(value);
  if (!normalized) {
    if (required) {
      throw new Error(`${field} is required. Valid options: ${Array.from(allowed).join(', ')}`);
    }
    return '';
  }
  if (!allowed.has(normalized)) {
    throw new Error(`Invalid ${field}: ${value}. Valid options: ${Array.from(allowed).join(', ')}`);
  }
  return normalized;
}


function formatReupholsteryMaterial(material, fallbackType = 'fabric') {
  const mat = cleanObject(material) || {};
  const type = normalizeKey(mat.type || fallbackType) === 'leather' ? 'COL' : 'COM';
  const yardage = toNullableNumber(mat.yardage);
  const name = cleanText(mat.name, 300) || (type === 'COL' ? 'COL' : 'COM');
  const usage = cleanText(mat.usage, 200);
  const yardInfo = yardage !== null ? `${yardage} YD, ` : '';
  return `${type}: (${yardInfo}${name})${usage ? ` - ${usage.toUpperCase()}` : ''}`;
}

function formatFill(fill) {
  const fillMap = {
    'down-25': '25/75',
    'down-50': '50/50',
    'angel-hair': 'ANGEL HAIR',
    'elite-fiber': 'ELITE FIBER',
    foam: 'FOAM',
    'foam-dacron': 'FOAM DACRON',
    'spring-down': 'ENVELOPE W/ MARSHALL SPRINGS'
  };
  return fillMap[normalizeKey(fill)] || titleCaseLabel(fill).toUpperCase();
}

function formatInsert(insert) {
  const labels = {
    foam: 'Foam',
    'foam-dacron': 'Foam + Dacron',
    'down-25': '25/75 Down & Feather',
    'down-50': '50/50 Down & Feather',
    'angel-hair': 'Angel Hair',
    'elite-fiber': 'Elite Fiber',
    'spring-down': 'Envelope w/ Marshall Springs'
  };
  return labels[normalizeKey(insert)] || titleCaseLabel(insert);
}

function formatSeam(seam) {
  const labels = {
    'not-specified': 'Not Specified',
    'blind-seam': 'Blind Seam',
    'self-welt': 'Self Welt',
    'contrast-welt': 'Contrast Welt',
    'double-welt': 'Double Welt',
    'single-topstitch': 'Single Topstitch',
    'double-topstitch': 'Double Topstitch',
    cot: 'COT (Cord on Trim)',
    flange: 'Flange'
  };
  return labels[normalizeKey(seam)] || titleCaseLabel(seam);
}

function buildReupholsteryDescription(formData, item) {
  return quoteDescriptionGenerators.generateReupholsteryDescription({
    ...item,
    ...formData,
    type: formData.reupholsteryType || formData.type || item.type || item.item_type,
    materialType: formData.materialType || item.materialType || 'fabric',
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    notes: formData.clientVisibleNotes || item.client_visible_notes || item.quote_notes
  });
}

const REUPHOLSTERY_BOOLEAN_FIELD_MAP = {
  new_foam: 'newFoam',
  new_springs: 'newSprings',
  new_webbing: 'newWebbing',
  frame_repair: 'frameRepair',
  new_fill: 'newFill',
  strip_old: 'stripOld',
  tufting: 'tufting',
  nailheads: 'nailheads'
};

function syncReupholsteryFormBooleans(formData, item) {
  const synced = { ...(cleanObject(formData) || {}) };
  for (const [columnKey, formKey] of Object.entries(REUPHOLSTERY_BOOLEAN_FIELD_MAP)) {
    if (item[columnKey] !== undefined && synced[formKey] === undefined) {
      synced[formKey] = Boolean(item[columnKey]);
    }
  }
  return synced;
}

function normalizePillowType(value) {
  const normalized = normalizeKey(value);
  if (!normalized) return 'throw';
  if (normalized === 'knife-edge' || normalized === 'lumbar' || normalized === 'euro' || normalized === 'pillow') return 'throw';
  return normalized;
}

function resolvePillowFillKey(value) {
  const normalized = normalizeKey(value);
  if (!normalized || normalized === '50/50' || normalized === '50-50' || normalized === '50-50-down') return 'down-50';
  if (normalized === '25/75' || normalized === '25-75' || normalized === '25-75-down') return 'down-25';
  if (normalized === '100/0' || normalized === '100-0' || normalized === '100-down' || normalized === '100-down-feather') return 'down-100';
  if (KNOWN_PILLOW_FILL_KEYS.has(normalized)) return normalized;
  if (normalized.includes('100')) return 'down-100';
  if (normalized.includes('25')) return 'down-25';
  if (normalized.includes('50')) return 'down-50';
  return normalized;
}

function buildPillowDefaultCostBreakdown(existingCostBreakdown) {
  return cleanObject(existingCostBreakdown) ? { ...existingCostBreakdown } : null;
}

function hasManualPillowPriceOverride(item, formData) {
  return Boolean(
    item.manual_price_override ||
    item.manualPriceOverride ||
    formData.manual_price_override ||
    formData.manualPriceOverride ||
    formData.pricingMode === 'manual' ||
    formData.priceMode === 'manual'
  );
}

function choosePillowSellPrice(item, formData, costBreakdown, quantity) {
  const manualPrice = item.sell_price !== undefined ? toNullableNumber(item.sell_price) : null;
  const calculatedPrice = costBreakdown
    ? calculatePillowUnitPriceFromBreakdown(costBreakdown, quantity)
    : null;

  if (manualPrice === null) return calculatedPrice;
  if (calculatedPrice === null) return manualPrice;
  if (hasManualPillowPriceOverride(item, formData)) return manualPrice;
  return Math.max(manualPrice, calculatedPrice);
}

function normalizeCushionType(value) {
  const normalized = normalizeKey(value);
  if (!normalized) return 'bench';
  if (normalized === 'seat' || normalized === 'seat-cushion' || normalized === 'sofa-cushion' || normalized === 'bench-seat') return 'bench';
  if (normalized === 'window-seat-cushion') return 'window-seat';
  if (normalized === 'chair-pad-cushion' || normalized === 'seat-pad') return 'chair-pad';
  return normalized;
}

function buildPillowDescription(formData, item) {
  return quoteDescriptionGenerators.generatePillowDescription({
    ...item,
    ...formData,
    type: formData.pillowType || formData.type || item.type || item.item_type,
    fill: formData.pillowFill || formData.fill || item.fill,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function buildCushionDescription(formData, item) {
  return quoteDescriptionGenerators.generateCushionDescription({
    ...item,
    ...formData,
    type: formData.cushionType || formData.type || item.type || item.item_type,
    fill: formData.cushionFill || formData.fill || item.fill,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizeReupholsteryDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeReupholsteryType(formData.reupholsteryType || item.reupholsteryType || item.type || item.item_type || item.item_name);
  const normalizedFormData = {
    ...formData,
    category: 'reupholstery',
    reupholsteryType: type,
    materialType: assertAllowed('reupholstery materialType', formData.materialType || item.materialType || 'fabric', REUPHOLSTERY_VALID.materialType, { required: true }),
    scope: assertAllowed('reupholstery scope', formData.scope || item.scope, REUPHOLSTERY_VALID.scope, { required: true }),
    condition: assertAllowed('reupholstery condition', formData.condition || item.condition, REUPHOLSTERY_VALID.condition, { required: true }),
    width: toNullableNumber(formData.width ?? item.width),
    depth: toNullableNumber(formData.depth ?? item.depth),
    height: toNullableNumber(formData.height ?? item.height),
    quantity: toNullableNumber(formData.quantity ?? item.quantity) || 1,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  };

  const description = buildReupholsteryDescription(normalizedFormData, { ...item, type });
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateReupholsteryUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || `REUPHOLSTER ${REUPHOLSTERY_TYPE_LABELS[type] || 'ITEM'}`;

  return {
    ...item,
    category: 'reupholstery',
    type,
    item_type: type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.depth,
    height: normalizedFormData.height,
    quantity: normalizedFormData.quantity,
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || item.com_yardage || formData.estimatedFabricYardage || normalizedFormData.estimatedFabricYardage)
  };
}

function normalizePillowDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizePillowType(formData.pillowType || item.pillowType || item.type || item.item_type);
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'pillows',
    pillowType: type,
    pillowFill: formData.pillowFill || item.pillowFill || item.fill,
    construction: formData.construction || item.construction || 'blind-seam',
    zipper: formData.zipper || item.zipper || 'no',
    width: toNullableNumber(formData.width ?? item.width),
    height: toNullableNumber(formData.height ?? item.height),
    box: toNullableNumber(formData.box ?? item.box),
    diameter: toNullableNumber(formData.diameter ?? item.diameter),
    medallionBoxed: Boolean(formData.medallionBoxed ?? item.medallionBoxed),
    medallionBoxDepth: toNullableNumber(formData.medallionBoxDepth ?? item.medallionBoxDepth),
    continuousBoxing: Boolean(formData.continuousBoxing ?? item.continuousBoxing),
    medallionContinuous: Boolean(formData.medallionContinuous ?? item.medallionContinuous),
    fillOther: formData.fillOther || item.fillOther || '',
    room: formData.room || item.room || null,
    quantity,
    isOutdoor: Boolean(formData.isOutdoor ?? item.isOutdoor),
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  };

  const description = buildPillowDescription(normalizedFormData, item);
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(
    buildPillowDefaultCostBreakdown(item.cost_breakdown || item.lineItems)
  );
  const sellPrice = choosePillowSellPrice(item, normalizedFormData, costBreakdown, quantity);
  if (sellPrice === null) {
    throw new Error(`Pillow draft item ${index + 1} requires sell_price or cost_breakdown; hardcoded pillow pricing defaults are disabled.`);
  }
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM PILLOWS';

  return {
    ...item,
    category: 'pillows',
    type,
    item_type: type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    height: normalizedFormData.height,
    quantity,
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: sellPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || formData.estimatedFabricYardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || formData.estimatedFabricCost || normalizedFormData.estimatedFabricCost)
  };
}

function normalizeCushionDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeCushionType(formData.cushionType || item.cushionType || item.type || item.item_type);
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'cushions',
    cushionType: type,
    type,
    quantity,
    length: toNullableNumber(formData.length ?? item.length),
    depth: toNullableNumber(formData.depth ?? item.depth),
    thickness: toNullableNumber(formData.thickness ?? item.thickness),
    cushionFill: formData.cushionFill || formData.fill || item.cushionFill || item.fill || 'foam-dacron',
    fill: formData.cushionFill || formData.fill || item.cushionFill || item.fill || 'foam-dacron',
    envelopeFill: formData.envelopeFill || item.envelopeFill || 'down-50',
    solidDownFill: formData.solidDownFill || item.solidDownFill || 'down-50',
    foamType: formData.foamType || item.foamType || 'hrfoam',
    construction: formData.construction || item.construction || 'blind-seam',
    ties: formData.ties || item.ties || 'no',
    zipper: formData.zipper || item.zipper || 'yes',
    room: formData.room || item.room || null,
    isOutdoor: Boolean(formData.isOutdoor ?? item.isOutdoor),
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    fabricWidth: toNullableNumber(formData.fabricWidth ?? item.fabricWidth),
    fabricCostPerYard: toNullableNumber(formData.fabricCostPerYard ?? item.fabricCostPerYard),
    estimatedFabricYardage: toNullableNumber(formData.estimatedFabricYardage ?? item.estimatedFabricYardage ?? item.estimated_fabric_yardage),
    estimatedFabricCost: toNullableNumber(formData.estimatedFabricCost ?? item.estimatedFabricCost ?? item.estimated_fabric_cost)
  };

  const description = buildCushionDescription(normalizedFormData, item);
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateCushionUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM CUSHION';

  return {
    ...item,
    category: 'cushions',
    type,
    item_type: type,
    item_name: itemName,
    name: itemName,
    description,
    length: normalizedFormData.length,
    depth: normalizedFormData.depth,
    height: normalizedFormData.thickness,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || normalizedFormData.estimatedFabricCost)
  };
}

function resolveOptionalBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value === 'string') {
    const normalized = normalizeKey(value);
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
    if (!normalized) return Boolean(fallback);
  }
  if (value === null || value === undefined) return Boolean(fallback);
  return Boolean(value);
}

function hasDraftSpecValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value > 0;
  return true;
}

function hasAnyDraftSpecValue(sources, keys) {
  return keys.some((key) => sources.some((source) => hasDraftSpecValue(source?.[key])));
}

function normalizeSeatingDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.type || item.type || item.item_type || 'sofa') || 'sofa';
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const hasSeatSpecDetails = hasAnyDraftSpecValue([formData, item], [
    'seatStyle',
    'seatInsert',
    'seatSeam',
    'seatFill',
    'seatFoamType',
    'seatFoam',
    'seatCount',
  ]);
  const hasBackSpecDetails = hasAnyDraftSpecValue([formData, item], [
    'backStyle',
    'backInsert',
    'backSeam',
    'backFill',
    'backFoamType',
    'backFoam',
    'backCount',
    'backPillowGroups',
  ]);
  const seatSpecEnabled = hasSeatSpecDetails || resolveOptionalBoolean(
    formData.seatSpecEnabled ?? item.seatSpecEnabled,
    false,
  );
  const backSpecEnabled = hasBackSpecDetails || resolveOptionalBoolean(
    formData.backSpecEnabled ?? item.backSpecEnabled,
    false,
  );
  const normalizedFormData = {
    ...formData,
    category: 'seating',
    type,
    quantity,
    room: formData.room || item.room || null,
    isOutdoor: Boolean(formData.isOutdoor ?? item.isOutdoor),
    width: toNullableNumber(formData.width ?? item.width),
    depth: toNullableNumber(formData.depth ?? item.depth),
    height: toNullableNumber(formData.height ?? item.height),
    shape: formData.shape || item.shape || '',
    pieces: toNullableNumber(formData.pieces ?? item.pieces),
    sectionWidths: Array.isArray(formData.sectionWidths) ? formData.sectionWidths : cleanArray(item.sectionWidths),
    wallTemplateRequired: Boolean(formData.wallTemplateRequired ?? item.wallTemplateRequired),
    seatSpecEnabled,
    backSpecEnabled,
    seatStyle: formData.seatStyle || item.seatStyle || '',
    seatFill: formData.seatFill || item.seatFill || '',
    seatCount: toNullableNumber(formData.seatCount ?? item.seatCount),
    seatInsert: formData.seatInsert || item.seatInsert || '',
    seatSeam: formData.seatSeam || item.seatSeam || '',
    seatFoamType: formData.seatFoamType || item.seatFoamType || '',
    seatFoam: formData.seatFoam || item.seatFoam || '',
    backStyle: formData.backStyle || item.backStyle || '',
    backFill: formData.backFill || item.backFill || '',
    backInsert: formData.backInsert || item.backInsert || '',
    backCount: toNullableNumber(formData.backCount ?? item.backCount),
    backSeam: formData.backSeam || item.backSeam || '',
    backFoamType: formData.backFoamType || item.backFoamType || '',
    backFoam: formData.backFoam || item.backFoam || '',
    tightBackAddon: Boolean(formData.tightBackAddon ?? item.tightBackAddon),
    tightBackAddonCount: toNullableNumber(formData.tightBackAddonCount ?? item.tightBackAddonCount),
    tightBackAddonInsert: formData.tightBackAddonInsert || item.tightBackAddonInsert || '',
    tightBackAddonFoamType: formData.tightBackAddonFoamType || item.tightBackAddonFoamType || '',
    tightBackAddonFoam: formData.tightBackAddonFoam || item.tightBackAddonFoam || '',
    tightBackAddonFill: formData.tightBackAddonFill || item.tightBackAddonFill || '',
    tightBackAddonSeam: formData.tightBackAddonSeam || item.tightBackAddonSeam || '',
    swivelBase: Boolean(formData.swivelBase ?? item.swivelBase),
    slipcover: Boolean(formData.slipcover ?? item.slipcover),
    slipcoverHours: toNullableNumber(formData.slipcoverHours ?? item.slipcoverHours),
    slipcoverRate: toNullableNumber(formData.slipcoverRate ?? item.slipcoverRate),
    legType: formData.legType || item.legType || '',
    armStyle: formData.armStyle || item.armStyle || '',
    woodSpecies: formData.woodSpecies || item.woodSpecies || '',
    finishSample: formData.finishSample || item.finishSample || '',
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    estimatedFabricYardage: toNullableNumber(formData.estimatedFabricYardage ?? item.estimatedFabricYardage ?? item.estimated_fabric_yardage),
    estimatedFabricCost: toNullableNumber(formData.estimatedFabricCost ?? item.estimatedFabricCost ?? item.estimated_fabric_cost),
    fabricCostPerYard: toNullableNumber(formData.fabricCostPerYard ?? item.fabricCostPerYard)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateSeatingUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || `NEW CUSTOM ${type.toUpperCase()}`;
  const description = cleanText(item.description, 5000) || quoteDescriptionGenerators.generateSeatingDescription({
    ...item,
    ...normalizedFormData,
    materials: normalizedFormData.materials
  });

  return {
    ...item,
    category: 'seating',
    type,
    item_type: type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.depth,
    height: normalizedFormData.height,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || normalizedFormData.estimatedFabricCost)
  };
}

function buildBedDescription(formData, item) {
  return quoteDescriptionGenerators.generateBedDescription({
    ...item,
    ...formData,
    type: formData.bedType || formData.type || item.type || item.item_type,
    size: formData.bedSize || formData.size || item.bedSize || item.size,
    headboardStyle: formData.headboardStyle || formData.hbStyle || item.headboardStyle || item.hbStyle,
    edge: formData.bedEdge || formData.edge || item.bedEdge || item.edge,
    base: formData.bedBase || formData.base || item.bedBase || item.base,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizeBedDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.bedType || formData.type || item.bedType || item.type || item.item_type || 'headboard');
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'bed',
    bedType: type || 'headboard',
    type: type || 'headboard',
    quantity,
    room: formData.room || item.room || null,
    bedSize: formData.bedSize || formData.size || item.bedSize || item.size || 'queen',
    size: formData.bedSize || formData.size || item.bedSize || item.size || 'queen',
    headboardHeight: toNullableNumber(formData.headboardHeight ?? formData.hbHeight ?? item.headboardHeight ?? item.hbHeight),
    hbHeight: toNullableNumber(formData.headboardHeight ?? formData.hbHeight ?? item.headboardHeight ?? item.hbHeight),
    width: toNullableNumber(formData.width ?? item.width),
    depth: toNullableNumber(formData.depth ?? item.depth),
    footboardHeight: toNullableNumber(formData.footboardHeight ?? formData.fbHeight ?? item.footboardHeight ?? item.fbHeight),
    fbHeight: toNullableNumber(formData.footboardHeight ?? formData.fbHeight ?? item.footboardHeight ?? item.fbHeight),
    headboardStyle: formData.headboardStyle || formData.hbStyle || item.headboardStyle || item.hbStyle || 'pullover',
    hbStyle: formData.headboardStyle || formData.hbStyle || item.headboardStyle || item.hbStyle || 'pullover',
    bedEdge: formData.bedEdge || formData.edge || item.bedEdge || item.edge || 'not-specified',
    edge: formData.bedEdge || formData.edge || item.bedEdge || item.edge || 'not-specified',
    bedBase: formData.baseType || formData.bedBase || formData.base || item.baseType || item.bedBase || item.base || 'attached',
    base: formData.baseType || formData.bedBase || formData.base || item.baseType || item.bedBase || item.base || 'attached',
    woodSpecies: formData.woodSpecies || item.woodSpecies || '',
    finishSample: formData.finishSample || item.finishSample || '',
    bedFoamThickness: toNullableNumber(formData.bedFoamThickness ?? formData.foamThickness ?? item.bedFoamThickness ?? item.foamThickness),
    foamThickness: toNullableNumber(formData.bedFoamThickness ?? formData.foamThickness ?? item.bedFoamThickness ?? item.foamThickness),
    bedConstructionNotes: formData.bedConstructionNotes || item.bedConstructionNotes || item.constructionNotes || '',
    slipcover: Boolean(formData.slipcover ?? item.slipcover),
    slipcoverHours: toNullableNumber(formData.slipcoverHours ?? item.slipcoverHours),
    slipcoverRate: toNullableNumber(formData.slipcoverRate ?? item.slipcoverRate),
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    estimatedFabricYardage: toNullableNumber(formData.estimatedFabricYardage ?? item.estimatedFabricYardage ?? item.estimated_fabric_yardage),
    estimatedFabricCost: toNullableNumber(formData.estimatedFabricCost ?? item.estimatedFabricCost ?? item.estimated_fabric_cost),
    fabricCostPerYard: toNullableNumber(formData.fabricCostPerYard ?? item.fabricCostPerYard)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateBedUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM BED';
  const description = item.description ? cleanText(item.description, 5000) : buildBedDescription(normalizedFormData, item);

  return {
    ...item,
    category: 'bed',
    type: normalizedFormData.type,
    item_type: normalizedFormData.type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.depth,
    height: normalizedFormData.headboardHeight,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || normalizedFormData.estimatedFabricCost)
  };
}

function buildOttomanDescription(formData, item) {
  return quoteDescriptionGenerators.generateOttomanDescription({
    ...item,
    ...formData,
    type: formData.ottomanType || formData.type || item.type || item.item_type,
    fill: formData.ottomanFill || formData.fill || item.fill,
    baseType: formData.baseType || formData.base || item.baseType || item.base,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizeOttomanDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.ottomanType || formData.type || item.ottomanType || item.type || item.item_type || 'ottoman');
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'ottoman',
    ottomanType: type || 'ottoman',
    type: type || 'ottoman',
    quantity,
    room: formData.room || item.room || null,
    isOutdoor: Boolean(formData.isOutdoor ?? item.isOutdoor),
    length: toNullableNumber(formData.length ?? item.length),
    width: toNullableNumber(formData.width ?? item.width),
    height: toNullableNumber(formData.height ?? item.height),
    topStyle: formData.topStyle || item.topStyle || 'tight-seat',
    ottomanFill: formData.ottomanFill || formData.fill || item.ottomanFill || item.fill || 'foam-dacron',
    fill: formData.ottomanFill || formData.fill || item.ottomanFill || item.fill || 'foam-dacron',
    wrapType: formData.wrapType || item.wrapType || 'down-50',
    foamType: formData.foamType || item.foamType || 'hrfoam',
    foamThickness: toNullableNumber(formData.foamThickness ?? item.foamThickness),
    edge: formData.edge || item.edge || 'blind-seam',
    baseType: formData.baseType || formData.base || item.baseType || item.base || 'attached-legs',
    legFinish: formData.legFinish || item.legFinish || '',
    legColor: formData.legColor || item.legColor || '',
    slipcover: Boolean(formData.slipcover ?? item.slipcover),
    slipcoverHours: toNullableNumber(formData.slipcoverHours ?? item.slipcoverHours),
    slipcoverRate: toNullableNumber(formData.slipcoverRate ?? item.slipcoverRate),
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateOttomanUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM OTTOMAN';
  const description = item.description ? cleanText(item.description, 5000) : buildOttomanDescription(normalizedFormData, item);

  return {
    ...item,
    category: 'ottoman',
    type: normalizedFormData.type,
    item_type: normalizedFormData.type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.length,
    height: normalizedFormData.height,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    }
  };
}

function buildSoftgoodsDescription(formData, item) {
  return quoteDescriptionGenerators.generateSoftgoodsDescription({
    ...item,
    ...formData,
    type: formData.softgoodsType || formData.type || item.type || item.item_type,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizeSoftgoodsDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.softgoodsType || formData.type || item.softgoodsType || item.type || item.item_type || 'other');
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'softgoods',
    softgoodsType: type || 'other',
    type: type || 'other',
    quantity,
    room: formData.room || item.room || null,
    bedsize: formData.bedsize || formData.bedSize || item.bedsize || item.bedSize || 'queen',
    length: toNullableNumber(formData.length ?? item.length),
    width: toNullableNumber(formData.width ?? item.width),
    sided: formData.sided || item.sided || 'single',
    panels: toNullableNumber(formData.panels ?? item.panels),
    edge: formData.edge || item.edge || 'not-specified',
    lining: formData.lining || item.lining || 'no',
    slipPieceType: formData.slipPieceType || item.slipPieceType || null,
    slipClosure: formData.slipClosure || item.slipClosure || null,
    slipFit: formData.slipFit || item.slipFit || null,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    fabricWidth: toNullableNumber(formData.fabricWidth ?? item.fabricWidth),
    fabricCostPerYard: toNullableNumber(formData.fabricCostPerYard ?? item.fabricCostPerYard),
    estimatedFabricYardage: toNullableNumber(formData.estimatedFabricYardage ?? item.estimatedFabricYardage ?? item.estimated_fabric_yardage),
    estimatedFabricCost: toNullableNumber(formData.estimatedFabricCost ?? item.estimatedFabricCost ?? item.estimated_fabric_cost)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateSoftgoodsUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM SOFTGOODS';
  const description = item.description ? cleanText(item.description, 5000) : buildSoftgoodsDescription(normalizedFormData, item);

  return {
    ...item,
    category: 'softgoods',
    type: normalizedFormData.type,
    item_type: normalizedFormData.type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    height: normalizedFormData.length,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || normalizedFormData.estimatedFabricCost)
  };
}

function buildPatioDescription(formData, item) {
  return quoteDescriptionGenerators.generatePatioDescription({
    ...item,
    ...formData,
    type: formData.patioType || formData.type || item.type || item.item_type,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizePatioDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.patioType || formData.type || item.patioType || item.type || item.item_type || 'chair');
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'patio',
    patioType: type || 'chair',
    type: type || 'chair',
    quantity,
    room: formData.room || item.room || null,
    width: toNullableNumber(formData.width ?? item.width),
    depth: toNullableNumber(formData.depth ?? item.depth),
    height: toNullableNumber(formData.height ?? item.height),
    seatCount: toNullableNumber(formData.seatCount ?? item.seatCount) || 1,
    seatThickness: toNullableNumber(formData.seatThickness ?? item.seatThickness) || 4,
    seatFill: formData.seatFill || item.seatFill || 'foam-dacron',
    seatEnvelopeFill: formData.seatEnvelopeFill || item.seatEnvelopeFill || 'down-50',
    backEnabled: Boolean(formData.backEnabled ?? item.backEnabled ?? true),
    backCount: toNullableNumber(formData.backCount ?? item.backCount) || 1,
    backThickness: toNullableNumber(formData.backThickness ?? item.backThickness) || 4,
    backFill: formData.backFill || item.backFill || 'fiber-fill',
    backEnvelopeFill: formData.backEnvelopeFill || item.backEnvelopeFill || 'down-50',
    useCushionDims: Boolean(formData.useCushionDims ?? item.useCushionDims),
    seatLength: toNullableNumber(formData.seatLength ?? item.seatLength),
    seatDepth: toNullableNumber(formData.seatDepth ?? item.seatDepth),
    backLength: toNullableNumber(formData.backLength ?? item.backLength),
    backWidth: toNullableNumber(formData.backWidth ?? item.backWidth),
    construction: formData.construction || item.construction || 'blind-seam',
    ties: formData.ties || item.ties || 'no',
    zipper: formData.zipper || item.zipper || 'no',
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials),
    estimatedFabricYardage: toNullableNumber(formData.estimatedFabricYardage ?? item.estimatedFabricYardage ?? item.estimated_fabric_yardage),
    estimatedFabricCost: toNullableNumber(formData.estimatedFabricCost ?? item.estimatedFabricCost ?? item.estimated_fabric_cost),
    fabricCostPerYard: toNullableNumber(formData.fabricCostPerYard ?? item.fabricCostPerYard)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculatePatioUnitPriceFromBreakdown(costBreakdown)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'NEW CUSTOM OUTDOOR PATIO CUSHIONS';
  const description = item.description ? cleanText(item.description, 5000) : buildPatioDescription(normalizedFormData, item);

  return {
    ...item,
    category: 'patio',
    type: normalizedFormData.type,
    item_type: normalizedFormData.type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.depth,
    height: normalizedFormData.height,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    },
    estimated_fabric_yardage: toNullableNumber(item.estimated_fabric_yardage || normalizedFormData.estimatedFabricYardage),
    estimated_fabric_cost: toNullableNumber(item.estimated_fabric_cost || normalizedFormData.estimatedFabricCost)
  };
}

function buildRestuffingDescription(formData, item) {
  return quoteDescriptionGenerators.generateRestuffingDescription({
    ...item,
    ...formData,
    type: formData.restuffingType || formData.type || item.restuffingType || item.type || item.item_type,
    newFill: formData.newFill || formData.newFillType || item.newFill || item.newFillType,
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  });
}

function normalizeRestuffingDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  const type = normalizeKey(formData.restuffingType || formData.type || item.restuffingType || item.type || item.item_type || 'seat-cushion');
  const quantity = toNullableNumber(formData.quantity ?? item.quantity) || 1;
  const normalizedFormData = {
    ...formData,
    category: 'restuffing',
    restuffingType: type || 'seat-cushion',
    type: type || 'seat-cushion',
    quantity,
    room: formData.room || item.room || null,
    isOutdoor: Boolean(formData.isOutdoor ?? item.isOutdoor),
    width: toNullableNumber(formData.width ?? item.width),
    depth: toNullableNumber(formData.depth ?? item.depth),
    thickness: toNullableNumber(formData.thickness ?? item.thickness),
    currentFill: formData.currentFill || item.currentFill || 'unknown',
    newFill: formData.newFill || formData.newFillType || item.newFill || item.newFillType || 'same',
    newFillType: formData.newFill || formData.newFillType || item.newFill || item.newFillType || 'same',
    newCover: Boolean(formData.newCover ?? item.newCover),
    notes: formData.notes || item.notes || '',
    materials: cleanArray(formData.materials).length ? cleanArray(formData.materials) : cleanArray(item.materials)
  };
  const costBreakdown = normalizeQuoteRevisionCostBreakdownLines(item.cost_breakdown || item.lineItems);
  const calculatedUnitPrice = item.sell_price === undefined && costBreakdown
    ? calculateRestuffingUnitPriceFromBreakdown(costBreakdown, quantity)
    : null;
  const itemName = cleanText(item.item_name || item.name || normalizedFormData.custom_name, 500) || 'RESTUFF CUSHION';
  const description = item.description ? cleanText(item.description, 5000) : buildRestuffingDescription(normalizedFormData, item);

  return {
    ...item,
    category: 'restuffing',
    type: normalizedFormData.type,
    item_type: normalizedFormData.type,
    item_name: itemName,
    name: itemName,
    description,
    width: normalizedFormData.width,
    depth: normalizedFormData.depth,
    height: normalizedFormData.thickness,
    quantity,
    room: cleanText(normalizedFormData.room, 500),
    sidemark: cleanText(item.sidemark || normalizedFormData.sidemark || item.room || '', 500) || null,
    sell_price: item.sell_price !== undefined ? toNullableNumber(item.sell_price) : calculatedUnitPrice,
    cost_breakdown: costBreakdown || cleanObject(item.cost_breakdown),
    form_data: {
      ...normalizedFormData,
      custom_name: itemName,
      source: formData.source || 'stitch',
      normalized_by: 'prestigio-write-service'
    }
  };
}

function normalizeDraftItem(item, index) {
  const formData = cleanObject(item.form_data) || {};
  assertAppQuoteTaxonomyAllowed(item, `draft quote item ${index + 1}`);
  const category = normalizeKey(item.category || formData.category || item.item_type || item.type);
  if (category === 'reupholstery') {
    return normalizeReupholsteryDraftItem(item, index);
  }
  if (category === 'pillows' || category === 'pillow') {
    return normalizePillowDraftItem(item, index);
  }
  if (category === 'cushions' || category === 'cushion') {
    return normalizeCushionDraftItem(item, index);
  }
  if (category === 'seating' || category === 'seat' || category === 'custom-furniture') {
    return normalizeSeatingDraftItem(item, index);
  }
  if (category === 'bed' || category === 'beds') {
    return normalizeBedDraftItem(item, index);
  }
  if (category === 'ottoman' || category === 'ottomans') {
    return normalizeOttomanDraftItem(item, index);
  }
  if (category === 'softgoods' || category === 'soft-goods' || category === 'slipcover') {
    return normalizeSoftgoodsDraftItem(item, index);
  }
  if (category === 'patio' || category === 'outdoor') {
    return normalizePatioDraftItem(item, index);
  }
  if (category === 'restuffing' || category === 'restuff') {
    return normalizeRestuffingDraftItem(item, index);
  }
  return item;
}
function sumDraftQuoteItems(items) {
  if (!Array.isArray(items)) return 0;
  return Math.round(items.reduce((sum, item) => {
    const normalized = normalizeDraftItem(item, 0);
    const qty = Number(normalized.quantity) || 1;
    const price = Number(normalized.sell_price ?? normalized.price ?? normalized.total ?? 0) || 0;
    return sum + (qty * price);
  }, 0) * 100) / 100;
}

function getDraftQuoteSiteVisitTotal(quote = {}) {
  const explicitTotal = Number(quote.site_visit_total);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    return Math.round(explicitTotal * 100) / 100;
  }
  const hours = Number(quote.site_visit_hours);
  const rate = Number(quote.site_visit_rate);
  if (Number.isFinite(hours) && hours > 0 && Number.isFinite(rate) && rate > 0) {
    return Math.round(hours * rate * 100) / 100;
  }
  return 0;
}

function draftItemPricingMode(item, normalized) {
  if (item && typeof item === 'object' && item.sell_price !== undefined && normalized?.sell_price === toNullableNumber(item.sell_price)) {
    return 'manual';
  }
  if (item && typeof item === 'object' && (item.cost_breakdown || item.lineItems || normalized?.cost_breakdown)) {
    return 'calculated';
  }
  return 'unknown';
}

// Fields that are noise on a review card or are pricing-lineage artifacts, not
// human-extracted drivers. Surfacing these would clutter the card and could
// expose the very sell_price/cost_breakdown values the compiled path forbids
// the caller from sending.
const PREVIEW_KEY_INPUT_EXCLUDE = new Set([
  'category',
  'quantity',
  'description',
  'notes',
  'clientvisiblenotes',
  'pricingpayload',
  'pricingmode',
  'pricemode',
  'sell_price',
  'sellprice',
  'cost_breakdown',
  'costbreakdown',
  'lineitems',
  'manual_price_override',
  'manualpriceoverride',
  'manual_price_override_authorized',
  'sourceattachments',
  'source_attachments',
  'reference_images',
  'referenceimages',
  'reference_image_paths',
  'referenceimagepaths',
  // Normalizer bookkeeping, not human-extracted drivers.
  'custom_name',
  'source',
  'normalized_by',
  'item_type',
  'name',
]);

// Keep only the non-empty scalar form fields (string / finite number / boolean)
// that aren't in the exclude set. Arrays (materials) and nested pricing objects
// fall out naturally because they aren't scalars.
function filterScalarFormInputs(formData) {
  const source = cleanObject(formData) || {};
  const inputs = {};
  for (const [key, value] of Object.entries(source)) {
    if (PREVIEW_KEY_INPUT_EXCLUDE.has(String(key).toLowerCase())) continue;
    if (typeof value === 'string') {
      const text = cleanText(value, 200);
      if (text) inputs[key] = text;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      inputs[key] = value;
    } else if (typeof value === 'boolean') {
      inputs[key] = value;
    }
  }
  return inputs;
}

// Surface the scalar pricing-driver fields the caller EXTRACTED (bedSize,
// laborHours, foamThickness, width, construction, etc.) so the reviewer can
// eyeball the assumptions behind the price instead of only seeing the price.
// Sourced from the caller's raw form_data, NOT the normalized output: the raw
// payload is what the AI actually extracted from the email (the provenance the
// reviewer is checking) and carries none of the normalizer's alias twins
// (bedSize+size, headboardHeight+hbHeight, ...) or bookkeeping metadata.
function buildPreviewKeyInputs(formData) {
  return filterScalarFormInputs(formData);
}

// Each normalizer writes some fields under two names — a canonical key and a
// shorthand twin holding the SAME value (e.g. bed stores size as both `bedSize`
// and `size`). This maps the twin we DROP -> the canonical we KEEP, per category.
// Used to de-duplicate the assumed-defaults list without collapsing genuinely
// distinct fields that merely share a value (e.g. patio seatCount vs backCount,
// which a value-based collapse would wrongly merge). Keep in sync with the
// normalize<Category>DraftItem builders above.
const PREVIEW_FORM_ALIASES = {
  cushions: { fill: 'cushionFill', type: 'cushionType' },
  bed: {
    type: 'bedType', size: 'bedSize', hbHeight: 'headboardHeight',
    fbHeight: 'footboardHeight', hbStyle: 'headboardStyle', edge: 'bedEdge',
    base: 'bedBase', foamThickness: 'bedFoamThickness',
  },
  ottoman: { type: 'ottomanType', fill: 'ottomanFill' },
  softgoods: { type: 'softgoodsType' },
  patio: { type: 'patioType' },
  restuffing: { type: 'restuffingType', newFillType: 'newFill' },
};

// Surface the scalar fields the NORMALIZER supplied that the caller never sent —
// i.e. silent defaults (missing bedSize -> "queen", missing foamThickness -> 2).
// These are the gap buildPreviewKeyInputs can't show, because key_inputs only
// reflects what the AI extracted. Listed separately so the reviewer can tell
// "the email said this" apart from "the system assumed this."
//
// Twin keys are removed via the per-category alias map (not by value), so two
// distinct fields that happen to default to the same value both survive. Boolean
// defaults of `false` are dropped: an "assumed off" toggle is noise, not a
// meaningful guess worth flagging.
function buildPreviewAssumedDefaults(rawFormData, normalizedFormData, category) {
  const raw = cleanObject(rawFormData);
  if (!raw || !normalizedFormData) return {};
  const aliasMap = PREVIEW_FORM_ALIASES[normalizeKey(category)] || {};
  const extracted = filterScalarFormInputs(raw);
  const normalized = filterScalarFormInputs(normalizedFormData);
  // A field counts as caller-provided whether the AI sent the canonical key or
  // its shorthand twin, so an extracted value is never re-listed as "assumed".
  const providedKeys = new Set();
  for (const key of Object.keys(extracted)) {
    providedKeys.add(key.toLowerCase());
    const canonical = aliasMap[key];
    if (canonical) providedKeys.add(canonical.toLowerCase());
  }
  const defaults = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (aliasMap[key]) continue;
    if (providedKeys.has(key.toLowerCase())) continue;
    if (value === false) continue;
    defaults[key] = value;
  }
  return defaults;
}

function summarizeCompiledDraftItemsForPreview(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    let normalized = item;
    try {
      normalized = normalizeDraftItem(item, index);
    } catch (_) {
      // Preview summaries should stay useful even when one line fails normalization.
    }
    const qty = toNullableNumber(normalized?.quantity) || 1;
    const unitPrice = toNullableNumber(normalized?.sell_price);
    return {
      index: index + 1,
      item_name: cleanText(normalized?.item_name || normalized?.name, 500),
      category: cleanText(normalized?.category || normalized?.item_type, 100),
      quantity: qty,
      unit_price: unitPrice,
      line_total: unitPrice !== null ? Math.round(unitPrice * qty * 100) / 100 : null,
      pricing_mode: draftItemPricingMode(item, normalized),
      key_inputs: buildPreviewKeyInputs(item?.form_data || normalized?.form_data),
      assumed_defaults: buildPreviewAssumedDefaults(item?.form_data, normalized?.form_data, normalized?.category || item?.category),
      description: cleanText(normalized?.description, 5000),
      reference_image_paths: cleanArray(normalized?.reference_image_paths || normalized?.referenceImagePaths),
      source_attachments: cleanArray(
        normalized?.sourceAttachments ||
        normalized?.source_attachments ||
        normalized?.form_data?.sourceAttachments ||
        normalized?.form_data?.source_attachments
      ),
      cost_breakdown: cleanObject(normalized?.cost_breakdown) || null,
    };
  });
}

function summarizeDraftQuotePricingModes(items) {
  if (!Array.isArray(items) || !items.length) return '';
  let manual = 0;
  let calculated = 0;
  items.forEach((item, index) => {
    let normalized = null;
    try {
      normalized = normalizeDraftItem(item, index);
    } catch (_) {
      normalized = item;
    }
    if (item && typeof item === 'object' && item.sell_price !== undefined && normalized?.sell_price === toNullableNumber(item.sell_price)) {
      manual += 1;
    } else if (item && typeof item === 'object' && (item.cost_breakdown || item.lineItems || normalized?.cost_breakdown)) {
      calculated += 1;
    }
  });
  const parts = [];
  if (calculated > 0) parts.push(`${calculated} calculated from cost breakdown`);
  if (manual > 0) parts.push(`${manual} manual/client-facing sell price`);
  return parts.length ? `; pricing: ${parts.join(', ')}` : '';
}

function summarizeDraftQuoteCostLines(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const fillParts = [];

  for (let index = 0; index < items.length; index += 1) {
    let item = items[index];
    try {
      item = normalizeDraftItem(item, index);
    } catch (_) {
      // Confirmation summaries should not fail just because a detail line cannot be normalized.
    }

    const breakdown = cleanObject(item?.cost_breakdown);
    const fill = cleanObject(breakdown?.fill);
    if (!fill) continue;

    const qty = toNullableNumber(fill.qty ?? fill.quantity);
    const rate = toNullableNumber(fill.rate);
    if (!qty || !rate) continue;

    const itemQty = toNullableNumber(item.quantity) || 1;
    const fillKey = cleanText(fill.item_key, 80);
    const label = fillKey ? `${fillKey} ` : '';
    fillParts.push(`${label}${qty} lb @ ${formatMoney(rate)}/lb each${itemQty > 1 ? ` x ${itemQty}` : ''}`);
  }

  return fillParts.length ? `; fill: ${fillParts.join(', ')}` : '';
}
  function finalizeDraftItemHelpers(assertFn) {
    if (assertFn) assertAppQuoteTaxonomyAllowed = assertFn;

    return {
      normalizeDraftItem,
      sumDraftQuoteItems,
      getDraftQuoteSiteVisitTotal,
      summarizeDraftQuotePricingModes,
      summarizeDraftQuoteCostLines,
      summarizeCompiledDraftItemsForPreview,
    };
  }

  return {
    buildDraftQuoteDescription,
    buildReupholsteryDescription,
    buildPillowDescription,
    buildCushionDescription,
    buildBedDescription,
    buildOttomanDescription,
    buildSoftgoodsDescription,
    buildPatioDescription,
    buildRestuffingDescription,
    syncReupholsteryFormBooleans,
    REUPHOLSTERY_BOOLEAN_FIELD_MAP,
    normalizeReupholsteryDraftItem,
    normalizePillowDraftItem,
    normalizeCushionDraftItem,
    normalizeSeatingDraftItem,
    normalizeBedDraftItem,
    normalizeOttomanDraftItem,
    normalizeSoftgoodsDraftItem,
    normalizePatioDraftItem,
    normalizeRestuffingDraftItem,
    getDraftQuoteSiteVisitTotal,
    setAssertAppQuoteTaxonomyAllowed,
    finalizeDraftItemHelpers,
  };
}

module.exports = { createDraftNormalizers };
