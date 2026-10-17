import type { ListEnvelope } from './types'

export type ClientStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
export type PlanTier = 'trial' | 'silver' | 'gold' | 'platinum' | 'metered' | 'exclusive'
/** Billing cycle as the API expects it. */
export type ApiBillingCycle = 'month' | 'quarter' | 'year'

export interface Client {
  id: string
  name: string
  slug: string
  country: string | null
  status: ClientStatus
  plan_id: string | null
  plan_name: string | null
  tier: string | null
  mrr: number
  students_count: number
  staff_count: number
  storage_gb: number
  created: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  logo_url?: string | null
  image_url?: string | null
  health_score: number
  /** Live active SIS enrolment (distinct from the billed students_count). */
  enrolled_students?: number
  /** Billing cycle the school is on. */
  billing_cycle?: ApiBillingCycle
  /** Billed seat cap + other plan limits. */
  limits?: { students: number | null; staff: number | null; storage_gb: number | null }
  /** Seat-increase mode: 'auto' grows per-student seats on enrolment; 'manual' blocks until raised. */
  seat_increase_mode?: 'auto' | 'manual'
  /** Per-school near-limit warning gap (null = use plan/default). */
  seat_alert_threshold?: number | null
}

/** CATRE updates a school's seat policy. */
export interface SeatSettingsBody {
  seat_increase_mode?: 'auto' | 'manual'
  seat_alert_threshold?: number
}

export interface CreateClientBody {
  name: string
  slug: string
  country?: string
  admin_name?: string
  admin_email?: string
  admin_phone?: string
  plan_id: string
  trial_days: number
  address?: string
  logo_url?: string
  image_url?: string
  csm?: string | null
  /** Exact/expected student count entered at onboarding; drives billing. */
  students_count?: number
  /** Billing cycle chosen at onboarding. Defaults to monthly server-side. */
  billing_cycle?: ApiBillingCycle
}

/** Raise a school's billed seat limit (CATRE team direct action). */
export interface IncreaseSeatsBody {
  seat_limit: number
  reason?: string
}

/** School owner raises a seat-increase request for CATRE to approve. */
export interface RaiseSeatRequestBody {
  requested_seats: number
  note?: string
}

export type SeatRequestStatus = 'pending' | 'approved' | 'rejected'

export interface SeatRequest {
  id: string
  tenant_id: string
  tenant_name: string | null
  current_seats: number
  requested_seats: number
  status: SeatRequestStatus
  note: string | null
  created_at: string
  updated_at: string
}

export interface CreateMySchoolBody {
  name: string
  slug: string
  country?: string
  plan_id: string
  admin_name?: string
  admin_phone?: string
  address?: string
  logo_url?: string
  image_url?: string
  trial_days?: number
  /** Expected student strength entered at onboarding; drives billing. */
  students_count?: number
  /** Billing cycle chosen at onboarding. Defaults to monthly server-side. */
  billing_cycle?: ApiBillingCycle
}

export interface Plan {
  id: string
  name: string
  tier: string
  pricing: string
  price: number
  per_student: number | null
  min_students: number | null
  period: string
  visibility: string
  audience: string
  description: string | null
  color: string | null
  /** Flat-plan bundled seat count. */
  included_students?: number | null
  /** CSV of billing cycles this plan offers, e.g. "month,quarter,year". */
  allowed_cycles?: string | null
  /** Default near-limit warning gap for schools on this plan. */
  seat_alert_threshold?: number | null
  /** Feature slugs included in the plan. */
  features?: string[]
  /** Capacity limits. */
  limits?: { students: number; staff: number; storage_gb: number }
}

export interface DashboardOverview {
  counts: { total: number; active: number; trial: number; suspended: number; cancelled: number }
  mrr: number
  trials_ending: number
  churn_pct: number
  months: string[]
  mrr_series: number[]
  signup_series: number[]
  plan_mix: { label: string; value: number; color: string | null }[]
  usage_alerts: { tenant: string; metric: string; used: number; limit: number; pct: number }[]
  system_health: { name: string; status: string; latency: string; uptime: string }[]
  recent_activity: { actor: string | null; action: string | null; target: string | null; kind: string | null; at: string }[]
}

/** School-wise student fee cash rollup for owner portfolio. */
export interface FeeSchoolSummary {
  tenant_id: string
  name: string
  collected: number
  outstanding: number
  payment_count: number
  invoice_count: number
}

export interface FeeSummaryResponse {
  period: { from: string; to: string }
  schools: FeeSchoolSummary[]
  totals: {
    collected: number
    outstanding: number
    payment_count: number
    invoice_count: number
  }
}

export type { ListEnvelope }
