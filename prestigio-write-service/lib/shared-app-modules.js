const fs = require('fs');

const SHARED_FILL_CALCULATOR_PATH =
  process.env.QUOTE_FILL_CALCULATOR_PATH || '/app/quote-fill-calculator.js';
const SHARED_PILLOW_CALC_PATH =
  process.env.PILLOWS_CALC_PATH || '/app/pillows-calc.js';
const SHARED_DESCRIPTION_GENERATOR_PATH =
  process.env.QUOTE_DESCRIPTION_GENERATORS_PATH || '/app/quote-description-generators.js';
const SHARED_QUOTE_PLAN_CONTRACTS_PATH =
  process.env.QUOTE_PLAN_CONTRACTS_PATH || '/app/quote-plan-contracts.js';

function resolveSharedModulePath(configuredPath) {
  if (fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const siblingMjsPath = configuredPath.endsWith('.js')
    ? configuredPath.replace(/\.js$/, '.mjs')
    : `${configuredPath}.mjs`;
  if (fs.existsSync(siblingMjsPath)) {
    throw new Error(
      `${configuredPath} is missing. Found ESM source at ${siblingMjsPath}. ` +
      'Regenerate the CommonJS shim with `npm run quote:v2-shared-shims:generate` in prestigio-app.',
    );
  }

  return configuredPath;
}

function loadSharedModule(configuredPath, globalName) {
  const modulePath = resolveSharedModulePath(configuredPath);
  require(modulePath);
  const loaded = require.cache[require.resolve(modulePath)]?.exports;
  if (loaded && typeof loaded === 'object' && Object.keys(loaded).length > 0) {
    return loaded;
  }
  if (globalThis[globalName]) {
    return globalThis[globalName];
  }
  throw new Error(`Unable to load ${globalName} from ${modulePath}`);
}

const quotePlanContracts = loadSharedModule(
  SHARED_QUOTE_PLAN_CONTRACTS_PATH,
  'QuotePlanContracts',
);
const quoteFillCalculator = loadSharedModule(
  SHARED_FILL_CALCULATOR_PATH,
  'PrestigioQuoteFillCalculator',
);
const quoteDescriptionGenerators = loadSharedModule(
  SHARED_DESCRIPTION_GENERATOR_PATH,
  'PrestigioQuoteDescriptionGenerators',
);
const pillowCalc = loadSharedModule(
  SHARED_PILLOW_CALC_PATH,
  'PrestigioPillowCalc',
);
const SHARED_CUSHION_CALC_PATH =
  process.env.CUSHIONS_CALC_PATH || '/app/cushions-calc.js';
const cushionCalc = loadSharedModule(
  SHARED_CUSHION_CALC_PATH,
  'PrestigioCushionCalc',
);
const SHARED_REUPHOLSTERY_CALC_PATH =
  process.env.REUPHOLSTERY_CALC_PATH || '/app/reupholstery-calc.js';
const reupholsteryCalc = loadSharedModule(
  SHARED_REUPHOLSTERY_CALC_PATH,
  'PrestigioReupholsteryCalc',
);
const SHARED_RESTUFFING_CALC_PATH =
  process.env.RESTUFFING_CALC_PATH || '/app/restuffing-calc.js';
const restuffingCalc = loadSharedModule(
  SHARED_RESTUFFING_CALC_PATH,
  'PrestigioRestuffingCalc',
);
const SHARED_PATIO_CALC_PATH =
  process.env.PATIO_CALC_PATH || '/app/patio-calc.js';
const patioCalc = loadSharedModule(
  SHARED_PATIO_CALC_PATH,
  'PrestigioPatioCalc',
);
const SHARED_SOFTGOODS_CALC_PATH =
  process.env.SOFTGOODS_CALC_PATH || '/app/softgoods-calc.js';
const softgoodsCalc = loadSharedModule(
  SHARED_SOFTGOODS_CALC_PATH,
  'PrestigioSoftgoodsCalc',
);
const SHARED_OTTOMAN_CALC_PATH =
  process.env.OTTOMAN_CALC_PATH || '/app/ottoman-calc.js';
const ottomanCalc = loadSharedModule(
  SHARED_OTTOMAN_CALC_PATH,
  'PrestigioOttomanCalc',
);
const SHARED_BED_CALC_PATH =
  process.env.BED_CALC_PATH || '/app/bed-calc.js';
const bedCalc = loadSharedModule(
  SHARED_BED_CALC_PATH,
  'PrestigioBedCalc',
);
const SHARED_SEATING_CALC_PATH =
  process.env.SEATING_CALC_PATH || '/app/seating-calc.js';
const seatingCalc = loadSharedModule(
  SHARED_SEATING_CALC_PATH,
  'PrestigioSeatingCalc',
);

if (!quotePlanContracts || typeof quotePlanContracts.isQuoteDescriptionAffectingPatch !== 'function') {
  throw new Error(`Unable to load quote plan contracts from ${SHARED_QUOTE_PLAN_CONTRACTS_PATH}`);
}

if (!quoteFillCalculator || typeof quoteFillCalculator.calculatePillowFill !== 'function') {
  throw new Error(`Unable to load quote fill calculator from ${SHARED_FILL_CALCULATOR_PATH}`);
}

if (
  !quoteDescriptionGenerators ||
  typeof quoteDescriptionGenerators.generatePillowDescription !== 'function'
) {
  throw new Error(
    `Unable to load quote description generators from ${SHARED_DESCRIPTION_GENERATOR_PATH}`,
  );
}

if (!pillowCalc || typeof pillowCalc.compilePillowFromFormData !== 'function') {
  throw new Error(`Unable to load pillow calc from ${SHARED_PILLOW_CALC_PATH}`);
}

if (!cushionCalc || typeof cushionCalc.compileCushionFromFormData !== 'function') {
  throw new Error(`Unable to load cushion calc from ${SHARED_CUSHION_CALC_PATH}`);
}

if (!reupholsteryCalc || typeof reupholsteryCalc.compileReupholsteryFromFormData !== 'function') {
  throw new Error(`Unable to load reupholstery calc from ${SHARED_REUPHOLSTERY_CALC_PATH}`);
}

if (!restuffingCalc || typeof restuffingCalc.compileRestuffingFromFormData !== 'function') {
  throw new Error(`Unable to load restuffing calc from ${SHARED_RESTUFFING_CALC_PATH}`);
}

if (!patioCalc || typeof patioCalc.compilePatioFromFormData !== 'function') {
  throw new Error(`Unable to load patio calc from ${SHARED_PATIO_CALC_PATH}`);
}

if (!softgoodsCalc || typeof softgoodsCalc.compileSoftgoodsFromFormData !== 'function') {
  throw new Error(`Unable to load softgoods calc from ${SHARED_SOFTGOODS_CALC_PATH}`);
}

if (!ottomanCalc || typeof ottomanCalc.compileOttomanFromFormData !== 'function') {
  throw new Error(`Unable to load ottoman calc from ${SHARED_OTTOMAN_CALC_PATH}`);
}

if (!bedCalc || typeof bedCalc.compileBedFromFormData !== 'function') {
  throw new Error(`Unable to load bed calc from ${SHARED_BED_CALC_PATH}`);
}

if (!seatingCalc || typeof seatingCalc.compileSeatingFromFormData !== 'function') {
  throw new Error(`Unable to load seating calc from ${SHARED_SEATING_CALC_PATH}`);
}

module.exports = {
  quotePlanContracts,
  quoteFillCalculator,
  quoteDescriptionGenerators,
  pillowCalc,
  cushionCalc,
  reupholsteryCalc,
  restuffingCalc,
  patioCalc,
  softgoodsCalc,
  ottomanCalc,
  bedCalc,
  seatingCalc,
  resolveSharedModulePath,
  loadSharedModule,
};
