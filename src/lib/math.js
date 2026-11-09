// All prediction and portfolio math lives here as small pure functions.
// Everything is in USD. No side effects, no DOM.

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function pct(from, to) {
  if (!isNum(from) || from === 0 || !isNum(to)) return 0;
  return ((to - from) / from) * 100;
}

// ---------- Portfolio ----------

export function holdingStats(h) {
  const qty = Number(h.quantity) || 0;
  const paid = Number(h.pricePaid) || 0;
  const invested = isNum(Number(h.amountInvested)) && h.amountInvested !== '' && h.amountInvested != null
    ? Number(h.amountInvested)
    : qty * paid;
  const current = isNum(Number(h.currentPrice)) && h.currentPrice != null && h.currentPrice !== ''
    ? Number(h.currentPrice)
    : null;
  const value = current == null ? invested : qty * current;
  const gain = value - invested;
  return { qty, paid, invested, current, value, gain, gainPct: pct(invested, value) };
}

export function sectionTotals(holdings) {
  return holdings.reduce(
    (acc, h) => {
      const s = holdingStats(h);
      acc.invested += s.invested;
      acc.value += s.value;
      acc.gain += s.gain;
      return acc;
    },
    { invested: 0, value: 0, gain: 0 }
  );
}

export function portfolioTotals(sections) {
  const t = { invested: 0, value: 0, gain: 0 };
  for (const s of sections) {
    const st = sectionTotals(s.holdings || []);
    t.invested += st.invested;
    t.value += st.value;
    t.gain += st.gain;
  }
  t.gainPct = pct(t.invested, t.value);
  return t;
}

// ---------- Predictions ----------

/** If I invest `amount` now at `current` and price reaches `target`. */
export function whatIf(amount, current, target) {
  if (!isNum(amount) || !isNum(current) || !isNum(target) || current <= 0) {
    return { units: 0, finalValue: 0, profit: 0, profitPct: 0 };
  }
  const units = amount / current;
  const finalValue = units * target;
  const profit = finalValue - amount;
  return { units, finalValue, profit, profitPct: pct(amount, finalValue) };
}

/** Lump sum needed now to end up with `goal` when price goes current -> target. */
export function requiredLumpSum(goal, current, target) {
  if (!isNum(goal) || !isNum(current) || !isNum(target) || target <= 0) return 0;
  return goal * (current / target);
}

/**
 * Smooth (compounding) price path from current to target over `periods` steps.
 * Price at step k (k = 0..periods) = current * (target/current)^(k/periods).
 */
export function pricePath(current, target, periods) {
  if (!isNum(current) || !isNum(target) || !isNum(periods) || periods <= 0 || current <= 0) return [];
  const ratio = target / current;
  const out = [];
  for (let k = 0; k <= periods; k++) out.push(current * Math.pow(ratio, k / periods));
  return out;
}

export function periodsFor(schedule, months) {
  const m = Math.max(0, Number(months) || 0);
  if (schedule === 'weekly') return Math.max(1, Math.round((m * 52) / 12));
  if (schedule === 'monthly') return Math.max(1, Math.round(m));
  return 0; // lump sum only
}

/**
 * Contribution plan: a contribution `c` is made at the START of each period k = 0..n-1,
 * buying at the projected price for that date; an optional `lump` is bought at the current price.
 * Final value = target * (lump/current + sum_k c / p(k)).
 * Because final value is linear in c, the required c is solved directly.
 */
export function contributionPlan({ goal, current, target, periods, lump = 0 }) {
  const path = pricePath(current, target, periods);
  if (!path.length || !isNum(goal)) {
    return { required: 0, totalContributed: 0, finalValue: 0, unitsFromLump: 0, sumInversePrice: 0 };
  }
  const n = periods;
  let S = 0;
  for (let k = 0; k < n; k++) S += 1 / path[k];
  const unitsFromLump = (Number(lump) || 0) / current;
  const needFromContrib = goal - unitsFromLump * target;
  const required = needFromContrib <= 0 ? 0 : needFromContrib / (target * S);
  const units = unitsFromLump + required * S;
  const finalValue = units * target;
  return {
    required,
    totalContributed: required * n + (Number(lump) || 0),
    finalValue,
    unitsFromLump,
    sumInversePrice: S,
    profit: finalValue - (required * n + (Number(lump) || 0)),
  };
}

/** Project what a fixed contribution would grow to on the same price path (for what-if with contributions). */
export function projectContributions({ contribution, current, target, periods, lump = 0 }) {
  const path = pricePath(current, target, periods);
  if (!path.length) return { finalValue: 0, totalContributed: 0, profit: 0, profitPct: 0 };
  let units = (Number(lump) || 0) / current;
  for (let k = 0; k < periods; k++) units += contribution / path[k];
  const finalValue = units * target;
  const totalContributed = contribution * periods + (Number(lump) || 0);
  return { finalValue, totalContributed, profit: finalValue - totalContributed, profitPct: pct(totalContributed, finalValue) };
}

/**
 * Growth at a yearly % rate, month by month, with optional monthly contributions
 * added at the start of each month (after month 0's starting amount).
 * Returns rows: { month, contributed, value }.
 */
export function growthTable({ start, annualRatePct, months, monthlyContribution = 0 }) {
  const r = Math.pow(1 + (Number(annualRatePct) || 0) / 100, 1 / 12) - 1;
  const n = Math.max(0, Math.round(Number(months) || 0));
  const rows = [];
  let value = Number(start) || 0;
  let contributed = value;
  rows.push({ month: 0, contributed, value });
  for (let m = 1; m <= n; m++) {
    value = value * (1 + r) + (Number(monthlyContribution) || 0);
    contributed += Number(monthlyContribution) || 0;
    rows.push({ month: m, contributed, value });
  }
  return rows;
}

/** Bear / Base / Bull scenarios for a lump-sum investment. */
export function scenarios({ amount, current, goal, bearPrice, basePrice, bullPrice }) {
  const mk = (name, price) => {
    const w = whatIf(amount, current, price);
    const furtherGainToGoalPct = w.finalValue > 0 && isNum(goal) ? pct(w.finalValue, goal) : 0;
    return { name, price, ...w, furtherGainToGoalPct };
  };
  const bear = mk('Bear', bearPrice);
  const base = mk('Base', basePrice);
  const bull = mk('Bull', bullPrice);
  const bearLoss = Math.max(0, -bear.profit);
  const rewardToRisk = bearLoss > 0 ? base.profit / bearLoss : null;
  return { bear, base, bull, rewardToRisk, requiredGainToGoalPct: isNum(amount) && amount > 0 ? pct(amount, goal) : 0 };
}

export function defaultScenarioPrices(current, target) {
  return { bear: current * 0.5, base: target, bull: target * 1.25 };
}

// ---------- Formatting helpers (pure) ----------

export function fmtMoney(n, opts = {}) {
  if (!isNum(n)) return '—';
  const abs = Math.abs(n);
  const digits = opts.digits ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : abs > 0 ? 4 : 2);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = n < 0 ? '-' : opts.plus && n > 0 ? '+' : '';
  return `${sign}$${s}`;
}

export function fmtPct(n, plus = true) {
  if (!isNum(n)) return '—';
  const sign = n < 0 ? '-' : plus && n > 0 ? '+' : '';
  return `${sign}${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}

export function fmtQty(n) {
  if (!isNum(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
