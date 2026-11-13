import type { ReactNode } from 'react'
import { Progress } from '@/components/ui/primitives'

export type AttendanceSpan = 'month' | 'overall'

const attColor = (v: number): string =>
  (v >= 90 ? 'var(--success)' : v >= 80 ? 'var(--brand-600)' : v >= 75 ? 'var(--warning)' : 'var(--danger)')

function roundPct(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.round(v)
}

/** Column header: Month is selected until Overall is clicked. */
export function AttendanceSpanLabel({
  mode,
  onChange,
}: {
  mode: AttendanceSpan
  onChange: (mode: AttendanceSpan) => void
}): ReactNode {
  const btn = (span: AttendanceSpan, label: string) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(span) }}
      className={mode === span ? 'fw7' : 'muted3'}
      style={{
        border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
        color: mode === span ? 'var(--brand-700)' : undefined,
        font: 'inherit',
      }}
    >
      {label}
    </button>
  )
  return (
    <span className="col" style={{ gap: 1, alignItems: 'flex-start' }}>
      <span>Attendance</span>
      <span className="row ai-center gap4 t-xs" onClick={(e) => e.stopPropagation()}>
        {btn('month', 'Month')}
        <span className="muted3">/</span>
        {btn('overall', 'Overall')}
      </span>
    </span>
  )
}

/** Bar follows the selected span. The other percent stays on the line under it. */
export function AttendanceSpanCell({
  month,
  overall,
  mode,
  onChange,
}: {
  month: number | null
  overall: number | null
  mode: AttendanceSpan
  onChange?: (mode: AttendanceSpan) => void
}) {
  const primary = roundPct(mode === 'month' ? month : overall)
  const secondary = roundPct(mode === 'month' ? overall : month)
  const secondarySpan: AttendanceSpan = mode === 'month' ? 'overall' : 'month'
  const secondaryLabel = mode === 'month' ? 'Overall' : 'Month'
  if (primary == null && secondary == null) return <span className="t-sm muted3">Not marked</span>
  return (
    <div style={{ minWidth: 128 }}>
      {primary == null
        ? <span className="t-sm muted3">Not marked</span>
        : (
          <div className="row ai-center gap8">
            <div style={{ flex: 1 }}><Progress value={primary} color={attColor(primary)} /></div>
            <span className="t-sm fw6" style={{ width: 34 }}>{primary}%</span>
          </div>
        )}
      <button
        type="button"
        className="t-xs muted3"
        style={{ border: 'none', background: 'transparent', padding: 0, cursor: onChange ? 'pointer' : 'default', font: 'inherit' }}
        onClick={onChange ? (e) => { e.stopPropagation(); onChange(secondarySpan) } : undefined}
      >
        {secondary == null ? `${secondaryLabel} —` : `${secondaryLabel} ${secondary}%`}
      </button>
    </div>
  )
}
