import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { listSchoolUsers, listParentLogins, fromApiRole, leadershipRoleLabel, type SchoolUserDto } from '../users'
import { queryKeys } from '../queryKeys'

/** CRM login accounts for this school — owner/admin/principal/vice_principal, plus any
 *  teacher/staff/parent rows the identity API also surfaces. */
export function useSchoolUsers(): UseQueryResult<SchoolUserDto[]> {
  return useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => listSchoolUsers(),
    staleTime: 30_000,
  })
}

/** Lowercased email → leadership role label, for anyone in this school also invited as
 *  owner/admin/principal/vice_principal — so a Teacher or Staff row can show that CRM access
 *  wherever the person is listed (Communication contacts, the Teachers list, etc.) instead of
 *  only in Identity & access. */
export function useLeadershipRoleByEmail(): Map<string, string> {
  const { data } = useSchoolUsers()
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const u of data ?? []) {
      const email = u.email?.trim().toLowerCase()
      if (!email) continue
      const role = fromApiRole(u.roles[0] ?? '')
      if (role !== 'owner' && role !== 'admin' && role !== 'principal') continue
      map.set(email, leadershipRoleLabel(role))
    }
    return map
  }, [data])
}

/** Find the linked login account (if any) for a person by email — used to show and
 *  toggle app access (Suspend/Unsuspend) from a Teacher/Staff profile drawer. */
export function useSchoolUserByEmail(email: string | undefined): SchoolUserDto | undefined {
  const { data } = useSchoolUsers()
  const needle = email?.trim().toLowerCase()
  return useMemo(() => {
    if (!needle) return undefined
    return (data ?? []).find((u) => u.email?.trim().toLowerCase() === needle)
  }, [data, needle])
}

/** Lowercased email → linked login account, for every person in this school — lets a
 *  Teacher/Staff list row show a Suspend/Unsuspend action without a per-row lookup. */
/** Parent app logins, keyed by email, for soft suspend on the Parents list. */
export function useParentLogins(): Map<string, SchoolUserDto> {
  const { data } = useQuery({
    queryKey: [...queryKeys.users.all, 'parents'],
    queryFn: () => listParentLogins(),
    staleTime: 30_000,
  })
  return useMemo(() => {
    const map = new Map<string, SchoolUserDto>()
    for (const u of data ?? []) {
      const email = u.email?.trim().toLowerCase()
      if (email) map.set(email, u)
    }
    return map
  }, [data])
}

export function useAccountByEmail(): Map<string, SchoolUserDto> {
  const { data } = useSchoolUsers()
  return useMemo(() => {
    const map = new Map<string, SchoolUserDto>()
    for (const u of data ?? []) {
      const email = u.email?.trim().toLowerCase()
      if (email) map.set(email, u)
    }
    return map
  }, [data])
}
