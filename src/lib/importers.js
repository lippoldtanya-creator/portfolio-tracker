// CSV parsing + column auto-detection for TradingView / Ledger Live / generic exports. Pure.

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = String(text || '').replace(/^﻿/, '');
  // detect delimiter from first line
  const firstLine = src.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1).map((r) => { const o = [...r]; while (o.length < headers.length) o.push(''); return o; }) };
}

export const FIELDS = [
  { key: 'asset', label: 'Asset / ticker', required: true },
  { key: 'dateBought', label: 'Date bought' },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'pricePaid', label: 'Price paid (per unit)' },
  { key: 'amountInvested', label: 'Amount invested (total)' },
  { key: 'type', label: 'Type (crypto/stock/etf)' },
  { key: 'side', label: 'Buy/Sell (optional filter)' },
];

const PATTERNS = {
  asset: [/^symbol$/i, /^ticker$/i, /currency ticker/i, /^asset$/i, /^coin$/i, /^instrument$/i, /symbol/i, /ticker/i, /asset/i, /currency/i, /^name$/i],
  dateBought: [/^date$/i, /operation date/i, /placing time/i, /^time$/i, /date/i, /time/i],
  quantity: [/^qty$/i, /^quantity$/i, /operation amount/i, /^amount$/i, /qty/i, /quantity/i, /filled/i, /units/i, /shares/i],
  pricePaid: [/fill price/i, /^price$/i, /avg.*price/i, /countervalue at operation/i, /price/i, /rate/i],
  amountInvested: [/^total$/i, /^cost$/i, /total cost/i, /amount invested/i, /^value$/i, /total/i, /cost/i],
  type: [/^type$/i, /asset type/i, /category/i],
  side: [/^side$/i, /operation type/i, /^action$/i, /buy\/sell/i, /^side/i, /^type$/i],
};

export function detectSource(headers) {
  const h = headers.map((x) => x.toLowerCase());
  if (h.some((x) => x.includes('operation date')) && h.some((x) => x.includes('currency ticker'))) return 'Ledger Live';
  if (h.some((x) => x.includes('fill price')) || h.some((x) => x.includes('placing time'))) return 'TradingView';
  if (h.includes('symbol') && h.includes('side')) return 'TradingView';
  return 'Generic CSV';
}

/** Returns { fieldKey: headerIndex | -1 } */
export function autoMap(headers) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS) {
    map[f.key] = -1;
    for (const re of PATTERNS[f.key]) {
      const idx = headers.findIndex((h, i) => !used.has(i) && re.test(h.trim()));
      if (idx >= 0) { map[f.key] = idx; used.add(idx); break; }
    }
  }
  // Ledger Live: the countervalue column is the TOTAL fiat value, not per-unit; treat it as amountInvested
  if (detectSource(headers) === 'Ledger Live') {
    const cv = headers.findIndex((h) => /countervalue at operation/i.test(h));
    if (cv >= 0) { map.amountInvested = cv; if (map.pricePaid === cv) map.pricePaid = -1; }
  }
  return map;
}

export function toNumber(v) {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/[$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (/^-?\d+\.\d{3}(,\d+)?$/.test(String(v).trim())) s = String(v).trim().replace(/\./g, '').replace(',', '.');
  if (!s) return NaN;
  return parseFloat(s);
}

export function toISODate(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    // assume MM/DD/YYYY unless first number can't be a month
    const month = a > 12 ? b : a, day = a > 12 ? a : b;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function guessType(asset) {
  const a = String(asset || '').toUpperCase();
  const crypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC', 'USDT', 'USDC', 'SHIB', 'TRX', 'XLM', 'ATOM', 'UNI', 'NEAR'];
  if (crypto.includes(a) || /USD$|USDT$|BTC$/.test(a) && a.length > 5) return 'crypto';
  const etfs = ['VOO', 'SPY', 'QQQ', 'VTI', 'IVV', 'SCHD', 'VXUS', 'VEA', 'BND', 'IWM', 'DIA', 'ARKK', 'IBIT', 'FBTC', 'GLD'];
  if (etfs.includes(a)) return 'etf';
  return 'stock';
}

/** Apply a column map to rows, producing holding drafts. Filters out sells/outgoing if a side column exists. */
export function rowsToHoldings(rows, map, { defaultType } = {}) {
  const out = [];
  for (const r of rows) {
    const get = (k) => (map[k] >= 0 ? r[map[k]] : '');
    const side = String(get('side') || '').toLowerCase();
    if (side && /sell|out|withdraw|send/.test(side) && !/buy|in\b|receive/.test(side)) continue;
    let asset = String(get('asset') || '').trim();
    // TradingView symbols like "BINANCE:BTCUSDT" or "NASDAQ:AAPL"
    if (asset.includes(':')) asset = asset.split(':').pop();
    asset = asset.replace(/(USDT|USD|USDC)$/i, (m, _p, off) => (off >= 3 ? '' : m));
    if (!asset) continue;
    const qty = Math.abs(toNumber(get('quantity')));
    let price = toNumber(get('pricePaid'));
    let total = Math.abs(toNumber(get('amountInvested')));
    if (!Number.isFinite(price) && Number.isFinite(total) && qty) price = total / qty;
    if (!Number.isFinite(total) && Number.isFinite(price) && qty) total = price * qty;
    if (!Number.isFinite(qty) || qty === 0) continue;
    const t = String(get('type') || '').toLowerCase();
    const type = /crypto|coin/.test(t) ? 'crypto' : /etf|fund/.test(t) ? 'etf' : /stock|equity|share/.test(t) ? 'stock' : (defaultType || guessType(asset));
    out.push({
      asset: asset.toUpperCase(),
      type,
      dateBought: toISODate(get('dateBought')),
      quantity: qty,
      pricePaid: Number.isFinite(price) ? price : '',
      amountInvested: Number.isFinite(total) ? total : '',
    });
  }
  return out;
}

/** Best-effort: pull rows that look like "ASSET ... date ... numbers" out of PDF text lines. */
export function extractRowsFromText(text) {
  const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const dateRe = /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})/;
  const numRe = /-?[$€£]?\d[\d,]*(?:\.\d+)?/g;
  const out = [];
  for (const l of lines) {
    const dm = l.match(dateRe);
    const nums = (l.replace(dateRe, ' ').match(numRe) || []).map(toNumber).filter((n) => Number.isFinite(n));
    const tick = l.match(/\b([A-Z]{2,6})\b/);
    if (tick && nums.length >= 1) {
      const qty = nums[0], price = nums[1], total = nums[2];
      out.push({
        asset: tick[1], type: guessType(tick[1]), dateBought: dm ? toISODate(dm[1]) : '',
        quantity: Math.abs(qty), pricePaid: Number.isFinite(price) ? Math.abs(price) : '',
        amountInvested: Number.isFinite(total) ? Math.abs(total) : (Number.isFinite(price) ? Math.abs(price * qty) : ''),
      });
    }
  }
  return out;
}
