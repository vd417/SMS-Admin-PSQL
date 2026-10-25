/* Edit school profile — name, address, contact, logo & school image. */
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks'
import {
  Modal, Btn, Field, Input, FileUpload, Spinner,
} from '@/components/ui'
import { SchoolMark, SchoolPhoto } from '@/components/SchoolMark'
import { compressImageFile } from '@/lib/compressImage'
import { updateSchoolProfile } from '@/api/schoolProfile'
import { clientToSchool, isValidSchoolId, normalizeSchoolId } from '@/api/ownerMap'
import { validateEmail, validatePhone } from '@/lib/validation'
import { ApiError } from '@/api/client'
import type { Client } from '@/api/ownerTypes'
import type { School } from '@/types'

async function toDataUrl(file: File, kind: 'logo' | 'cover'): Promise<string> {
  try {
    return await compressImageFile(file, {
      maxEdge: kind === 'logo' ? 256 : 1280,
      quality: kind === 'logo' ? 0.85 : 0.8,
    })
  } catch {
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result ?? ''))
      r.onerror = () => reject(r.error ?? new Error('read failed'))
      r.readAsDataURL(file)
    })
  }
}

export function EditSchoolProfileModal({
  open,
  school,
  client,
  isPlatform,
  onClose,
  onSaved,
}: {
  open: boolean
  school: School | null
  /** Prefer full Client row when available (contact fields). */
  client?: Client | null
  isPlatform: boolean
  onClose: () => void
  onSaved: (school: School, client: Client) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [schoolId, setSchoolId] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [contactName, setContactName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [clearLogo, setClearLogo] = useState(false)
  const [clearImage, setClearImage] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !school) return
    setName(school.name ?? '')
    setSchoolId(school.slug ?? client?.slug ?? '')
    setCity(school.city === '—' ? '' : (school.city ?? ''))
    setAddress(client?.address ?? '')
    setEmail(client?.contact_email ?? '')
    setPhone(client?.contact_phone ?? '')
    setContactName(client?.contact_name ?? '')
    setLogoUrl(school.logoUrl ?? client?.logo_url ?? '')
    setImageUrl(school.imageUrl ?? client?.image_url ?? '')
    setLogoFile(null)
    setImageFile(null)
    setClearLogo(false)
    setClearImage(false)
  }, [open, school, client])

  if (!school) return null

  const preview: School = {
    ...school,
    name: name.trim() || school.name,
    slug: schoolId.trim() || school.slug,
    logoUrl: clearLogo ? null : (logoUrl.trim() || school.logoUrl),
    imageUrl: clearImage ? null : (imageUrl.trim() || school.imageUrl),
  }

  const save = async () => {
    if (!name.trim()) {
      toast.danger('Name required', 'Enter the school name.')
      return
    }
    if (!isValidSchoolId(schoolId)) {
      toast.danger('Invalid school ID', 'Use 3–40 characters: letters, numbers, hyphens (e.g. scc or riverdale-blr).')
      return
    }
    const emailErr = validateEmail(email)
    if (emailErr) {
      toast.danger('Invalid contact email', emailErr)
      return
    }
    const phoneErr = validatePhone(phone)
    if (phoneErr) {
      toast.danger('Invalid contact phone', phoneErr)
      return
    }
    setBusy(true)
    try {
      let nextLogo = logoUrl.trim() || null
      let nextImage = imageUrl.trim() || null
      let setLogo = clearLogo || !!logoFile || (logoUrl.trim() !== (school.logoUrl ?? client?.logo_url ?? ''))
      let setImage = clearImage || !!imageFile || (imageUrl.trim() !== (school.imageUrl ?? client?.image_url ?? ''))

      if (logoFile) {
        nextLogo = await toDataUrl(logoFile, 'logo')
        setLogo = true
      }
      if (imageFile) {
        nextImage = await toDataUrl(imageFile, 'cover')
        setImage = true
      }
      if (clearLogo) {
        nextLogo = null
        setLogo = true
      }
      if (clearImage) {
        nextImage = null
        setImage = true
      }

      const updated = await updateSchoolProfile(school.id, {
        name: name.trim(),
        slug: normalizeSchoolId(schoolId),
        country: city.trim() || undefined,
        address: address.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_email: email.trim() || undefined,
        contact_phone: phone.trim() || undefined,
        set_logo: setLogo,
        set_image: setImage,
        logo_url: setLogo ? nextLogo : undefined,
        image_url: setImage ? nextImage : undefined,
      }, isPlatform)

      const mapped = clientToSchool(updated)
      toast.success('School updated', `${mapped.name} profile, logo and image saved.`)
      onSaved(mapped, updated)
      onClose()
    } catch (e) {
      toast.danger('Could not save', e instanceof ApiError ? e.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      size="lg"
      title="Edit school"
      icon="building"
      footer={
        <div className="row gap8 jc-end" style={{ width: '100%' }}>
          <Btn disabled={busy} onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="check" disabled={busy} onClick={() => { void save() }}>
            {busy ? <><Spinner size={14} /> Saving…</> : 'Save changes'}
          </Btn>
        </div>
      }
    >
      <div className="col gap16">
        <div className="row ai-center gap14">
          <SchoolPhoto school={preview} size={72} />
          <SchoolMark school={preview} size={40} round />
          <div className="t-sm muted">Round photo shows on the school dashboard · logo in sidebar & switcher.</div>
        </div>

        <Field label="School name" required>
          <Input icon="building" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="School ID"
          required
          hint="Unique short code for this school (letters, numbers, hyphens)."
          error={
            schoolId.trim().length > 0 && !isValidSchoolId(schoolId)
              ? 'Use 3–40 characters: letters, numbers, hyphens (e.g. scc or riverdale-blr)'
              : undefined
          }
        >
          <Input
            icon="key"
            value={schoolId}
            placeholder="e.g. riverdale-blr"
            onChange={(e) => {
              const next = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '')
                .replace(/--+/g, '-')
                .slice(0, 40)
              setSchoolId(next)
            }}
          />
        </Field>
        <Field label="Address">
          <Input icon="pin" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, district, city, state, PIN" />
        </Field>
        <div className="sm-grid-2">
          <Field label="City / location">
            <Input icon="pin" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Contact name">
            <Input icon="user" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Contact email">
            <Input icon="message" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contact phone">
            <Input icon="phone" digits={10} placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <div className="sm-grid-2" style={{ alignItems: 'start' }}>
          <Field label="School logo" hint="PNG/JPG under 4 MB.">
            <FileUpload
              accept=".png,.jpg,.jpeg,.webp,image/*"
              value={logoFile}
              ariaLabel="Upload school logo"
              onChange={(f) => {
                setLogoFile(f)
                setClearLogo(false)
                if (f) setLogoUrl('')
              }}
            />
            <Input
              icon="globe"
              style={{ marginTop: 8 }}
              value={logoUrl}
              placeholder="Or paste logo URL"
              onChange={(e) => {
                setLogoUrl(e.target.value)
                setLogoFile(null)
                setClearLogo(false)
              }}
            />
            <Btn size="sm" variant="ghost" style={{ marginTop: 6 }} onClick={() => { setClearLogo(true); setLogoUrl(''); setLogoFile(null) }}>
              Remove logo
            </Btn>
          </Field>
          <Field label="School image" hint="Round photo on dashboard.">
            <FileUpload
              accept=".png,.jpg,.jpeg,.webp,image/*"
              value={imageFile}
              ariaLabel="Upload school image"
              onChange={(f) => {
                setImageFile(f)
                setClearImage(false)
                if (f) setImageUrl('')
              }}
            />
            <Input
              icon="globe"
              style={{ marginTop: 8 }}
              value={imageUrl}
              placeholder="Or paste image URL"
              onChange={(e) => {
                setImageUrl(e.target.value)
                setImageFile(null)
                setClearImage(false)
              }}
            />
            <Btn size="sm" variant="ghost" style={{ marginTop: 6 }} onClick={() => { setClearImage(true); setImageUrl(''); setImageFile(null) }}>
              Remove image
            </Btn>
          </Field>
        </div>
      </div>
    </Modal>
  )
}
