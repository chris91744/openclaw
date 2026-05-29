function createQuoteCompileClient(deps) {
  const {
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
  } = deps;

  const COMPILED_CATEGORIES = new Set([
    'pillows',
    'pillow',
    'cushions',
    'cushion',
    'reupholstery',
    'reupholster',
    'restuffing',
    'restuff',
    'patio',
    'outdoor',
    'softgoods',
    'soft-goods',
    'slipcover',
    'ottoman',
    'ottomans',
    'bed',
    'beds',
    'seating',
    'custom-furniture',
    'seat',
  ]);

  function getItemCategory(item) {
    const formData = cleanObject(item?.form_data) || {};
    return normalizeKey(item?.category || formData.category || item?.item_type || item?.type);
  }

  function truthyAuthorization(value) {
    return value === true || value === 'true' || value === 'yes' || value === 'authorized';
  }

  function hasManualPriceOverride(item, fields = {}) {
    const formData = cleanObject(item?.form_data) || {};
    return (
      truthyAuthorization(fields?.manual_price_override_authorized) ||
      truthyAuthorization(item?.manual_price_override_authorized) ||
      truthyAuthorization(item?.manual_price_override) ||
      truthyAuthorization(item?.manualPriceOverride) ||
      truthyAuthorization(formData?.manual_price_override) ||
      truthyAuthorization(formData?.manualPriceOverride) ||
      formData?.pricingMode === 'manual' ||
      formData?.priceMode === 'manual'
    );
  }

  function assertDraftMaterialsValid(items) {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      const formData = cleanObject(item?.form_data) || {};
      const materials = [
        ...(Array.isArray(item?.materials) ? item.materials : []),
        ...(Array.isArray(formData.materials) ? formData.materials : []),
      ];
      if (!materials.length) return;

      materials.forEach((material, materialIndex) => {
        if (!material || typeof material !== 'object' || Array.isArray(material)) {
          throw new Error(
            `Draft quote item ${index + 1} materials[${materialIndex}] must be an object with type, name, and yardage or sqft.`,
          );
        }

        const type = normalizeKey(material.type);
        const name = cleanObject(material).name || material.name;
        if (!type) {
          throw new Error(`Draft quote item ${index + 1} materials[${materialIndex}] requires type "fabric" or "leather".`);
        }
        if (!String(name || '').trim()) {
          throw new Error(`Draft quote item ${index + 1} materials[${materialIndex}] requires name.`);
        }

        if (type !== 'leather') return;

        const sqft = toNullableNumber(material.sqft ?? material.squareFeet ?? material.square_feet);
        const yardage = toNullableNumber(material.yardage);
        if (yardage !== null && sqft === null) {
          throw new Error(
            `Draft quote item ${index + 1} leather/COL material must use sqft, not yardage. ` +
            'Send { "type": "leather", "name": "...", "sqft": 120 } for hides, shearling, and leather.',
          );
        }
        if (sqft === null) {
          throw new Error(
            `Draft quote item ${index + 1} leather/COL material requires sqft. ` +
            'Send { "type": "leather", "name": "...", "sqft": 120 } for hides, shearling, and leather.',
          );
        }
      });
    });
  }

  function isLeatherMaterial(material) {
    return normalizeKey(material?.type || material?.kind || material?.materialType) === 'leather';
  }

  function materialHasSqft(material) {
    return toNullableNumber(material?.sqft ?? material?.squareFeet ?? material?.square_feet) !== null;
  }

  function getSeatingMaterialRequirement(item) {
    if (!seatingCalc?.normalizeSeatingFormData || !seatingCalc?.calculateSeatingMaterialRequirement) {
      return null;
    }

    const formData = cleanObject(item?.form_data) || {};
    const materials = [
      ...(Array.isArray(formData.materials) ? formData.materials : []),
      ...(Array.isArray(item?.materials) ? item.materials : []),
    ];
    if (!materials.some(material => isLeatherMaterial(material) && !materialHasSqft(material))) {
      return null;
    }

    const normalized = seatingCalc.normalizeSeatingFormData({
      ...formData,
      ...(cleanObject(item) || {}),
      materials,
      category: 'seating',
    });
    const materialRequirement = seatingCalc.calculateSeatingMaterialRequirement(normalized);
    if (
      !materialRequirement ||
      materialRequirement.type !== 'leather' ||
      toNullableNumber(materialRequirement.sqft) === null
    ) {
      return null;
    }
    return materialRequirement;
  }

  function applySeatingLeatherRequirementToMaterials(materials, materialRequirement) {
    if (!Array.isArray(materials) || !materialRequirement) return materials;
    const sqft = toNullableNumber(materialRequirement.sqft);
    if (sqft === null) return materials;

    return materials.map((material) => {
      if (!material || typeof material !== 'object' || Array.isArray(material)) return material;
      if (!isLeatherMaterial(material) || materialHasSqft(material)) return material;
      return {
        ...material,
        sqft,
        yardageBasis: materialRequirement.yardageBasis,
        sqftPerYard: materialRequirement.sqftPerYard,
        derivedBy: 'prestigio-write-service',
        source: 'seating.materialRequirement',
      };
    });
  }

  function normalizeDraftQuoteItemsForPayloadGate(items) {
    if (!Array.isArray(items)) return items;
    return items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      let nextItem = withCanonicalFillVocabulary(item);
      const category = getItemCategory(nextItem);
      if (category !== 'seating' && category !== 'custom-furniture' && category !== 'seat') return nextItem;

      const materialRequirement = getSeatingMaterialRequirement(nextItem);
      if (!materialRequirement) return nextItem;

      const formData = cleanObject(nextItem.form_data) || {};
      nextItem = { ...nextItem };
      if (Array.isArray(nextItem.materials)) {
        nextItem.materials = applySeatingLeatherRequirementToMaterials(nextItem.materials, materialRequirement);
      }
      if (Array.isArray(formData.materials)) {
        nextItem.form_data = {
          ...formData,
          materials: applySeatingLeatherRequirementToMaterials(formData.materials, materialRequirement),
          materialRequirement: formData.materialRequirement || {
            ...materialRequirement,
            derivedBy: 'prestigio-write-service',
            source: 'seating.materialRequirement',
          },
        };
      }
      return nextItem;
    });
  }

  function assertDraftManualPricingAllowed(items, fields = {}) {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      const category = getItemCategory(item);
      if (!COMPILED_CATEGORIES.has(category)) return;
      const sellPrice = item?.sell_price !== undefined ? toNullableNumber(item.sell_price) : null;
      if (sellPrice === null) return;
      if (hasManualPriceOverride(item, fields)) return;
      throw new Error(
        `Draft quote item ${index + 1} (${category}) must use the compiled pricing path: omit sell_price and send structured form_data. ` +
        'Manual sell_price overrides are blocked unless manual_price_override_authorized: true after Chris explicitly approves a manual price override for this line.',
      );
    });
  }

  function itemNeedsCompile(item) {
    const category = getItemCategory(item);
    if (!COMPILED_CATEGORIES.has(category)) return false;
    if (cleanObject(item?.cost_breakdown) || cleanObject(item?.lineItems)) return false;
    if (item?.sell_price !== undefined && toNullableNumber(item.sell_price) !== null) return false;
    return true;
  }

  let activePricingLookupContext = null;

  function createPricingLookupContext() {
    const missingRows = new Map();
    const missingLookups = new Map();
    return {
      missingRows,
      missingLookups,
      addMissingRow(category, key) {
        const normalizedCategory = String(category || '').trim();
        const normalizedKey = String(key || '').trim();
        if (!normalizedCategory || !normalizedKey) return;
        missingRows.set(`${normalizedCategory}:${normalizedKey}`, {
          category: normalizedCategory,
          key: normalizedKey,
        });
      },
      addMissingLookup(category, key) {
        const normalizedCategory = String(category || '').trim();
        const normalizedKey = String(key || '').trim();
        if (!normalizedCategory || !normalizedKey) return;
        missingLookups.set(`${normalizedCategory}:${normalizedKey}`, {
          category: normalizedCategory,
          key: normalizedKey,
        });
      },
      missingRowList() {
        return Array.from(missingRows.values());
      },
      missingLookupList() {
        return Array.from(missingLookups.values());
      },
    };
  }

  function pricingSettingIsPresent(category, key) {
    const value = getPricingSettingValue(category, key);
    return value !== null && value > 0;
  }

  function getFramePricingKeys(furnitureType, tier = 'mid') {
    const normalizedType = furnitureType === 'loveseat' ? 'sofa' : furnitureType;
    if (tier === 'patio') {
      return [`${normalizedType}-patio`, `${normalizedType}-high`, `${normalizedType}-mid`];
    }
    if (tier === 'special') {
      return [`${normalizedType}-special`, `${normalizedType}-high`, `${normalizedType}-mid`];
    }
    return [`${normalizedType}-${tier}`];
  }

  function getMergedFormData(item) {
    return {
      ...(cleanObject(item?.form_data) || {}),
      ...(cleanObject(item) || {}),
    };
  }

  function formHasRateOverride(formData, qtyKey, rateKey) {
    return toNullableNumber(formData?.[qtyKey]) !== null && toNullableNumber(formData?.[rateKey]) !== null;
  }

  function normalizeFillFamilyKey(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return '';
    if (normalized === 'foam' || normalized === 'foam-only' || normalized === 'foam-and-dacron' || normalized === 'foam-dacron') return 'foam-dacron';
    if ([
      'foam-down-wrap',
      'foam-down',
      'foam-fill-wrap',
      'foam-with-down-wrap',
      'foam-w-down-wrap',
    ].includes(normalized)) return 'envelope';
    if (normalized === 'solid' || normalized === 'solid-down' || normalized === 'solid-fill' || normalized === 'solid-fill-no-foam') return 'solid';
    if (normalized === 'spring-and-down' || normalized === 'marshall-spring-down') return 'spring-down';
    return normalized;
  }

  function normalizePatioSeatFillKey(value) {
    const family = normalizeFillFamilyKey(value);
    if (!family) return 'foam-dacron';
    if (family === 'solid' || family === 'spring-down' || family === 'fiber-fill') return 'envelope';
    return family;
  }

  function normalizePatioBackFillKey(value) {
    const normalized = normalizeKey(value);
    if (!normalized || normalized === 'fiber-fill' || normalized === 'fiberfill') return 'solid';
    return normalizeFillFamilyKey(normalized);
  }

  function normalizeFillGradeKey(value, fallback = '') {
    const normalized = normalizeKey(value);
    if (!normalized) return fallback;
    if (normalized === '50/50' || normalized === '50-50' || normalized === '50-50-down') return 'down-50';
    if (normalized === '25/75' || normalized === '25-75' || normalized === '25-75-down') return 'down-25';
    if (normalized === '100/0' || normalized === '100-0' || normalized === '100-down' || normalized === '100-down-feather') return 'down-100';
    if (normalized === 'poly-fiber' || normalized === 'poly-fill' || normalized === 'polyfiber' || normalized === 'poly-fibre') return 'elite-fiber';
    return normalized;
  }

  function normalizeRestuffingFillKey(value, fallback = 'same') {
    const family = normalizeFillFamilyKey(value);
    if (family === 'solid') return 'solid';
    return normalizeFillGradeKey(value, fallback);
  }

  function mapFillVocabularyCanonically(source, category) {
    const input = cleanObject(source);
    if (!input) return { value: source, changed: false };
    const next = { ...input };
    let changed = false;
    const set = (key, mapper) => {
      if (next[key] === undefined) return;
      const mapped = mapper(next[key]);
      if (mapped !== next[key]) {
        next[key] = mapped;
        changed = true;
      }
    };
    const setValue = (key, value) => {
      if (next[key] === value) return;
      next[key] = value;
      changed = true;
    };
    const normalizedCategory = normalizeKey(category || next.category);

    if (normalizedCategory === 'pillows' || normalizedCategory === 'pillow') {
      for (const key of ['pillowFill', 'fill', 'fillMaterial']) set(key, value => normalizeFillGradeKey(value, 'down-50'));
    } else if (normalizedCategory === 'cushions' || normalizedCategory === 'cushion') {
      for (const key of ['cushionFill', 'fill']) set(key, value => normalizeFillFamilyKey(value));
      for (const key of ['envelopeFill', 'solidDownFill', 'backFill']) set(key, value => normalizeFillGradeKey(value, value));
    } else if (normalizedCategory === 'ottoman' || normalizedCategory === 'ottomans') {
      for (const key of ['ottomanFill', 'fill']) set(key, value => normalizeFillFamilyKey(value));
      set('wrapType', value => normalizeFillGradeKey(value, 'down-50'));
    } else if (normalizedCategory === 'patio' || normalizedCategory === 'outdoor') {
      set('seatFill', value => normalizePatioSeatFillKey(value));
      const backFamily = normalizePatioBackFillKey(next.backFill);
      set('backFill', value => normalizePatioBackFillKey(value));
      set('seatEnvelopeFill', value => normalizeFillGradeKey(value, 'elite-fiber'));
      set('backEnvelopeFill', value => normalizeFillGradeKey(value, 'elite-fiber'));
      if (backFamily === 'solid' || normalizeKey(source.backFill) === 'fiber-fill') {
        setValue('backEnvelopeFill', 'elite-fiber');
      }
    } else if (normalizedCategory === 'seating' || normalizedCategory === 'custom-furniture' || normalizedCategory === 'reupholstery') {
      for (const key of ['seatInsert', 'backInsert', 'tightBackAddonInsert']) set(key, value => normalizeFillFamilyKey(value));
      for (const key of ['seatFill', 'backFill', 'tightBackAddonFill']) set(key, value => normalizeFillGradeKey(value, value));
    } else if (normalizedCategory === 'restuffing' || normalizedCategory === 'restuff') {
      set('currentFill', value => normalizeRestuffingFillKey(value, 'unknown'));
      set('newFill', value => normalizeRestuffingFillKey(value, 'same'));
      set('newFillType', value => normalizeRestuffingFillKey(value, 'same'));
    }

    return { value: changed ? next : source, changed };
  }

  function withCanonicalFillVocabulary(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const category = getItemCategory(item);
    const mappedItem = mapFillVocabularyCanonically(item, category);
    const mappedFormData = mapFillVocabularyCanonically(cleanObject(item.form_data) || {}, category);
    if (!mappedItem.changed && !mappedFormData.changed) return item;
    return {
      ...(mappedItem.value === item ? item : mappedItem.value),
      form_data: mappedFormData.changed ? mappedFormData.value : item.form_data,
    };
  }

  function requireAnyPricingRow(context, category, keys) {
    const keyList = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (!keyList.length) return;
    if (keyList.some(key => pricingSettingIsPresent(category, key))) return;
    keyList.forEach(key => context.addMissingRow(category, key));
  }

  function resolveSeatingFrameType(type) {
    const normalized = normalizeKey(type) || 'sofa';
    if (normalized === 'loveseat') return 'sofa';
    if (normalized === 'banquette') return 'sectional';
    return normalized;
  }

  function getRequiredFrameKeysForForm(category, formData, frameComplexity) {
    if (category === 'seating' || category === 'custom-furniture' || category === 'seat') {
      const seatingType = normalizeKey(formData.type || formData.seatingType || formData.item_type || 'sofa') || 'sofa';
      const frameType = resolveSeatingFrameType(seatingType);
      const keys = getFramePricingKeys(frameType, frameComplexity);
      if (frameType === 'barstool' && frameComplexity !== 'mid') keys.push('barstool-mid');
      return keys;
    }

    if (category === 'ottoman' || category === 'ottomans') {
      return getFramePricingKeys('ottoman', frameComplexity);
    }

    if (category === 'bed' || category === 'beds') {
      const bedFrameTypeMap = {
        headboard: 'bed-headboard',
        'headboard-rails': 'bed-headboard-rails',
        'bed-rails-platform': 'bed-rails-platform',
        'full-bed': 'bed-full-bed',
        '3-piece': 'bed-3-piece',
        'wall-to-wall': 'bed-wall-to-wall',
      };
      const bedType = normalizeKey(formData.type || formData.bedType || formData.item_type || 'headboard') || 'headboard';
      const specificType = bedFrameTypeMap[bedType] || 'bed';
      return [
        ...getFramePricingKeys(specificType, frameComplexity),
        ...getFramePricingKeys('bed', frameComplexity),
      ];
    }

    return [];
  }

  function isExploratoryMissingLookup(row, category, formData, frameComplexity) {
    if (row.category === 'frame') {
      const requiredFrameKeys = getRequiredFrameKeysForForm(category, formData, frameComplexity);
      if (requiredFrameKeys.length) {
        if (requiredFrameKeys.some(key => pricingSettingIsPresent('frame', key))) return true;
        return !requiredFrameKeys.includes(row.key);
      }
    }

    const seatingType = normalizeKey(formData.type || formData.seatingType || formData.item_type || '');
    if (
      (category === 'seating' || category === 'custom-furniture' || category === 'seat') &&
      row.category === 'material' &&
      row.key === 'springs' &&
      (seatingType === 'sofa' || seatingType === 'loveseat' || seatingType === 'sectional')
    ) {
      return true;
    }

    const baseType = normalizeKey(formData.baseType || '');
    if (
      (category === 'ottoman' || category === 'ottomans') &&
      row.category === 'material' &&
      row.key === 'ottoman-leg-base' &&
      ['attached-legs', 'wood-base', 'metal-base', 'casters', 'skirted', 'none'].includes(baseType)
    ) {
      return true;
    }

    if (
      (category === 'bed' || category === 'beds') &&
      row.category === 'material' &&
      row.key === 'bed-legs' &&
      ['wood-base', 'metal-base', 'casters', 'platform', 'skirted'].includes(baseType)
    ) {
      return true;
    }

    return false;
  }

  function collectDerivedRequiredPricingRows(item, compiled, context) {
    const category = getItemCategory(compiled || item);
    const formData = getMergedFormData(compiled || item);
    const frameComplexity = normalizeKey(formData.frameComplexity || 'mid') || 'mid';

    if (category === 'seating' || category === 'custom-furniture' || category === 'seat') {
      const seatingType = normalizeKey(formData.type || formData.seatingType || formData.item_type || 'sofa') || 'sofa';
      if (!formHasRateOverride(formData, 'frameQty', 'frameRate')) {
        requireAnyPricingRow(context, 'frame', getRequiredFrameKeysForForm(category, formData, frameComplexity));
      }
      if (!formHasRateOverride(formData, 'springsQty', 'springsRate')) {
        const springKey = seatingType === 'chair'
          ? 'chair-springs'
          : (seatingType === 'sofa' || seatingType === 'loveseat' || seatingType === 'sectional')
            ? 'sofa-springs'
            : 'springs';
        requireAnyPricingRow(context, 'material', springKey);
      }
    }

    if ((category === 'ottoman' || category === 'ottomans') && !formHasRateOverride(formData, 'frameQty', 'frameRate')) {
      requireAnyPricingRow(context, 'frame', getRequiredFrameKeysForForm(category, formData, frameComplexity));
    }

    if (category === 'ottoman' || category === 'ottomans') {
      if ((formData.newSprings === true || formData.newSprings === 'true') && !formHasRateOverride(formData, 'springsQty', 'springsRate')) {
        requireAnyPricingRow(context, 'material', 'springs');
      }
      if (!formHasRateOverride(formData, 'legsQty', 'legsRate')) {
        const baseType = normalizeKey(formData.baseType || '');
        if (baseType === 'attached-legs') requireAnyPricingRow(context, 'material', 'ottoman-leg-attached');
        else if (baseType === 'wood-base') requireAnyPricingRow(context, 'material', 'ottoman-wood-base');
        else if (baseType === 'metal-base') requireAnyPricingRow(context, 'material', 'ottoman-metal-base');
        else if (baseType === 'casters') requireAnyPricingRow(context, 'material', 'ottoman-casters');
        else if (baseType !== 'skirted' && baseType !== 'none') requireAnyPricingRow(context, 'material', 'ottoman-leg-base');
      }
    }

    if (
      (category === 'reupholstery' || category === 'reupholster') &&
      (formData.newSprings === true || formData.newSprings === 'true') &&
      !formHasRateOverride(formData, 'springsQty', 'springsRate')
    ) {
      requireAnyPricingRow(context, 'material', 'springs');
    }

    if (
      (category === 'bed' || category === 'beds') &&
      !formHasRateOverride(formData, 'frameQty', 'frameRate')
    ) {
      requireAnyPricingRow(context, 'frame', getRequiredFrameKeysForForm(category, formData, frameComplexity));
    }

    context.missingLookupList()
      .filter(row => !isExploratoryMissingLookup(row, category, formData, frameComplexity))
      .forEach(row => context.addMissingRow(row.category, row.key));
  }

  function getPricingLineage(missingRows = []) {
    const receipt = typeof getActivePricingSettingsReceipt === 'function'
      ? getActivePricingSettingsReceipt()
      : null;
    return {
      source: receipt?.source || 'pricing_settings',
      rows_count: receipt?.rows_count ?? null,
      loaded_at: receipt?.loaded_at ?? null,
      ...(missingRows.length ? { missing_rows: missingRows } : {}),
    };
  }

  function createMissingPricingRowsError(missingRows) {
    const rowText = missingRows.map(row => `${row.category}/${row.key}`).join(', ');
    const error = new Error(
      `Calculated quote pricing is blocked because live pricing_settings is missing required row(s): ${rowText}`,
    );
    error.code = 'PRICING_SETTINGS_MISSING_REQUIRED_ROWS';
    error.internal_blocker = true;
    error.missing_pricing_rows = missingRows;
    error.pricing_lineage = getPricingLineage(missingRows);
    return error;
  }

  function attachPricingLineage(compiled, context) {
    if (!compiled || typeof compiled !== 'object') return compiled;
    const pricingLineage = getPricingLineage(context.missingRowList());
    return {
      ...compiled,
      pricing_lineage: pricingLineage,
      form_data: {
        ...(cleanObject(compiled.form_data) || {}),
        pricing_lineage: pricingLineage,
      },
    };
  }

  function compileWithPricingGuard(item, compileFn) {
    const previousContext = activePricingLookupContext;
    const context = createPricingLookupContext();
    activePricingLookupContext = context;
    try {
      const compiled = compileFn();
      collectDerivedRequiredPricingRows(item, compiled, context);
      const missingRows = context.missingRowList();
      if (missingRows.length) {
        throw createMissingPricingRowsError(missingRows);
      }
      return attachPricingLineage(compiled, context);
    } finally {
      activePricingLookupContext = previousContext;
    }
  }

  function createPricingAdapter() {
    const context = activePricingLookupContext || createPricingLookupContext();
    return {
      getPrice(category, key) {
        const value = getPricingSettingValue(category, key);
        if (value === null) context.addMissingLookup(category, key);
        return value;
      },
      getFirstPrice(category, keys) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          const value = getPricingSettingValue(category, key);
          if (value !== null && value > 0) return value;
        }
        keyList
          .filter(key => !pricingSettingIsPresent(category, key))
          .forEach(key => context.addMissingLookup(category, key));
        return getPricingSettingValue(category, keyList[0]);
      },
      getMaterialsMultiplier() {
        return getLivePricingMultiplier('material');
      },
      getPassthroughMultiplier() {
        return getLivePricingMultiplier('passthrough');
      },
    };
  }

  function compilePillowItem(item) {
    if (!pillowCalc?.compilePillowFromFormData) {
      throw new Error('PrestigioPillowCalc.compilePillowFromFormData is required for pillow compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'pillows',
    };

    const compiled = pillowCalc.compilePillowFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'pillows',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'pillows',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileCushionItem(item) {
    if (!cushionCalc?.compileCushionFromFormData) {
      throw new Error('PrestigioCushionCalc.compileCushionFromFormData is required for cushion compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'cushions',
    };

    const compiled = cushionCalc.compileCushionFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'cushions',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'cushions',
        compiled_by: 'prestigio-write-service',
        ...(compiled.cushionSet ? { cushionSet: compiled.cushionSet } : {}),
      },
      ...(compiled.cushionSet ? { cushionSet: compiled.cushionSet } : {}),
    };
  }

  function compileReupholsteryItem(item) {
    if (!reupholsteryCalc?.compileReupholsteryFromFormData) {
      throw new Error('PrestigioReupholsteryCalc.compileReupholsteryFromFormData is required for reupholstery compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'reupholstery',
    };

    const compiled = reupholsteryCalc.compileReupholsteryFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
            passthrough: getLivePricingMultiplier('passthrough'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'reupholstery',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'reupholstery',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileRestuffingItem(item) {
    if (!restuffingCalc?.compileRestuffingFromFormData) {
      throw new Error('PrestigioRestuffingCalc.compileRestuffingFromFormData is required for restuffing compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'restuffing',
    };

    const compiled = restuffingCalc.compileRestuffingFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'restuffing',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      form_data: {
        ...compiled.formData,
        category: 'restuffing',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compilePatioItem(item) {
    if (!patioCalc?.compilePatioFromFormData) {
      throw new Error('PrestigioPatioCalc.compilePatioFromFormData is required for patio compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'patio',
    };

    const compiled = patioCalc.compilePatioFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'patio',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'patio',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileSoftgoodsItem(item) {
    if (!softgoodsCalc?.compileSoftgoodsFromFormData) {
      throw new Error('PrestigioSoftgoodsCalc.compileSoftgoodsFromFormData is required for softgoods compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'softgoods',
    };

    const compiled = softgoodsCalc.compileSoftgoodsFromFormData(
      formData,
      createPricingAdapter(),
    );

    return {
      ...item,
      category: 'softgoods',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'softgoods',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileOttomanItem(item) {
    if (!ottomanCalc?.compileOttomanFromFormData) {
      throw new Error('PrestigioOttomanCalc.compileOttomanFromFormData is required for ottoman compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'ottoman',
    };

    const compiled = ottomanCalc.compileOttomanFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
            passthrough: getLivePricingMultiplier('passthrough'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'ottoman',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'ottoman',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileBedItem(item) {
    if (!bedCalc?.compileBedFromFormData) {
      throw new Error('PrestigioBedCalc.compileBedFromFormData is required for bed compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'bed',
    };

    const compiled = bedCalc.compileBedFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
            passthrough: getLivePricingMultiplier('passthrough'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'bed',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'bed',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileSeatingItem(item) {
    if (!seatingCalc?.compileSeatingFromFormData) {
      throw new Error('PrestigioSeatingCalc.compileSeatingFromFormData is required for seating compile');
    }

    const formData = {
      ...(cleanObject(item.form_data) || {}),
      ...item,
      category: 'seating',
    };

    const compiled = seatingCalc.compileSeatingFromFormData(
      formData,
      createPricingAdapter(),
      {
        pricingOptions: {
          multipliers: {
            material: getLivePricingMultiplier('material'),
            passthrough: getLivePricingMultiplier('passthrough'),
          },
        },
      },
    );

    return {
      ...item,
      category: 'seating',
      description: compiled.description,
      cost_breakdown: compiled.costBreakdown,
      estimated_fabric_yardage: compiled.estimatedFabricYardage,
      estimated_fabric_cost: compiled.estimatedFabricCost,
      form_data: {
        ...compiled.formData,
        category: 'seating',
        compiled_by: 'prestigio-write-service',
      },
    };
  }

  function compileDraftQuoteItem(item) {
    if (!item || typeof item !== 'object') return item;
    if (!itemNeedsCompile(item)) return item;

    const canonicalItem = withCanonicalFillVocabulary(item);
    const category = getItemCategory(canonicalItem);
    if (category === 'pillows' || category === 'pillow') {
      return compileWithPricingGuard(canonicalItem, () => compilePillowItem(canonicalItem));
    }
    if (category === 'cushions' || category === 'cushion') {
      return compileWithPricingGuard(canonicalItem, () => compileCushionItem(canonicalItem));
    }
    if (category === 'reupholstery' || category === 'reupholster') {
      return compileWithPricingGuard(canonicalItem, () => compileReupholsteryItem(canonicalItem));
    }
    if (category === 'restuffing' || category === 'restuff') {
      return compileWithPricingGuard(canonicalItem, () => compileRestuffingItem(canonicalItem));
    }
    if (category === 'patio' || category === 'outdoor') {
      return compileWithPricingGuard(canonicalItem, () => compilePatioItem(canonicalItem));
    }
    if (category === 'softgoods' || category === 'soft-goods' || category === 'slipcover') {
      return compileWithPricingGuard(canonicalItem, () => compileSoftgoodsItem(canonicalItem));
    }
    if (category === 'ottoman' || category === 'ottomans') {
      return compileWithPricingGuard(canonicalItem, () => compileOttomanItem(canonicalItem));
    }
    if (category === 'bed' || category === 'beds') {
      return compileWithPricingGuard(canonicalItem, () => compileBedItem(canonicalItem));
    }
    if (category === 'seating' || category === 'custom-furniture' || category === 'seat') {
      return compileWithPricingGuard(canonicalItem, () => compileSeatingItem(canonicalItem));
    }
    return item;
  }

  function compileDraftQuoteItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(compileDraftQuoteItem);
  }

  return {
    itemNeedsCompile,
    assertDraftManualPricingAllowed,
    assertDraftMaterialsValid,
    normalizeDraftQuoteItemsForPayloadGate,
    compileDraftQuoteItem,
    compileDraftQuoteItems,
  };
}

module.exports = { createQuoteCompileClient };
