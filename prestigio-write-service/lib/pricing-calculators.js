function createPricingCalculators(deps) {
  const {
    quoteDescriptionGenerators,
    getPricingOptionsForBreakdown,
    getLivePricingMultiplier,
    cleanObject,
    toNullableNumber,
    roundQuoteBuilderPrice,
  } = deps;

  function requireGenerator(name) {
    const fn = quoteDescriptionGenerators?.[name];
    if (typeof fn !== 'function') {
      throw new Error(`quoteDescriptionGenerators.${name} is required for calculated quote pricing`);
    }
    return fn;
  }

  function quoteRevisionLineRaw(line) {
    const value = cleanObject(line) || {};
    if (value.raw !== undefined && value.raw !== null) return Number(value.raw) || 0;
    const qty = Number(value.qty ?? value.quantity ?? value.hours ?? 0) || 0;
    const rate = Number(value.rate ?? 0) || 0;
    return qty * rate;
  }

  function quoteRevisionLineFinal(line, costType = 'labor') {
    const value = cleanObject(line) || {};
    const final = toNullableNumber(value.final);
    if (final !== null) return final;
    const multiplier = toNullableNumber(value.multiplier) ?? getLivePricingMultiplier(costType);
    return quoteRevisionLineRaw(value) * multiplier;
  }

  function normalizeQuoteRevisionCostBreakdownLines(costBreakdown) {
    const breakdown = cleanObject(costBreakdown);
    if (!breakdown) return breakdown;
    const normalized = {};
    for (const [key, line] of Object.entries(breakdown)) {
      const lineObject = cleanObject(line);
      if (!lineObject) {
        normalized[key] = line;
        continue;
      }
      const nextLine = { ...lineObject };
      if (nextLine.quantity !== undefined) {
        nextLine.qty = nextLine.quantity;
      }
      const qty = Number(nextLine.qty ?? nextLine.quantity ?? nextLine.hours);
      const rate = Number(nextLine.rate);
      if (Number.isFinite(qty) && Number.isFinite(rate)) {
        const raw = qty * rate;
        nextLine.raw = raw;
        if (nextLine.final === undefined && Number.isFinite(Number(nextLine.multiplier))) {
          nextLine.final = raw * Number(nextLine.multiplier);
        }
      }
      normalized[key] = nextLine;
    }
    return normalized;
  }

  function calculateReupholsteryUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateReupholsteryUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculatePillowUnitPriceFromBreakdown(costBreakdown, quantity) {
    return requireGenerator('calculatePillowUnitPriceFromBreakdown')(
      costBreakdown,
      quantity,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateCushionUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateCushionUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateSeatingUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateSeatingUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateBedUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateBedUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateOttomanUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateOttomanUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateSoftgoodsUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculateSoftgoodsUnitPriceFromBreakdown')(costBreakdown);
  }

  function calculatePatioUnitPriceFromBreakdown(costBreakdown) {
    return requireGenerator('calculatePatioUnitPriceFromBreakdown')(
      costBreakdown,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  function calculateRestuffingUnitPriceFromBreakdown(costBreakdown, quantity) {
    return requireGenerator('calculateRestuffingUnitPriceFromBreakdown')(
      costBreakdown,
      quantity,
      getPricingOptionsForBreakdown(costBreakdown),
    );
  }

  return {
    quoteRevisionLineRaw,
    quoteRevisionLineFinal,
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
  };
}

module.exports = { createPricingCalculators };
