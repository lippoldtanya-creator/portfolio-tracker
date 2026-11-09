// Live + historical prices. Every function resolves (never rejects); failures return null.
import { getItem, setItem } from './storage.js';

const PRICE_TTL = 5 * 60 * 1000;        // 5 minutes
const HISTORY_TTL = 12 * 60 * 60 * 1000; // 12 hours
const CG = 'https://api.coingecko.com/api/v3';
const AV = 'https://www.alphavantage.co/query';

// Common tickers -> CoinGecko ids (saves API calls; anything else is looked up via /search).
export const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
  BNB: 'binancecoin', AVAX: 'avalanche-2', DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token', LTC: 'litecoin', BCH: 'bitcoin-cash', UNI: 'uniswap', ATOM: 'cosmos',
  XLM: 'stellar', TRX: 'tron', NEAR: 'near', ALGO: 'algorand', HBAR: 'hedera-hashgraph', ETC: 'ethereum-classic',
  SHIB: 'shiba-inu', PEPE: 'pepe', SUI: 'sui', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', TON: 'the-open-network',
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai', XMR: 'monero', FIL: 'filecoin', AAVE: 'aave', MKR: 'maker',
  INJ: 'injective-protocol', RNDR: 'render-token', RENDER: 'render-token', ICP: 'internet-computer', VET: 'vechain',
  CRO: 'crypto-com-chain', FET: 'fetch-ai', TAO: 'bittensor', ONDO: 'ondo-finance', HYPE: 'hyperliquid', KAS: 'kaspa',
  BITCOIN: 'bitcoin', ETHEREUM: 'ethereum', SOLANA: 'solana', CARDANO: 'cardano', DOGECOIN: 'dogecoin',
};

const norm = (s) => String(s || '').trim().toUpperCase();
export const assetKey = (asset, type) => `${type === 'crypto' ? 'c' : 's'}:${norm(asset)}`;

async function getJSON(url, headers = {}, timeoutMs = 12000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

function cgHeaders(settings) {
  const k = settings && settings.coinGeckoKey;
  return k ? { 'x-cg-demo-api-key': k } : {};
}

// ---------- CoinGecko id resolution ----------
export async function resolveCoinId(asset, settings) {
  const sym = norm(asset);
  if (!sym) return null;
  if (COINGECKO_IDS[sym]) return COINGECKO_IDS[sym];
  const cache = getItem('cgIds', {});
  if (cache[sym]) return cache[sym];
  const data = await getJSON(`${CG}/search?query=${encodeURIComponent(sym)}`, cgHeaders(settings));
  const coins = (data && data.coins) || [];
  const exact = coins.find((c) => norm(c.symbol) === sym) || coins.find((c) => norm(c.name) === sym) || coins[0];
  if (!exact) return null;
  cache[sym] = exact.id;
  setItem('cgIds', cache);
  return exact.id;
}

// ---------- Live prices ----------
/**
 * holdings: [{asset, type}] -> { [assetKey]: { price, at, stale:boolean } }
 * Uses a 5-minute cache. Always resolves. Missing prices are simply absent.
 */
export async function fetchPrices(holdings, settings = {}, { force = false } = {}) {
  const cache = getItem('priceCache', {});
  const now = Date.now();
  const out = {};
  const needCrypto = new Set();
  const needStock = new Set();

  for (const h of holdings) {
    const key = assetKey(h.asset, h.type);
    const c = cache[key];
    if (!force && c && now - c.at < PRICE_TTL) { out[key] = { ...c, stale: false }; continue; }
    if (h.type === 'crypto') needCrypto.add(norm(h.asset)); else needStock.add(norm(h.asset));
  }

  // Crypto: resolve ids (parallel), then one batched call
  if (needCrypto.size) {
    const syms = [...needCrypto];
    const ids = await Promise.all(syms.map((s) => resolveCoinId(s, settings)));
    const idList = ids.filter(Boolean);
    if (idList.length) {
      const data = await getJSON(`${CG}/simple/price?ids=${idList.join(',')}&vs_currencies=usd`, cgHeaders(settings));
      if (data) {
        syms.forEach((s, i) => {
          const id = ids[i];
          const p = id && data[id] && data[id].usd;
          if (typeof p === 'number') {
            const key = assetKey(s, 'crypto');
            out[key] = { price: p, at: now, stale: false };
            cache[key] = { price: p, at: now };
          }
        });
      }
    }
  }

  // Stocks/ETFs: Alpha Vantage, one call per symbol (free tier is 25/day, so be gentle)
  if (needStock.size && settings.alphaVantageKey) {
    const syms = [...needStock];
    const results = await Promise.all(syms.map((s) =>
      getJSON(`${AV}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(s)}&apikey=${encodeURIComponent(settings.alphaVantageKey)}`)));
    syms.forEach((s, i) => {
      const q = results[i] && results[i]['Global Quote'];
      const p = q && parseFloat(q['05. price']);
      if (Number.isFinite(p) && p > 0) {
        const key = assetKey(s, 'stock');
        out[key] = { price: p, at: now, stale: false };
        cache[key] = { price: p, at: now };
      }
    });
  }

  setItem('priceCache', cache);
  return out;
}

// ---------- Historical daily prices ----------
/** Returns { 'YYYY-MM-DD': price } or null. Cached 12h. */
export async function fetchHistory(asset, type, settings = {}) {
  const key = assetKey(asset, type);
  const cache = getItem('histCache', {});
  const c = cache[key];
  if (c && Date.now() - c.at < HISTORY_TTL) return c.series;

  let series = null;
  if (type === 'crypto') {
    const id = await resolveCoinId(asset, settings);
    if (id) {
      const data = await getJSON(`${CG}/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, cgHeaders(settings));
      if (data && Array.isArray(data.prices)) {
        series = {};
        for (const [ts, p] of data.prices) series[new Date(ts).toISOString().slice(0, 10)] = p;
      }
    }
  } else if (settings.alphaVantageKey) {
    const data = await getJSON(`${AV}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(norm(asset))}&outputsize=full&apikey=${encodeURIComponent(settings.alphaVantageKey)}`);
    const ts = data && data['Time Series (Daily)'];
    if (ts) {
      series = {};
      for (const d of Object.keys(ts)) series[d] = parseFloat(ts[d]['4. close']);
    }
  }

  if (series) {
    // Keep the cache small-ish: store at most ~5 years of daily points
    cache[key] = { at: Date.now(), series };
    try { setItem('histCache', cache); } catch { /* ignore */ }
  }
  return series;
}
