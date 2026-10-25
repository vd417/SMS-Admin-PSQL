/* ============================================================
   SchoolMate — Form controls: Field, Input, Textarea, Select,
   Toggle, Checkbox, Search
   ============================================================ */
import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, Ref, ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { validateFile, clampPhoneInput } from '@/lib/validation'

export function Field({ label, required, hint, error, children }: {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode
}) {
  return (
    <div className="sm-field">
      {label && <label className="sm-label">{label}{required && <span className="sm-req">*</span>}</label>}
      {children}
      {error ? <span className="sm-err"><Icon name="alert" size={12} />{error}</span> : hint ? <span className="sm-hint">{hint}</span> : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: string
  error?: boolean
  /** When set, restricts entry to digits only, capped at this many characters
   *  (e.g. 10 for a mobile number). Also hints a numeric keypad. */
  digits?: number
  ref?: Ref<HTMLInputElement>
}
export function Input({ icon, error, className, ref, digits, onChange, inputMode, maxLength, ...rest }: InputProps) {
  const handleChange = digits
    ? (ev: ChangeEvent<HTMLInputElement>) => {
      const clamped = clampPhoneInput(ev.target.value, digits)
      if (clamped !== ev.target.value) ev.target.value = clamped
      onChange?.(ev)
    }
    : onChange
  return (
    <div className={['sm-input-wrap', icon && 'has-icon', error && 'is-error'].filter(Boolean).join(' ')}>
      {icon && <span className="sm-input-ic"><Icon name={icon} size={16} /></span>}
      <input
        ref={ref}
        className={['sm-input', className].filter(Boolean).join(' ')}
        inputMode={digits ? 'numeric' : inputMode}
        maxLength={digits ?? maxLength}
        onChange={handleChange}
        {...rest}
      />
    </div>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { ref?: Ref<HTMLTextAreaElement> }
export function Textarea({ className, ref, ...rest }: TextareaProps) {
  return <textarea ref={ref} className={['sm-input', 'sm-textarea', className].filter(Boolean).join(' ')} {...rest} />
}

export type SelectOption = string | { value: string; label: string }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[]
  ref?: Ref<HTMLSelectElement>
}
export function Select({ options, className, ref, ...rest }: SelectProps) {
  return (
    <div className="sm-select-wrap">
      <select ref={ref} className={['sm-input', 'sm-select', className].filter(Boolean).join(' ')} {...rest}>
        {options.map((o, i) => {
          const value = typeof o === 'object' ? o.value : o
          const label = typeof o === 'object' ? o.label : o
          return <option key={i} value={value}>{label}</option>
        })}
      </select>
      <span className="sm-select-chev"><Icon name="chevDown" size={16} /></span>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange?: () => void; label?: ReactNode }) {
  return (
    <button type="button" className={['sm-toggle', checked && 'on'].filter(Boolean).join(' ')} onClick={onChange} aria-pressed={checked}>
      <span className="sm-toggle-knob" />
      {label && <span className="sm-toggle-label">{label}</span>}
    </button>
  )
}

export function Checkbox({ checked, indeterminate, onChange, label }: {
  checked?: boolean; indeterminate?: boolean; onChange?: (checked: boolean) => void; label?: ReactNode
}) {
  return (
    <label className="sm-check">
      <input type="checkbox" checked={!!checked} ref={(el) => { if (el) el.indeterminate = !!indeterminate }}
        onChange={(e) => onChange?.(e.target.checked)} />
      <span className="sm-check-box"><Icon name="check" size={13} stroke={3} /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Search({ value, onChange, placeholder = 'Search…', style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties
}) {
  return (
    <div className="sm-search" style={style}>
      <Icon name="search" size={16} />
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <button className="sm-search-clear" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={14} /></button>}
    </div>
  )
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name)
}

/* ------------------------------------------------------------
   FileUpload — picker with image preview + Replace / Remove.
   Optional existingUrl shows a previously saved photo (e.g. edit student).
   ------------------------------------------------------------ */
export function FileUpload({
  accept = '.pdf,.jpg,.jpeg,.png',
  value,
  onChange,
  ariaLabel,
  existingUrl,
  existingLabel,
  onClearExisting,
  photoPreview = false,
}: {
  accept?: string
  value: File | null
  onChange: (file: File | null) => void
  ariaLabel?: string
  /** Saved photo/data-URL when not replacing with a new File yet. */
  existingUrl?: string | null
  existingLabel?: string
  onClearExisting?: () => void
  /** Larger square preview (student / parent photos). */
  photoPreview?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)

  /* FileReader data-URL — stable under React Strict Mode (object URLs get revoked). */
  useEffect(() => {
    setBroken(false)
    if (!value || !isImageFile(value)) {
      setPreview(null)
      return
    }
    let cancelled = false
    const reader = new FileReader()
    reader.onload = () => {
      if (!cancelled) setPreview(String(reader.result || ''))
    }
    reader.onerror = () => {
      if (!cancelled) setPreview(null)
    }
    reader.readAsDataURL(value)
    return () => { cancelled = true }
  }, [value, existingUrl])

  const pick = (file: File | null) => {
    if (!file) { onChange(null); setErr(null); return }
    const e = validateFile(file)
    if (e) {
      setErr(e)
      onChange(null)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setErr(null)
    onClearExisting?.()
    onChange(file)
  }

  const clear = () => {
    onChange(null)
    onClearExisting?.()
    setErr(null)
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const openPicker = () => {
    if (inputRef.current) inputRef.current.value = ''
    inputRef.current?.click()
  }

  const thumbSrc = broken ? null : (preview || (!value ? (existingUrl || null) : null))
  const hasFile = !!value || !!existingUrl
  const showPhoto = photoPreview || !!thumbSrc

  return (
    <div className={['sm-upload', showPhoto && 'is-photo'].filter(Boolean).join(' ')}>
      <input
        ref={inputRef} type="file" accept={accept} hidden aria-label={ariaLabel}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {hasFile ? (
        <div className={['sm-upload-file', showPhoto && 'is-photo', err && 'is-error'].filter(Boolean).join(' ')}>
          {thumbSrc
            ? (
              <img
                src={thumbSrc}
                alt=""
                className={['sm-upload-thumb', showPhoto && 'is-photo'].filter(Boolean).join(' ')}
                onError={() => setBroken(true)}
              />
              )
            : <span className="sm-upload-ic"><Icon name="doc" size={16} /></span>}
          <div className="sm-upload-meta">
            <div className="fw6 t-sm sm-upload-name">
              {value?.name || existingLabel || 'Current file'}
            </div>
            <div className="t-xs muted">
              {value ? `${(value.size / 1024 / 1024).toFixed(2)} MB` : 'Saved · replace to change'}
            </div>
            <div className="row gap6 wrap" style={{ marginTop: 6 }}>
              {(preview || existingUrl) && (
                <button
                  type="button"
                  className="sm-upload-action"
                  onClick={() => {
                    const src = preview || existingUrl
                    if (!src) return
                    /* Always open via blob — Chrome blocks data: PDF tabs. */
                    void (async () => {
                      try {
                        const res = await fetch(src)
                        const blob = await res.blob()
                        const url = URL.createObjectURL(blob)
                        const w = window.open(url, '_blank')
                        if (!w) {
                          const a = document.createElement('a')
                          a.href = url
                          a.download = value?.name || existingLabel || 'document'
                          a.click()
                        }
                        setTimeout(() => URL.revokeObjectURL(url), 120_000)
                      } catch {
                        window.open(src, '_blank')
                      }
                    })()
                  }}
                >
                  Open
                </button>
              )}
              <button type="button" className="sm-upload-action" onClick={openPicker}>Replace</button>
              <button type="button" className="sm-upload-action is-danger" onClick={clear}>Remove</button>
            </div>
          </div>
        </div>
      ) : photoPreview ? (
        <button type="button" className="sm-upload-drop is-photo" onClick={openPicker}>
          <span className="sm-upload-drop-ic"><Icon name="user" size={28} /></span>
          <span className="fw6 t-sm">Upload photo</span>
          <span className="t-xs muted">JPG or PNG · max 4 MB</span>
        </button>
      ) : (
        <button type="button" className="sm-upload-drop" onClick={openPicker}>
          <Icon name="upload" size={16} />
          <span>Choose file</span>
          <span className="t-xs muted">PDF, JPG, PNG · max 4 MB</span>
        </button>
      )}
      {err && <span className="sm-err"><Icon name="alert" size={12} />{err}</span>}
    </div>
  )
}
