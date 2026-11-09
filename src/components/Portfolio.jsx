import { useMemo, useState } from 'react';
import { LineChart, Breakdown, Tip, Modal, Money } from './ui.jsx';
import SectionTable from './SectionTable.jsx';
import ImportModal from './ImportModal.jsx';
import { buildSeries, byYear } from '../lib/history.js';
import { sectionTotals, fmtMoney, fmtPct } from '../lib/math.js';
import { downloadFile, toCSV, todayISO } from '../lib/storage.js';

export default function Portfolio({ state, sections, totals, histories, prices, loadingPrices, actions }) {
  const [range, setRange] = useState('All');
  const [year, setYear] = useState('all');
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreErr, setRestoreErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);

  const series = useMemo(() => buildSeries({ sections, histories, prices, snapshots: state.snapshots, range }), [sections, histories, prices, state.snapshots, range]);
  const years = useMemo(() => Object.keys(byYear(sections)).sort().reverse(), [sections]);
  const yearStats = useMemo(() => byYear(sections), [sections]);
  const hasHoldings = sections.some((s) => (s.holdings || []).length);
  const staleCount = sections.flatMap((s) => s.holdings).filter((h) => h.priceSource === 'stale' || h.priceSource === 'none').length;
  const needsKey = sections.flatMap((s) => s.holdings).some((h) => h.type !== 'crypto') && !state.settings.alphaVantageKey;

  const exportJSON = () => {
    const ok = downloadFile(`portfolio-backup-${todayISO()}.json`, JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2));
    actions.notify(ok ? 'Backup downloaded' : 'Could not download — try another browser');
  };
  const exportCSV = () => { downloadFile(`portfolio-${todayISO()}.csv`, toCSV(state.sections), 'text/csv'); actions.notify('CSV downloaded'); };

  const onRestoreFile = async (file) => {
    setRestoreErr('');
    try {
      const text = await file.text();
      actions.restore(JSON.parse(text));
      setShowRestore(false);
    } catch (e) { setRestoreErr('That file is not a Portfolio Tracker backup (' + (e.message || 'unreadable') + ').'); }
  };

  return (
    <>
      {!hasHoldings ? (
        <div className="card empty">
          <div className="big">🌱</div>
          <h2>Add your first holding</h2>
          <p className="muted">Create a section (like "Long-term" or "Stocks") and type in what you bought — or import a CSV from TradingView or Ledger Live.</p>
          <div className="row">
            <button className="btn primary" onClick={() => actions.addSection('Long-term')}>+ Create a section</button>
            <button className="btn" onClick={() => setShowImport(true)}>📥 Import CSV / PDF</button>
            <button className="btn" onClick={actions.loadSample}>Load sample data</button>
            <button className="btn ghost" onClick={() => setShowRestore(true)}>Restore backup</button>
          </div>
          {state.sections.length > 0 && <p className="small muted" style={{ marginTop: 16 }}>You have {state.sections.length} empty section{state.sections.length > 1 ? 's' : ''} below. Add a row to get started.</p>}
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Growth over time <Tip text="Grey dashed line = total money you put in. Blue line = what it's worth. Built from your purchase dates and daily historical prices; a snapshot is also saved each day you open the app." /></h2>
              <div className="seg" role="tablist" aria-label="Chart range">
                {['1M', '6M', '1Y', 'All'].map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
              </div>
            </div>
            <LineChart points={series.points} />
            {series.approximate && <div className="tiny muted" style={{ marginTop: 6 }}>Some assets have no price history available (stocks need an Alpha Vantage key, and free crypto history covers 1 year), so parts of this line are estimated as a straight line from the price you paid to today's price.</div>}
            <div className="strip" style={{ marginTop: 12 }}>
              <div className="stat"><div className="label">Total invested</div><div className="val mono">{fmtMoney(totals.invested)}</div></div>
              <div className="stat"><div className="label">Current value</div><div className="val mono">{fmtMoney(totals.value)}</div></div>
              <div className="stat"><div className="label">Gain / loss $</div><div className={`val mono ${totals.gain >= 0 ? 'gain' : 'loss'}`}>{fmtMoney(totals.gain, { plus: true })}</div></div>
              <div className="stat"><div className="label">Gain / loss %</div><div className={`val mono ${totals.gain >= 0 ? 'gain' : 'loss'}`}>{fmtPct(totals.gainPct)}</div></div>
            </div>
          </div>

          {(staleCount > 0 || needsKey) && (
            <div className="notice" style={{ marginBottom: 14 }}>
              {needsKey ? <>Stock/ETF prices need a free Alpha Vantage key — add it in <button className="btn sm" onClick={() => setShowSettings(true)}>Settings</button>, or type prices by hand in the "Current price" column. </> : null}
              {staleCount > 0 && !needsKey ? <>{staleCount} price{staleCount > 1 ? 's' : ''} may be out of date (shown with ⚠). You can type a price manually. </> : null}
              <button className="btn sm" onClick={actions.refreshPrices} disabled={loadingPrices}>{loadingPrices ? 'Refreshing…' : 'Retry prices'}</button>
            </div>
          )}
        </>
      )}

      <div className="card tight" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="small muted" style={{ flex: 1, minWidth: 200 }}>💾 Your data lives only in this browser. Export a backup now and then.</span>
        <button className="btn sm primary" onClick={() => setShowImport(true)}>📥 Import CSV / PDF</button>
        <button className="btn sm" onClick={exportJSON}>Export backup</button>
        <button className="btn sm ghost" onClick={exportCSV}>Export CSV</button>
        <button className="btn sm" onClick={() => setShowRestore(true)}>Restore backup</button>
        <button className="btn sm ghost" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        <button className="btn sm ghost" onClick={actions.refreshPrices} disabled={loadingPrices || !hasHoldings} title="Refresh prices">{loadingPrices ? '⏳' : '↻'} Prices</button>
      </div>

      {hasHoldings && (
        <div className="card">
          <div className="card-head">
            <h2>Sections <Tip text="Each section is its own little spreadsheet. The bar shows how much of your whole portfolio each section is." /></h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => setShowImport(true)}>📥 Import CSV / PDF</button>
              <label className="small muted">Year bought:&nbsp;
                <select className="input" style={{ minHeight: 36, width: 'auto', display: 'inline-block', padding: '4px 8px' }} value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="all">All years</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
          </div>
          <Breakdown items={sections.map((s) => ({ id: s.id, name: s.name, value: sectionTotals(s.holdings).value }))} />
          {year !== 'all' && yearStats[year] && (
            <div className="notice info" style={{ marginTop: 10 }}>
              In <b>{year}</b> you bought {yearStats[year].count} holding{yearStats[year].count > 1 ? 's' : ''}, paid <b>{fmtMoney(yearStats[year].invested)}</b>, now worth <b>{fmtMoney(yearStats[year].value)}</b> (<Money n={yearStats[year].gain} plus />, {fmtPct(yearStats[year].invested ? (yearStats[year].gain / yearStats[year].invested) * 100 : 0)}).
            </div>
          )}
          {year === 'all' && years.length > 1 && (
            <details className="disclosure" style={{ marginTop: 8 }}>
              <summary className="small">By year bought</summary>
              <div className="table-wrap"><table className="sheet" style={{ minWidth: 420 }}>
                <thead><tr><th className="l">Year</th><th>Holdings</th><th>Paid</th><th>Worth now</th><th>Gain / loss</th></tr></thead>
                <tbody>{years.map((y) => <tr key={y}><td className="l">{y}</td><td>{yearStats[y].count}</td><td>{fmtMoney(yearStats[y].invested)}</td><td>{fmtMoney(yearStats[y].value)}</td><td><Money n={yearStats[y].gain} plus /> <span className={yearStats[y].gain >= 0 ? 'gain' : 'loss'}>({fmtPct(yearStats[y].invested ? (yearStats[y].gain / yearStats[y].invested) * 100 : 0)})</span></td></tr>)}</tbody>
              </table></div>
            </details>
          )}
        </div>
      )}

      {sections.map((sec, i) => (
        <SectionTable key={sec.id} section={sec} index={i} count={sections.length} total={totals.value} yearFilter={year} actions={actions} allSections={sections} onDelete={() => setConfirmDel(sec)} />
      ))}

      {state.sections.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => actions.addSection()}>+ Add section</button>
          {!hasHoldings && <button className="btn ghost" onClick={actions.loadSample}>Load sample data</button>}
        </div>
      )}

      {showImport && <ImportModal sections={state.sections} actions={actions} onClose={() => setShowImport(false)} />}

      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)} footer={<button className="btn primary" onClick={() => setShowSettings(false)}>Done</button>}>
          <div className="field">
            <label>Alpha Vantage API key (for stocks & ETFs) <Tip text="Free at alphavantage.co — click 'Get your free API key'. The free plan allows about 25 price lookups per day, so prices are cached for 5 minutes." /></label>
            <input className="input" value={state.settings.alphaVantageKey} onChange={(e) => actions.setSettings({ alphaVantageKey: e.target.value.trim() })} placeholder="Paste your key" autoCapitalize="off" autoCorrect="off" />
            <div className="tiny muted">Get one free at <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer">alphavantage.co/support/#api-key</a>. Crypto prices (CoinGecko) need no key.</div>
          </div>
          <div className="field">
            <label>CoinGecko demo key (optional) <Tip text="Not required. A free demo key from coingecko.com raises the rate limit if you track many coins." /></label>
            <input className="input" value={state.settings.coinGeckoKey} onChange={(e) => actions.setSettings({ coinGeckoKey: e.target.value.trim() })} placeholder="Optional" autoCapitalize="off" autoCorrect="off" />
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <div className="small muted" style={{ marginBottom: 8 }}>Keys are stored only in this browser, next to your portfolio data.</div>
          <button className="btn danger" onClick={() => { if (window.confirm('Delete ALL holdings, sections and predictions from this browser? Export a backup first if you want to keep them.')) actions.clearAll(); }}>Clear all data</button>
        </Modal>
      )}

      {showRestore && (
        <Modal title="Restore backup" onClose={() => setShowRestore(false)}>
          <p className="small muted">Choose a backup file you exported earlier (ends in .json). This replaces what's currently in this browser.</p>
          <input className="input" type="file" accept=".json,application/json" onChange={(e) => e.target.files[0] && onRestoreFile(e.target.files[0])} />
          {restoreErr && <div className="notice" style={{ marginTop: 10 }}>{restoreErr}</div>}
        </Modal>
      )}

      {confirmDel && (
        <Modal title={`Delete "${confirmDel.name}"?`} onClose={() => setConfirmDel(null)} footer={<>
          <button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn danger" onClick={() => { actions.deleteSection(confirmDel.id); setConfirmDel(null); }}>Delete section</button>
        </>}>
          <p>This removes the section and its {confirmDel.holdings.length} holding{confirmDel.holdings.length === 1 ? '' : 's'}. You can't undo this (unless you have a backup).</p>
        </Modal>
      )}
    </>
  );
}
