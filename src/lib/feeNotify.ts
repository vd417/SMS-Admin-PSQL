import { collectAudienceContacts } from '@/lib/collectAudienceEmails'
import { createAnnouncement } from '@/api/announcements'
import { fmtMoney } from '@/lib/format'
import { buildFeeReceiptHtml, feeReceiptFileName, feeReceiptToBase64, type FeeReceiptData } from '@/lib/feeReceipt'

export interface FeeNotifyChannels {
  email: boolean
  sms: boolean
  app: boolean
}

export interface FeeNotifyInput {
  kind: 'receipt' | 'reminder' | 'invoice_created'
  schoolName: string
  /** Required for 'receipt' / 'reminder' — a single student's notice. Unused for 'invoice_created'. */
  studentName?: string
  amount?: number
  mode?: string
  dueDate?: string
  currency?: string
  channels: FeeNotifyChannels
  audience?: string
  emails?: string[]
  phones?: string[]
  /** When set, attaches a downloadable receipt for email + parent/student app. */
  receipt?: FeeReceiptData
  /** Targets the in-app notice at this login. Without it, the app channel is a school-wide push. */
  userId?: string
  /** Replaces the generated title (class-teacher and principal summaries). */
  titleText?: string
  /** Replaces the generated body. */
  bodyText?: string
  /** 'invoice_created': how many invoices were just generated, for which period.
   *  'reminder' with no studentName (bulk send): how many invoices this reaches — amount
   *  is then read as the combined outstanding total, not one student's due. */
  count?: number
  period?: string
}

export interface FeeNotifyResult {
  reach: number
  emails: number
  phones: number
  channels: string[]
}

/** Send a fee receipt or reminder to a student's parents via email · SMS · app. */
export async function notifyFeeAudience(input: FeeNotifyInput): Promise<FeeNotifyResult> {
  const channelList = [
    input.channels.email ? 'email' : '',
    input.channels.sms ? 'sms' : '',
    input.channels.app ? 'app' : '',
  ].filter(Boolean)

  if (!channelList.length) throw new Error('Pick at least one channel: Email, SMS, or App.')

  let emails = input.emails
  let phones = input.phones
  if (!emails || !phones) {
    const contacts = await collectAudienceContacts(input.audience ?? 'parents')
    emails = emails ?? contacts.emails
    phones = phones ?? contacts.phones
  }

  const amount = fmtMoney(input.amount ?? 0, input.currency)
  const isBulkReminder = input.kind === 'reminder' && !input.studentName
  const title = input.titleText?.trim() || (input.kind === 'receipt'
    ? `Payment received — ${input.studentName}`
    : input.kind === 'reminder'
      ? (isBulkReminder ? 'Fee reminder' : `Fee reminder — ${input.studentName}`)
      : `New fee invoice${input.count && input.count > 1 ? 's' : ''} generated`)

  const body = input.bodyText?.trim() || (input.kind === 'receipt'
    ? `${input.schoolName}: We received a payment of ${amount} for ${input.studentName}${input.mode ? ` via ${input.mode}` : ''}. Thank you. Download the attached fee receipt, or open it in the parent / student app.`
    : input.kind === 'reminder'
      ? (isBulkReminder
        ? `${input.schoolName}: You have ${input.count ?? 'an'} outstanding fee payment${input.count === 1 ? '' : 's'}${input.amount ? ` totaling ${amount}` : ''}. Please pay at the earliest to avoid late fees.`
        : `${input.schoolName}: A fee payment of ${amount} is due for ${input.studentName}${input.dueDate ? ` by ${input.dueDate}` : ''}. Please pay at the earliest to avoid late fees.`)
      : `${input.schoolName}: A new fee has been published${input.period ? ` for ${input.period}` : ''}. Please check the parent app for your dues and pay at the earliest.`)

  let attachmentBase64: string | undefined
  let attachmentFileName: string | undefined
  let attachmentContentType: string | undefined
  if (input.kind === 'receipt' && input.receipt) {
    const html = buildFeeReceiptHtml(input.receipt)
    attachmentBase64 = feeReceiptToBase64(html)
    attachmentFileName = feeReceiptFileName(input.receipt)
    attachmentContentType = 'text/html;charset=utf-8'
  }

  /* App channel still needs contact targets when available. */
  const eventKind = input.kind === 'receipt'
    ? 'fee_receipt'
    : input.kind === 'reminder'
      ? 'fee_reminder'
      : 'fee_invoice_created'
  const created = await createAnnouncement({
    title,
    body,
    type: eventKind,
    audience: input.audience ?? 'parents',
    emails: input.channels.email || input.channels.app ? emails : [],
    phones: input.channels.sms || input.channels.app ? phones : [],
    channels: channelList,
    schoolName: input.schoolName,
    eventKind,
    userId: input.userId,
    attachmentBase64,
    attachmentFileName,
    attachmentContentType,
  })

  return {
    reach: created.reach ?? Math.max(emails.length, phones.length),
    emails: emails.length,
    phones: phones.length,
    channels: channelList,
  }
}
