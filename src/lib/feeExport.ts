import type { FeeInvoice } from '@/types'

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Collection export — student + admission + class + amounts. */
export function invoicesToCsv(
  rows: FeeInvoice[],
  admOf?: (inv: FeeInvoice) => string,
): string {
  const header = ['Student', 'Student ID', 'Class', 'Term', 'Year', 'Total', 'Paid', 'Due', 'Status']
  const lines = rows.map((r) => {
    const adm = admOf?.(r) || r.studentAdm || ''
    return [
      r.studentName,
      adm,
      r.cls,
      r.term,
      r.academicYear,
      r.total,
      r.paid,
      r.due,
      r.status,
    ].map(csvCell).join(',')
  })
  return [header.join(','), ...lines].join('\n')
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Same download mechanics as downloadTextFile, for binary output (e.g. a generated .xlsx
 *  workbook's ArrayBuffer) that a text Blob can't carry. */
export function downloadArrayBuffer(filename: string, data: ArrayBuffer, mime: string): void {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
