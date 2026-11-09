import { useEffect, useMemo, useState } from 'react';
import { fmtMoney } from '../lib/math.js';

export function Tip({ text }) {
  return <span className="tip" tabIndex={0} data-tip={text} aria-label={text}>?</span>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 980 } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast" role="status">{msg}</div>;
}

export function Money({ n, plus, className = '' }) {
  const cls = n > 0 ? 'gain' : n < 0 ? 'loss' : '';
  return <span className={`mono ${plus ? cls : ''} ${className}`}>{fmtMoney(n, { plus })}</span>;
}

/** Two-line SVG chart: invested vs value. Responsive via viewBox. */
export function LineChart({ points, height = 220 }) {
  const [hover, setHover] = useState(null);
  const W = 800, H = height, padL = 8, padR = 8, padT = 12, padB = 26;
  const geo = useMemo(() => {
    if (!points || points.length < 1) return null;
    const vals = points.flatMap((p) => [p.invested, p.value]);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
    const pad = (max - min) * 0.08; min -= pad; max += pad; if (min < 0) min = 0;
    const n = points.length;
    const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const area = `${path('value')} L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    const ticks = [0, 0.5, 1].map((f) => ({ v: min + (max - min) * f, y: y(min + (max - min) * f) }));
    const labels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => ({ x: x(i), t: points[i].date }));
    return { x, y, path, area, ticks, labels, n };
  }, [points, H]);

  if (!geo) return <div className="muted small center" style={{ padding: 30 }}>Add a holding to see your growth chart.</div>;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX ?? (e.touches && e.touches[0].clientX)) - rect.left) / rect.width * W;
    const i = Math.max(0, Math.min(geo.n - 1, Math.round(((px - padL) / (W - padL - padR)) * (geo.n - 1))));
    setHover(i);
  };
  const h = hover != null ? points[hover] : points[points.length - 1];
  const gain = h.value - h.invested;

  return (
    <div>
      <div className="legend" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="legend"><span className="inv">Invested</span><span className="val">Value</span></div>
        <div className="small mono"><span className="muted">{h.date}</span>&nbsp; {fmtMoney(h.value)} <span className={gain >= 0 ? 'gain' : 'loss'}>({fmtMoney(gain, { plus: true })})</span></div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}
        onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)}>
        <defs>
          <linearGradient id="valfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--line-value)" stopOpacity=".25" />
            <stop offset="1" stopColor="var(--line-value)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={t.y} y2={t.y} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={W - padR} y={t.y - 4} fontSize="11" textAnchor="end" fill="var(--muted)">{fmtMoney(t.v)}</text>
          </g>
        ))}
        <path d={geo.area} fill="url(#valfill)" />
        <path d={geo.path('invested')} fill="none" stroke="var(--line-invested)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <path d={geo.path('value')} fill="none" stroke="var(--line-value)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={padT} y2={H - padB} stroke="var(--muted)" />
            <circle cx={geo.x(hover)} cy={geo.y(points[hover].value)} r="4" fill="var(--line-value)" />
            <circle cx={geo.x(hover)} cy={geo.y(points[hover].invested)} r="4" fill="var(--line-invested)" />
          </g>
        )}
        {geo.labels.map((l, i) => (
          <text key={i} x={l.x} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === geo.labels.length - 1 ? 'end' : 'middle'}>{l.t}</text>
        ))}
      </svg>
    </div>
  );
}

const PALETTE = ['#3b5bdb', '#2bb673', '#f2994a', '#9b59b6', '#e05a7a', '#17a2b8', '#b7791f', '#6c757d'];

/** Horizontal bar breakdown of sections by % of portfolio. */
export function Breakdown({ items }) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  if (!total) return null;
  return (
    <div>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--surface-2)' }} aria-hidden="true">
        {items.map((it, i) => (
          <div key={it.id} style={{ width: `${(Math.max(0, it.value) / total) * 100}%`, background: PALETTE[i % PALETTE.length] }} title={`${it.name}: ${((it.value / total) * 100).toFixed(1)}%`} />
        ))}
      </div>
      <div className="keys">
        {items.map((it, i) => (
          <span key={it.id}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />{it.name}&nbsp;<span className="muted mono">{((Math.max(0, it.value) / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Simple single-line growth chart for the planner. */
export function GrowthChart({ rows }) {
  if (!rows || rows.length < 2) return null;
  const W = 800, H = 200, padL = 8, padR = 8, padT = 12, padB = 24;
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.contributed))) * 1.05 || 1;
  const x = (i) => padL + (i / (rows.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const path = (k) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="legend"><span className="inv">Contributed</span><span className="val">Value</span></div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {[0, 0.5, 1].map((f) => <text key={f} x={W - padR} y={y(max * f) + (f === 1 ? 12 : -4)} fontSize="11" textAnchor="end" fill="var(--muted)">{fmtMoney(max * f)}</text>)}
        <path d={path('contributed')} fill="none" stroke="var(--line-invested)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <path d={path('value')} fill="none" stroke="var(--line-value)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <text x={padL} y={H - 6} fontSize="11" fill="var(--muted)">Month 0</text>
        <text x={W - padR} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">Month {rows.length - 1}</text>
      </svg>
    </div>
  );
}
