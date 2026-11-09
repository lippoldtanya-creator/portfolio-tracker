import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal localStorage for node
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { fetchPrices, fetchHistory, resolveCoinId } = await import('./prices.js');

const json = (obj) => Promise.resolve({ ok: true, json: () => Promise.resolve(obj) });

describe('prices', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; vi.restoreAllMocks(); });

  it('fetches crypto in one batched CoinGecko call and stocks via Alpha Vantage', async () => {
    const calls = [];
    globalThis.fetch = vi.fn((url) => {
      calls.push(url);
      if (url.includes('/simple/price')) return json({ bitcoin: { usd: 100000 }, ethereum: { usd: 3500 } });
      if (url.includes('GLOBAL_QUOTE')) return json({ 'Global Quote': { '05. price': '231.50' } });
      return Promise.resolve({ ok: false });
    });
    const out = await fetchPrices(
      [{ asset: 'BTC', type: 'crypto' }, { asset: 'eth', type: 'crypto' }, { asset: 'AAPL', type: 'stock' }],
      { alphaVantageKey: 'demo' },
    );
    expect(out['c:BTC'].price).toBe(100000);
    expect(out['c:ETH'].price).toBe(3500);
    expect(out['s:AAPL'].price).toBe(231.5);
    expect(calls.filter((u) => u.includes('/simple/price')).length).toBe(1);
    expect(calls.find((u) => u.includes('/simple/price'))).toContain('ids=bitcoin,ethereum');
  });

  it('uses the 5-minute cache on a second call', async () => {
    globalThis.fetch = vi.fn(() => json({ litecoin: { usd: 99 } }));
    await fetchPrices([{ asset: 'LTC', type: 'crypto' }]);
    const out = await fetchPrices([{ asset: 'LTC', type: 'crypto' }]);
    expect(out['c:LTC'].price).toBe(99);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('never throws when the network fails or returns junk', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const out = await fetchPrices([{ asset: 'DOGE', type: 'crypto' }, { asset: 'MSFT', type: 'stock' }], { alphaVantageKey: 'x' });
    expect(out).toEqual({});
    globalThis.fetch = vi.fn(() => json({ Note: 'rate limited' }));
    const out2 = await fetchPrices([{ asset: 'MSFT', type: 'stock' }], { alphaVantageKey: 'x' });
    expect(out2).toEqual({});
    const h = await fetchHistory('MSFT', 'stock', { alphaVantageKey: 'x' });
    expect(h).toBeNull();
  });

  it('skips stocks entirely without an Alpha Vantage key', async () => {
    globalThis.fetch = vi.fn(() => json({}));
    await fetchPrices([{ asset: 'NVDA', type: 'stock' }], {});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('resolves unknown tickers via /search, preferring an exact symbol match', async () => {
    globalThis.fetch = vi.fn(() => json({ coins: [{ id: 'wrong-coin', symbol: 'XYZZ' }, { id: 'right-coin', symbol: 'XYZ' }] }));
    expect(await resolveCoinId('xyz')).toBe('right-coin');
    expect(await resolveCoinId('BTC')).toBe('bitcoin');
  });

  it('parses history into a date->price map', async () => {
    globalThis.fetch = vi.fn(() => json({ prices: [[Date.UTC(2024, 0, 1), 10], [Date.UTC(2024, 0, 2), 11]] }));
    const h = await fetchHistory('BTC', 'crypto');
    expect(h['2024-01-01']).toBe(10);
    expect(h['2024-01-02']).toBe(11);
  });
});
