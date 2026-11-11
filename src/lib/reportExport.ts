import { fmtMoney, fmtNum } from '@/lib/format'
import { properName } from '@/lib/properCase'
import { downloadTextFile } from '@/lib/feeExport'

/** School branding + context shared by every exported report. */
export interface ReportMeta {
  schoolName: string
  schoolCity?: string
  /** School logo image URL; when absent the initials badge is used. */
  logoUrl?: string | null
  /** Initials fallback for the logo badge (e.g. "GW"). */
  logoInitials?: string
  /** Brand colour for the letterhead accent + table header. */
  brandColor?: string
  /** Currency code/symbol used to format money columns in the PDF. */
  currency?: string
  /** Period label shown on the document, e.g. "Term 1 · 2026". */
  period: string
}

/** A single tabular report ready to export to CSV or a branded PDF. */
export interface ReportSpec {
  title: string
  subtitle?: string
  columns: string[]
  rows: (string | number)[][]
  /** Per-column alignment; defaults to left. */
  align?: ('l' | 'r')[]
  /** Per-column money flag — formatted with the school currency in the PDF. */
  money?: boolean[]
  /** Optional KPI chips rendered above the table. */
  summary?: { label: string; value: string }[]
  /** Optional chart data rendered above the table. */
  chart?: { label: string; value: number }[]
  /** Title for the chart block. */
  chartTitle?: string
  /** Format chart values as money. */
  chartMoney?: boolean
  /** Chart style — horizontal bars (default) or a donut/pie. */
  chartKind?: 'bar' | 'pie'
  /** Optional per-cell background + text color (e.g. status letters), keyed [rowIndex][colIndex].
   *  Omit (or leave a cell undefined) for the default styling — other reports are unaffected. */
  cellColor?: (CellColor | undefined)[][]
}

/** A pastel background + matching dark text, e.g. green for "present", red for "absent". */
export interface CellColor {
  bg: string
  text: string
}

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolveBrand(color?: string): string {
  const c = (color || '').trim()
  if (/^#?[0-9a-fA-F]{3,8}$/.test(c)) return c.startsWith('#') ? c : `#${c}`
  return '#4f46e5'
}

function logoMarkup(meta: ReportMeta, brand: string): string {
  if (meta.logoUrl) {
    return `<img class="logo" src="${esc(meta.logoUrl)}" alt="${esc(meta.schoolName)} logo" />`
  }
  const initials = esc((meta.logoInitials || meta.schoolName || '?').slice(0, 3).toUpperCase())
  return `<div class="logo badge" style="background:${brand}">${initials}</div>`
}

function slug(s: string): string {
  return s.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'report'
}

export function reportToCsv(spec: ReportSpec): string {
  const header = spec.columns.map(csvCell).join(',')
  const lines = spec.rows.map((r) => r.map(csvCell).join(','))
  return [header, ...lines].join('\n')
}

export function reportFileName(spec: ReportSpec, meta: ReportMeta, ext: string): string {
  return `${slug(spec.title)}-${slug(meta.period)}.${ext}`
}

export function downloadReportCsv(spec: ReportSpec, meta: ReportMeta): void {
  downloadTextFile(reportFileName(spec, meta, 'csv'), reportToCsv(spec))
}

const CHART_HUES = ['#0ea5e9', '#f59e0b', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']
function segColor(i: number, brand: string): string {
  return i === 0 ? brand : CHART_HUES[(i - 1) % CHART_HUES.length]
}

function fmtChartVal(spec: ReportSpec, value: number, currency?: string): string {
  return spec.chartMoney ? fmtMoney(value, currency || undefined) : fmtNum(value)
}

/** Donut chart + legend (SVG). Falls back to nothing when totals are zero. */
function renderPie(spec: ReportSpec, brand: string, currency?: string): string {
  const data = (spec.chart ?? []).filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return ''
  const r = 52, cx = 64, cy = 64, sw = 24, circ = 2 * Math.PI * r
  let acc = 0
  const segs = data.map((d, i) => {
    const dash = (d.value / total) * circ
    const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="transparent" stroke="${segColor(i, brand)}" stroke-width="${sw}" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`
    acc += dash
    return seg
  }).join('')
  const legend = data.map((d, i) => {
    const pct = Math.round((d.value / total) * 100)
    return `<div class="lrow"><span class="dot" style="background:${segColor(i, brand)}"></span>`
      + `<span class="ll">${esc(d.label)}</span>`
      + `<span class="lv">${esc(fmtChartVal(spec, d.value, currency))} · ${pct}%</span></div>`
  }).join('')
  return `<div class="chart"><div class="ctitle">${esc(spec.chartTitle || 'Breakdown')}</div>`
    + `<div class="pierow"><svg width="128" height="128" viewBox="0 0 128 128">${segs}</svg><div class="legend">${legend}</div></div></div>`
}

/** Horizontal bar chart (pure HTML/CSS — prints reliably). */
function renderBars(spec: ReportSpec, brand: string, currency?: string): string {
  const data = spec.chart ?? []
  if (data.length === 0) return ''
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1)
  const rows = data
    .map((d) => {
      const pct = Math.max(2, Math.round((Math.abs(d.value) / max) * 100))
      return `<div class="crow"><span class="clabel" title="${esc(d.label)}">${esc(d.label)}</span>`
        + `<span class="ctrack"><span class="cbar" style="width:${pct}%;background:${brand}"></span></span>`
        + `<span class="cval">${esc(fmtChartVal(spec, d.value, currency))}</span></div>`
    })
    .join('')
  return `<div class="chart"><div class="ctitle">${esc(spec.chartTitle || 'Overview')}</div>${rows}</div>`
}

function renderChart(spec: ReportSpec, brand: string, currency?: string): string {
  if (!spec.chart || spec.chart.length === 0) return ''
  return spec.chartKind === 'pie' ? renderPie(spec, brand, currency) : renderBars(spec, brand, currency)
}

/** Formats a cell for the PDF: money columns get the school currency. */
function pdfCell(spec: ReportSpec, colIdx: number, value: string | number, currency?: string): string {
  if (spec.money?.[colIdx] && value !== '' && !Number.isNaN(Number(value))) {
    return esc(fmtMoney(Number(value), currency || undefined))
  }
  return esc(String(value ?? ''))
}

/** Branded, print-ready (A4 landscape) HTML for a single report.
 *  `opts.excel` drops the on-screen toolbar so the file imports cleanly into
 *  Excel; `opts.autoPrint` fires the print dialog (Save-as-PDF) on load. */
export function buildReportHtml(spec: ReportSpec, meta: ReportMeta, opts: { autoPrint?: boolean; excel?: boolean } = {}): string {
  const brand = resolveBrand(meta.brandColor)
  const school = properName(meta.schoolName)
  const city = meta.schoolCity ? esc(meta.schoolCity) : ''
  const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

  const head = `<tr>${spec.columns
    .map((c, i) => `<th class="${spec.align?.[i] === 'r' || spec.money?.[i] ? 'r' : ''}">${esc(c)}</th>`)
    .join('')}</tr>`

  const body = spec.rows.length === 0
    ? `<tr><td class="empty" colspan="${spec.columns.length}">No records for this period.</td></tr>`
    : spec.rows
      .map((r, ri) => `<tr>${r
        .map((v, i) => {
          const cc = spec.cellColor?.[ri]?.[i]
          const style = cc ? ` style="background:${esc(cc.bg)};color:${esc(cc.text)};font-weight:700"` : ''
          return `<td class="${spec.align?.[i] === 'r' || spec.money?.[i] ? 'r' : ''}"${style}>${pdfCell(spec, i, v, meta.currency)}</td>`
        })
        .join('')}</tr>`)
      .join('')

  const chips = spec.summary?.length
    ? `<div class="chips">${spec.summary
      .map((s) => `<div class="chip"><span class="k">${esc(s.label)}</span><span class="v">${esc(s.value)}</span></div>`)
      .join('')}</div>`
    : ''

  const chart = renderChart(spec, brand, meta.currency)

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(spec.title)} — ${esc(school)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  *{box-sizing:border-box}
  body{font:12.5px/1.45 system-ui,Segoe UI,sans-serif;color:#0f172a;margin:22px}
  .toolbar{margin-bottom:14px}
  .toolbar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid ${brand};background:${brand};color:#fff;cursor:pointer}
  @media print{.toolbar{display:none}}
  .head{display:flex;align-items:center;gap:14px;padding-bottom:12px;border-bottom:3px solid ${brand}}
  .logo{width:52px;height:52px;border-radius:12px;object-fit:cover;flex:0 0 auto}
  .logo.badge{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:19px}
  .head .info{flex:1;min-width:0}
  h1{font-size:19px;margin:0 0 2px;line-height:1.2}
  .muted{color:#64748b;font-size:11.5px}
  .doc{text-align:right}
  .doc .t{font-weight:800;font-size:13px}
  .title{margin:16px 0 2px;font-size:16px;font-weight:800}
  .sub{color:#64748b;font-size:12px;margin-bottom:12px}
  .chips{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
  .chip{border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;min-width:120px}
  .chip .k{display:block;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em}
  .chip .v{font-weight:800;font-size:15px}
  .chart{margin:12px 0 4px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
  .ctitle{font-weight:700;margin-bottom:8px;font-size:12.5px}
  .crow{display:flex;align-items:center;gap:10px;margin:5px 0}
  .clabel{width:150px;flex:0 0 auto;color:#334155;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ctrack{flex:1;min-width:60px;background:#f1f5f9;border-radius:6px;overflow:hidden;height:12px}
  .cbar{display:block;height:12px;border-radius:6px}
  .cval{width:110px;flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;font-size:11.5px}
  .pierow{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .legend{flex:1;min-width:180px}
  .lrow{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:11.5px}
  .dot{width:11px;height:11px;border-radius:3px;flex:0 0 auto}
  .ll{flex:1;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lv{font-variant-numeric:tabular-nums;font-weight:600;color:#0f172a}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{padding:7px 9px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}
  table.fit th,table.fit td{padding:3px 2px;font-size:9px;text-align:center}
  table.fit th:nth-child(-n+3),table.fit td:nth-child(-n+3){text-align:left;white-space:normal}
  table.fit th:nth-child(n+4),table.fit td:nth-child(n+4){white-space:nowrap;width:22px}
  th{background:${brand}14;color:#0f172a;font-weight:700;border-bottom:2px solid ${brand}55}
  td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
  tbody tr:nth-child(even){background:#fafbfc}
  td.empty{text-align:center;color:#94a3b8;padding:24px}
  .foot{margin-top:18px;color:#94a3b8;font-size:11px;display:flex;justify-content:space-between}
</style></head><body>
  ${opts.excel ? '' : '<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>'}
  <div class="head">
    ${logoMarkup(meta, brand)}
    <div class="info">
      <h1>${esc(school)}</h1>
      ${city ? `<div class="muted">${city}</div>` : ''}
    </div>
    <div class="doc">
      <div class="t">${esc(spec.title)}</div>
      <div class="muted">${esc(meta.period)}</div>
    </div>
  </div>
  <div class="title">${esc(spec.title)}</div>
  ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
  ${chips}
  ${chart}
  <table class="${spec.columns.length > 12 ? 'fit' : ''}"><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="foot">
    <span>${esc(spec.rows.length.toString())} record${spec.rows.length === 1 ? '' : 's'}</span>
    <span>Generated ${esc(generated)} · ${esc(school)}</span>
  </div>
  ${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>' : ''}
</body></html>`
}

/** Branded workbook that Microsoft Excel opens directly (HTML `.xls`).
 *  Includes the school logo, KPI chips, chart and the full data table. */
export function downloadReportXls(spec: ReportSpec, meta: ReportMeta): void {
  const html = buildReportHtml(spec, meta, { excel: true })
  downloadTextFile(reportFileName(spec, meta, 'xls'), html, 'application/vnd.ms-excel;charset=utf-8')
}

/** Opens the branded report in a new tab and triggers the print dialog
 *  (Save as PDF). Falls back to downloading the HTML if popups are blocked. */
export function openReportPdf(spec: ReportSpec, meta: ReportMeta): void {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  if (win) {
    win.document.write(buildReportHtml(spec, meta, { autoPrint: true }))
    win.document.close()
    return
  }
  const blob = new Blob([buildReportHtml(spec, meta, {})], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = reportFileName(spec, meta, 'html')
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
