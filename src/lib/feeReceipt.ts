import { fmtMoney } from '@/lib/format'
import { properName } from '@/lib/properCase'

export interface FeeReceiptData {
  schoolName: string
  schoolCity?: string
  studentName: string
  studentAdm?: string
  cls: string
  amount: number
  currency?: string
  mode: string
  ref?: string
  paidAt: string
  term?: string
  academicYear?: string
  headName?: string
  invoiceId?: string
  /** School logo image URL; when absent the initials badge is used. */
  logoUrl?: string | null
  /** Initials fallback for the logo badge (e.g. "GW"). */
  logoInitials?: string
  /** Brand colour for the letterhead accent. */
  brandColor?: string
}

function resolveBrand(color?: string): string {
  const c = (color || '').trim()
  if (/^#?[0-9a-fA-F]{3,8}$/.test(c)) return c.startsWith('#') ? c : `#${c}`
  return '#4f46e5'
}

function receiptLogo(data: FeeReceiptData, brand: string): string {
  if (data.logoUrl) {
    return `<img class="logo" src="${esc(data.logoUrl)}" alt="${esc(data.schoolName)} logo" />`
  }
  const initials = esc((data.logoInitials || data.schoolName || '?').slice(0, 3).toUpperCase())
  return `<div class="logo badge" style="background:${brand}">${initials}</div>`
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Printable / attachable fee receipt for parent email + app download. */
export function buildFeeReceiptHtml(data: FeeReceiptData): string {
  const name = properName(data.studentName)
  const school = properName(data.schoolName)
  const amount = fmtMoney(data.amount, data.currency)
  const city = data.schoolCity ? esc(data.schoolCity) : ''
  const brand = resolveBrand(data.brandColor)
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Fee receipt — ${esc(name)}</title>
<style>
  *{box-sizing:border-box}
  body{font:14px/1.45 system-ui,Segoe UI,sans-serif;color:#0f172a;margin:24px;max-width:560px}
  .head{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:3px solid ${brand}}
  .logo{width:52px;height:52px;border-radius:12px;object-fit:cover;flex:0 0 auto}
  .logo.badge{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:19px}
  .head .info{flex:1;min-width:0}
  h1{font-size:20px;margin:0 0 2px;line-height:1.2}
  .muted{color:#64748b;font-size:12px}
  .box{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:16px}
  .row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9}
  .row:last-child{border-bottom:none}
  .amt{font-size:22px;font-weight:800;margin-top:12px}
  .ok{color:#166534;font-weight:700}
</style></head><body>
  <div class="head">
    ${receiptLogo(data, brand)}
    <div class="info">
      <h1>${esc(school)}</h1>
      ${city ? `<div class="muted">${city}</div>` : ''}
    </div>
  </div>
  <div class="ok" style="margin-top:12px">Fee receipt · Paid</div>
  <div class="box">
    <div class="row"><span class="muted">Student</span><strong>${esc(name)}</strong></div>
    ${data.studentAdm ? `<div class="row"><span class="muted">Student ID</span><strong>${esc(data.studentAdm)}</strong></div>` : ''}
    <div class="row"><span class="muted">Class</span><strong>${esc(data.cls)}</strong></div>
    ${data.term ? `<div class="row"><span class="muted">Term</span><strong>${esc(data.term)}${data.academicYear ? ` · ${esc(data.academicYear)}` : ''}</strong></div>` : ''}
    ${data.headName ? `<div class="row"><span class="muted">Fee head</span><strong>${esc(data.headName)}</strong></div>` : ''}
    <div class="row"><span class="muted">Mode</span><strong>${esc(data.mode)}</strong></div>
    ${data.ref ? `<div class="row"><span class="muted">Reference</span><strong>${esc(data.ref)}</strong></div>` : ''}
    <div class="row"><span class="muted">Paid on</span><strong>${esc(data.paidAt)}</strong></div>
    ${data.invoiceId ? `<div class="row"><span class="muted">Invoice</span><strong>${esc(data.invoiceId)}</strong></div>` : ''}
    <div class="amt">${esc(amount)}</div>
  </div>
  <p class="muted" style="margin-top:16px">Keep this receipt for your records. It is also available in the parent / student app.</p>
</body></html>`
}

export function feeReceiptFileName(data: Pick<FeeReceiptData, 'studentName' | 'studentAdm' | 'cls'>): string {
  const name = properName(data.studentName).replace(/\s+/g, '-') || 'Student'
  const adm = (data.studentAdm || '').replace(/\//g, '-') || 'receipt'
  const cls = (data.cls || '').replace(/\s+/g, '')
  return `Fee-receipt · ${name} · ${adm}${cls ? ` · ${cls}` : ''}.html`
}

export function feeReceiptToBase64(html: string): string {
  if (typeof btoa === 'function') {
    try {
      return btoa(unescape(encodeURIComponent(html)))
    } catch {
      return btoa(html)
    }
  }
  /* Node / Vitest */
  return Buffer.from(html, 'utf8').toString('base64')
}

export function downloadFeeReceipt(data: FeeReceiptData): void {
  const html = buildFeeReceiptHtml(data)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = feeReceiptFileName(data)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
