import { describe, it, expect } from 'vitest';
import {
  whatIf, requiredLumpSum, pricePath, contributionPlan, projectContributions,
  growthTable, scenarios, defaultScenarioPrices, periodsFor, holdingStats, portfolioTotals, pct,
} from './math.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('whatIf', () => {
  it('$10,000 at $100,000 reaching $150,000 ends with $15,000', () => {
    const r = whatIf(10000, 100000, 150000);
    expect(close(r.units, 0.1)).toBe(true);
    expect(close(r.finalValue, 15000)).toBe(true);
    expect(close(r.profit, 5000)).toBe(true);
    expect(close(r.profitPct, 50)).toBe(true);
  });
  it('handles bad input without throwing', () => {
    expect(whatIf(NaN, 0, 5).finalValue).toBe(0);
    expect(whatIf(100, 0, 5).finalValue).toBe(0);
  });
});

describe('requiredLumpSum', () => {
  it('to end with $15,000 when price goes 100k -> 150k, invest $10,000', () => {
    expect(close(requiredLumpSum(15000, 100000, 150000), 10000)).toBe(true);
  });
  it('is the inverse of whatIf', () => {
    const need = requiredLumpSum(50000, 3200, 8000);
    expect(close(whatIf(need, 3200, 8000).finalValue, 50000)).toBe(true);
  });
});

describe('pricePath', () => {
  it('starts at current, ends at target, compounds smoothly', () => {
    const p = pricePath(100, 400, 2);
    expect(p.length).toBe(3);
    expect(close(p[0], 100)).toBe(true);
    expect(close(p[1], 200)).toBe(true); // geometric midpoint
    expect(close(p[2], 400)).toBe(true);
  });
  it('returns [] for bad input', () => {
    expect(pricePath(0, 10, 5)).toEqual([]);
    expect(pricePath(10, 10, 0)).toEqual([]);
  });
});

describe('periodsFor', () => {
  it('converts months to weeks / months / none', () => {
    expect(periodsFor('weekly', 12)).toBe(52);
    expect(periodsFor('weekly', 6)).toBe(26);
    expect(periodsFor('monthly', 12)).toBe(12);
    expect(periodsFor('lump', 12)).toBe(0);
  });
});

describe('contributionPlan', () => {
  it('required contribution actually hits the goal (linearity check)', () => {
    const plan = contributionPlan({ goal: 20000, current: 100, target: 200, periods: 12 });
    expect(plan.required).toBeGreaterThan(0);
    expect(close(plan.finalValue, 20000, 1e-6)).toBe(true);
    // re-project with the solved contribution and confirm
    const proj = projectContributions({ contribution: plan.required, current: 100, target: 200, periods: 12 });
    expect(close(proj.finalValue, 20000, 1e-6)).toBe(true);
    expect(close(plan.totalContributed, plan.required * 12)).toBe(true);
  });
  it('hand-checked 2-period example', () => {
    // price path 100 -> 200 -> 400, contributions at k=0 ($100 price) and k=1 ($200 price)
    // units per $1 = 1/100 + 1/200 = 0.015; final per $1 = 0.015 * 400 = 6
    // goal 600 => contribution 100 per period
    const plan = contributionPlan({ goal: 600, current: 100, target: 400, periods: 2 });
    expect(close(plan.required, 100)).toBe(true);
    expect(close(plan.totalContributed, 200)).toBe(true);
    expect(close(plan.finalValue, 600)).toBe(true);
  });
  it('a lump sum reduces the required contribution; enough lump means 0 needed', () => {
    const a = contributionPlan({ goal: 600, current: 100, target: 400, periods: 2 });
    const b = contributionPlan({ goal: 600, current: 100, target: 400, periods: 2, lump: 50 });
    expect(b.required).toBeLessThan(a.required);
    const c = contributionPlan({ goal: 600, current: 100, target: 400, periods: 2, lump: 150 });
    expect(c.required).toBe(0); // 150/100*400 = 600 already
  });
});

describe('growthTable', () => {
  it('10% a year on $1,000 gives ~$1,100 after 12 months with no contributions', () => {
    const rows = growthTable({ start: 1000, annualRatePct: 10, months: 12 });
    expect(rows.length).toBe(13);
    expect(close(rows[12].value, 1100, 1e-6)).toBe(true);
  });
  it('adds monthly contributions', () => {
    const rows = growthTable({ start: 0, annualRatePct: 0, months: 3, monthlyContribution: 100 });
    expect(rows[3].value).toBe(300);
    expect(rows[3].contributed).toBe(300);
  });
});

describe('scenarios', () => {
  it('bear/base/bull with defaults and reward-to-risk', () => {
    const d = defaultScenarioPrices(100000, 150000);
    expect(d).toEqual({ bear: 50000, base: 150000, bull: 187500 });
    const s = scenarios({ amount: 10000, current: 100000, goal: 15000, bearPrice: d.bear, basePrice: d.base, bullPrice: d.bull });
    expect(close(s.bear.finalValue, 5000)).toBe(true);
    expect(close(s.bear.profit, -5000)).toBe(true);
    expect(close(s.base.profit, 5000)).toBe(true);
    expect(close(s.bull.finalValue, 18750)).toBe(true);
    expect(close(s.rewardToRisk, 1)).toBe(true); // gain 5000 / loss 5000
    expect(close(s.requiredGainToGoalPct, 50)).toBe(true);
    expect(close(s.bear.furtherGainToGoalPct, 200)).toBe(true); // 5000 -> 15000
  });
  it('rewardToRisk is null when bear case is not a loss', () => {
    const s = scenarios({ amount: 100, current: 10, goal: 200, bearPrice: 12, basePrice: 20, bullPrice: 25 });
    expect(s.rewardToRisk).toBeNull();
  });
});

describe('portfolio math', () => {
  it('holding stats fall back to invested when no current price', () => {
    const s = holdingStats({ quantity: 2, pricePaid: 50 });
    expect(s.invested).toBe(100);
    expect(s.value).toBe(100);
    expect(s.gain).toBe(0);
  });
  it('totals across sections', () => {
    const t = portfolioTotals([
      { holdings: [{ quantity: 1, pricePaid: 100, currentPrice: 150 }] },
      { holdings: [{ quantity: 10, pricePaid: 10, amountInvested: 105, currentPrice: 9 }] },
    ]);
    expect(t.invested).toBe(205);
    expect(t.value).toBe(240);
    expect(t.gain).toBe(35);
    expect(close(pct(205, 240), t.gainPct)).toBe(true);
  });
});
