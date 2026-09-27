import {
  useQuery, useMutation, useQueryClient,
  type UseQueryResult, type UseMutationResult,
} from '@tanstack/react-query'
import {
  listPtm, createPtm, deletePtm,
  type PtmItem, type PtmFilters, type CreatePtmInput,
} from '../ptm'
import { queryKeys } from '../queryKeys'

export function usePtm(filters: PtmFilters = {}): UseQueryResult<PtmItem[]> {
  return useQuery({ queryKey: queryKeys.ptm.list(filters), queryFn: () => listPtm(filters) })
}

export function useCreatePtm(): UseMutationResult<PtmItem, Error, CreatePtmInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePtmInput) => createPtm(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.ptm.all }) },
  })
}

export function useDeletePtm(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePtm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.ptm.all }) },
  })
}
