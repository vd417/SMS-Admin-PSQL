import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentMonthAttendancePct } from '@/api/studentAttendance'

function monthToDate(): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` }
}

/** This month's period attendance % for the students on the list. Keys are lowercase ids. */
export function useStudentMonthAttendance(ids: string[]) {
  const span = useMemo(() => monthToDate(), [])
  const idKey = ids.slice().sort().join(',')
  const q = useQuery({
    queryKey: ['student-month-attendance', span.from, span.to, idKey],
    queryFn: () => studentMonthAttendancePct(ids, span.from, span.to),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
  return q.data ?? new Map<string, number>()
}
