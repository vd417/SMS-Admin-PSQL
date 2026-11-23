/* ============================================================
   SchoolMate — Lightweight SVG charts. Ported from charts.jsx.
   Uses useId() for stable gradient ids (SSR/test safe).
   ============================================================ */
import { useId, type ReactNode, type CSSProperties } from 'react'

export interface Segment { value: number; color: string; label?: string }
export interface Series { data: number[]; color: string; label?: string }
export type BarDatum = number | { value: number; label?: string; color?: string; valueLabel?: ReactNode; empty?: boolean }

/* ---------- Sparkline ---------- */
export function Spark({ data, w = 120, h = 34, color = 'var(--brand-600)', fill = true, strokeW = 2 }: {
  data: number[]; w?: number; h?: number; color?: string; fill?: boolean; strokeW?: number
}) {
  const max = Math.max(...data), min = Math.min(...data), rng = (max - min) || 1
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - 4 - ((d - min) / rng) * (h - 8)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = line + ` L${w} ${h} L0 ${h} Z`
  const id = useId().replace(/:/g, '')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  )
}

/* ---------- Donut ---------- */
export function Donut({ segments, size = 120, thickness = 16, gap = 2, center }: {
  segments: Segment[]; size?: number; thickness?: number; gap?: number; center?: ReactNode
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  const r = (size - thickness) / 2, c = 2 * Math.PI * r
  let off = 0
  return (
    <div style={{ position: 'relative', width: size, maxWidth: '100%', aspectRatio: '1', flex: '0 1 auto' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c
          const dash = `${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
            strokeDasharray={dash} strokeDashoffset={-off} strokeLinecap="round" />
          off += len
          return el
        })}
      </svg>
      {center && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{center}</div>}
    </div>
  )
}

/* ---------- Bars ---------- */
export function Bars({ data, h = 140, color = 'var(--brand-600)', labels, valueFmt, onBarClick, activeIndex }: {
  data: BarDatum[]; h?: number; color?: string; labels?: string[]; valueFmt?: (v: number) => ReactNode
  onBarClick?: (index: number) => void; activeIndex?: number
}) {
  const max = Math.max(...data.map((d) => (typeof d === 'object' ? d.value : d))) || 1
  const clickable = typeof onBarClick === 'function'
  return (
    <div className="sm-bars" style={{ height: h }}>
      {data.map((d, i) => {
        const v = typeof d === 'object' ? d.value : d
        const lab = typeof d === 'object' ? d.label : (labels && labels[i])
        const cl = typeof d === 'object' ? d.color : undefined
        const isEmpty = typeof d === 'object' && d.empty === true
        const valNode = (typeof d === 'object' && d.valueLabel != null) ? d.valueLabel : (valueFmt ? valueFmt(v) : v)
        const active = activeIndex === i
        const colStyle: CSSProperties = {
          ...(clickable ? { cursor: 'pointer' } : {}),
          ...(active
            ? {
                background: 'color-mix(in srgb, var(--brand-600) 14%, transparent)',
                borderRadius: 10,
                boxShadow: 'inset 0 0 0 1.5px var(--brand-600)',
              }
            : {}),
          transition: 'background .15s ease',
        }
        return (
          <div
            key={i}
            className={['sm-bar-col', clickable && 'is-clickable', active && 'is-active'].filter(Boolean).join(' ')}
            style={colStyle}
            onClick={clickable ? () => onBarClick!(i) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBarClick!(i) } } : undefined}
            title={clickable && typeof lab === 'string' ? lab : undefined}
          >
            <div className="sm-bar-val" style={active ? { color: 'var(--brand-600)' } : undefined}>{valNode}</div>
            {isEmpty ? (
              <div
                className="sm-bar-track"
                style={{
                  height: '100%',
                  background: 'repeating-linear-gradient(45deg, var(--surface-3) 0, var(--surface-3) 6px, var(--surface-2) 6px, var(--surface-2) 12px)',
                  border: active ? '1.5px dashed var(--brand-600)' : '1.5px dashed var(--text-3)',
                }}
              />
            ) : (
              <div className="sm-bar-track" style={{ height: '100%' }}>
                <div className="sm-bar-fill" style={{ height: `${(v / max) * 100}%`, background: cl || color }} />
              </div>
            )}
            <div className="sm-bar-lab" style={active ? { color: 'var(--brand-600)', fontWeight: 700 } : undefined}>{lab}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Horizontal bars (ranked comparison) ---------- */
export function HBars({ data, color = 'var(--brand-600)', labelWidth = 168, valueFmt }: {
  data: BarDatum[]; color?: string; labelWidth?: number; valueFmt?: (v: number) => ReactNode
}) {
  const max = Math.max(...data.map((d) => (typeof d === 'object' ? d.value : d))) || 1
  return (
    <div className="sm-hbars" style={{ ['--hbar-lab-w' as string]: `${labelWidth}px` }}>
      {data.map((d, i) => {
        const v = typeof d === 'object' ? d.value : d
        const lab = typeof d === 'object' ? d.label : undefined
        const cl = typeof d === 'object' ? d.color : undefined
        return (
          <div key={i} className="sm-hbar-row">
            <div className="sm-hbar-lab" title={typeof lab === 'string' ? lab : undefined}>{lab}</div>
            <div className="sm-hbar-track">
              <div className="sm-hbar-fill" style={{ width: `${(v / max) * 100}%`, background: cl || color }} />
            </div>
            <div className="sm-hbar-val">{valueFmt ? valueFmt(v) : v}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Line chart (multi-series) ---------- */
export function LineChart({ series, w = 560, h = 200, labels, yMax, yFmt }: {
  series: Series[]; w?: number; h?: number; labels: string[]; yMax?: number; yFmt?: (v: number) => ReactNode
}) {
  const pad = { l: 38, r: 12, t: 12, b: 26 }
  const allVals = series.flatMap((s) => s.data)
  const max = yMax || Math.max(...allVals) * 1.1
  const min = 0
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b
  const x = (i: number) => pad.l + (i / (labels.length - 1)) * iw
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih
  const grid = 4
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {Array.from({ length: grid + 1 }).map((_, i) => {
        const gy = pad.t + (i / grid) * ih
        const gv = max - (i / grid) * (max - min)
        return (
          <g key={i}>
            <line x1={pad.l} y1={gy} x2={w - pad.r} y2={gy} stroke="var(--border)" strokeWidth="1" strokeDasharray={i === grid ? '0' : '3 3'} />
            <text x={pad.l - 8} y={gy + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">{yFmt ? yFmt(gv) : Math.round(gv)}</text>
          </g>
        )
      })}
      {labels.map((l, i) => i % Math.ceil(labels.length / 7) === 0 && (
        <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--text-3)">{l}</text>
      ))}
      {series.map((s, si) => {
        const line = s.data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d).toFixed(1)).join(' ')
        return (
          <g key={si}>
            <path d={line} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            {s.data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d)} r="2.4" fill="var(--surface)" stroke={s.color} strokeWidth="1.6" />)}
          </g>
        )
      })}
    </svg>
  )
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="row gap16 wrap">
      {items.map((it, i) => (
        <div key={i} className="row ai-center gap6">
          <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color }} />
          <span className="t-sm muted">{it.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Radial gauge (semicircle) ---------- */
export function Gauge({ value, max = 100, size = 200, thickness = 18, color = 'var(--brand-600)', label, sub }: {
  value: number; max?: number; size?: number; thickness?: number; color?: string; label?: ReactNode; sub?: ReactNode
}) {
  const pct = Math.min(1, value / max)
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const id = useId().replace(/:/g, '')
  const pt = (frac: number): [number, number] => { const a = Math.PI * (1 - frac); return [cx + r * Math.cos(a), cy - r * Math.sin(a)] }
  const [sx, sy] = pt(0), [ex, ey] = pt(1), [vx, vy] = pt(pct)
  const large = pct > 0.5 ? 1 : 0
  return (
    <div style={{ position: 'relative', width: size, height: size / 2 + 10 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={color} stopOpacity=".6" /><stop offset="1" stopColor={color} /></linearGradient></defs>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${vx} ${vy}`} fill="none" stroke={`url(#${id})`} strokeWidth={thickness} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, top: size * 0.16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: size * 0.18, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{label}</div>
        {sub && <div className="t-xs muted" style={{ marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  )
}
