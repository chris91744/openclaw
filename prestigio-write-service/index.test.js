const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.QUOTE_PLAN_CONTRACTS_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-plan-contracts.js');
process.env.QUOTE_DESCRIPTION_GENERATORS_PATH = path.resolve(__dirname, '../../prestigio-app/js/quote-description-generators.js');

const {
  assertQuoteRevisionManualPricingAllowed,
  buildConfirmSummary,
  clearActivePricingSettings,
  getDraftQuoteSiteVisitTotal,
  isAllowedAttachmentPath,
  mergeQuoteRevisionPatchIntoItem,
  normalizeAttachmentPath,
  setActivePricingSettingsFromRows,
  summarizeDraftQuotePricingModes,
  sumDraftQuoteItems
} = require('./index.js');

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

test('pillow draft items require explicit pricing instead of hardcoded defaults', () => {
  assert.throws(
    () => sumDraftQuoteItems([
      {
        category: 'pillows',
        quantity: 1,
        form_data: {
          pillowType: 'throw',
          pillowFill: 'down-50',
          width: 20,
          height: 20
        }
      }
    ]),
    /requires sell_price or cost_breakdown/
  );
});

test('pillow draft items still accept manual sell prices', () => {
  const summary = buildConfirmSummary('create-draft-quote', {
    quote: { sidemark: 'Manual Pillow Price' },
    items: [
      {
        category: 'pillows',
        quantity: 2,
        sell_price: 225,
        form_data: {
          pillowType: 'throw',
          pillowFill: 'down-50',
          width: 20,
          height: 20
        }
      }
    ]
  });

  assert.match(summary, /total \$450\.00/);
  assert.match(summary, /manual\/client-facing sell price/);
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
          seatCount: 2,
          seatWidth: 62,
          backCount: 2
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
