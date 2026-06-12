function createMergeRevisionPatch(deps) {
  const {
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
    syncReupholsteryFormBooleans,
    isDescriptionAffectingQuotePatch: isDescriptionAffectingQuotePatchDep,
  } = deps;

  const CATEGORY_PAYLOAD_KEYS = [
    'bedPayload',
    'cushionPayload',
    'ottomanPayload',
    'patioPayload',
    'pillowPayload',
    'restuffingPayload',
    'reupholsteryPayload',
    'seatingPayload',
    'softgoodsPayload',
  ];

  function cloneQuoteRevisionValue(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function stableQuoteRevisionJson(value) {
    if (typeof stableJson === 'function') return stableJson(value);
    if (Array.isArray(value)) return `[${value.map(stableQuoteRevisionJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableQuoteRevisionJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function quoteRevisionValuesEqual(left, right) {
    return stableQuoteRevisionJson(left) === stableQuoteRevisionJson(right);
  }

  function omitPricingArtifacts(value) {
    const object = cleanObject(value);
    if (!object) return {};
    const clone = { ...object };
    delete clone.pricingPayload;
    for (const key of CATEGORY_PAYLOAD_KEYS) {
      delete clone[key];
    }
    return clone;
  }

  function quoteRevisionCategoryPayloadKey(item) {
    const formData = cleanObject(item?.form_data) || {};
    const category = normalizeKey(item?.category || formData.category);
    if (category === 'bed' || category === 'beds') return 'bedPayload';
    if (category === 'cushion' || category === 'cushions') return 'cushionPayload';
    if (category === 'ottoman' || category === 'ottomans') return 'ottomanPayload';
    if (category === 'patio' || category === 'outdoor') return 'patioPayload';
    if (category === 'pillow' || category === 'pillows') return 'pillowPayload';
    if (category === 'restuffing' || category === 'restuff') return 'restuffingPayload';
    if (category === 'reupholstery') return 'reupholsteryPayload';
    if (category === 'seating' || category === 'custom-furniture') return 'seatingPayload';
    if (category === 'softgoods' || category === 'soft-goods' || category === 'slipcover' || category === 'slipcovers') return 'softgoodsPayload';
    return null;
  }

  function quoteRevisionHasPricingLineageArtifacts(item) {
    const formData = cleanObject(item?.form_data) || {};
    const snapshot = cleanObject(item?.quoted_plan_snapshot);
    if (cleanObject(formData.pricingPayload)) return true;
    if (CATEGORY_PAYLOAD_KEYS.some(key => cleanObject(formData[key]) && Object.prototype.hasOwnProperty.call(formData[key], 'pricing'))) {
      return true;
    }
    return Boolean(snapshot);
  }

  function buildAuthoritativePricingPayload(item) {
    if (!quotePlanContracts || typeof quotePlanContracts.buildQuotePricingPayload !== 'function') {
      return null;
    }
    const formData = cleanObject(item?.form_data) || {};
    const strippedFormData = omitPricingArtifacts(formData);
    const strippedTopLevel = omitPricingArtifacts(item);
    const source = {
      ...strippedTopLevel,
      ...item,
      form_data: strippedFormData,
      lineItems: item.cost_breakdown,
      cost_breakdown: item.cost_breakdown,
      type: item.item_type || item.type || strippedFormData.type,
      unitPrice: item.sell_price,
      total: item.sell_price,
    };
    delete source.pricingPayload;
    for (const key of CATEGORY_PAYLOAD_KEYS) {
      delete source[key];
    }
    return cloneQuoteRevisionValue(quotePlanContracts.buildQuotePricingPayload(source));
  }

  function syncFormDataPricingLineage(formData, pricingPayload, item) {
    const existing = cleanObject(formData) || {};
    const next = { ...existing, pricingPayload: cloneQuoteRevisionValue(pricingPayload) };
    const relevantPayloadKey = quoteRevisionCategoryPayloadKey(item);
    const payloadKeys = new Set([
      ...CATEGORY_PAYLOAD_KEYS.filter(key => cleanObject(existing[key]) && Object.prototype.hasOwnProperty.call(existing[key], 'pricing')),
      ...(relevantPayloadKey && cleanObject(existing[relevantPayloadKey]) ? [relevantPayloadKey] : []),
    ]);
    for (const key of payloadKeys) {
      next[key] = {
        ...cleanObject(existing[key]),
        pricing: cloneQuoteRevisionValue(pricingPayload),
      };
    }
    return next;
  }

  function buildQuoteRevisionSnapshot(item) {
    const formData = cleanObject(item?.form_data) || {};
    return {
      schema_version: 1,
      item: {
        item_type: item.item_type ?? null,
        category: item.category ?? null,
        description: item.description ?? null,
        width: item.width ?? null,
        depth: item.depth ?? null,
        height: item.height ?? null,
        quantity: item.quantity ?? null,
        room: item.room ?? null,
        sidemark: item.sidemark ?? null,
        reference_images: cloneQuoteRevisionValue(item.reference_images) || null,
        sell_price: item.sell_price ?? null,
        cost_breakdown: cloneQuoteRevisionValue(item.cost_breakdown) || null,
        estimated_fabric_yardage: item.estimated_fabric_yardage ?? null,
        estimated_fabric_cost: item.estimated_fabric_cost ?? null,
      },
      form_data: cloneQuoteRevisionValue(formData) || {},
    };
  }

  function assertQuoteRevisionPricingLineageConsistent(item, context = 'quote revision item') {
    if (!quoteRevisionHasPricingLineageArtifacts(item)) return;
    const costBreakdown = cleanObject(item?.cost_breakdown);
    if (!costBreakdown) return;
    const pricingPayload = cleanObject(buildAuthoritativePricingPayload(item));
    if (!pricingPayload) return;
    const formData = cleanObject(item?.form_data) || {};
    const formPricing = cleanObject(formData.pricingPayload);
    if (formPricing && !quoteRevisionValuesEqual(formPricing, pricingPayload)) {
      throw new Error(`${context} pricing lineage mismatch: form_data.pricingPayload does not match cost_breakdown/sell_price.`);
    }
    for (const key of CATEGORY_PAYLOAD_KEYS) {
      const payloadPricing = cleanObject(formData[key]) && cleanObject(formData[key].pricing);
      if (payloadPricing && !quoteRevisionValuesEqual(payloadPricing, pricingPayload)) {
        throw new Error(`${context} pricing lineage mismatch: form_data.${key}.pricing does not match cost_breakdown/sell_price.`);
      }
    }
    const snapshot = cleanObject(item?.quoted_plan_snapshot);
    if (!snapshot) return;
    const snapshotItem = cleanObject(snapshot.item) || {};
    if (!quoteRevisionValuesEqual(snapshotItem.cost_breakdown || null, costBreakdown)) {
      throw new Error(`${context} pricing lineage mismatch: quoted_plan_snapshot.item.cost_breakdown does not match cost_breakdown.`);
    }
    if (toNullableNumber(snapshotItem.sell_price) !== toNullableNumber(item.sell_price)) {
      throw new Error(`${context} pricing lineage mismatch: quoted_plan_snapshot.item.sell_price does not match sell_price.`);
    }
    const snapshotFormData = cleanObject(snapshot.form_data) || {};
    const snapshotPricing = cleanObject(snapshotFormData.pricingPayload);
    if (snapshotPricing && !quoteRevisionValuesEqual(snapshotPricing, pricingPayload)) {
      throw new Error(`${context} pricing lineage mismatch: quoted_plan_snapshot.form_data.pricingPayload does not match cost_breakdown/sell_price.`);
    }
    for (const key of CATEGORY_PAYLOAD_KEYS) {
      const payloadPricing = cleanObject(snapshotFormData[key]) && cleanObject(snapshotFormData[key].pricing);
      if (payloadPricing && !quoteRevisionValuesEqual(payloadPricing, pricingPayload)) {
        throw new Error(`${context} pricing lineage mismatch: quoted_plan_snapshot.form_data.${key}.pricing does not match cost_breakdown/sell_price.`);
      }
    }
  }

  function syncQuoteRevisionPricingLineage(merged, item, patch) {
    const pricingChanged = patch.cost_breakdown !== undefined || patch.sell_price !== undefined;
    if (!pricingChanged) return merged;
    const finalItem = applyQuoteRevisionItemPatch(item, merged);
    if (!quoteRevisionHasPricingLineageArtifacts(finalItem)) return merged;
    const costBreakdown = cleanObject(finalItem.cost_breakdown);
    if (!costBreakdown) return merged;
    const pricingPayload = buildAuthoritativePricingPayload(finalItem);
    if (!cleanObject(pricingPayload)) return merged;
    const nextFormData = syncFormDataPricingLineage(finalItem.form_data, pricingPayload, finalItem);
    merged.form_data = nextFormData;

    const finalItemWithFormData = applyQuoteRevisionItemPatch(item, merged);
    if (cleanObject(finalItemWithFormData.quoted_plan_snapshot)) {
      merged.quoted_plan_snapshot = buildQuoteRevisionSnapshot(finalItemWithFormData);
    }
    assertQuoteRevisionPricingLineageConsistent(
      applyQuoteRevisionItemPatch(item, merged),
      'quote revision item',
    );
    return merged;
  }

  function buildQuoteRevisionItemUpdates(updates) {
    const raw = cleanObject(updates) || {};
    const patch = {};

    const textFields = {
      item_type: 200,
      item_name: 500,
      custom_name: 500,
      category: 100,
      description: 5000,
      room: 500,
      sidemark: 500,
      quote_item_status: 100,
      status: 100,
    };
    for (const [field, max] of Object.entries(textFields)) {
      if (raw[field] !== undefined) patch[field] = cleanText(raw[field], max);
    }

    const numberFields = [
      'quantity',
      'sell_price',
      'width',
      'depth',
      'height',
      'estimated_fabric_yardage',
      'actual_fabric_yardage',
    ];
    for (const field of numberFields) {
      if (raw[field] !== undefined) patch[field] = toNullableNumber(raw[field]);
    }

    const booleanFields = [
      'new_foam',
      'new_springs',
      'new_webbing',
      'frame_repair',
      'new_fill',
      'strip_old',
      'tufting',
      'nailheads',
    ];
    for (const field of booleanFields) {
      if (raw[field] !== undefined) patch[field] = Boolean(raw[field]);
    }

    if (raw.cost_breakdown !== undefined) {
      patch.cost_breakdown = cleanObject(raw.cost_breakdown);
    }
    if (raw.form_data !== undefined) {
      patch.form_data = cleanObject(raw.form_data);
    }
    if (raw.reference_images !== undefined) {
      patch.reference_images = Array.isArray(raw.reference_images) ? raw.reference_images : [];
    }
    if (raw.referenceImages !== undefined) {
      patch.reference_images = Array.isArray(raw.referenceImages) ? raw.referenceImages : [];
    }
    if (raw.reference_image_paths !== undefined) {
      patch.reference_image_paths = cleanArray(raw.reference_image_paths);
    }
    if (raw.referenceImagePaths !== undefined) {
      patch.reference_image_paths = cleanArray(raw.referenceImagePaths);
    }
    const sourceAttachmentEntries = [
      ...cleanArray(raw.sourceAttachments),
      ...cleanArray(raw.source_attachments),
      ...cleanArray(raw.sourceAttachmentPaths),
      ...cleanArray(raw.source_attachment_paths),
      ...cleanArray(raw.attachment_paths),
      ...cleanArray(raw.attachments),
    ];
    if (sourceAttachmentEntries.length) {
      patch.sourceAttachments = sourceAttachmentEntries;
    }

    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  }

  function truthyAuthorization(value) {
    return value === true || value === 'true' || value === 'yes' || value === 'authorized';
  }

  function hasDirectSellPriceUpdate(updates) {
    const raw = cleanObject(updates) || {};
    return Object.prototype.hasOwnProperty.call(raw, 'sell_price');
  }

  function hasSuppliedRevisionCostBreakdown(updates) {
    const raw = cleanObject(updates) || {};
    return fieldIsPresent(raw.cost_breakdown) || fieldIsPresent(raw.lineItems);
  }

  function quoteRevisionManualPriceAuthorized(fields, op) {
    return truthyAuthorization(fields?.manual_price_override_authorized);
  }

  function assertQuoteRevisionManualPricingAllowed(fields, op) {
    if (!hasDirectSellPriceUpdate(op?.updates)) return;
    if (hasSuppliedRevisionCostBreakdown(op?.updates)) {
      throw new Error(
        'Manual sell_price overrides for quote revisions must omit cost_breakdown and lineItems. ' +
        'Send structured cost_breakdown drivers and omit sell_price so the writer can calculate, or send only the trusted final sell_price after Chris explicitly approves a manual override.',
      );
    }
    if (quoteRevisionManualPriceAuthorized(fields, op)) return;
    throw new Error(
      'Manual sell_price overrides are blocked for quote revisions. ' +
      'Change form_data/cost_breakdown pricing drivers and omit sell_price, or add manual_price_override_authorized: true only after Chris explicitly approves a manual price override for this line.',
    );
  }

  const AGENT_FORBIDDEN_REVISION_FORM_FIELDS = [
    'assumptions',
    'bedConstructionNotes',
    'bedModificationScopeSummary',
    'bedTvLiftAccessNotes',
    'bedTvLiftClearanceNotes',
    'bedTvLiftNotes',
    'bedTvLiftPowerNotes',
    'client_questions',
    'client_visible_notes',
    'clientVisibleNotes',
    'constructionNotes',
    'description',
    'manual_price_override_authorized',
    'manual_price_override',
    'manualPriceOverride',
    'modificationScopeSummary',
    'notes',
    'priceMode',
    'pricingMode',
    'quote_notes',
    'raw_text',
    'rawText',
    'source_text',
    'sourceText',
    'tvLiftAccessNotes',
    'tvLiftClearanceNotes',
    'tvLiftNotes',
    'tvLiftPowerNotes',
  ];

  const AGENT_FORBIDDEN_REVISION_NESTED_FORM_PATHS = [
    ['tvLift', 'accessNotes'],
    ['tvLift', 'clearanceNotes'],
    ['tvLift', 'notes'],
    ['tvLift', 'powerNotes'],
    ['bedTvLift', 'accessNotes'],
    ['bedTvLift', 'clearanceNotes'],
    ['bedTvLift', 'notes'],
    ['bedTvLift', 'powerNotes'],
    ['modification', 'scopeSummary'],
    ['modification', 'notes'],
    ['work', 'notes'],
  ];

  function fieldIsPresent(value) {
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  }

  function valueAtPath(object, path) {
    let current = object;
    for (const segment of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  function assertQuoteRevisionStructuredPayloadAllowed(fields, op) {
    const updates = cleanObject(op?.updates) || {};
    if (fieldIsPresent(updates.description)) {
      throw new Error(
        'Quote revisions must omit direct description updates. ' +
        'Change structured form_data fields and let the app/RPA regenerate quote copy.',
      );
    }
    if (
      fieldIsPresent(op?.manual_price_override_authorized) ||
      fieldIsPresent(updates.manual_price_override_authorized) ||
      fieldIsPresent(updates.manual_price_override) ||
      fieldIsPresent(updates.manualPriceOverride)
    ) {
      throw new Error(
        'Quote revisions must not self-authorize manual pricing inside an operation. ' +
        'Use trusted confirmation-level manual_price_override_authorized only after Chris explicitly approves it.',
      );
    }
    const formData = cleanObject(updates.form_data) || {};
    for (const field of AGENT_FORBIDDEN_REVISION_FORM_FIELDS) {
      if (!fieldIsPresent(formData[field])) continue;
      throw new Error(
        `Quote revisions must omit form_data.${field}. ` +
        'Agent-created revisions may only send approved structured fields; prose belongs in review context.',
      );
    }
    for (const path of AGENT_FORBIDDEN_REVISION_NESTED_FORM_PATHS) {
      if (!fieldIsPresent(valueAtPath(formData, path))) continue;
      throw new Error(
        `Quote revisions must omit form_data.${path.join('.')}. ` +
        'Agent-created revisions may only send approved structured fields; nested prose belongs in review context.',
      );
    }
  }

  function assertAppQuoteTaxonomyAllowed(item, context = 'quote item') {
    const formData = cleanObject(item?.form_data) || {};
    const category = normalizeKey(item?.category || formData.category);
    const type = normalizeKey(
      item?.item_type ||
      item?.type ||
      formData.type ||
      formData.cushionType ||
      formData.pillowType ||
      '',
    );

    const cushionCategories = new Set(['cushion', 'cushions']);

    if (type === 'cushion-set' && !cushionCategories.has(category)) {
      throw new Error(
        `${context} uses app cushion taxonomy value "cushion-set" outside category "cushions". ` +
        'Use category "cushions" for seat/back cushion packages, or choose an app-supported type for the selected category.',
      );
    }

    if (cushionCategories.has(category)) {
      const validCushionTypes = new Set(['window-seat', 'bench', 'chair-pad', 'cushion-set']);
      if (type && !validCushionTypes.has(type)) {
        throw new Error(
          `${context} uses unsupported cushion item_type "${type}". ` +
          `Valid cushion types are: ${Array.from(validCushionTypes).join(', ')}.`,
        );
      }
    }

    if (category === 'seating') {
      const validSeatingTypes = new Set(['sofa', 'loveseat', 'chair', 'dining-chair', 'sectional', 'banquette']);
      if (type && !validSeatingTypes.has(type)) {
        throw new Error(
          `${context} uses unsupported seating item_type "${type}". ` +
          `Valid seating types are: ${Array.from(validSeatingTypes).join(', ')}.`,
        );
      }
    }
  }

  function deepMergeQuoteRevisionObjects(base, updates) {
    const baseObject = cleanObject(base) || {};
    const updateObject = cleanObject(updates) || {};
    const merged = { ...baseObject };
    for (const [key, value] of Object.entries(updateObject)) {
      if (cleanObject(value) && cleanObject(merged[key])) {
        merged[key] = deepMergeQuoteRevisionObjects(merged[key], value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  function isDescriptionAffectingQuotePatch(category, patch) {
    if (
      quotePlanContracts &&
      typeof quotePlanContracts.isQuoteDescriptionAffectingPatch === 'function'
    ) {
      return quotePlanContracts.isQuoteDescriptionAffectingPatch(category, patch);
    }
    if (typeof isDescriptionAffectingQuotePatchDep === 'function') {
      return isDescriptionAffectingQuotePatchDep(category, patch);
    }
    return Boolean(patch && typeof patch === 'object' && patch.description !== undefined);
  }

  function applyQuoteRevisionItemPatch(item, patch) {
    return { ...item, ...patch };
  }

  function mergeQuoteRevisionPatchIntoItem(item, patch) {
    const merged = { ...patch };
    if (patch.form_data !== undefined) {
      merged.form_data = deepMergeQuoteRevisionObjects(item.form_data, patch.form_data);
    }
    if (patch.cost_breakdown !== undefined) {
      merged.cost_breakdown = normalizeQuoteRevisionCostBreakdownLines(
        deepMergeQuoteRevisionObjects(item.cost_breakdown, patch.cost_breakdown),
      );
    }
    const category = normalizeKey(
      merged.category ||
      item.category ||
      merged.form_data?.category ||
      item.form_data?.category ||
      '',
    );
    assertAppQuoteTaxonomyAllowed(applyQuoteRevisionItemPatch(item, merged), 'quote revision item');
    applyRevisionPricing(merged, item);
    const finalItem = applyQuoteRevisionItemPatch(item, merged);
    const finalFormData = syncReupholsteryFormBooleans(finalItem.form_data, finalItem);
    const finalCategory = normalizeKey(
      finalItem.category ||
      finalFormData.category ||
      '',
    );
    const shouldRegenerateForSemanticPatch = isDescriptionAffectingQuotePatch(
      category || finalCategory,
      patch,
    );
    applyRevisionDescription(merged, item, patch, {
      category,
      finalCategory,
      finalItem,
      finalFormData,
      shouldRegenerateForSemanticPatch,
    });
    syncQuoteRevisionPricingLineage(merged, item, patch);
    return merged;
  }

  return {
    buildQuoteRevisionItemUpdates,
    truthyAuthorization,
    hasDirectSellPriceUpdate,
    quoteRevisionManualPriceAuthorized,
    assertQuoteRevisionManualPricingAllowed,
    assertQuoteRevisionStructuredPayloadAllowed,
    assertAppQuoteTaxonomyAllowed,
    deepMergeQuoteRevisionObjects,
    isDescriptionAffectingQuotePatch,
    applyQuoteRevisionItemPatch,
    mergeQuoteRevisionPatchIntoItem,
    assertQuoteRevisionPricingLineageConsistent,
  };
}

module.exports = { createMergeRevisionPatch };
