const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createOrchestrator } = require('./lib/orchestrator');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.QUOTE_PLAN_CONTRACTS_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-plan-contracts.js');
process.env.QUOTE_FILL_CALCULATOR_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-fill-calculator.js');
process.env.PILLOWS_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/pillows.calc.js');
process.env.CUSHIONS_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/cushions.calc.js');
process.env.REUPHOLSTERY_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/reupholstery.calc.js');
process.env.RESTUFFING_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/restuffing.calc.js');
process.env.PATIO_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/patio.calc.js');
process.env.SOFTGOODS_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/softgoods.calc.js');
process.env.OTTOMAN_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/ottoman.calc.js');
process.env.BED_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/bed.calc.js');
process.env.SEATING_CALC_PATH = path.resolve(__dirname, '../../prestigio-app/js/categories/seating.calc.js');
process.env.QUOTE_DESCRIPTION_GENERATORS_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-description-generators.js');
process.env.PAYLOAD_GATE_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-intake/payload-gate/index.cjs');

const {
  assertDraftManualPricingAllowed,
  assertDraftMaterialsValid,
  assertDraftAttachmentReferencesValid,
  assertQuoteRevisionManualPricingAllowed,
  assertQuoteRevisionPricingLineageConsistent,
  buildDraftQuotePayload,
  buildConfirmSummary,
  clearActivePricingSettings,
  compileDraftQuoteItems,
  getDraftQuoteSiteVisitTotal,
  isAllowedAttachmentPath,
  mergeQuoteRevisionPatchIntoItem,
  normalizeAttachmentPath,
  normalizeDraftItem,
  normalizeDraftQuoteItemsForPayloadGate,
  reviseExistingQuote,
  resolveDraftSourceAttachments,
  setActivePricingSettingsFromRows,
  summarizeDraftQuotePricingModes,
  summarizeCompiledDraftItemsForPreview,
  getPayloadGate,
  sumDraftQuoteItems
} = require('./index.js');

test('payload gate rejects invalid create-draft-quote payloads before compile', () => {
  const gate = getPayloadGate();
  const payload = {
    quote: { sidemark: 'Test' },
    items: [
      {
        category: 'seating',
        item_type: 'chair',
        item_name: 'CHAIR',
        quantity: 1,
        form_data: { category: 'seating', type: 'chair', width: 30, depth: 30, height: 30, quantity: 1 },
      },
    ],
  };

  assert.throws(
    () => gate.validateCreateDraftQuote(payload),
    /client_id or quote.project_id/,
  );
});

test('payload gate surface is pinned to the mounted gate', () => {
  const { getPayloadGateSurface } = require('./lib/payload-gate-client');
  const surface = getPayloadGateSurface();
  assert.equal(surface.gate, 'prestigio-create-draft-quote');
  assert.ok(surface.fingerprint);
  assert.ok(surface.categories.seating);
});

test('create draft confirmation includes calculated site visit in total', () => {
  const summary = buildConfirmSummary('create-draft-quote', {
    quote: {
      sidemark: 'Site Visit Test',
      site_visit_hours: 2,
      site_visit_rate: 175
    },
    items: [
      {
        category: 'softgoods',
        quantity: 1,
        cost_breakdown: {
          labor: { hours: 1, rate: 100 }
        }
      }
    ]
  });

  assert.equal(getDraftQuoteSiteVisitTotal({ site_visit_hours: 2, site_visit_rate: 175 }), 350);
  assert.match(summary, /total \$450\.00 including \$350\.00 site visit/);
});

test('create draft confirmation distinguishes calculated and manual prices', () => {
  const summary = buildConfirmSummary('create-draft-quote', {
    quote: { sidemark: 'Pricing Mode Test' },
    items: [
      {
        category: 'softgoods',
        quantity: 1,
        cost_breakdown: {
          labor: { hours: 1, rate: 100 }
        }
      },
      {
        category: 'softgoods',
        quantity: 1,
        sell_price: 225
      }
    ]
  });

  assert.equal(
    summarizeDraftQuotePricingModes([
      { cost_breakdown: { labor: { hours: 1, rate: 100 } } },
      { sell_price: 225 }
    ]),
    '; pricing: 1 calculated from cost breakdown, 1 manual/client-facing sell price'
  );
  assert.match(summary, /pricing: 1 calculated from cost breakdown, 1 manual\/client-facing sell price/);
});

test('cushion golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/cushions.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'cushions',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.foam?.qty, golden.expected.foam_qty);
    assert.equal(normalized.cost_breakdown?.fill?.qty, golden.expected.fill_qty);
    assert.equal(normalized.cost_breakdown?.labor?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('pillow golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/pillows.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'pillows',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.ok(normalized.cost_breakdown?.fill?.qty >= golden.expected.fill_qty_min);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    assert.equal(normalized.estimated_fabric_yardage, golden.expected.estimated_fabric_yardage);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('pillow draft fill is canonicalized on the persist path (matches the app human path)', () => {
  // normalizeDraftItem is exactly what the persist builder runs per item
  // (quote-handlers builds the recorded items via fields.items.map(normalizeDraftItem)).
  const normalized = normalizeDraftItem(
    {
      category: 'pillows',
      item_name: 'Test pillow',
      quantity: 1,
      sell_price: 120,
      form_data: {
        pillowType: 'throw',
        pillowFill: '50/50',
        width: 20,
        height: 20,
        quantity: 1,
        construction: 'blind-seam',
      },
    },
    0,
  );
  // "50/50" must canonicalize to "down-50" the same way the app's
  // normalizePillowFill does, so AI-built and human-built pillows store the
  // same fill key. Regression guard: resolvePillowFillKey was previously dead.
  assert.equal(normalized.form_data.pillowFill, 'down-50');
});

test('reupholstery golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/reupholstery.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'reupholstery',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.seat_foam?.qty, golden.expected.seat_foam_qty);
    assert.equal(normalized.cost_breakdown?.seat_foam?.rate, golden.expected.seat_foam_rate);
    assert.equal(normalized.cost_breakdown?.back_foam?.qty, golden.expected.back_foam_qty);
    assert.equal(normalized.cost_breakdown?.back_foam?.rate, golden.expected.back_foam_rate);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    assert.equal(normalized.estimated_fabric_yardage, golden.expected.estimated_fabric_yardage);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('pillow form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/pillows.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'pillows',
        quantity: golden.form_data.quantity,
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('cushion form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/cushions.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'cushions',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('reupholstery form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/reupholstery.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'reupholstery',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('restuffing golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/restuffing.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'restuffing',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.fill?.qty, golden.expected.fill_qty);
    assert.equal(normalized.cost_breakdown?.fill?.rate, golden.expected.fill_rate);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('restuffing form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/restuffing.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'restuffing',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('patio golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/patio.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'patio',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.seat_foam?.qty, golden.expected.seat_foam_qty);
    assert.equal(normalized.cost_breakdown?.seat_foam?.rate, golden.expected.seat_foam_rate);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('patio form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/patio.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'patio',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('softgoods golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/softgoods.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'softgoods',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('softgoods form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/softgoods.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'softgoods',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('ottoman golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/ottoman.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'ottoman',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.frame?.rate, golden.expected.frame_rate);
    assert.equal(normalized.cost_breakdown?.springs?.qty, golden.expected.springs_qty);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('ottoman form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/ottoman.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'ottoman',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('bed golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/bed.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'bed',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.frame?.rate, golden.expected.frame_rate);
    assert.equal(normalized.cost_breakdown?.legs?.qty, golden.expected.legs_qty);
    assert.equal(normalized.cost_breakdown?.foam?.qty, golden.expected.foam_qty);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    assert.equal(normalized.estimated_fabric_yardage, golden.expected.estimated_fabric_yardage);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('bed form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/bed.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'bed',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('seating golden fixture matches shared compile output', async () => {
  const golden = require('../../prestigio-app/js/categories/seating.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'seating',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const normalized = items[0];
    assert.equal(normalized.cost_breakdown?.frame?.rate, golden.expected.frame_rate);
    assert.equal(normalized.cost_breakdown?.springs?.qty, golden.expected.springs_qty);
    assert.equal(normalized.cost_breakdown?.springs?.rate, golden.expected.springs_rate);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.hours, golden.expected.labor_hours);
    assert.equal(normalized.cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    assert.equal(normalized.estimated_fabric_yardage, golden.expected.estimated_fabric_yardage);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('seating form-only payloads compile from catalog-aligned pricing settings', async () => {
  const golden = require('../../prestigio-app/js/categories/seating.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'seating',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].cost_breakdown?.labor_upholstery?.rate, golden.expected.labor_rate);
    const total = sumDraftQuoteItems(items);
    assert.equal(total, golden.expected.unit_price * golden.form_data.quantity);
  } finally {
    clearActivePricingSettings();
  }
});

test('compiled draft items block missing required live pricing rows', async () => {
  const golden = require('../../prestigio-app/js/categories/seating.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows, 'pricing_settings');

  try {
    const items = [
      {
        category: 'seating',
        form_data: {
          ...golden.form_data,
          type: 'chair',
        },
      },
    ];

    await assert.rejects(
      () => compileDraftQuoteItems(items),
      (error) => {
        assert.equal(error.code, 'PRICING_SETTINGS_MISSING_REQUIRED_ROWS');
        assert.equal(error.internal_blocker, true);
        assert.deepEqual(error.missing_pricing_rows, [
          { category: 'frame', key: 'chair-mid' },
          { category: 'material', key: 'chair-springs' },
        ]);
        assert.equal(error.pricing_lineage.source, 'pricing_settings');
        assert.equal(error.pricing_lineage.rows_count, golden.pricing_rows.length);
        assert.deepEqual(error.pricing_lineage.missing_rows, error.missing_pricing_rows);
        return true;
      }
    );
  } finally {
    clearActivePricingSettings();
  }
});

test('compiled draft items include pricing lineage receipt', async () => {
  const golden = require('../../prestigio-app/js/categories/seating.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows, 'pricing_settings');

  try {
    const items = [
      {
        category: 'seating',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    assert.equal(items[0].pricing_lineage?.source, 'pricing_settings');
    assert.equal(items[0].pricing_lineage?.rows_count, golden.pricing_rows.length);
    assert.equal(items[0].form_data?.pricing_lineage?.source, 'pricing_settings');
  } finally {
    clearActivePricingSettings();
  }
});

test('pillow draft items without pricing still require compile or explicit sell_price', () => {
  clearActivePricingSettings();
  assert.throws(
    () => sumDraftQuoteItems([
      {
        category: 'pillows',
        quantity: 1,
        form_data: {
          pillowType: 'throw',
          pillowFill: 'down-50',
          width: 20,
          height: 20,
        },
      },
    ]),
    /requires sell_price or cost_breakdown/
  );
});

test('compiled draft items reject manual sell_price without override authorization', async () => {
  const items = [
    {
      category: 'seating',
      item_type: 'chair',
      quantity: 1,
      sell_price: 7190,
      form_data: {
        category: 'seating',
        type: 'chair',
        width: 33.08,
        depth: 35.44,
        height: 33.47,
      },
    },
  ];

  assert.throws(
    () => assertDraftManualPricingAllowed(items),
    /must use the compiled pricing path/
  );

  await assert.rejects(
    () => compileDraftQuoteItems(items),
    /must use the compiled pricing path/
  );
});

test('compiled draft items accept manual sell_price with override authorization', async () => {
  const items = [
    {
      category: 'pillows',
      quantity: 2,
      sell_price: 225,
      form_data: {
        pillowType: 'throw',
        pillowFill: 'down-50',
        width: 20,
        height: 20,
      },
    },
  ];

  assert.doesNotThrow(() => assertDraftManualPricingAllowed(items, {
    manual_price_override_authorized: true,
  }));

  await compileDraftQuoteItems(items, { manual_price_override_authorized: true });

  const summary = buildConfirmSummary('create-draft-quote', {
    quote: { sidemark: 'Manual Pillow Price' },
    items,
    manual_price_override_authorized: true,
  });

  assert.match(summary, /total \$450\.00/);
  assert.match(summary, /manual\/client-facing sell price/);
});

test('preview summaries include compiled item descriptions and pricing mode', async () => {
  const golden = require('../../prestigio-app/js/categories/pillows.compile-golden.json');
  setActivePricingSettingsFromRows(golden.pricing_rows);

  try {
    const items = [
      {
        category: 'pillows',
        form_data: golden.form_data,
      },
    ];
    await compileDraftQuoteItems(items);
    const compiled = summarizeCompiledDraftItemsForPreview(items);
    assert.equal(compiled.length, 1);
    assert.equal(compiled[0].pricing_mode, 'calculated');
    assert.match(compiled[0].description, /NEW CUSTOM PILLOWS/);
    assert.ok(compiled[0].unit_price > 0);
  } finally {
    clearActivePricingSettings();
  }
});

test('compiled draft items reject leather materials with yardage instead of sqft', () => {
  const items = [
    {
      category: 'seating',
      item_type: 'chair',
      quantity: 2,
      form_data: {
        category: 'seating',
        type: 'chair',
        width: 33,
        depth: 35,
        height: 33,
        materials: [{ type: 'leather', name: 'Shearling', yardage: 10 }],
      },
    },
  ];

  assert.throws(
    () => assertDraftMaterialsValid(items),
    /leather\/COL material must use sqft, not yardage/
  );
});

test('create draft pre-gate normalizer derives seating leather sqft from form data', () => {
  const gate = getPayloadGate();
  const payload = {
    quote: {
      client_id: 'client-1',
      sidemark: 'Cross Hwy',
    },
    items: [
      {
        category: 'seating',
        item_type: 'chair',
        item_name: 'Cross Hwy Chair',
        quantity: 2,
        form_data: {
          category: 'seating',
          type: 'chair',
          quantity: 2,
          width: 33.08,
          depth: 35.44,
          height: 33.47,
          seatStyle: 'tight',
          seatInsert: 'Not Specified',
          seatSeam: 'Not Specified',
          backStyle: 'tight',
          backInsert: 'Not Specified',
          backSeam: 'Not Specified',
          legType: 'wood-legs',
          materials: [
            {
              type: 'leather',
              name: 'Ombre Brown Natural Shearling Keleen Leathers',
            },
          ],
        },
      },
    ],
  };

  assert.throws(
    () => gate.validateCreateDraftQuote(payload),
    /leather\/COL requires sqft/
  );

  payload.items = normalizeDraftQuoteItemsForPayloadGate(payload.items);

  const material = payload.items[0].form_data.materials[0];
  assert.equal(material.sqft, 180);
  assert.equal(material.yardageBasis, 10);
  assert.equal(material.sqftPerYard, 18);
  assert.equal(material.derivedBy, 'prestigio-write-service');
  assert.equal(material.source, 'seating.materialRequirement');
  assert.doesNotThrow(() => gate.validateCreateDraftQuote(payload));
});

test('create draft orchestrator normalizes seating leather before payload gate validation', async () => {
  let gateSawSqft = null;
  const writes = [];
  const orchestrator = createOrchestrator({
    fs: {},
    path,
    ACTION_FIELDS: {
      'create-draft-quote': ['quote', 'items', 'source_context', 'requested_at', 'confirmed', 'confirm_digest'],
    },
    CONFIRMABLE_ACTIONS: ['create-draft-quote'],
    LEGACY_REQUEST_FILE: '',
    REQUEST_DIR: '',
    writeResponse: (data) => writes.push(data),
    sanitizeRequestId: value => value,
    isStableFile: () => true,
    listPendingRequestFiles: () => [],
    ensureBusDirs: () => {},
    cleanupOldBusFiles: () => {},
    resolveDraftQuoteClientFromProject: async () => {},
    normalizeDraftQuoteItemsForPayloadGate,
    compileDraftQuoteItems: async () => {},
    ensureLivePricingSettingsForDraftItems: async () => {},
    revisionOperationsNeedLivePricingSettings: () => false,
    ensureLivePricingSettingsForCalculatedPricing: async () => {},
    resolveExistingQuote: async () => ({}),
    fetchExistingQuoteItems: async () => [],
    buildResolvedQuoteRevisionPlan: () => ({}),
    computeResolvedQuoteRevisionDigest: () => 'digest',
    summarizeResolvedQuoteRevisionPlan: () => 'summary',
    computeConfirmDigest: () => 'digest',
    buildConfirmSummary: () => 'summary',
    summarizeCompiledDraftItemsForPreview: items => items,
    getPayloadGate: () => ({
      validateCreateDraftQuote(payload) {
        gateSawSqft = payload.items[0].form_data.materials[0].sqft;
        assert.equal(gateSawSqft, 180);
      },
    }),
    createDraftQuote: async () => {
      throw new Error('createDraftQuote should not run for an unconfirmed preview');
    },
    createClientProject: async () => ({}),
    reviseExistingQuote: async () => ({}),
    callEdgeFunction: async () => ({}),
  });

  await orchestrator.processWriteRequest({
    action: 'create-draft-quote',
    quote: {
      client_id: 'client-1',
      sidemark: 'Cross Hwy',
    },
    items: [
      {
        category: 'seating',
        item_type: 'chair',
        item_name: 'Cross Hwy Chair',
        quantity: 2,
        form_data: {
          category: 'seating',
          type: 'chair',
          quantity: 2,
          width: 33.08,
          depth: 35.44,
          height: 33.47,
          seatStyle: 'tight',
          seatInsert: 'Not Specified',
          seatSeam: 'Not Specified',
          backStyle: 'tight',
          backInsert: 'Not Specified',
          backSeam: 'Not Specified',
          legType: 'wood-legs',
          materials: [
            {
              type: 'leather',
              name: 'Ombre Brown Natural Shearling Keleen Leathers',
            },
          ],
        },
      },
    ],
  });

  assert.equal(gateSawSqft, 180);
  assert.equal(writes[0].requires_confirmation, true);
});

test('create draft pre-gate normalizer still blocks seating leather when dimensions are insufficient', () => {
  const gate = getPayloadGate();
  const payload = {
    quote: {
      client_id: 'client-1',
      sidemark: 'Cross Hwy',
    },
    items: [
      {
        category: 'seating',
        item_type: 'chair',
        item_name: 'Cross Hwy Chair',
        quantity: 2,
        form_data: {
          category: 'seating',
          type: 'chair',
          quantity: 2,
          width: 33.08,
          height: 33.47,
          materials: [
            {
              type: 'leather',
              name: 'Ombre Brown Natural Shearling Keleen Leathers',
            },
          ],
        },
      },
    ],
  };

  payload.items = normalizeDraftQuoteItemsForPayloadGate(payload.items);

  assert.equal(payload.items[0].form_data.materials[0].sqft, undefined);
  assert.throws(
    () => gate.validateCreateDraftQuote(payload),
    /form_data\.depth/
  );
});

test('compiled draft items accept leather materials with sqft', async () => {
  const golden = require('../../prestigio-app/js/categories/seating.compile-golden.json');
  setActivePricingSettingsFromRows([
    ...golden.pricing_rows,
    { category: 'frame', item_key: 'chair-mid', value: '650' },
    { category: 'material', item_key: 'chair-springs', value: '40' },
  ]);

  try {
    const items = [
      {
        category: 'seating',
        item_type: 'chair',
        quantity: 1,
        form_data: {
          category: 'seating',
          type: 'chair',
          width: 33,
          depth: 35,
          height: 33,
          materials: [{ type: 'leather', name: 'Shearling', sqft: 10 }],
        },
      },
    ];

    assert.doesNotThrow(() => assertDraftMaterialsValid(items));

    await compileDraftQuoteItems(items);

    assert.match(items[0].description, /COL: \(10 SQ FT, Shearling\)/);
  } finally {
    clearActivePricingSettings();
  }
});

test('calculated material pricing requires live pricing settings when line multipliers are absent', () => {
  clearActivePricingSettings();

  assert.throws(
    () => sumDraftQuoteItems([
      {
        category: 'cushions',
        quantity: 1,
        cost_breakdown: {
          foam: { qty: 1, rate: 100 },
          labor: { hours: 1, rate: 100 }
        },
        form_data: {
          cushionType: 'bench',
          fill: 'foam-dacron',
          length: 24,
          depth: 24,
          thickness: 4
        }
      }
    ]),
    /Live pricing_settings multiplier "material" is required/
  );
});

test('calculated material pricing uses live pricing settings instead of writer defaults', () => {
  setActivePricingSettingsFromRows([
    { category: 'multiplier', item_key: 'material', value: '2' },
    { category: 'multiplier', item_key: 'passthrough', value: '1.5' }
  ]);

  try {
    const total = sumDraftQuoteItems([
      {
        category: 'cushions',
        quantity: 1,
        cost_breakdown: {
          foam: { qty: 1, rate: 100 },
          labor: { hours: 1, rate: 100 }
        },
        form_data: {
          cushionType: 'bench',
          fill: 'foam-dacron',
          length: 24,
          depth: 24,
          thickness: 4
        }
      }
    ]);

    assert.equal(total, 300);
  } finally {
    clearActivePricingSettings();
  }
});

test('reference image safety check accepts local mail attachment paths', () => {
  const priorWorkspace = process.env.OPENCLAW_WORKSPACE_DIR;
  process.env.OPENCLAW_WORKSPACE_DIR = '/home/node/.openclaw/workspace';

  try {
    const hostPath = '/Users/chrisreyes/.openclaw/workspace/mail-chris/attachments/message-id/Screenshot 2026-05-04 at 3.20.08 PM.png';
    const containerPath = '/home/node/.openclaw/workspace/mail-chris/attachments/message-id/Screenshot 2026-05-04 at 3.20.08 PM.png';

    assert.equal(
      normalizeAttachmentPath(hostPath),
      containerPath
    );
    assert.equal(isAllowedAttachmentPath(hostPath), true);
    assert.equal(isAllowedAttachmentPath(containerPath), true);
    assert.equal(isAllowedAttachmentPath('/Users/chrisreyes/Downloads/random.png'), false);
  } finally {
    if (priorWorkspace === undefined) {
      delete process.env.OPENCLAW_WORKSPACE_DIR;
    } else {
      process.env.OPENCLAW_WORKSPACE_DIR = priorWorkspace;
    }
  }
});

test('draft attachment validator blocks unsafe local paths before preview approval', () => {
  assert.throws(
    () => assertDraftAttachmentReferencesValid([
      {
        category: 'softgoods',
        sourceAttachments: ['/Users/chrisreyes/Downloads/client-spec.pdf'],
      },
    ]),
    /outside allowed mail attachment roots/,
  );
});

test('draft quote payload preserves source PDFs separately from reference images', async () => {
  const sourcePdf = {
    filename: 'client-spec.pdf',
    url: 'https://cdn.example.com/client-spec.pdf',
    contentType: 'application/pdf',
    source: 'quote_request_email',
  };

  const payload = await buildDraftQuotePayload({
    quote: {
      client_id: 'client-1',
      sidemark: 'Attachment Test',
    },
    manual_price_override_authorized: true,
    items: [
      {
        category: 'softgoods',
        item_type: 'slipcover',
        item_name: 'Slipcover Test',
        quantity: 1,
        sell_price: 100,
        reference_images: ['https://cdn.example.com/chair-preview.jpg'],
        sourceAttachments: [sourcePdf],
        form_data: {
          category: 'softgoods',
          softgoodsType: 'slipcover',
          type: 'slipcover',
          length: 96,
        },
      },
    ],
  });

  assert.deepEqual(payload.items[0].reference_images, ['https://cdn.example.com/chair-preview.jpg']);
  assert.deepEqual(payload.items[0].form_data.sourceAttachments, [sourcePdf]);
});

test('draft quote payload keeps seating spec sections enabled when style fields are present', async () => {
  const payload = await buildDraftQuotePayload({
    quote: {
      client_id: 'client-1',
      sidemark: 'Seating Spec Test',
    },
    manual_price_override_authorized: true,
    items: [
      {
        category: 'seating',
        item_type: 'chair',
        item_name: 'Spec Test Chair',
        quantity: 1,
        sell_price: 100,
        form_data: {
          category: 'seating',
          type: 'chair',
          quantity: 1,
          width: 30,
          depth: 30,
          seatSpecEnabled: false,
          seatStyle: 'tight',
          seatInsert: 'Not Specified',
          seatSeam: 'Not Specified',
          backSpecEnabled: false,
          backStyle: 'tight',
          backInsert: 'Not Specified',
          backSeam: 'Not Specified',
        },
      },
    ],
  });

  assert.equal(payload.items[0].form_data.seatSpecEnabled, true);
  assert.equal(payload.items[0].form_data.backSpecEnabled, true);
  assert.match(payload.items[0].description, /SEAT CUSHION SPEC/);
  assert.match(payload.items[0].description, /BACK CUSHION SPEC/);
  assert.match(payload.items[0].description, /SEAM DETAILS: Not Specified/);
});

test('draft preview summaries expose source attachments for approval review', () => {
  const sourceAttachment = {
    filename: 'client-spec.pdf',
    url: 'https://cdn.example.com/client-spec.pdf',
    contentType: 'application/pdf',
  };
  const summary = summarizeCompiledDraftItemsForPreview([
    {
      category: 'softgoods',
      item_type: 'slipcover',
      item_name: 'Slipcover Test',
      quantity: 1,
      sell_price: 100,
      sourceAttachments: [sourceAttachment],
      form_data: {
        category: 'softgoods',
        softgoodsType: 'slipcover',
        type: 'slipcover',
        length: 96,
      },
    },
  ]);

  assert.deepEqual(summary[0].source_attachments, [sourceAttachment]);
});

test('source attachment resolver normalizes public PDF links', async () => {
  const attachments = await resolveDraftSourceAttachments({
    source_attachment_paths: ['https://cdn.example.com/client-spec.pdf'],
  });

  assert.deepEqual(attachments, [
    {
      url: 'https://cdn.example.com/client-spec.pdf',
      filename: 'client-spec.pdf',
      contentType: 'application/pdf',
    },
  ]);
});

test('quote revision writes thread reference images and source attachments', async () => {
  const originalFetch = global.fetch;
  const patchBodies = [];
  global.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    const method = options.method || 'GET';
    if (textUrl.includes('/rest/v1/quotes') && method === 'GET') {
      return {
        ok: true,
        text: async () => JSON.stringify([
          {
            id: 'quote-1',
            status: 'draft',
            sidemark: 'Farley Trail / Dining Chairs',
            grand_total: 100,
          },
        ]),
      };
    }
    if (textUrl.includes('/rest/v1/order_items') && method === 'GET') {
      return {
        ok: true,
        text: async () => JSON.stringify([
          {
            id: 'item-1',
            quote_id: 'quote-1',
            category: 'seating',
            item_type: 'dining-chair',
            description: 'DINING CHAIR',
            quantity: 1,
            sell_price: 100,
            form_data: { category: 'seating', type: 'dining-chair' },
          },
        ]),
      };
    }
    if (textUrl.includes('/rest/v1/order_items') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      patchBodies.push(body);
      return { ok: true, text: async () => JSON.stringify([body]) };
    }
    if (textUrl.includes('/rest/v1/quotes') && method === 'PATCH') {
      return { ok: true, text: async () => JSON.stringify([{ id: 'quote-1' }]) };
    }
    throw new Error(`Unexpected fetch ${method} ${textUrl}`);
  };

  try {
    await reviseExistingQuote({
      quote: { quote_id: 'quote-1' },
      operations: [
        {
          op: 'update_item',
          item_id: 'item-1',
          updates: {
            reference_image_paths: ['https://cdn.example.com/farley-chair.png'],
            sourceAttachments: [
              {
                url: 'https://cdn.example.com/farley-source.pdf',
                filename: 'farley-source.pdf',
                contentType: 'application/pdf',
                source: 'quote_request_email',
              },
            ],
          },
        },
      ],
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(patchBodies.length, 1);
  assert.deepEqual(patchBodies[0].reference_images, ['https://cdn.example.com/farley-chair.png']);
  assert.equal(patchBodies[0].reference_image_paths, undefined);
  assert.equal(patchBodies[0].sourceAttachments, undefined);
  assert.deepEqual(patchBodies[0].form_data.sourceAttachments, [
    {
      url: 'https://cdn.example.com/farley-source.pdf',
      filename: 'farley-source.pdf',
      contentType: 'application/pdf',
      source: 'quote_request_email',
    },
  ]);
});

test('quote revision sell price only does not rewrite description or form data', () => {
  const mergedPatch = mergeQuoteRevisionPatchIntoItem(
    {
      category: 'softgoods',
      description: 'NEW CUSTOM TABLE SKIRT\nEDGE: PLAIN HEM',
      sell_price: 510,
      form_data: {
        category: 'softgoods',
        softgoodsType: 'table-skirt',
        softgoodsEdge: 'plain-hem',
        softgoodsLength: '96'
      }
    },
    {
      sell_price: 350
    }
  );

  assert.equal(mergedPatch.sell_price, 350);
  assert.equal(Object.hasOwn(mergedPatch, 'description'), false);
  assert.equal(Object.hasOwn(mergedPatch, 'form_data'), false);
});

test('quote revision direct sell price requires explicit manual override authorization', () => {
  assert.throws(
    () => assertQuoteRevisionManualPricingAllowed(
      {},
      {
        op: 'update_item',
        item_id: 'item-1',
        updates: {
          sell_price: 7450,
          form_data: { width: 124 }
        }
      }
    ),
    /Manual sell_price overrides are blocked/
  );

  assert.doesNotThrow(
    () => assertQuoteRevisionManualPricingAllowed(
      {},
      {
        op: 'update_item',
        item_id: 'item-1',
        manual_price_override_authorized: true,
        updates: {
          sell_price: 7450,
          form_data: { width: 124 }
        }
      }
    )
  );

  assert.doesNotThrow(
    () => assertQuoteRevisionManualPricingAllowed(
      {},
      {
        op: 'update_item',
        item_id: 'item-1',
        updates: {
          form_data: { width: 124 },
          cost_breakdown: {
            labor: { hours: 2, rate: 130 }
          }
        }
      }
    )
  );
});

test('quote revisions reject cushion-set outside the app cushions category', () => {
  assert.throws(
    () => mergeQuoteRevisionPatchIntoItem(
      {
        category: 'seating',
        type: 'cushion-set',
        item_type: 'cushion-set',
        description: 'OLD CUSHION SET',
        sell_price: 4670,
        form_data: {
          category: 'seating',
          type: 'cushion-set',
          width: 124,
          depth: 47,
          height: 4
        }
      },
      {
        form_data: {
          width: 126
        }
      }
    ),
    /cushion-set" outside category "cushions"/
  );
});

test('quote revisions allow app-owned cushion-set taxonomy in cushions category', () => {
  assert.doesNotThrow(
    () => mergeQuoteRevisionPatchIntoItem(
      {
        category: 'cushions',
        type: 'cushion-set',
        item_type: 'cushion-set',
        description: 'NEW CUSTOM CUSHION SET',
        sell_price: 4670,
        form_data: {
          category: 'cushions',
          type: 'cushion-set',
          construction: 'blind-seam',
          backConstruction: 'blind-seam',
          fill: 'foam-dacron',
          backFill: 'foam-dacron',
          seatCount: 2,
          seatWidth: 62,
          seatDepth: 24,
          seatThickness: 4,
          backCount: 2,
          backWidth: 24,
          backHeight: 24,
          backThickness: 4
        }
      },
      {
        form_data: {
          seatWidth: 63
        }
      }
    )
  );
});

test('quote revision cost breakdown only does not rewrite description or form data', () => {
  const mergedPatch = mergeQuoteRevisionPatchIntoItem(
    {
      category: 'softgoods',
      description: 'NEW CUSTOM TABLE SKIRT\nEDGE: PLAIN HEM',
      sell_price: 510,
      cost_breakdown: {
        labor: { hours: 4, rate: 130 }
      },
      form_data: {
        category: 'softgoods',
        softgoodsType: 'table-skirt',
        softgoodsEdge: 'plain-hem',
        softgoodsLength: '96'
      }
    },
    {
      cost_breakdown: {
        labor: { hours: 2.75, rate: 130 }
      }
    }
  );

  assert.equal(mergedPatch.sell_price, 350);
  assert.equal(Object.hasOwn(mergedPatch, 'description'), false);
  assert.equal(Object.hasOwn(mergedPatch, 'form_data'), false);
});

test('quote revision cost breakdown updates v2 pricing lineage artifacts', () => {
  const oldBreakdown = {
    labor_upholstery: { hours: 8, rate: 120, raw: 960, multiplier: 1, final: 960 },
    frame: { qty: 1, rate: 400, raw: 400, multiplier: 1, final: 400 }
  };
  const stalePricingPayload = {
    schemaVersion: 1,
    kind: 'quote-pricing',
    category: 'seating',
    type: 'chair',
    quantity: 1,
    unitPrice: 1360,
    total: 1360,
    totals: { raw: 1360, final: 1360, lineCount: 2 },
    lines: [],
    costBreakdown: oldBreakdown,
    legacyCostBreakdown: oldBreakdown
  };
  const existingItem = {
    item_type: 'chair',
    category: 'seating',
    description: 'OLD REGULAR CHAIR',
    sell_price: 1360,
    quantity: 1,
    width: 24,
    depth: 24,
    height: 36,
    cost_breakdown: oldBreakdown,
    form_data: {
      category: 'seating',
      type: 'chair',
      pricingPayload: stalePricingPayload,
      seatingPayload: {
        schemaVersion: 1,
        category: 'seating',
        type: 'chair',
        pricing: stalePricingPayload
      }
    },
    quoted_plan_snapshot: {
      schema_version: 1,
      item: {
        item_type: 'chair',
        category: 'seating',
        description: 'OLD REGULAR CHAIR',
        width: 24,
        depth: 24,
        height: 36,
        quantity: 1,
        room: null,
        sidemark: null,
        reference_images: null,
        sell_price: 1360,
        cost_breakdown: oldBreakdown,
        estimated_fabric_yardage: null,
        estimated_fabric_cost: null
      },
      form_data: {
        category: 'seating',
        type: 'chair',
        pricingPayload: stalePricingPayload,
        seatingPayload: {
          schemaVersion: 1,
          category: 'seating',
          type: 'chair',
          pricing: stalePricingPayload
        }
      }
    }
  };
  const newBreakdown = {
    labor_upholstery: { hours: 6, rate: 130 },
    frame: { qty: 1, rate: 300 }
  };

  assert.throws(
    () => assertQuoteRevisionPricingLineageConsistent({
      ...existingItem,
      sell_price: 1080,
      cost_breakdown: newBreakdown
    }),
    /pricing lineage mismatch/
  );

  const mergedPatch = mergeQuoteRevisionPatchIntoItem(existingItem, {
    item_type: 'dining-chair',
    sell_price: 1080,
    cost_breakdown: newBreakdown
  });

  assert.equal(mergedPatch.sell_price, 1080);
  assert.deepEqual(mergedPatch.form_data.pricingPayload.costBreakdown, mergedPatch.cost_breakdown);
  assert.equal(mergedPatch.form_data.pricingPayload.total, 1080);
  assert.equal(mergedPatch.form_data.pricingPayload.type, 'dining-chair');
  assert.deepEqual(mergedPatch.form_data.seatingPayload.pricing, mergedPatch.form_data.pricingPayload);
  assert.deepEqual(mergedPatch.quoted_plan_snapshot.item.cost_breakdown, mergedPatch.cost_breakdown);
  assert.equal(mergedPatch.quoted_plan_snapshot.item.sell_price, 1080);
  assert.deepEqual(mergedPatch.quoted_plan_snapshot.form_data.pricingPayload, mergedPatch.form_data.pricingPayload);
  assert.deepEqual(mergedPatch.quoted_plan_snapshot.form_data.seatingPayload.pricing, mergedPatch.form_data.pricingPayload);
  assert.doesNotThrow(
    () => assertQuoteRevisionPricingLineageConsistent({ ...existingItem, ...mergedPatch })
  );
});

test('quote revision semantic form data change may regenerate description', () => {
  const mergedPatch = mergeQuoteRevisionPatchIntoItem(
    {
      category: 'softgoods',
      description: 'NEW CUSTOM TABLE SKIRT\nEDGE: PLAIN HEM',
      sell_price: 510,
      form_data: {
        category: 'softgoods',
        softgoodsType: 'table-skirt',
        room: 'Dining Room',
        softgoodsEdge: 'plain-hem',
        softgoodsLength: '96'
      }
    },
    {
      form_data: {
        softgoodsEdge: 'flanged'
      }
    }
  );

  assert.match(mergedPatch.description, /EDGE: FLANGED/);
  assert.equal(mergedPatch.form_data.softgoodsEdge, 'flanged');
});
