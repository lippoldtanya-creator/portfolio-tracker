import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { load, save, emptyState, sampleState, todayISO, uid } from './lib/storage.js';
import { fetchPrices, fetchHistory, assetKey } from './lib/prices.js';
import { portfolioTotals } from './lib/math.js';
import Portfolio from './components/Portfolio.jsx';
import Planner from './components/Planner.jsx';
import { Toast } from './components/ui.jsx';

function useHashRoute() {
  const get = () => (window.location.hash.replace('#', '') === 'planner' ? 'planner' : 'portfolio');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { window.location.hash = r === 'planner' ? 'planner' : ''; window.scrollTo(0, 0); }];
}

export default function App() {
  const [state, setState] = useState(() => {
    const s = load();
    return s ? { ...emptyState(), ...s, settings: { ...emptyState().settings, ...(s.settings || {}) } } : emptyState();
  });
  const [route, go] = useHashRoute();
  const [toast, setToast] = useState('');
  const [prices, setPrices] = useState({});      // { key: {price, at, stale} }
  const [histories, setHistories] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const toastTimer = useRef();

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  // Persist on every change
  useEffect(() => { save(state); }, [state]);

  // Theme
  const theme = state.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const update = useCallback((fn) => setState((s) => fn(typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)))), []);

  const allHoldings = useMemo(() => state.sections.flatMap((s) => s.holdings || []), [state.sections]);

  // Merge live prices into holdings for math: currentPrice = manual override ?? live ?? last known
  const sectionsWithPrices = useMemo(() => state.sections.map((s) => ({
    ...s,
    holdings: (s.holdings || []).map((h) => {
      const key = assetKey(h.asset, h.type);
      const live = prices[key];
      const last = state.lastPrices[key];
      const manual = h.manualPrice !== '' && h.manualPrice != null ? Number(h.manualPrice) : null;
      const price = manual ?? (live && live.price) ?? (last && last.price) ?? null;
      return {
        ...h,
        currentPrice: price,
        priceSource: manual != null ? 'manual' : live ? 'live' : last ? 'stale' : 'none',
        priceAt: live ? live.at : last ? last.at : null,
      };
    }),
  })), [state.sections, prices, state.lastPrices]);

  const totals = useMemo(() => portfolioTotals(sectionsWithPrices), [sectionsWithPrices]);

  const refreshPrices = useCallback(async (force = false) => {
    if (!allHoldings.length) return;
    setLoadingPrices(true);
    try {
      const got = await fetchPrices(allHoldings, state.settings, { force });
      setPrices((p) => ({ ...p, ...got }));
      if (Object.keys(got).length) {
        update((s) => { for (const k of Object.keys(got)) s.lastPrices[k] = { price: got[k].price, at: got[k].at }; return s; });
      }
      // Histories (cached 12h; only fetch what we don't have yet)
      const uniq = {};
      for (const h of allHoldings) uniq[assetKey(h.asset, h.type)] = h;
      const missing = Object.keys(uniq).filter((k) => !(k in histories));
      if (missing.length) {
        const results = await Promise.all(missing.map((k) => fetchHistory(uniq[k].asset, uniq[k].type, state.settings)));
        setHistories((hs) => { const n = { ...hs }; missing.forEach((k, i) => { n[k] = results[i]; }); return n; });
      }
    } catch { /* never crash on prices */ } finally { setLoadingPrices(false); }
  }, [allHoldings, state.settings, histories, update]);

  // Fetch on load / when holdings change (debounced)
  const sig = allHoldings.map((h) => `${h.type}:${String(h.asset).toUpperCase()}`).sort().join('|') + '|' + state.settings.alphaVantageKey + '|' + state.settings.coinGeckoKey;
  useEffect(() => {
    const t = setTimeout(() => refreshPrices(false), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Daily snapshot once prices are in
  useEffect(() => {
    if (!allHoldings.length) return;
    const d = todayISO();
    const haveLive = Object.keys(prices).length > 0;
    if (!haveLive) return;
    update((s) => { s.snapshots[d] = { value: totals.value, invested: totals.invested }; return s; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.value, totals.invested]);

  const actions = {
    notify,
    toggleTheme: () => update((s) => { s.theme = theme === 'dark' ? 'light' : 'dark'; return s; }),
    loadSample: () => { const sm = sampleState(); update((s) => ({ ...s, sections: sm.sections })); notify('Sample data loaded'); },
    addSection: (name = 'New section') => update((s) => { s.sections.push({ id: uid(), name, holdings: [] }); return s; }),
    renameSection: (id, name) => update((s) => { const sec = s.sections.find((x) => x.id === id); if (sec) sec.name = name; return s; }),
    deleteSection: (id) => update((s) => { s.sections = s.sections.filter((x) => x.id !== id); return s; }),
    moveSection: (id, dir) => update((s) => {
      const i = s.sections.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= s.sections.length) return s;
      [s.sections[i], s.sections[j]] = [s.sections[j], s.sections[i]]; return s;
    }),
    addHolding: (sectionId, h = {}) => update((s) => {
      const sec = s.sections.find((x) => x.id === sectionId);
      if (sec) sec.holdings.push({ id: uid(), asset: '', type: 'crypto', dateBought: todayISO(), quantity: '', pricePaid: '', amountInvested: '', manualPrice: '', ...h });
      return s;
    }),
    addHoldings: (sectionId, list, newName = 'Imported') => update((s) => {
      let sec = sectionId ? s.sections.find((x) => x.id === sectionId) : null;
      if (!sec) { sec = { id: uid(), name: newName, holdings: [] }; s.sections.push(sec); }
      for (const h of list) sec.holdings.push({ id: uid(), manualPrice: '', ...h });
      return s;
    }),
    updateHolding: (sectionId, hid, patch) => update((s) => {
      const sec = s.sections.find((x) => x.id === sectionId); const h = sec && sec.holdings.find((x) => x.id === hid);
      if (!h) return s;
      Object.assign(h, patch);
      // keep amount invested in sync when qty/price change and amount wasn't hand-edited
      if (('quantity' in patch || 'pricePaid' in patch) && !h.amountLocked) {
        const q = Number(h.quantity), p = Number(h.pricePaid);
        h.amountInvested = Number.isFinite(q) && Number.isFinite(p) && h.quantity !== '' && h.pricePaid !== '' ? +(q * p).toFixed(2) : h.amountInvested;
      }
      if ('amountInvested' in patch) h.amountLocked = patch.amountInvested !== '';
      return s;
    }),
    deleteHolding: (sectionId, hid) => update((s) => { const sec = s.sections.find((x) => x.id === sectionId); if (sec) sec.holdings = sec.holdings.filter((x) => x.id !== hid); return s; }),
    moveHolding: (fromId, hid, toId) => update((s) => {
      const from = s.sections.find((x) => x.id === fromId), to = s.sections.find((x) => x.id === toId);
      if (!from || !to) return s; const i = from.holdings.findIndex((x) => x.id === hid); if (i < 0) return s;
      to.holdings.push(from.holdings.splice(i, 1)[0]); return s;
    }),
    setSettings: (patch) => update((s) => { s.settings = { ...s.settings, ...patch }; return s; }),
    restore: (data) => {
      if (!data || !Array.isArray(data.sections)) throw new Error('Not a Portfolio Tracker backup');
      update((s) => ({ ...s, ...data, settings: { ...s.settings, ...(data.settings || {}) } }));
      notify('Backup restored');
    },
    clearAll: () => { update(() => emptyState()); setPrices({}); notify('All data cleared'); },
    savePrediction: (p) => update((s) => { const i = s.predictions.findIndex((x) => x.id === p.id); if (i >= 0) s.predictions[i] = p; else s.predictions.push({ ...p, id: p.id || uid() }); return s; }),
    deletePrediction: (id) => update((s) => { s.predictions = s.predictions.filter((x) => x.id !== id); return s; }),
    refreshPrices: () => refreshPrices(true),
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('portfolio')} style={{ cursor: 'pointer' }}>
          <div className="logo">P</div>
          <div>
            <h1>Portfolio Tracker</h1>
            <div className="tiny muted">All amounts in USD · data stays in this browser</div>
          </div>
        </div>
        <div className="actions">
          {route === 'portfolio'
            ? <button className="btn primary" onClick={() => go('planner')}>📈 Prediction Planner</button>
            : <button className="btn" onClick={() => go('portfolio')}>← Back to Portfolio</button>}
          <button className="btn icon" onClick={actions.toggleTheme} aria-label="Toggle light / dark mode" title="Light / dark">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>

      {route === 'planner'
        ? <Planner state={state} actions={actions} />
        : <Portfolio state={state} sections={sectionsWithPrices} totals={totals} histories={histories} prices={prices} loadingPrices={loadingPrices} actions={actions} />}

      <p className="footer-note">Estimates only, not financial advice. Prices come from free public sources and can be delayed.</p>
      <Toast msg={toast} />
    </div>
  );
}
