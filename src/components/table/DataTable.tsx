/* ============================================================
   SchoolMate — Generic DataTable: sort, pagination, bulk-select,
   column visibility.
   ============================================================ */
import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Checkbox } from '@/components/ui/forms'

export interface Column<T> {
  key: string
  label: ReactNode
  render?: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right' | 'center'
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  pageSize?: number
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  rowKey?: (row: T, i: number) => string | number
  bulk?: boolean
  onBulk?: (selected: T[]) => void
  bulkActions?: (selected: T[], clear: () => void) => ReactNode
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  empty?: ReactNode
}

export function DataTable<T>({
  columns, rows, pageSize = 10, initialSort, rowKey = (_r, i) => i,
  bulk, bulkActions, onRowClick, onRowDoubleClick, empty,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort)
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<Set<string | number>>(new Set())

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const sv = col.sortValue
    const out = rows.slice().sort((a, b) => {
      const av = sv(a), bv = sv(b)
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [rows, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const toggleSort = (key: string) => {
    setSort((s) => s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }
  const keyOf = (row: T, i: number) => rowKey(row, safePage * pageSize + i)
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r, i) => sel.has(keyOf(r, i)))
  const someSelected = sel.size > 0
  const clearSel = () => setSel(new Set())
  const selectedRows = sorted.filter((r, i) => sel.has(rowKey(r, i)))

  return (
    <div className="sm-table-wrap">
      {bulk && someSelected && bulkActions && (
        <div className="row ai-center jc-between" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--brand-50)' }}>
          <span className="t-sm fw6">{sel.size} selected</span>
          <div className="row gap8">{bulkActions(selectedRows, clearSel)}</div>
        </div>
      )}
      <table className="sm-table">
        <thead>
          <tr>
            {bulk && (
              <th style={{ width: 40 }}>
                <Checkbox checked={allOnPageSelected} indeterminate={someSelected && !allOnPageSelected}
                  onChange={(c) => {
                    const next = new Set(sel)
                    pageRows.forEach((r, i) => { const k = keyOf(r, i); if (c) next.add(k); else next.delete(k) })
                    setSel(next)
                  }} />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                className={[
                  c.sortValue && 'sortable',
                  c.align === 'right' && 'ta-right',
                  c.align === 'center' && 'ta-center',
                  c.key === 'actions' && 'sm-col-actions',
                ].filter(Boolean).join(' ')}
                onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
              >
                <span className="row ai-center gap4" style={{ justifyContent: c.align === 'right' ? 'flex-end' : undefined }}>
                  {c.label}
                  {sort?.key === c.key && <Icon name={sort.dir === 'asc' ? 'chevDown' : 'chevRight'} size={12} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr><td colSpan={columns.length + (bulk ? 1 : 0)}>{empty ?? <div className="sm-empty"><div className="sm-empty-title">No results</div></div>}</td></tr>
          ) : pageRows.map((row, i) => {
            const k = keyOf(row, i)
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                style={(onRowClick || onRowDoubleClick) ? { cursor: 'pointer' } : undefined}
              >
                {bulk && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={sel.has(k)} onChange={(c) => { const next = new Set(sel); if (c) next.add(k); else next.delete(k); setSel(next) }} />
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      c.align === 'right' && 'ta-right',
                      c.align === 'center' && 'ta-center',
                      c.key === 'actions' && 'sm-col-actions',
                    ].filter(Boolean).join(' ')}
                  >
                    {c.render ? c.render(row) : (row as Record<string, ReactNode>)[c.key]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div className="sm-table-foot">
          <span className="t-sm muted">{`${sorted.length} records · page ${safePage + 1} of ${pageCount}`}</span>
          <div className="sm-pager">
            <button className="sm-pager-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><Icon name="chevLeft" size={14} /></button>
            {Array.from({ length: pageCount }).slice(Math.max(0, safePage - 2), Math.max(0, safePage - 2) + 5).map((_, idx) => {
              const p = Math.max(0, safePage - 2) + idx
              return <button key={p} className={['sm-pager-btn', p === safePage && 'on'].filter(Boolean).join(' ')} onClick={() => setPage(p)}>{p + 1}</button>
            })}
            <button className="sm-pager-btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}><Icon name="chevRight" size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
