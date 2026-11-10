export type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom'

export function localIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const mondayOffset = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - mondayOffset)
  return copy
}

export function rangeForPreset(preset: ReportPreset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = localIso(today)
  if (preset === 'today' || preset === 'custom') return { from: to, to }
  if (preset === 'yesterday') {
    const y = new Date(today)
    y.setDate(y.getDate() - 1)
    const iso = localIso(y)
    return { from: iso, to: iso }
  }
  if (preset === 'week') return { from: localIso(startOfWeek(today)), to }
  if (preset === 'month') return { from: localIso(new Date(today.getFullYear(), today.getMonth(), 1)), to }
  if (preset === 'lastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 0)
    return { from: localIso(start), to: localIso(end) }
  }
  return { from: localIso(new Date(today.getFullYear(), 0, 1)), to }
}
