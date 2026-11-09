import { describe, it, expect } from 'vitest';
import { parseCSV, autoMap, detectSource, rowsToHoldings, toNumber, toISODate } from './importers.js';
import { buildSeries, priceOn } from './history.js';

describe('CSV import', () => {
  it('parses quoted CSV and detects Ledger Live', () => {
    const csv = `Operation Date,Currency Ticker,Operation Type,Operation Amount,Operation Fees,Operation Hash,Account Name,Account xpub,Countervalue Ticker,Countervalue at Operation Date,Countervalue at CSV Export
2024-03-15T10:00:00.000Z,BTC,IN,0.25,0,abc,"Bitcoin 1",xpub,USD,6875,20000
2024-04-01T10:00:00.000Z,BTC,OUT,0.1,0,def,"Bitcoin 1",xpub,USD,3000,8000`;
    const { headers, rows } = parseCSV(csv);
    expect(headers.length).toBe(11);
    expect(rows.length).toBe(2);
    expect(detectSource(headers)).toBe('Ledger Live');
    const map = autoMap(headers);
    const holdings = rowsToHoldings(rows, map);
    expect(holdings.length).toBe(1); // OUT row filtered
    expect(holdings[0].asset).toBe('BTC');
    expect(holdings[0].type).toBe('crypto');
    expect(holdings[0].quantity).toBe(0.25);
    expect(holdings[0].amountInvested).toBe(6875);
    expect(holdings[0].pricePaid).toBe(27500);
    expect(holdings[0].dateBought).toBe('2024-03-15');
  });

  it('handles TradingView-style exports', () => {
    const csv = `Symbol,Side,Type,Qty,Fill Price,Status,Commission,Placing Time
NASDAQ:AAPL,Buy,Market,10,190.5,Filled,0,2025-05-20 14:03:00
BINANCE:BTCUSDT,Buy,Limit,0.1,65000,Filled,0,2025-06-01 09:00:00
NASDAQ:AAPL,Sell,Market,5,200,Filled,0,2025-07-01 14:03:00`;
    const { headers, rows } = parseCSV(csv);
    expect(detectSource(headers)).toBe('TradingView');
    const h = rowsToHoldings(rows, autoMap(headers));
    expect(h.length).toBe(2);
    expect(h[0]).toMatchObject({ asset: 'AAPL', type: 'stock', quantity: 10, pricePaid: 190.5, amountInvested: 1905, dateBought: '2025-05-20' });
    expect(h[1]).toMatchObject({ asset: 'BTC', type: 'crypto', quantity: 0.1, pricePaid: 65000 });
  });

  it('bad CSV does not throw', () => {
    expect(() => rowsToHoldings(parseCSV('garbage\n"unclosed').rows, autoMap(['garbage']))).not.toThrow();
    expect(parseCSV('').rows).toEqual([]);
  });

  it('number and date helpers', () => {
    expect(toNumber('$1,234.50')).toBe(1234.5);
    expect(toNumber('(50)')).toBe(-50);
    expect(toISODate('03/15/2024')).toBe('2024-03-15');
    expect(toISODate('2024-03-15T10:00:00Z')).toBe('2024-03-15');
  });
});

describe('history series', () => {
  it('priceOn picks the latest price on/before the date', () => {
    const s = { '2024-01-01': 10, '2024-01-05': 20 };
    expect(priceOn(s, '2024-01-03')).toBe(10);
    expect(priceOn(s, '2024-01-05')).toBe(20);
    expect(priceOn(s, '2023-12-31')).toBeNull();
  });
  it('builds invested and value lines', () => {
    const today = new Date('2024-01-10T12:00:00Z');
    const sections = [{ holdings: [{ asset: 'BTC', type: 'crypto', dateBought: '2024-01-02', quantity: 1, pricePaid: 100 }] }];
    const histories = { 'c:BTC': { '2024-01-01': 100, '2024-01-05': 150, '2024-01-10': 200 } };
    const prices = { 'c:BTC': { price: 200 } };
    const { points, approximate } = buildSeries({ sections, histories, prices, range: 'All', today });
    expect(approximate).toBe(false);
    expect(points[0].date).toBe('2024-01-02');
    expect(points[0].invested).toBe(100);
    expect(points[0].value).toBe(100);
    const last = points[points.length - 1];
    expect(last.date).toBe('2024-01-10');
    expect(last.value).toBe(200);
  });
  it('flags approximate when no history', () => {
    const today = new Date('2024-01-10T12:00:00Z');
    const sections = [{ holdings: [{ asset: 'ZZZ', type: 'stock', dateBought: '2024-01-02', quantity: 2, pricePaid: 10 }] }];
    const { points, approximate } = buildSeries({ sections, prices: { 's:ZZZ': { price: 20 } }, range: 'All', today });
    expect(approximate).toBe(true);
    expect(points[points.length - 1].value).toBe(40);
    expect(points[0].value).toBe(20);
  });
});
