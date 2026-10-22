import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'
import { useClasses } from './useClasses'
import {
  CLASS_SUBJECTS_CHANGED,
  getClassSubjects,
  hydrateClassSubjectsFromClasses,
  listClassSubjects,
  loadClassSubjectsMap,
  saveClassSubjects,
  type ClassSubjectsMap,
} from '../classSubjects'
import { listClassPeriodOverrides, saveClassPeriodOverride, type ClassPeriodOverrideMap } from '../classPeriodOverrides'
import { queryKeys } from '../queryKeys'

/** In-memory class→subject map. Hydrates from GET /classes.subjects when present. */
export function useClassSubjectsMap(): ClassSubjectsMap {
  const classesQ = useClasses()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (classesQ.data?.length) hydrateClassSubjectsFromClasses(classesQ.data)
  }, [classesQ.data])

  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    window.addEventListener(CLASS_SUBJECTS_CHANGED, bump)
    return () => {
      window.removeEventListener(CLASS_SUBJECTS_CHANGED, bump)
    }
  }, [])

  return useMemo(
    () => loadClassSubjectsMap(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, classesQ.dataUpdatedAt, classesQ.data],
  )
}

/** Mapped subjects for one class (id preferred). Empty when not mapped. */
export function useClassSubjects(classId: string | null | undefined, className = ''): string[] {
  const map = useClassSubjectsMap()
  const id = (classId ?? '').trim()
  const name = className.trim()
  return useMemo(() => {
    if (id && map[id]?.length) return map[id]
    if (name && map[name]?.length) return map[name]
    return getClassSubjects(id || null, name)
  }, [map, id, name])
}

export function useListClassSubjects(classId: string | null): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.classes.subjects(classId ?? ''),
    queryFn: () => listClassSubjects(classId!),
    enabled: !!classId,
    staleTime: 30_000,
  })
}

export function useSaveClassSubjects(): UseMutationResult<
  string[],
  Error,
  { classId: string; className: string; subjects: string[] }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ classId, className, subjects }) => saveClassSubjects(classId, className, subjects),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.classes.subjects(vars.classId) })
      void qc.invalidateQueries({ queryKey: queryKeys.classes.all })
    },
  })
}

export function useClassPeriodOverrides(): UseQueryResult<ClassPeriodOverrideMap> {
  return useQuery({
    queryKey: queryKeys.classes.periodOverrides(),
    queryFn: listClassPeriodOverrides,
  })
}

export function useSaveClassPeriodOverride(): UseMutationResult<void, Error, { classId: string; periodCount: number | null }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ classId, periodCount }) => saveClassPeriodOverride(classId, periodCount),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.classes.periodOverrides() })
    },
  })
}
