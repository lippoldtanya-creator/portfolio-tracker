import { useMemo, useState } from 'react';
import { Modal } from './ui.jsx';
import { parseCSV, autoMap, detectSource, rowsToHoldings, FIELDS, extractRowsFromText } from '../lib/importers.js';
import { fmtMoney } from '../lib/math.js';

async function pdfToText(file) {
  // Loaded only when needed, so the main app stays small.
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items into lines by their y position
    const lines = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: it.transform[4], s: it.str });
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of ordered) text += items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ') + '\n';
  }
  return text;
}

export default function ImportModal({ sections, actions, onClose }) {
  const [step, setStep] = useState('pick'); // pick -> map -> preview
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState({ headers: [], rows: [] });
  const [map, setMap] = useState({});
  const [source, setSource] = useState('');
  const [isPdf, setIsPdf] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [target, setTarget] = useState(sections[0] ? sections[0].id : 'new');
  const [newName, setNewName] = useState('Imported');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    setErr(''); setBusy(true); setFileName(file.name);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        setIsPdf(true);
        const text = await pdfToText(file);
        const rows = extractRowsFromText(text);
        if (!rows.length) setErr('Could not find any rows that look like holdings in this PDF. You can still add rows by hand below.');
        setDrafts(rows);
        setSource('PDF (best effort)');
        setStep('preview');
      } else {
        setIsPdf(false);
        const text = await file.text();
        const p = parseCSV(text);
        if (!p.headers.length || !p.rows.length) throw new Error('This file looks empty or is not a CSV.');
        setParsed(p);
        setMap(autoMap(p.headers));
        setSource(detectSource(p.headers));
        setStep('map');
      }
    } catch (e) {
      setErr('Could not read that file: ' + (e.message || 'unknown error'));
    } finally { setBusy(false); }
  };

  const mapped = useMemo(() => (step === 'map' ? rowsToHoldings(parsed.rows, map) : []), [parsed, map, step]);

  const goPreview = () => { setDrafts(mapped); setStep('preview'); };

  const updDraft = (i, patch) => setDrafts((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addDraft = () => setDrafts((d) => [...d, { asset: '', type: 'crypto', dateBought: '', quantity: '', pricePaid: '', amountInvested: '' }]);

  const confirm = () => {
    const clean = drafts.filter((r) => r.asset && Number(r.quantity) > 0).map((r) => ({
      asset: String(r.asset).toUpperCase().trim(), type: r.type || 'crypto', dateBought: r.dateBought || '',
      quantity: Number(r.quantity), pricePaid: r.pricePaid === '' ? '' : Number(r.pricePaid),
      amountInvested: r.amountInvested === '' ? (r.pricePaid === '' ? '' : +(Number(r.pricePaid) * Number(r.quantity)).toFixed(2)) : Number(r.amountInvested),
    }));
    if (!clean.length) { setErr('Nothing to import — each row needs an asset and a quantity.'); return; }
    actions.addHoldings(target === 'new' ? null : target, clean, newName || 'Imported');
    actions.notify(`Imported ${clean.length} holding${clean.length > 1 ? 's' : ''}`);
    onClose();
  };

  const footer = step === 'pick' ? null : step === 'map'
    ? <><button className="btn" onClick={() => setStep('pick')}>Back</button><button className="btn primary" onClick={goPreview} disabled={!mapped.length}>Preview {mapped.length} row{mapped.length === 1 ? '' : 's'} →</button></>
    : <><button className="btn" onClick={() => setStep(isPdf ? 'pick' : 'map')}>Back</button><button className="btn primary" onClick={confirm} disabled={!drafts.length}>Save {drafts.filter((r) => r.asset && Number(r.quantity) > 0).length} to portfolio</button></>;

  return (
    <Modal title="Import holdings" onClose={onClose} footer={footer} wide={step === 'preview'}>
      {step === 'pick' && (
        <>
          <p className="small muted">Upload a CSV export from <b>TradingView</b> (Trading panel → History → Export) or <b>Ledger Live</b> (Accounts → ⋯ → Export operation history). Any CSV with an asset, quantity and price column works. PDF statements are read best-effort.</p>
          <input className="input" type="file" accept=".csv,.txt,.tsv,.pdf,text/csv,application/pdf" onChange={(e) => onFile(e.target.files[0])} disabled={busy} />
          {busy && <p className="small muted">Reading {fileName}…</p>}
          {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
          <div className="notice info" style={{ marginTop: 12 }}>Nothing is saved until you press <b>Save to portfolio</b> on the preview screen.</div>
        </>
      )}

      {step === 'map' && (
        <>
          <p className="small">Detected: <span className="badge accent">{source}</span> &nbsp;<span className="muted">{parsed.rows.length} rows in {fileName}</span></p>
          <p className="small muted">Check that each column is matched correctly. Rows marked as Sell / outgoing are skipped automatically.</p>
          <div className="grid c2">
            {FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}{f.required && ' *'}</label>
                <select className="input" value={map[f.key] ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— not in file —</option>
                  {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <h3 style={{ margin: '10px 0 6px' }}>First rows as they'll be read</h3>
          <div className="table-wrap"><table className="sheet" style={{ minWidth: 560 }}>
            <thead><tr><th className="l">Asset</th><th className="l">Type</th><th className="l">Date</th><th>Qty</th><th>Price</th><th>Invested</th></tr></thead>
            <tbody>{mapped.slice(0, 8).map((r, i) => <tr key={i}><td className="l">{r.asset}</td><td className="l">{r.type}</td><td className="l">{r.dateBought || <span className="muted">—</span>}</td><td>{r.quantity}</td><td>{r.pricePaid === '' ? '—' : fmtMoney(r.pricePaid)}</td><td>{r.amountInvested === '' ? '—' : fmtMoney(r.amountInvested)}</td></tr>)}</tbody>
          </table></div>
          {!mapped.length && <div className="notice" style={{ marginTop: 8 }}>No usable rows yet — make sure Asset and Quantity are matched to the right columns.</div>}
        </>
      )}

      {step === 'preview' && (
        <>
          {isPdf && <div className="notice" style={{ marginBottom: 10 }}>⚠ PDF reading can be imperfect. Please check every row below — fix anything wrong, delete junk rows, and add missing ones.</div>}
          {err && <div className="notice" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="field">
            <label>Put these holdings in section</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ flex: 1, minWidth: 180 }} value={target} onChange={(e) => setTarget(e.target.value)}>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="new">+ New section…</option>
              </select>
              {target === 'new' && <input className="input" style={{ flex: 1, minWidth: 160 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Section name" />}
            </div>
          </div>
          <div className="table-wrap"><table className="sheet" style={{ minWidth: 700 }}>
            <thead><tr><th className="l">Asset</th><th className="l">Type</th><th className="l">Date bought</th><th>Quantity</th><th>Price paid</th><th>Invested</th><th></th></tr></thead>
            <tbody>
              {drafts.map((r, i) => (
                <tr key={i}>
                  <td className="l"><input className="cell l asset" value={r.asset} onChange={(e) => updDraft(i, { asset: e.target.value.toUpperCase() })} /></td>
                  <td className="l"><select className="cell l" value={r.type} onChange={(e) => updDraft(i, { type: e.target.value })}><option value="crypto">Crypto</option><option value="stock">Stock</option><option value="etf">ETF</option></select></td>
                  <td className="l"><input className="cell l date" type="date" value={r.dateBought} onChange={(e) => updDraft(i, { dateBought: e.target.value })} /></td>
                  <td><input className="cell" inputMode="decimal" value={r.quantity} onChange={(e) => updDraft(i, { quantity: e.target.value })} /></td>
                  <td><input className="cell" inputMode="decimal" value={r.pricePaid} onChange={(e) => updDraft(i, { pricePaid: e.target.value })} /></td>
                  <td><input className="cell" inputMode="decimal" value={r.amountInvested} onChange={(e) => updDraft(i, { amountInvested: e.target.value })} /></td>
                  <td><button className="btn sm icon ghost danger" onClick={() => setDrafts((d) => d.filter((_, j) => j !== i))} aria-label="Remove row">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={addDraft}>+ Add a row</button>
        </>
      )}
    </Modal>
  );
}
