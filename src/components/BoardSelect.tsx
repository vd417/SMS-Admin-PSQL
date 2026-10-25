/* Education-board picker: CBSE / ICSE / State Board, or "Other…" → free-text name.
   Controlled by a single string: a preset value, a custom name, or '' when unset. */
import { useEffect, useState } from 'react'
import { Select, Input } from '@/components/ui'
import { SCHOOL_BOARDS } from '@/api/ownerTypes'

const PRESETS = SCHOOL_BOARDS as readonly string[]

export function BoardSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const isPreset = PRESETS.includes(value)
  const [other, setOther] = useState(value.trim() !== '' && !isPreset)

  // Keep the "Other" toggle in sync when the value is set from outside (e.g. editing a school).
  useEffect(() => {
    if (PRESETS.includes(value)) setOther(false)
    else if (value.trim() !== '') setOther(true)
  }, [value])

  const selected = other ? 'Other' : (isPreset ? value : '')

  return (
    <div className="col gap8">
      <Select
        value={selected}
        options={[
          { value: '', label: 'Select board…' },
          ...SCHOOL_BOARDS.map((b) => ({ value: b, label: b })),
          { value: 'Other', label: 'Other…' },
        ]}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'Other') { setOther(true); onChange('') }
          else { setOther(false); onChange(v) }
        }}
      />
      {other && (
        <Input
          placeholder="Board name (e.g. Maharashtra State Board)"
          value={isPreset ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
