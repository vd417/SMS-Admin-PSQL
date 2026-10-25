import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'
import { listClasses, createClass, updateClass, deleteClass, ensureDefaultClasses, type SchoolClass, type UpdateClassPatch } from '../classes'
import { queryKeys } from '../queryKeys'
import { mergeClassNames } from '@/lib/defaultClasses'

export function useClasses(): UseQueryResult<SchoolClass[]> {
  return useQuery({ queryKey: queryKeys.classes.all, queryFn: () => listClasses(), staleTime: 60_000 })
}

/** Live class names from API only (empty until classes are added or seeded). */
export function useClassNames(): string[] {
  const { data } = useClasses()
  return useMemo(() => {
    const live = (data ?? [])
      .map((c) => (c.name || `${c.grade}-${c.section}`).trim())
      .filter((n) => n && n !== '-')
    return [...new Set(live)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  }, [data])
}

/** Defaults + live (for pickers that still want Nursery–XII suggestions). */
export function useMergedClassNames(): string[] {
  const { data } = useClasses()
  return useMemo(() => mergeClassNames(data), [data])
}

export function useCreateClass(): UseMutationResult<SchoolClass, Error, SchoolClass> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: SchoolClass) => createClass(c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.classes.all }) },
  })
}

export function useUpdateClass(): UseMutationResult<SchoolClass, Error, { id: string; patch: UpdateClassPatch }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }) => updateClass(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.classes.all }) },
  })
}

export function useDeleteClass(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteClass(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.classes.all }) },
  })
}

/** Seed chosen default classes (defaults to Nursery–XII · A/B/C); skips any that exist. */
export interface EnsureDefaultClassesVars {
  existing?: SchoolClass[]
  grades?: readonly string[]
  sections?: readonly string[]
}
export function useEnsureDefaultClasses(): UseMutationResult<number, Error, EnsureDefaultClassesVars | undefined> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars?: EnsureDefaultClassesVars) =>
      ensureDefaultClasses(vars?.existing, { grades: vars?.grades, sections: vars?.sections }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.classes.all }) },
  })
}
