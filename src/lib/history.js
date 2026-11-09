// Builds the invested-vs-value time series for the hero chart. Pure.
import { holdingStats } from './math.js';
import { assetKey } from './prices.js';

const dayMs = 86400000;
export const iso = (d) => new Date(d).toISOString().slice(0, 10);

/** Price on `date` from a {date: price} series: latest point on or before the date. */
export function priceOn(series, date, sortedDates) {
  if (!series) return null;
  if (series[date] != null) return series[date];
  // binary search for last date <= target
  const keys = sortedDates || Object.keys(series).sort();
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? series[keys[ans]] : null;
}

/**
 * sections: [{holdings}], histories: { assetKey: {date: price} }, prices: { assetKey: {price} },
 * snapshots: { date: {value, invested} }, range: '1M' | '6M' | '1Y' | 'All'
 * Returns { points: [{date, invested, value}], approximate: boolean }
 */
export function buildSeries({ sections, histories = {}, prices = {}, snapshots = {}, range = 'All', today = new Date() }) {
  const holdings = [];
  for (const s of sections) for (const h of s.holdings || []) holdings.push(h);
  if (!holdings.length) return { points: [], approximate: false };

  const todayISO = iso(today);
  const buys = holdings.map((h) => h.dateBought).filter(Boolean).sort();
  const firstBuy = buys[0] || todayISO;
  const rangeDays = { '1M': 30, '6M': 182, '1Y': 365 }[range];
  let start = rangeDays ? iso(today.getTime() - rangeDays * dayMs) : firstBuy;
  if (start > todayISO) start = todayISO;
  if (!rangeDays && start < firstBuy) start = firstBuy;

  // Choose a step so we never draw more than ~400 points
  const totalDays = Math.max(1, Math.round((new Date(todayISO) - new Date(start)) / dayMs));
  const step = Math.max(1, Math.ceil(totalDays / 400));

  const sortedKeys = {};
  for (const k of Object.keys(histories)) if (histories[k]) sortedKeys[k] = Object.keys(histories[k]).sort();

  let approximate = false;
  const points = [];
  for (let t = new Date(start).getTime(); ; t += step * dayMs) {
    let date = iso(t);
    const last = date >= todayISO;
    if (last) date = todayISO;
    let invested = 0, value = 0;
    for (const h of holdings) {
      if (!h.dateBought || h.dateBought > date) continue;
      const st = holdingStats(h);
      invested += st.invested;
      const key = assetKey(h.asset, h.type);
      const hist = histories[key];
      const cur = prices[key] && prices[key].price;
      let p = hist ? priceOn(hist, date, sortedKeys[key]) : null;
      if (p == null) {
        // No history: interpolate from purchase price to today's price (straight line). Flagged as approximate.
        approximate = true;
        const curP = Number.isFinite(cur) ? cur : (st.current ?? st.paid);
        const span = Math.max(1, new Date(todayISO) - new Date(h.dateBought));
        const frac = Math.min(1, Math.max(0, (new Date(date) - new Date(h.dateBought)) / span));
        p = st.paid + (curP - st.paid) * frac;
      }
      if (last && Number.isFinite(cur)) p = cur;
      value += st.qty * p;
    }
    // A real recorded snapshot wins over an approximation for that day
    if (approximate && snapshots[date] && !last) value = snapshots[date].value;
    points.push({ date, invested, value });
    if (last) break;
  }
  return { points, approximate };
}

/** Group holdings by purchase year: { year: {invested, value, gain, count} } */
export function byYear(sections) {
  const out = {};
  for (const s of sections) for (const h of s.holdings || []) {
    const y = (h.dateBought || '').slice(0, 4) || 'Unknown';
    const st = holdingStats(h);
    out[y] = out[y] || { invested: 0, value: 0, gain: 0, count: 0 };
    out[y].invested += st.invested; out[y].value += st.value; out[y].gain += st.gain; out[y].count++;
  }
  return out;
}
