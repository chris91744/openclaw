function createCategoryRegistry(deps) {
  const {
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
    buildReupholsteryDescription,
    buildPillowDescription,
    buildCushionDescription,
    buildBedDescription,
    buildOttomanDescription,
    buildSoftgoodsDescription,
    buildPatioDescription,
    buildRestuffingDescription,
    quoteDescriptionGenerators,
    syncReupholsteryFormBooleans,
    REUPHOLSTERY_BOOLEAN_FIELD_MAP,
  } = deps;

  const HANDLERS = [
    {
      id: 'reupholstery',
      categories: new Set(['reupholstery']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          category !== 'seating' &&
          category !== 'custom-furniture' &&
          category !== 'bed' &&
          category !== 'beds' &&
          category !== 'patio' &&
          category !== 'outdoor' &&
          category !== 'restuffing' &&
          category !== 'restuff' &&
          breakdown && (
            breakdown.labor_upholstery ||
            breakdown.seat_foam ||
            breakdown.back_foam ||
            breakdown.seat_fill ||
            breakdown.back_fill ||
            breakdown.springs ||
            category === 'reupholstery'
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateReupholsteryUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, finalFormData, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'reupholstery' || finalCategory === 'reupholstery') &&
          (
            shouldRegenerateForSemanticPatch ||
            Object.keys(REUPHOLSTERY_BOOLEAN_FIELD_MAP).some(key => patch[key] !== undefined)
          )
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...finalFormData,
          category: 'reupholstery',
        };
        merged.description = buildReupholsteryDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'pillow',
      categories: new Set(['pillows', 'pillow']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            (breakdown.fill && category !== 'cushions' && category !== 'cushion') ||
            category === 'pillows' ||
            category === 'pillow'
          )
        );
      },
      calculatePrice(breakdown, ctx) {
        return calculatePillowUnitPriceFromBreakdown(breakdown, ctx.quantity);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'pillows' || category === 'pillow' || finalCategory === 'pillows' || finalCategory === 'pillow') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'pillows',
        };
        merged.description = buildPillowDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'cushion',
      categories: new Set(['cushions', 'cushion']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            breakdown.foam ||
            breakdown.fill ||
            category === 'cushions' ||
            category === 'cushion'
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateCushionUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'cushions' || category === 'cushion' || finalCategory === 'cushions' || finalCategory === 'cushion') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'cushions',
        };
        merged.description = buildCushionDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'seating',
      categories: new Set(['seating', 'custom-furniture']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            category !== 'patio' &&
            category !== 'outdoor' &&
            (breakdown.frame ||
            breakdown.seat_foam ||
            breakdown.back_foam ||
            breakdown.frame_padding ||
            breakdown.arm_foam ||
            category === 'seating' ||
            category === 'custom-furniture')
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateSeatingUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'seating' || category === 'custom-furniture' || finalCategory === 'seating' || finalCategory === 'custom-furniture') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'seating',
        };
        merged.description = quoteDescriptionGenerators.generateSeatingDescription({
          ...finalItem,
          ...merged.form_data,
          materials: cleanArray(merged.form_data.materials).length ? cleanArray(merged.form_data.materials) : cleanArray(finalItem.materials),
        });
        return true;
      },
    },
    {
      id: 'bed',
      categories: new Set(['bed', 'beds']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          category !== 'ottoman' &&
          category !== 'ottomans' &&
          breakdown && (
            category === 'bed' ||
            category === 'beds' ||
            breakdown.frame ||
            breakdown.legs ||
            breakdown.foam
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateBedUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'bed' || category === 'beds' || finalCategory === 'bed' || finalCategory === 'beds') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'bed',
        };
        merged.description = buildBedDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'ottoman',
      categories: new Set(['ottoman', 'ottomans']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            category === 'ottoman' ||
            category === 'ottomans' ||
            breakdown.wrap
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateOttomanUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'ottoman' || category === 'ottomans' || finalCategory === 'ottoman' || finalCategory === 'ottomans') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'ottoman',
        };
        merged.description = buildOttomanDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'softgoods',
      categories: new Set(['softgoods', 'soft-goods', 'slipcover']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            category === 'softgoods' ||
            category === 'soft-goods' ||
            category === 'slipcover'
          )
        );
      },
      calculatePrice(breakdown) {
        return calculateSoftgoodsUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'softgoods' || category === 'soft-goods' || category === 'slipcover' || finalCategory === 'softgoods' || finalCategory === 'soft-goods' || finalCategory === 'slipcover') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'softgoods',
        };
        merged.description = buildSoftgoodsDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'patio',
      categories: new Set(['patio', 'outdoor']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            category === 'patio' ||
            category === 'outdoor'
          )
        );
      },
      calculatePrice(breakdown) {
        return calculatePatioUnitPriceFromBreakdown(breakdown);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'patio' || category === 'outdoor' || finalCategory === 'patio' || finalCategory === 'outdoor') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'patio',
        };
        merged.description = buildPatioDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
    {
      id: 'restuffing',
      categories: new Set(['restuffing', 'restuff']),
      looksLikeBreakdown(breakdown, category) {
        return Boolean(
          breakdown && (
            category === 'restuffing' ||
            category === 'restuff'
          )
        );
      },
      calculatePrice(breakdown, ctx) {
        return calculateRestuffingUnitPriceFromBreakdown(breakdown, ctx.quantity);
      },
      regenerateDescription(merged, item, patch, ctx) {
        const { category, finalCategory, finalItem, shouldRegenerateForSemanticPatch } = ctx;
        const shouldRegenerate = (
          merged.description === undefined &&
          (category === 'restuffing' || category === 'restuff' || finalCategory === 'restuffing' || finalCategory === 'restuff') &&
          shouldRegenerateForSemanticPatch
        );
        if (!shouldRegenerate) return false;
        merged.form_data = {
          ...(cleanObject(finalItem.form_data) || {}),
          ...(cleanObject(merged.form_data) || {}),
          category: 'restuffing',
        };
        merged.description = buildRestuffingDescription(merged.form_data, {
          ...finalItem,
          form_data: merged.form_data,
        });
        return true;
      },
    },
  ];

  function resolveCategoryHandler(category) {
    const normalized = normalizeKey(category);
    return HANDLERS.find(handler => handler.categories.has(normalized)) || null;
  }

  function applyRevisionPricing(merged, item) {
    if (merged.sell_price !== undefined) return merged;
    const category = normalizeKey(
      merged.category ||
      item.category ||
      merged.form_data?.category ||
      item.form_data?.category ||
      '',
    );
    for (const handler of HANDLERS) {
      if (!handler.looksLikeBreakdown(merged.cost_breakdown, category)) continue;
      const calculatedPrice = handler.calculatePrice(merged.cost_breakdown, {
        quantity: merged.quantity ?? item.quantity,
      });
      if (calculatedPrice !== null) {
        merged.sell_price = calculatedPrice;
        break;
      }
    }
    return merged;
  }

  function applyRevisionDescription(merged, item, patch, ctx) {
    for (const handler of HANDLERS) {
      if (handler.regenerateDescription(merged, item, patch, ctx)) {
        break;
      }
    }
    return merged;
  }

  return {
    HANDLERS,
    resolveCategoryHandler,
    applyRevisionPricing,
    applyRevisionDescription,
  };
}

module.exports = { createCategoryRegistry };
