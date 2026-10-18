import { describe, expect, it } from 'vitest'
import { invoicesToCsv } from './feeExport'
import type { FeeInvoice } from '@/types'

const inv = (partial: Partial<FeeInvoice>): FeeInvoice => ({
  id: 'i1',
  studentId: 's1',
  studentName: 'Rahul Shrma',
  studentAdm: 'sccrdtb/STU/26/0001',
  cls: 'IV-B',
  grade: 'IV',
  academicYear: '2026-27',
  term: 'Term 1',
  lines: [],
  total: 1000,
  paid: 200,
  waived: 0,
  due: 800,
  status: 'partial',
  ...partial,
})

describe('invoicesToCsv', () => {
  it('exports header + admission + amounts', () => {
    const csv = invoicesToCsv([inv({})])
    expect(csv.split('\n')[0]).toContain('Student ID')
    expect(csv).toContain('Rahul Shrma')
    expect(csv).toContain('sccrdtb/STU/26/0001')
    expect(csv).toContain('IV-B')
    expect(csv).toContain('800')
  })
})
