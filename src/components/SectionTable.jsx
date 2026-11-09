import { useState } from 'react';
import { holdingStats, sectionTotals, fmtMoney, fmtPct } from '../lib/math.js';
import { Tip } from './ui.jsx';

const TYPES = [['crypto', 'Crypto'], ['stock', 'Stock'], ['etf', 'ETF']];

function Cell({ value, onChange, type = 'text', className = '', placeholder, step, inputMode, title }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      className={`cell ${className}`}
      type={type}
      step={step}
      inputMode={inputMode}
      placeholder={placeholder}
      title={title}
      value={draft != null ? draft : (value ?? '')}
      onFocus={() => setDraft(value == null ? '' : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft != null && draft !== String(value ?? '')) onChange(draft); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export default function SectionTable({ section, index, count, total, yearFilter, actions, allSections, onDelete }) {
  const rows = (section.holdings || []).filter((h) => yearFilter === 'all' || (h.dateBought || '').startsWith(yearFilter));
  const st = sectionTotals(section.holdings || []);
  const share = total > 0 ? (st.value / total) * 100 : 0;
  const num = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : ''; };

  return (
    <div className="card">
      <div className="section-head">
        <input className="title" value={section.name} onChange={(e) => actions.renameSection(section.id, e.target.value)} aria-label="Section name" />
        <span className="badge accent mono">{fmtMoney(st.value)}</span>
        <span className="badge mono">{share.toFixed(1)}% of portfolio</span>
        <span className={`badge ${st.gain >= 0 ? 'gain' : 'loss'} mono`}>{fmtMoney(st.gain, { plus: true })} · {fmtPct(st.invested ? (st.gain / st.invested) * 100 : 0)}</span>
        <span className="spacer" />
        <div className="tools">
          <button className="btn sm icon ghost" onClick={() => actions.moveSection(section.id, -1)} disabled={index === 0} aria-label="Move section up" title="Move up">↑</button>
          <button className="btn sm icon ghost" onClick={() => actions.moveSection(section.id, 1)} disabled={index === count - 1} aria-label="Move section down" title="Move down">↓</button>
          <button className="btn sm icon ghost danger" onClick={onDelete} aria-label="Delete section" title="Delete section">🗑</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="muted small" style={{ padding: '10px 0' }}>
          {yearFilter !== 'all' ? `Nothing bought in ${yearFilter} in this section.` : 'No holdings yet.'}
        </div>
      ) : (
        <><div className="swipe-hint">Swipe the table sideways to see value and gain/loss →</div>
        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="l">Asset</th>
                <th className="l">Type</th>
                <th className="l">Date bought</th>
                <th>Quantity</th>
                <th>Price paid</th>
                <th>Invested <Tip text="Total you paid. Auto-filled from quantity × price; you can overwrite it (e.g. to include fees)." /></th>
                <th>Current price <Tip text="Live price when available. Type your own to override. ⚠ means the live price failed and this is the last one we saw." /></th>
                <th>Current value</th>
                <th>Gain / loss $</th>
                <th>Gain / loss %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const s = holdingStats(h);
                const upd = (patch) => actions.updateHolding(section.id, h.id, patch);
                const cls = s.gain > 0 ? 'gain' : s.gain < 0 ? 'loss' : '';
                return (
                  <tr key={h.id}>
                    <td className="l"><Cell className="l asset" value={h.asset} placeholder="BTC" onChange={(v) => upd({ asset: v.trim().toUpperCase() })} /></td>
                    <td className="l">
                      <select className="cell l" value={h.type} onChange={(e) => upd({ type: e.target.value })}>
                        {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="l"><Cell className="l date" type="date" value={h.dateBought} onChange={(v) => upd({ dateBought: v })} /></td>
                    <td><Cell value={h.quantity} inputMode="decimal" placeholder="0" onChange={(v) => upd({ quantity: num(v) })} /></td>
                    <td><Cell value={h.pricePaid} inputMode="decimal" placeholder="0.00" onChange={(v) => upd({ pricePaid: num(v) })} /></td>
                    <td><Cell value={h.amountInvested} inputMode="decimal" placeholder={s.invested ? s.invested.toFixed(2) : '0.00'} onChange={(v) => upd({ amountInvested: num(v) })} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        {h.priceSource === 'stale' && <span className="badge warn" title="Live price failed — showing last known price">⚠</span>}
                        {h.priceSource === 'none' && h.asset && <span className="badge warn" title="No price yet — type one">?</span>}
                        {h.priceSource === 'manual' && <span className="badge" title="You typed this price">✎</span>}
                        <Cell value={h.manualPrice !== '' && h.manualPrice != null ? h.manualPrice : (s.current != null ? +s.current.toFixed(s.current < 1 ? 6 : 2) : '')} inputMode="decimal" placeholder="type price" onChange={(v) => upd({ manualPrice: v === '' ? '' : num(v) })} title={h.priceSource === 'manual' ? 'Clear this cell to go back to the live price' : ''} />
                      </div>
                    </td>
                    <td className="mono">{fmtMoney(s.value)}</td>
                    <td className={`mono ${cls}`}>{fmtMoney(s.gain, { plus: true })}</td>
                    <td className={`mono ${cls}`}>{fmtPct(s.gainPct)}</td>
                    <td>
                      <div className="rowbtns">
                        {allSections.length > 1 && (
                          <select className="cell" style={{ minWidth: 40, width: 40, textAlign: 'center' }} value="" onChange={(e) => e.target.value && actions.moveHolding(section.id, h.id, e.target.value)} title="Move to another section" aria-label="Move to section">
                            <option value="">⇄</option>
                            {allSections.filter((x) => x.id !== section.id).map((x) => <option key={x.id} value={x.id}>→ {x.name}</option>)}
                          </select>
                        )}
                        <button className="btn sm icon ghost danger" onClick={() => actions.deleteHolding(section.id, h.id)} aria-label="Delete row" title="Delete row">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td className="l" colSpan={5}>Section total</td>
                  <td className="mono">{fmtMoney(sectionTotals(rows).invested)}</td>
                  <td></td>
                  <td className="mono">{fmtMoney(sectionTotals(rows).value)}</td>
                  <td className={`mono ${sectionTotals(rows).gain >= 0 ? 'gain' : 'loss'}`}>{fmtMoney(sectionTotals(rows).gain, { plus: true })}</td>
                  <td className={`mono ${sectionTotals(rows).gain >= 0 ? 'gain' : 'loss'}`}>{fmtPct(sectionTotals(rows).invested ? (sectionTotals(rows).gain / sectionTotals(rows).invested) * 100 : 0)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div></>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => actions.addHolding(section.id)}>+ Add row</button>
      </div>
    </div>
  );
}
