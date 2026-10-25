export interface ErrorBody {
  code: string
  message: string
  details?: Record<string, string[]> | null
}

export interface Envelope<T> { data: T }
export interface ListEnvelope<T> { data: T[]; next_cursor: string | null }

export interface AuthTokens { access_token: string; refresh_token: string }

export type Role = 'admin' | 'principal' | 'vice_principal' | 'teacher'
export interface Me {
  id: string
  tenant_id: string | null
  roles: Role[]
  is_platform: boolean
  /** Real display name from /auth/me — prefer this over the email prefix. */
  name?: string | null
  /** Canonical account email from /auth/me (the login identifier may be a phone). */
  email?: string | null
}
