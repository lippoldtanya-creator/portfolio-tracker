// Safe localStorage wrapper. Never throws; falls back to in-memory.
const mem = {};
const KEY = 'portfolio-tracker:v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return mem[KEY] || null;
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* ignore */ }
  mem[KEY] = state;
}

export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`${KEY}:${key}`);
    if (raw != null) return JSON.parse(raw);
  } catch { /* ignore */ }
  return mem[key] ?? fallback;
}

export function setItem(key, value) {
  try { localStorage.setItem(`${KEY}:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  mem[key] = value;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyState() {
  return {
    version: 1,
    theme: null,
    sections: [],
    snapshots: {},      // { 'YYYY-MM-DD': { value, invested } }
    predictions: [],
    settings: { alphaVantageKey: '', coinGeckoKey: '' },
    lastPrices: {},     // { assetKey: { price, at } }
  };
}

export function sampleState() {
  const s = emptyState();
  const y = new Date().getFullYear();
  s.sections = [
    {
      id: uid(), name: 'Long-term', holdings: [
        { id: uid(), asset: 'BTC', type: 'crypto', dateBought: `${y - 2}-03-15`, quantity: 0.25, pricePaid: 27500, amountInvested: 6875 },
        { id: uid(), asset: 'ETH', type: 'crypto', dateBought: `${y - 1}-01-10`, quantity: 2, pricePaid: 2300, amountInvested: 4600 },
      ],
    },
    {
      id: uid(), name: 'Ledger wallet', holdings: [
        { id: uid(), asset: 'SOL', type: 'crypto', dateBought: `${y - 1}-08-02`, quantity: 20, pricePaid: 145, amountInvested: 2900 },
      ],
    },
    {
      id: uid(), name: 'Stocks', holdings: [
        { id: uid(), asset: 'AAPL', type: 'stock', dateBought: `${y - 1}-05-20`, quantity: 10, pricePaid: 190, amountInvested: 1900 },
        { id: uid(), asset: 'VOO', type: 'etf', dateBought: `${y}-02-01`, quantity: 3, pricePaid: 510, amountInvested: 1530 },
      ],
    },
  ];
  return s;
}

export function downloadFile(name, text, mime = 'application/json') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    return true;
  } catch { return false; }
}

export function toCSV(sections) {
  const rows = [['Section', 'Asset', 'Type', 'Date bought', 'Quantity', 'Price paid', 'Amount invested']];
  for (const s of sections) for (const h of s.holdings || []) {
    rows.push([s.name, h.asset, h.type, h.dateBought, h.quantity, h.pricePaid, h.amountInvested ?? '']);
  }
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
