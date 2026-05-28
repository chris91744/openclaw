const crypto = require('crypto');

const ACTION_FIELDS = {
  'set-hold': ['item_id', 'hold_reason', 'hold_contact', 'hold_follow_up_date'],
  'clear-hold': ['item_id'],
  'append-note': ['item_id', 'title', 'body'],
  'rename-item': ['item_id', 'sidemark'],
  'mark-received': ['item_id'],
  'mark-not-received': ['item_id'],
  'set-order-item-production-field': ['item_id', 'field', 'value', 'confirmed', 'confirm_digest'],
  'set-item-spec-field': ['item_id', 'spec_id', 'field', 'value', 'confirmed', 'confirm_digest'],
  'apply-credit': ['order_item_id', 'xero_contact_id', 'xero_invoice_id', 'amount', 'description', 'source_context', 'reference', 'requested_at'],
  'search-xero-invoices': ['search', 'contact_id', 'invoice_number', 'statuses', 'requested_at'],
  'search-xero-quotes': ['search', 'contact_id', 'quote_number', 'statuses', 'requested_at'],
  'search-xero-bank-transactions': ['search', 'contact_id', 'from_date', 'to_date', 'reference', 'requested_at'],
  'search-xero-credit-notes': ['search', 'contact_id', 'credit_note_number', 'statuses', 'requested_at'],
  'create-invoice': ['xero_contact_id', 'reference', 'line_items', 'due_days', 'requested_at'],
  'record-payment': ['payments', 'check_date', 'payment_method', 'check_number', 'account_id', 'requested_at'],
  'email-invoice': ['invoice_id', 'requested_at'],
  'send-invoice-email': ['invoiceId', 'xeroInvoiceId', 'xeroInvoiceNumber', 'ccEmails', 'recipientOverrideEmails', 'requested_at'],
  'create-xero-contact': ['client_id', 'name', 'company', 'email', 'phone', 'source_context', 'requested_at', 'confirmed', 'confirm_digest'],
  'create-client-project': ['client', 'project', 'source_context', 'requested_at', 'confirmed', 'confirm_digest'],
  'create-draft-quote': ['quote', 'items', 'source_context', 'requested_at', 'confirmed', 'confirm_digest', 'manual_price_override_authorized'],
  'revise-existing-quote': ['quote', 'revision_reason', 'operations', 'expected', 'source_context', 'requested_at', 'confirmed', 'confirm_digest', 'manual_price_override_authorized'],
};

const CONFIRMABLE_ACTIONS = ['set-order-item-production-field', 'set-item-spec-field', 'create-client-project', 'create-draft-quote', 'create-xero-contact', 'revise-existing-quote'];

function createConfirmModule(deps) {
  const {
    stableJson,
    cleanObject,
    cleanArray,
    cleanText,
    formatMoney,
    sumDraftQuoteItems,
    getDraftQuoteSiteVisitTotal,
    summarizeDraftQuotePricingModes,
    summarizeDraftQuoteCostLines,
  } = deps;

  function buildQuoteRevisionPlanFromRequest(params) {
    const quote = cleanObject(params.quote) || {};
    const operations = cleanArray(params.operations);
    return {
      action: 'revise-existing-quote',
      quote: {
        quote_id: cleanText(quote.quote_id || quote.id, 100),
        xero_quote_number: cleanText(quote.xero_quote_number, 100),
        quote_number: cleanText(quote.quote_number, 100),
      },
      revision_reason: cleanText(params.revision_reason, 1000),
      operations: operations.map(op => ({
        op: cleanText(op.op, 100),
        item_id: cleanText(op.item_id, 100),
        reason: cleanText(op.reason, 1000),
        updates: cleanObject(op.updates) || null,
      })),
      expected: cleanObject(params.expected) || null,
      source_context: cleanObject(params.source_context) || null,
    };
  }

  function summarizeQuoteRevisionPlan(plan) {
    const quoteLabel =
      plan.quote.xero_quote_number ||
      plan.quote.quote_number ||
      plan.quote.quote_id ||
      'existing quote';
    const removeOps = cleanArray(plan.operations).filter(op => op.op === 'remove_item');
    const updateOps = cleanArray(plan.operations).filter(op => op.op === 'update_item');
    const expected = cleanObject(plan.expected) || {};
    const totalText = expected.before_total !== undefined && expected.after_total !== undefined
      ? ` Total ${formatMoney(expected.before_total)} -> ${formatMoney(expected.after_total)}.`
      : '';
    return `Revise ${quoteLabel}: remove ${removeOps.length} quote item(s), update ${updateOps.length} quote item(s).${totalText}`;
  }

  function computeConfirmDigest(action, params) {
    const secret = process.env.STITCH_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!secret) {
      return null;
    }
    let canonical;

    if (action === 'set-order-item-production-field') {
      canonical = `${action}:${params.item_id}:${params.field}:${JSON.stringify(params.value)}`;
    } else if (action === 'set-item-spec-field') {
      canonical = `${action}:${params.item_id}:${params.spec_id}:${params.field}:${JSON.stringify(params.value)}`;
    } else if (action === 'create-client-project') {
      canonical = `${action}:${JSON.stringify(params.client || {})}:${JSON.stringify(params.project || {})}`;
    } else if (action === 'create-draft-quote') {
      canonical = `${action}:${JSON.stringify(params.quote || {})}:${JSON.stringify(params.items || [])}`;
    } else if (action === 'create-xero-contact') {
      canonical = `${action}:${params.client_id}:${params.name || ''}:${params.company || ''}:${params.email || ''}:${params.phone || ''}`;
    } else if (action === 'revise-existing-quote') {
      const plan = buildQuoteRevisionPlanFromRequest(params);
      if (!plan) return null;
      canonical = stableJson(plan);
    } else {
      return null;
    }

    return crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
  }

  function buildConfirmSummary(action, params) {
    if (action === 'set-order-item-production-field') {
      return `Set ${params.field} to ${JSON.stringify(params.value)} on item ${params.item_id}`;
    }
    if (action === 'set-item-spec-field') {
      return `Set ${params.field} to ${JSON.stringify(params.value)} on spec ${params.spec_id} (item ${params.item_id})`;
    }
    if (action === 'create-draft-quote') {
      const quote = params.quote || {};
      const items = Array.isArray(params.items) ? params.items : [];
      const sidemark = quote.sidemark || quote.project_name || quote.client_name || 'Untitled quote';
      const itemTotal = sumDraftQuoteItems(items);
      const siteVisitTotal = getDraftQuoteSiteVisitTotal(quote);
      const total = Math.round((itemTotal + siteVisitTotal) * 100) / 100;
      const siteVisitText = siteVisitTotal > 0 ? ` including ${formatMoney(siteVisitTotal)} site visit` : '';
      return `Create draft quote "${sidemark}" with ${items.length} item(s), total ${formatMoney(total)}${siteVisitText}${summarizeDraftQuotePricingModes(items)}${summarizeDraftQuoteCostLines(items)}`;
    }
    if (action === 'create-client-project') {
      const client = params.client || {};
      const project = params.project || {};
      const clientName = client.company || client.name || 'Unnamed client';
      const projectName = project.name ? ` and project "${project.name}"` : '';
      return `Create client "${clientName}"${projectName}`;
    }
    if (action === 'create-xero-contact') {
      const label = params.company || params.name || params.client_id || 'client';
      return `Create or link Xero contact "${label}"`;
    }
    if (action === 'revise-existing-quote') {
      const plan = buildQuoteRevisionPlanFromRequest(params);
      if (!plan) return 'Revise existing quote';
      return summarizeQuoteRevisionPlan(plan);
    }
    return `${action} on ${params.item_id}`;
  }

  return {
    ACTION_FIELDS,
    CONFIRMABLE_ACTIONS,
    buildQuoteRevisionPlanFromRequest,
    summarizeQuoteRevisionPlan,
    computeConfirmDigest,
    buildConfirmSummary,
  };
}

module.exports = {
  ACTION_FIELDS,
  CONFIRMABLE_ACTIONS,
  createConfirmModule,
};
