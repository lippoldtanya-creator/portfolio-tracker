import { useMemo, useState } from 'react';
import { Tip, GrowthChart, Modal } from './ui.jsx';
import {
  whatIf, requiredLumpSum, contributionPlan, projectContributions, periodsFor, growthTable,
  scenarios, defaultScenarioPrices, fmtMoney, fmtPct, fmtQty,
} from '../lib/math.js';
import { fetchPrices } from '../lib/prices.js';
import { uid } from '../lib/storage.js';

const n = (v) => { const x = parseFloat(String(v ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(x) ? x : NaN; };
const monthsBetween = (dateStr) => {
  if (!dateStr) return NaN;
  const d = new Date(dateStr), now = new Date();
  return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth()) + (d.getDate() - now.getDate()) / 30);
};

const EMPTY = {
  asset: 'BTC', assetType: 'crypto', mode: 'target', current: '', target: '', timeMode: 'months', months: 12, date: '',
  amount: 10000, goal: '', schedule: 'lump', lump: '', annualRate: 10, monthly: '',
  bear: '', base: '', bull: '',
};

function Field({ label, tip, children }) {
  return <div className="field"><label>{label}{tip && <Tip text={tip} />}</label>{children}</div>;
}

export default function Planner({ state, actions }) {
  const [f, setF] = useState(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState('');
  const [compare, setCompare] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const current = n(f.current), target = n(f.target), amount = n(f.amount), goal = n(f.goal);
  const months = f.timeMode === 'date' ? monthsBetween(f.date) : n(f.months);
  const periods = periodsFor(f.schedule, months);
  const lump = f.schedule === 'lump' ? 0 : (n(f.lump) || 0);

  const def = useMemo(() => defaultScenarioPrices(current || 0, target || 0), [current, target]);
  const bear = f.bear === '' ? def.bear : n(f.bear);
  const base = f.base === '' ? def.base : n(f.base);
  const bull = f.bull === '' ? def.bull : n(f.bull);

  const wi = whatIf(amount, current, target);
  const need = requiredLumpSum(goal, current, target);
  const plan = f.schedule !== 'lump' ? contributionPlan({ goal, current, target, periods, lump }) : null;
  const proj = f.schedule !== 'lump' && Number.isFinite(amount) ? projectContributions({ contribution: amount, current, target, periods, lump }) : null;
  const sc = scenarios({ amount, current, goal, bearPrice: bear, basePrice: base, bullPrice: bull });
  const rows = useMemo(() => growthTable({ start: amount || 0, annualRatePct: n(f.annualRate) || 0, months: Number.isFinite(months) ? months : 0, monthlyContribution: n(f.monthly) || 0 }), [amount, f.annualRate, months, f.monthly]);

  const ready = Number.isFinite(current) && current > 0 && Number.isFinite(target) && target > 0;
  const per = f.schedule === 'weekly' ? 'week' : 'month';

  const getPrice = async () => {
    if (!f.asset) return;
    setFetching(true); setFetchMsg('');
    try {
      const got = await fetchPrices([{ asset: f.asset, type: f.assetType }], state.settings, { force: true });
      const k = Object.keys(got)[0];
      if (k) { set({ current: got[k].price }); setFetchMsg('Live price loaded'); }
      else setFetchMsg(f.assetType !== 'crypto' && !state.settings.alphaVantageKey ? 'Stocks need an Alpha Vantage key (Portfolio → Settings). Type the price instead.' : 'Could not fetch a price — type it in.');
    } catch { setFetchMsg('Could not fetch a price — type it in.'); }
    finally { setFetching(false); }
  };

  const savePrediction = () => {
    actions.savePrediction({
      id: uid(), savedAt: new Date().toISOString(), asset: f.asset, mode: f.mode, current, target, months: Number.isFinite(months) ? +months.toFixed(1) : null,
      amount, goal: Number.isFinite(goal) ? goal : null, schedule: f.schedule, annualRate: n(f.annualRate),
      finalValue: f.mode === 'rate' ? rows[rows.length - 1]?.value : (f.schedule === 'lump' ? wi.finalValue : proj?.finalValue),
      profit: f.mode === 'rate' ? rows[rows.length - 1]?.value - rows[rows.length - 1]?.contributed : (f.schedule === 'lump' ? wi.profit : proj?.profit),
      needNow: f.schedule === 'lump' ? need : null, needPer: plan ? plan.required : null,
      bearFinal: sc.bear.finalValue, bullFinal: sc.bull.finalValue, rewardToRisk: sc.rewardToRisk,
    });
    actions.notify('Prediction saved');
  };

  const loadPrediction = (p) => set({
    asset: p.asset, mode: p.mode, current: p.current, target: p.target || '', timeMode: 'months', months: p.months ?? 12,
    amount: p.amount, goal: p.goal ?? '', schedule: p.schedule, annualRate: p.annualRate ?? 10, bear: '', base: '', bull: '',
  });

  return (
    <>
      <div className="notice" style={{ marginBottom: 14 }}>Estimates only, not financial advice. Crypto prices can swing a lot and predictions can be wrong.</div>

      <div className="card">
        <div className="card-head">
          <h2>Prediction Planner</h2>
          <div className="seg">
            <button className={f.mode === 'target' ? 'on' : ''} onClick={() => set({ mode: 'target' })}>Target price</button>
            <button className={f.mode === 'rate' ? 'on' : ''} onClick={() => set({ mode: 'rate' })}>% growth rate</button>
          </div>
        </div>

        <div className="grid c3">
          <Field label="Asset" tip="Type a ticker like BTC, ETH or AAPL, then press Get price.">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={f.asset} onChange={(e) => set({ asset: e.target.value.toUpperCase() })} placeholder="BTC" style={{ textTransform: 'uppercase' }} />
              <select className="input" style={{ width: 'auto' }} value={f.assetType} onChange={(e) => set({ assetType: e.target.value })}><option value="crypto">Crypto</option><option value="stock">Stock/ETF</option></select>
            </div>
          </Field>
          <Field label="Current price ($)" tip="Auto-filled by Get price; you can edit it.">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" inputMode="decimal" value={f.current} onChange={(e) => set({ current: e.target.value })} placeholder="e.g. 100000" />
              <button className="btn" onClick={getPrice} disabled={fetching || !f.asset}>{fetching ? '…' : 'Get price'}</button>
            </div>
            {fetchMsg && <div className="tiny muted">{fetchMsg}</div>}
          </Field>
          {f.mode === 'target' ? (
            <Field label="Target price ($)" tip="The price you expect it to reach by the end of your time frame.">
              <input className="input" inputMode="decimal" value={f.target} onChange={(e) => set({ target: e.target.value })} placeholder="e.g. 150000" />
            </Field>
          ) : (
            <Field label="Yearly return (%)" tip="Expected growth per year. Converted to a monthly rate and compounded.">
              <input className="input" inputMode="decimal" value={f.annualRate} onChange={(e) => set({ annualRate: e.target.value })} placeholder="e.g. 10" />
            </Field>
          )}
        </div>

        <div className="grid c3">
          <Field label="Time frame" tip="How long until the target price / growth is reached.">
            <div style={{ display: 'flex', gap: 6 }}>
              {f.timeMode === 'months'
                ? <input className="input" inputMode="numeric" value={f.months} onChange={(e) => set({ months: e.target.value })} placeholder="months" />
                : <input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />}
              <select className="input" style={{ width: 'auto' }} value={f.timeMode} onChange={(e) => set({ timeMode: e.target.value })}><option value="months">months</option><option value="date">by date</option></select>
            </div>
            {f.timeMode === 'date' && Number.isFinite(months) && <div className="tiny muted">≈ {months.toFixed(1)} months</div>}
          </Field>
          <Field label={f.mode === 'rate' ? 'Starting amount ($)' : f.schedule === 'lump' ? 'Amount I invest now ($)' : `Amount per ${per} ($)`} tip="Used for the what-if calculation.">
            <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="10000" />
          </Field>
          {f.mode === 'target' ? (
            <Field label="Goal: I want to end up with ($)" tip="The final dollar amount you're aiming for. We'll tell you what it takes to get there.">
              <input className="input" inputMode="decimal" value={f.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="e.g. 50000" />
            </Field>
          ) : (
            <Field label="Monthly contribution ($, optional)">
              <input className="input" inputMode="decimal" value={f.monthly} onChange={(e) => set({ monthly: e.target.value })} placeholder="0" />
            </Field>
          )}
        </div>

        {f.mode === 'target' && (
          <div className="grid c2">
            <Field label="Contribution schedule" tip="Lump sum = invest once now. Weekly/monthly = keep adding the same amount each period; each contribution buys at the projected price for that date (price assumed to move smoothly from current to target).">
              <div className="seg">
                {[['lump', 'Lump sum only'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => <button key={v} className={f.schedule === v ? 'on' : ''} onClick={() => set({ schedule: v })}>{l}</button>)}
              </div>
            </Field>
            {f.schedule !== 'lump' && (
              <Field label="Plus a lump sum now ($, optional)" tip="Money you invest today at the current price, on top of the regular contributions.">
                <input className="input" inputMode="decimal" value={f.lump} onChange={(e) => set({ lump: e.target.value })} placeholder="0" />
              </Field>
            )}
          </div>
        )}
      </div>

      {f.mode === 'target' && (
        <>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Results</h2>
            {!ready ? <p className="muted">Enter a current price and a target price to see results.</p> : (
              <>
                <div className="result">
                  <div className="label tiny muted" style={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>What if</div>
                  {f.schedule === 'lump' ? (
                    <div className="headline">If I invest <b>{fmtMoney(amount || 0)}</b> now at <b>{fmtMoney(current)}</b> and it reaches <b>{fmtMoney(target)}</b>, I end up with <b>{fmtMoney(wi.finalValue)}</b> <span className={wi.profit >= 0 ? 'gain' : 'loss'}>(profit {fmtMoney(wi.profit, { plus: true })}, {fmtPct(wi.profitPct)})</span>.</div>
                  ) : (
                    <div className="headline">If I invest <b>{fmtMoney(amount || 0)}</b> every {per} for {periods} {per}s{lump ? <> plus <b>{fmtMoney(lump)}</b> now</> : null}, and the price climbs smoothly from <b>{fmtMoney(current)}</b> to <b>{fmtMoney(target)}</b>, I'll have put in <b>{fmtMoney(proj.totalContributed)}</b> and end up with <b>{fmtMoney(proj.finalValue)}</b> <span className={proj.profit >= 0 ? 'gain' : 'loss'}>(profit {fmtMoney(proj.profit, { plus: true })}, {fmtPct(proj.profitPct)})</span>.</div>
                  )}
                  <div className="tiny muted" style={{ marginTop: 4 }}>You'd own about {fmtQty(f.schedule === 'lump' ? wi.units : proj.finalValue / target)} {f.asset}.</div>
                </div>

                {Number.isFinite(goal) && goal > 0 && (
                  <div className="result">
                    <div className="label tiny muted" style={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>How much to invest</div>
                    <div className="headline">To end up with <b>{fmtMoney(goal)}</b>, I need to invest <b>{fmtMoney(need)}</b> now (lump sum).</div>
                    {plan && (
                      <div className="headline" style={{ marginTop: 8 }}>
                        Or, with {f.schedule} contributions{lump ? <> and <b>{fmtMoney(lump)}</b> now</> : null}: <b>{fmtMoney(plan.required)}</b> per {per} for {periods} {per}s → total contributed <b>{fmtMoney(plan.totalContributed)}</b>, projected final value <b>{fmtMoney(plan.finalValue)}</b> <span className={plan.profit >= 0 ? 'gain' : 'loss'}>(profit {fmtMoney(plan.profit, { plus: true })})</span>.
                        {plan.required === 0 && <div className="tiny muted">Your lump sum alone already reaches the goal.</div>}
                      </div>
                    )}
                    <div className="tiny muted" style={{ marginTop: 4 }}>That's a {fmtPct(sc.requiredGainToGoalPct)} gain on {fmtMoney(amount || 0)}; the price needs to go up {fmtPct((target / current - 1) * 100)} to reach your target.</div>
                  </div>
                )}
              </>
            )}
          </div>

          {ready && (
            <div className="card">
              <div className="card-head">
                <h2>Risk vs reward <Tip text="Three stories for the same investment. Edit any scenario price. Reward-to-risk = what you'd gain in the base case ÷ what you'd lose in the bear case." /></h2>
                <button className="btn sm ghost" onClick={() => set({ bear: '', base: '', bull: '' })}>Reset to defaults</button>
              </div>
              <div className="scen">
                {[['bear', 'Bear 🐻', sc.bear, '−50% from current'], ['base', 'Base 🎯', sc.base, 'your target'], ['bull', 'Bull 🐂', sc.bull, 'target +25%']].map(([k, title, s, hint]) => (
                  <div className="box" key={k}>
                    <h3>{title} <span className="tiny muted" style={{ fontWeight: 500 }}>{hint}</span></h3>
                    <input className="input" inputMode="decimal" value={f[k] === '' ? (Number.isFinite(def[k]) ? +def[k].toFixed(def[k] < 1 ? 6 : 2) : '') : f[k]} onChange={(e) => set({ [k]: e.target.value })} aria-label={`${title} price`} />
                    <div style={{ marginTop: 8 }}>
                      <div className="kv"><span className="muted">Final value</span><b>{fmtMoney(s.finalValue)}</b></div>
                      <div className="kv"><span className="muted">Profit / loss</span><b className={s.profit >= 0 ? 'gain' : 'loss'}>{fmtMoney(s.profit, { plus: true })} ({fmtPct(s.profitPct)})</b></div>
                      {Number.isFinite(goal) && goal > 0 && <div className="kv"><span className="muted">Still needed to hit goal</span><b>{s.furtherGainToGoalPct <= 0 ? '✓ reached' : fmtPct(s.furtherGainToGoalPct)}</b></div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="result" style={{ marginTop: 10, marginBottom: 0 }}>
                <div className="headline">If it drops to <b>{fmtMoney(sc.bear.price)}</b> ({fmtPct((sc.bear.price / current - 1) * 100)}) instead, you would {sc.bear.profit < 0 ? <>lose <b className="loss">{fmtMoney(-sc.bear.profit)}</b></> : <>still gain <b className="gain">{fmtMoney(sc.bear.profit)}</b></>}.</div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Reward-to-risk: {sc.rewardToRisk == null ? 'n/a (no loss in the bear case)' : <><b>{sc.rewardToRisk.toFixed(2)}</b> — for every $1 you could lose, you could gain ${sc.rewardToRisk.toFixed(2)}.</>}
                  {Number.isFinite(goal) && goal > 0 && <> Required gain to hit your goal: <b>{fmtPct(sc.requiredGainToGoalPct)}</b>.</>}
                  {f.schedule !== 'lump' && <> Scenarios assume a one-time investment of {fmtMoney(amount || 0)} now.</>}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {f.mode === 'rate' && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Growth at {n(f.annualRate) || 0}% a year</h2>
          {rows.length > 1 ? (
            <>
              <div className="result">
                <div className="headline">Starting with <b>{fmtMoney(amount || 0)}</b>{n(f.monthly) ? <> and adding <b>{fmtMoney(n(f.monthly))}</b> a month</> : null} at <b>{n(f.annualRate) || 0}%</b> a year, after <b>{rows.length - 1} months</b> you'd have <b>{fmtMoney(rows[rows.length - 1].value)}</b> — <span className="gain">{fmtMoney(rows[rows.length - 1].value - rows[rows.length - 1].contributed, { plus: true })}</span> more than the {fmtMoney(rows[rows.length - 1].contributed)} you put in.</div>
              </div>
              <GrowthChart rows={rows} />
              <details className="disclosure" style={{ marginTop: 8 }} open={rows.length <= 25}>
                <summary className="small">Month-by-month table</summary>
                <div className="table-wrap"><table className="sheet" style={{ minWidth: 420 }}>
                  <thead><tr><th className="l">Month</th><th>Put in so far</th><th>Value</th><th>Growth</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.month}><td className="l">{r.month}</td><td>{fmtMoney(r.contributed)}</td><td>{fmtMoney(r.value)}</td><td className={r.value - r.contributed >= 0 ? 'gain' : 'loss'}>{fmtMoney(r.value - r.contributed, { plus: true })}</td></tr>)}</tbody>
                </table></div>
              </details>
            </>
          ) : <p className="muted">Enter a starting amount and a time frame in months.</p>}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Saved predictions</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {state.predictions.length > 1 && <button className="btn sm" onClick={() => setCompare(true)}>Compare side by side</button>}
            <button className="btn sm primary" onClick={savePrediction} disabled={f.mode === 'target' ? !ready : !(amount > 0)}>Save this prediction</button>
          </div>
        </div>
        {!state.predictions.length ? <p className="muted small">No saved predictions yet. Fill in the planner and press Save.</p> : (
          <div className="table-wrap"><table className="sheet" style={{ minWidth: 700 }}>
            <thead><tr><th className="l">Asset</th><th className="l">Plan</th><th>Now</th><th>Target</th><th>Months</th><th>Invest</th><th>Ends with</th><th>Profit</th><th></th></tr></thead>
            <tbody>
              {state.predictions.map((p) => (
                <tr key={p.id}>
                  <td className="l"><b>{p.asset}</b><div className="tiny muted">{new Date(p.savedAt).toLocaleDateString()}</div></td>
                  <td className="l">{p.mode === 'rate' ? `${p.annualRate}% / yr` : p.schedule === 'lump' ? 'Lump sum' : `${p.schedule} contributions`}</td>
                  <td>{fmtMoney(p.current)}</td>
                  <td>{p.mode === 'rate' ? '—' : fmtMoney(p.target)}</td>
                  <td>{p.months ?? '—'}</td>
                  <td>{fmtMoney(p.amount)}{p.schedule !== 'lump' && p.mode !== 'rate' ? `/${p.schedule === 'weekly' ? 'wk' : 'mo'}` : ''}</td>
                  <td>{fmtMoney(p.finalValue)}</td>
                  <td className={p.profit >= 0 ? 'gain' : 'loss'}>{fmtMoney(p.profit, { plus: true })}</td>
                  <td><div className="rowbtns"><button className="btn sm ghost" onClick={() => loadPrediction(p)}>Open</button><button className="btn sm icon ghost danger" onClick={() => actions.deletePrediction(p.id)} aria-label="Delete">✕</button></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {compare && (
        <Modal title="Compare predictions" onClose={() => setCompare(false)} wide>
          <div className="table-wrap"><table className="sheet" style={{ minWidth: 600 }}>
            <thead><tr><th className="l"></th>{state.predictions.map((p) => <th key={p.id}>{p.asset}<div className="tiny muted" style={{ textTransform: 'none' }}>{p.mode === 'rate' ? `${p.annualRate}%/yr` : p.schedule}</div></th>)}</tr></thead>
            <tbody>
              {[
                ['Current price', (p) => fmtMoney(p.current)], ['Target price', (p) => (p.mode === 'rate' ? '—' : fmtMoney(p.target))], ['Months', (p) => p.months ?? '—'],
                ['Invest', (p) => fmtMoney(p.amount)], ['Ends with', (p) => fmtMoney(p.finalValue)], ['Profit', (p) => <span className={p.profit >= 0 ? 'gain' : 'loss'}>{fmtMoney(p.profit, { plus: true })}</span>],
                ['Goal', (p) => (p.goal ? fmtMoney(p.goal) : '—')], ['Needed now for goal', (p) => (p.needNow ? fmtMoney(p.needNow) : '—')], ['Needed per period', (p) => (p.needPer ? fmtMoney(p.needPer) : '—')],
                ['Bear case ends with', (p) => (p.bearFinal ? fmtMoney(p.bearFinal) : '—')], ['Bull case ends with', (p) => (p.bullFinal ? fmtMoney(p.bullFinal) : '—')], ['Reward-to-risk', (p) => (p.rewardToRisk != null ? p.rewardToRisk.toFixed(2) : '—')],
              ].map(([label, fn]) => <tr key={label}><td className="l muted">{label}</td>{state.predictions.map((p) => <td key={p.id}>{fn(p)}</td>)}</tr>)}
            </tbody>
          </table></div>
        </Modal>
      )}
    </>
  );
}
