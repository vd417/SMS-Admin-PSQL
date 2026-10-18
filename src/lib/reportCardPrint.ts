/* Print / Save-as-PDF for a branded exam report card. */
import { gradeFor, gpaFor } from '@/lib/format'
import { properName, properPlace } from '@/lib/properCase'
import type { Report, Student } from '@/types'

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface ReportCardPrintOpts {
  schoolName: string
  schoolCity?: string
  schoolSlug?: string
  schoolLogoInitials?: string
  schoolLogoUrl?: string | null
  schoolImageUrl?: string | null
  schoolBrandColor?: string
  examName?: string
  student: Pick<Student, 'name' | 'adm' | 'cls' | 'roll' | 'guardian' | 'attendance'>
  report: Report
  rank: number
  classSize: number
  autoPrint?: boolean
  subjectTeacher?: string
  classTeacher?: string
  principal?: string
}

function brandColor(opts: ReportCardPrintOpts): string {
  const c = opts.schoolBrandColor?.trim()
  if (c && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c
  return '#1e40af'
}

/** Prefer logo mark; avoid huge campus photos that slow PDF. */
function logoUrl(opts: ReportCardPrintOpts): string {
  return (opts.schoolLogoUrl?.trim() || opts.schoolImageUrl?.trim() || '')
}

function headerLogo(opts: ReportCardPrintOpts, brand: string): string {
  const url = logoUrl(opts)
  if (url) {
    return `<img class="rc-logo" src="${esc(url)}" alt="${esc(opts.schoolName)}" decoding="async" />`
  }
  const initials = esc((opts.schoolLogoInitials || opts.schoolName.slice(0, 2)).toUpperCase())
  return `<div class="rc-logo-fallback" style="background:${esc(brand)}">${initials}</div>`
}

function watermarkBlock(opts: ReportCardPrintOpts, brand: string): string {
  const url = logoUrl(opts)
  if (url) {
    return `<div class="rc-wm-layer" aria-hidden="true"><img class="rc-watermark" src="${esc(url)}" alt="" decoding="async" /></div>`
  }
  const initials = esc((opts.schoolLogoInitials || opts.schoolName.slice(0, 2)).toUpperCase())
  return `<div class="rc-wm-layer" aria-hidden="true"><div class="rc-watermark rc-watermark-text" style="color:${esc(brand)}">${initials}</div></div>`
}

function signLine(label: string, name?: string): string {
  const who = name?.trim()
  return `<div class="sign">
    <div class="sign-line"></div>
    <div class="sign-lab">${esc(label)}</div>
    ${who ? `<div class="sign-name">${esc(who)}</div>` : ''}
  </div>`
}

/** Suggested Save-as-PDF file name: student + admission no + class. */
export function reportCardPdfTitle(opts: Pick<ReportCardPrintOpts, 'student' | 'examName'>): string {
  const studentName = properName(opts.student.name) || 'Student'
  const adm = String(opts.student.adm ?? '').trim().replace(/\//g, '-')
  const cls = String(opts.student.cls ?? '').trim()
  const examLabel = properName(opts.examName) || 'Report Card'
  return [studentName, adm, cls, examLabel].filter(Boolean).join(' · ')
}

function buildHtml(opts: ReportCardPrintOpts): string {
  const brand = brandColor(opts)
  const schoolName = properName(opts.schoolName)
  const city = properPlace(opts.schoolCity)
  const studentName = properName(opts.student.name)
  const guardian = properName(opts.student.guardian)
  const examLabel = properName(opts.examName)
  const pdfTitle = reportCardPdfTitle(opts)
  const meta = [city, opts.schoolSlug].map((x) => x?.trim()).filter(Boolean).join(' · ')
  const title = examLabel
    ? `${examLabel} · Report Card`
    : 'Academic Year · Term Report Card'
  const resultTone = opts.report.result === 'PASS' ? '#166534' : '#b91c1c'
  const resultBg = opts.report.result === 'PASS' ? '#dcfce7' : '#fee2e2'
  const auto = opts.autoPrint !== false
  const printOpts = { ...opts, schoolName, schoolCity: city }

  const rows = opts.report.rows.map((r) => {
    const g = r.grade || gradeFor((r.marks / Math.max(1, r.max)) * 100)
    const gpa = r.gpa ?? gpaFor(g)
    return `<tr>
      <td class="fw">${esc(r.subject)}</td>
      <td class="num">${r.marks}</td>
      <td class="num muted">${r.max}</td>
      <td class="cen">${esc(g)}</td>
      <td class="cen">${gpa}</td>
      <td class="cen ${r.pass ? 'ok' : 'bad'}">${r.pass ? 'Pass' : 'Fail'}</td>
    </tr>`
  }).join('')

  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${esc(pdfTitle)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font: 13px/1.4 system-ui, Segoe UI, Roboto, sans-serif;
    color: #0f172a; background: #fff;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .sheet {
    position: relative;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }
  /* Full sheet flex-center — logo always dead middle of the card */
  .rc-wm-layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 0;
    pointer-events: none;
  }
  .rc-watermark {
    width: min(300px, 52%);
    max-height: 300px;
    height: auto;
    object-fit: contain;
    opacity: 0.16;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .rc-watermark-text {
    width: 220px; height: 220px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 72px; font-weight: 800; letter-spacing: -0.04em;
    border: 3px solid currentColor; opacity: 0.14;
  }
  .layer { position: relative; z-index: 1; }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    padding: 18px 20px 14px; border-bottom: 1px solid #e2e8f0;
    background: linear-gradient(180deg, color-mix(in srgb, ${esc(brand)} 10%, #fff) 0%, rgba(255,255,255,.9) 100%);
  }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .rc-logo, .rc-logo-fallback {
    width: 64px; height: 64px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
  }
  .rc-logo-fallback {
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 20px;
  }
  .school { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; }
  .meta { margin-top: 3px; font-size: 12px; color: #64748b; }
  .title { margin-top: 6px; font-size: 13px; font-weight: 600; color: ${esc(brand)}; }
  .badge {
    flex-shrink: 0; padding: 5px 11px; border-radius: 999px;
    font-weight: 700; font-size: 12px; color: ${resultTone}; background: ${resultBg};
  }
  .info {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px;
    padding: 14px 20px; background: rgba(255,255,255,.78);
  }
  .info .lab { font-size: 11px; color: #64748b; }
  .info .val { font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: rgba(255,255,255,.62); }
  th, td { padding: 8px 12px; border-top: 1px solid #e2e8f0; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .num { text-align: right; }
  .cen { text-align: center; }
  .fw { font-weight: 600; }
  .muted { color: #64748b; }
  .ok { color: #166534; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 600; }
  .foot {
    display: flex; gap: 24px; flex-wrap: wrap;
    padding: 14px 20px; border-top: 1px solid #e2e8f0;
    background: rgba(248,250,252,.82);
  }
  .foot .lab { font-size: 11px; color: #64748b; }
  .foot .val { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .signs {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    padding: 28px 20px 18px; border-top: 1px solid #e2e8f0;
    background: rgba(255,255,255,.85);
  }
  .sign { text-align: center; }
  .sign-line {
    height: 36px; border-bottom: 1px solid #94a3b8; margin: 0 8px 8px;
  }
  .sign-lab { font-size: 11px; font-weight: 700; color: #334155; letter-spacing: .02em; }
  .sign-name { margin-top: 2px; font-size: 11px; color: #64748b; }
  .toolbar { display: none; }
  @media print {
    .sheet { border: none; border-radius: 0; }
    .rc-watermark { opacity: 0.18 !important; }
  }
</style>
</head><body>
  <div class="sheet">
    ${watermarkBlock(printOpts, brand)}
    <div class="layer head">
      <div class="brand">
        ${headerLogo(printOpts, brand)}
        <div>
          <div class="school">${esc(schoolName)}</div>
          ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
          <div class="title">${esc(title)}</div>
        </div>
      </div>
      <div class="badge">${esc(opts.report.result)}</div>
    </div>
    <div class="layer info">
      <div><div class="lab">Student</div><div class="val">${esc(studentName)}</div></div>
      <div><div class="lab">Student ID</div><div class="val">${esc(opts.student.adm)}</div></div>
      <div><div class="lab">Class · Roll</div><div class="val">${esc(opts.student.cls)} · ${opts.student.roll}</div></div>
      <div><div class="lab">Guardian</div><div class="val">${esc(guardian || '—')}</div></div>
      <div><div class="lab">Attendance</div><div class="val">${opts.student.attendance}%</div></div>
      <div><div class="lab">Class rank</div><div class="val">${opts.rank} / ${opts.classSize}</div></div>
    </div>
    <table class="layer">
      <thead>
        <tr>
          <th>Subject</th><th class="num">Marks</th><th class="num">Max</th>
          <th class="cen">Grade</th><th class="cen">GPA</th><th class="cen">Result</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td class="fw">Total</td>
          <td class="num fw">${opts.report.total}</td>
          <td class="num muted">${opts.report.maxTotal}</td>
          <td class="cen fw">${esc(opts.report.grade)}</td>
          <td class="cen fw">${opts.report.gpa}</td>
          <td class="cen fw">${opts.report.pct}%</td>
        </tr>
      </tbody>
    </table>
    <div class="layer foot">
      <div><div class="lab">Percentage</div><div class="val">${opts.report.pct}%</div></div>
      <div><div class="lab">Overall grade</div><div class="val">${esc(opts.report.grade)}</div></div>
      <div><div class="lab">GPA</div><div class="val">${opts.report.gpa}</div></div>
      <div><div class="lab">Result</div><div class="val">${esc(opts.report.result)}</div></div>
    </div>
    <div class="layer signs">
      ${signLine('Subject teacher', opts.subjectTeacher)}
      ${signLine('Class teacher', opts.classTeacher)}
      ${signLine('Principal', opts.principal)}
    </div>
  </div>
  <script>
    ${auto ? `
      (function(){
        function go(){ try{ window.focus(); window.print(); }catch(e){} }
        var imgs = Array.prototype.slice.call(document.images || []);
        if (!imgs.length) { go(); return; }
        var left = imgs.length, done = false;
        function finish(){ if (done) return; done = true; go(); }
        imgs.forEach(function(img){
          if (img.complete) { if (--left <= 0) finish(); return; }
          img.onload = img.onerror = function(){ if (--left <= 0) finish(); };
        });
        setTimeout(finish, 120);
      })();
    ` : ''}
  </script>
</body></html>`
}

/** Print report card — popup window so Save-as-PDF uses student/adm/class title (not Admin Console). */
export function printReportCard(opts: ReportCardPrintOpts): boolean {
  const html = buildHtml({ ...opts, autoPrint: false })
  const pdfTitle = reportCardPdfTitle(opts)

  const runPrint = (win: Window, doc: Document, onDone?: () => void) => {
    const go = () => {
      try {
        win.focus()
        win.print()
      } finally {
        onDone?.()
      }
    }
    const imgs = Array.from(doc.images || [])
    if (!imgs.length || imgs.every((img) => img.complete)) {
      window.setTimeout(go, 30)
      return
    }
    let left = imgs.length
    let done = false
    const finish = () => {
      if (done) return
      done = true
      go()
    }
    imgs.forEach((img) => {
      if (img.complete) {
        if (--left <= 0) finish()
        return
      }
      img.onload = img.onerror = () => {
        if (--left <= 0) finish()
      }
    })
    window.setTimeout(finish, 150)
  }

  /* Prefer a real window — Chrome/Edge use its <title> for the PDF file name. */
  const popup = window.open('', '_blank')
  if (popup) {
    popup.document.open()
    popup.document.write(html)
    popup.document.close()
    try { popup.document.title = pdfTitle } catch { /* ignore */ }
    runPrint(popup, popup.document, () => {
      window.setTimeout(() => {
        try { popup.close() } catch { /* ignore */ }
      }, 1_000)
    })
    return true
  }

  /* Pop-up blocked → iframe, but swap parent title so PDF name is still correct. */
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', pdfTitle)
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = win?.document
  if (!win || !doc) {
    iframe.remove()
    return false
  }

  doc.open()
  doc.write(html)
  doc.close()

  const prevTitle = document.title
  document.title = pdfTitle

  runPrint(win, doc, () => {
    document.title = prevTitle
    window.setTimeout(() => iframe.remove(), 30_000)
  })
  return true
}

/** Exported for unit tests — HTML only. */
export function reportCardPrintHtml(opts: ReportCardPrintOpts): string {
  return buildHtml({ ...opts, autoPrint: false })
}
