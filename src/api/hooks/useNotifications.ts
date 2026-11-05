import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'
import { listNotifications, createNotification, markNotificationsRead, type CreateNotificationInput } from '../notifications'
import { queryKeys } from '../queryKeys'
import type { AppNotification } from '@/types'

export function useNotifications(): UseQueryResult<AppNotification[]> {
  return useQuery({
    queryKey: queryKeys.notifications.all,
    queryFn: () => listNotifications(),
  })
}

export function useCreateNotification(): UseMutationResult<AppNotification, Error, CreateNotificationInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNotificationInput) => createNotification(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.notifications.all }) },
  })
}

export function useMarkNotificationsRead(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.notifications.all }) },
  })
}
