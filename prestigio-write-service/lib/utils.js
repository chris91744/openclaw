function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, max = 2000) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function cleanArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanEmail(value) {
  const text = cleanText(value, 320);
  if (!text) return null;
  return text.includes('@') ? text.toLowerCase() : null;
}

function normalizeKey(value) {
  return cleanText(value, 100)?.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-') || '';
}

function titleCaseLabel(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatMoney(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundQuoteBuilderPrice(raw) {
  const value = Number(raw) || 0;
  const targets = [0, 10, 50, 95];
  const base = Math.floor(value / 100) * 100;
  const remainder = value - base;

  let bestTarget = 0;
  let bestDist = Infinity;
  for (const target of targets) {
    const dist = Math.abs(remainder - target);
    if (dist < bestDist || (dist === bestDist && target > bestTarget)) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  if (100 - remainder < bestDist) return base + 100;
  return base + bestTarget;
}

module.exports = {
  stableJson,
  toNullableNumber,
  cleanText,
  cleanObject,
  cleanArray,
  cleanEmail,
  normalizeKey,
  titleCaseLabel,
  formatMoney,
  roundCurrency,
  roundQuoteBuilderPrice,
};
