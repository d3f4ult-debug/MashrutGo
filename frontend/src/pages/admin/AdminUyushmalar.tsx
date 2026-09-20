import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApi, buildUyushmaCreateBody, buildUyushmaUpdateBody, normalizePhone } from '../../services/api/adminApi'
import { ApiError, errorMessage } from '../../services/api/client'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import { formatDate } from '../../utils/format'
import type { AdminUyushma, AdminUyushmaCreateInput, UyushmaStatus } from '../../types/admin'
import { AdminModal, Alert, EmptyState, ErrorState, LoadingState, Toast, isAbortError, useToast } from './adminShared'
import './AdminOperations.css'
import '../uyushma/UyushmaOperations.css'

type StatusFilter = 'all' | UyushmaStatus

interface FormState {
  name: string
  code: string
  phone: string
  region: string
  address: string
  contact_person: string
  license_number: string
  withAdmin: boolean
  admin_full_name: string
  admin_phone: string
  admin_password: string
  admin_password_confirm: string
}

const EMPTY_FORM: FormState = {
  name: '',
  code: '',
  phone: '+998',
  region: '',
  address: '',
  contact_person: '',
  license_number: '',
  withAdmin: true,
  admin_full_name: '',
  admin_phone: '+998',
  admin_password: '',
  admin_password_confirm: '',
}

export function AdminUyushmalar() {
  const { reloadOptions } = useUyushmaScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast, show: showToast, hide: hideToast } = useToast()

  const [uyushmalar, setUyushmalar] = useState<AdminUyushma[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Create / edit form
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<AdminUyushma | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Archive (dangerous)
  const [archiving, setArchiving] = useState<AdminUyushma | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [archiveCodeConfirm, setArchiveCodeConfirm] = useState('')
  const [archiveError, setArchiveError] = useState<ApiError | Error | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  // Uyushma admin login (create or reset)
  const [accountFor, setAccountFor] = useState<AdminUyushma | null>(null)
  const [accountName, setAccountName] = useState('')
  const [accountPhone, setAccountPhone] = useState('+998')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountPassword2, setAccountPassword2] = useState('')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [isSavingAccount, setIsSavingAccount] = useState(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)
    try {
      const list = await adminApi.getUyushmalar(controller.signal)
      if (controller.signal.aborted) return
      setUyushmalar(list)
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return
      setLoadError(errorMessage(err, 'Uyushmalar ro‘yxatini yuklab bo‘lmadi'))
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowPassword(false)
    setFormMode('create')
  }, [])

  // Dashboard "Yangi Uyushma" deep link: /admin/uyushmalar?create=1
  useEffect(() => {
    if (searchParams.get('create') === '1') {
      openCreate()
      const next = new URLSearchParams(searchParams)
      next.delete('create')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, openCreate])

  const openEdit = (u: AdminUyushma) => {
    setEditing(u)
    setForm({
      ...EMPTY_FORM,
      name: u.name,
      code: u.code,
      phone: u.phone,
      region: u.region ?? '',
      address: u.address ?? '',
      contact_person: u.contact_person ?? '',
      license_number: u.license_number ?? '',
      withAdmin: false,
    })
    setFormError(null)
    setFormMode('edit')
  }

  const closeForm = () => {
    if (isSaving) return
    setFormMode(null)
    setEditing(null)
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async () => {
    setFormError(null)
    try {
      if (formMode === 'create') {
        if (form.withAdmin && form.admin_password !== form.admin_password_confirm) {
          throw new Error('Admin paroli va tasdiqlash paroli bir xil emas')
        }
        const input: AdminUyushmaCreateInput = {
          name: form.name,
          code: form.code,
          phone: form.phone,
          region: form.region,
          address: form.address,
          contact_person: form.contact_person,
          license_number: form.license_number,
          admin: form.withAdmin
            ? { full_name: form.admin_full_name, phone: form.admin_phone, password: form.admin_password }
            : null,
        }
        buildUyushmaCreateBody(input) // client-side validation before the request
        setIsSaving(true)
        const created = await adminApi.createUyushma(input)
        showToast(
          form.withAdmin
            ? `"${created.name}" yaratildi. Admin ${normalizePhone(form.admin_phone)} raqami bilan tizimga kira oladi.`
            : `"${created.name}" yaratildi (admin akkauntisiz).`,
        )
      } else if (formMode === 'edit' && editing) {
        const input = {
          name: form.name,
          phone: form.phone,
          region: form.region,
          address: form.address,
          contact_person: form.contact_person,
          license_number: form.license_number,
        }
        buildUyushmaUpdateBody(input)
        setIsSaving(true)
        const updated = await adminApi.updateUyushma(editing.id, input)
        setUyushmalar((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev)
        showToast(`"${updated.name}" ma’lumotlari saqlandi.`)
      }
      setFormMode(null)
      setEditing(null)
      reloadOptions()
      load()
    } catch (err) {
      setFormError(errorMessage(err, 'Saqlashda xatolik yuz berdi'))
    } finally {
      setIsSaving(false)
    }
  }

  const openAccount = (u: AdminUyushma) => {
    setAccountFor(u)
    setAccountName('')
    setAccountPhone(u.admin_phone ?? '+998')
    setAccountPassword('')
    setAccountPassword2('')
    setAccountError(null)
  }

  const handleSaveAccount = async () => {
    if (!accountFor) return
    if (accountPassword !== accountPassword2) {
      setAccountError('Parollar mos kelmadi')
      return
    }
    setAccountError(null)
    setIsSavingAccount(true)
    try {
      const updated = await adminApi.setUyushmaAdmin(accountFor.id, {
        full_name: accountName,
        phone: accountPhone,
        password: accountPassword,
      })
      setUyushmalar((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev)
      showToast(
        accountFor.admin_phone
          ? `Admin logini yangilandi: ${updated.admin_phone}. Eski parol endi ishlamaydi.`
          : `Admin akkaunti yaratildi: ${updated.admin_phone}`,
      )
      setAccountFor(null)
    } catch (err) {
      setAccountError(errorMessage(err, 'Admin akkauntini saqlab bo‘lmadi'))
    } finally {
      setIsSavingAccount(false)
    }
  }

  const openArchive = (u: AdminUyushma) => {
    setArchiving(u)
    setArchiveReason('')
    setArchiveCodeConfirm('')
    setArchiveError(null)
  }

  const handleArchive = async () => {
    if (!archiving) return
    setArchiveError(null)
    setIsArchiving(true)
    try {
      const archived = await adminApi.archiveUyushma(archiving.id, archiveReason)
      setUyushmalar((prev) => prev?.map((u) => (u.id === archived.id ? archived : u)) ?? prev)
      showToast(`"${archived.name}" arxivlandi. Amal audit jurnaliga yozildi.`)
      setArchiving(null)
      reloadOptions()
    } catch (err) {
      setArchiveError(err instanceof Error ? err : new Error(errorMessage(err)))
    } finally {
      setIsArchiving(false)
    }
  }

  const counts = useMemo(() => {
    const list = uyushmalar ?? []
    return {
      all: list.length,
      active: list.filter((u) => u.status === 'active').length,
      archived: list.filter((u) => u.status === 'archived').length,
    }
  }, [uyushmalar])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (uyushmalar ?? []).filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (!q) return true
      return [u.name, u.code, u.region, u.phone, u.admin_phone, u.contact_person, u.license_number, u.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [uyushmalar, search, statusFilter])

  const archiveReasonOk = archiveReason.trim().length >= 3
  const archiveCodeOk = archiving ? archiveCodeConfirm.trim() === archiving.code : false

  return (
    <div className="admin-page-container">
      <Toast toast={toast} onClose={hideToast} />

      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-building-2-line" style={{ color: 'var(--admin-accent)' }} />
            Uyushmalar boshqaruvi
          </h1>
          <p>Tashuvchi tashkilotlarni ro‘yxatdan o‘tkazish, admin akkauntini berish, tahrirlash va arxivlash</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button type="button" className="btn-secondary-action" onClick={load} disabled={isLoading}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Yangilash
          </button>
          <button type="button" className="btn-admin-primary" onClick={openCreate}>
            <i className="ri-add-line" />
            Yangi Uyushma
          </button>
        </div>
      </div>

      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="search"
            placeholder="Nomi, kodi, hudud, telefon, admin telefoni..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Uyushma qidirish"
          />
        </div>
        <div className="admin-segmented" role="tablist" aria-label="Holat bo‘yicha filtr">
          {(
            [
              ['all', `Hammasi (${counts.all})`],
              ['active', `Faol (${counts.active})`],
              ['archived', `Arxivlangan (${counts.archived})`],
            ] as [StatusFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={statusFilter === key ? 'active' : ''}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError && uyushmalar && <Alert>Ro‘yxatni yangilab bo‘lmadi: {loadError}</Alert>}

      <div className="uyushma-table-wrapper">
        {!uyushmalar && isLoading ? (
          <LoadingState label="Uyushmalar yuklanmoqda..." />
        ) : !uyushmalar ? (
          <ErrorState message={loadError ?? 'Uyushmalar ro‘yxatini yuklab bo‘lmadi'} onRetry={load} />
        ) : uyushmalar.length === 0 ? (
          <EmptyState
            icon="ri-building-2-line"
            title="Hali birorta Uyushma ro‘yxatdan o‘tkazilmagan"
            hint="“Yangi Uyushma” tugmasi orqali birinchi tashkilotni qo‘shing"
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon="ri-search-line" title="Filtr bo‘yicha Uyushma topilmadi" />
        ) : (
          <table className="uyushma-table">
            <thead>
              <tr>
                <th>Uyushma</th>
                <th>Aloqa</th>
                <th>Admin login</th>
                <th>Litsenziya</th>
                <th>Resurslar</th>
                <th>Holat</th>
                <th style={{ textAlign: 'right' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={u.status === 'archived' ? { opacity: 0.75 } : undefined}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    <div className="admin-muted">
                      <span className="vehicle-plate-badge" style={{ color: 'var(--admin-accent)', fontSize: '0.72rem' }}>
                        {u.code}
                      </span>{' '}
                      {u.region ?? 'Hudud ko‘rsatilmagan'}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.phone}</div>
                    <div className="admin-muted">{u.contact_person ?? 'Mas’ul shaxs ko‘rsatilmagan'}</div>
                    {u.address && <div className="admin-muted">{u.address}</div>}
                  </td>
                  <td>
                    {u.admin_phone ? (
                      <span className="admin-mono">{u.admin_phone}</span>
                    ) : (
                      <span className="status-pill warning" title="Bu Uyushmaga admin akkaunti biriktirilmagan">
                        <i className="ri-user-unfollow-line" /> Admin yo‘q
                      </span>
                    )}
                  </td>
                  <td>{u.license_number ? <span className="admin-mono">{u.license_number}</span> : <span className="admin-muted">—</span>}</td>
                  <td className="admin-muted" style={{ whiteSpace: 'nowrap' }}>
                    <div>
                      <strong style={{ color: 'var(--accent-primary)' }}>{u.routes_count}</strong> yo‘nalish
                    </div>
                    <div>
                      <strong style={{ color: 'var(--success)' }}>{u.drivers_count}</strong> haydovchi
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>{u.vehicles_count}</strong> transport
                    </div>
                  </td>
                  <td>
                    {u.status === 'active' ? (
                      <span className="status-pill active">Faol</span>
                    ) : (
                      <div>
                        <span className="status-pill inactive">Arxivlangan</span>
                        <div className="admin-muted" style={{ marginTop: '0.2rem' }}>{formatDate(u.archived_at)}</div>
                        {u.archive_reason && (
                          <div className="admin-muted" style={{ maxWidth: 200 }} title={u.archive_reason}>
                            Sabab: {u.archive_reason}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn-table-action" onClick={() => openEdit(u)} title="Tahrirlash">
                        <i className="ri-edit-line" />
                      </button>
                      {u.status === 'active' && (
                        <button
                          type="button"
                          className="btn-table-action"
                          onClick={() => openAccount(u)}
                          title={u.admin_phone ? 'Admin loginini tiklash (yangi parol)' : 'Admin akkaunti yaratish'}
                        >
                          <i className={u.admin_phone ? 'ri-key-2-line' : 'ri-user-add-line'} />
                        </button>
                      )}
                      {u.status === 'active' && (
                        <button
                          type="button"
                          className="btn-table-action danger"
                          onClick={() => openArchive(u)}
                          title="Arxivlash (xavfli amal)"
                        >
                          <i className="ri-archive-line" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit */}
      {formMode && (
        <AdminModal
          title={formMode === 'create' ? 'Yangi Uyushma' : 'Uyushmani tahrirlash'}
          icon="ri-building-2-line"
          onClose={closeForm}
          busy={isSaving}
          maxWidth={640}
          onSubmit={handleSave}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={closeForm} disabled={isSaving}>
                Bekor qilish
              </button>
              <button type="submit" className="btn-admin-primary" disabled={isSaving}>
                <i className={isSaving ? 'ri-loader-4-line admin-spin' : 'ri-save-line'} />
                {isSaving ? 'Saqlanmoqda...' : formMode === 'create' ? 'Yaratish' : 'Saqlash'}
              </button>
            </>
          }
        >
          {formError && <Alert>{formError}</Alert>}

          <div className="uyushma-form-group">
            <label htmlFor="uy-name">Uyushma nomi *</label>
            <input
              id="uy-name"
              className="uyushma-input"
              value={form.name}
              maxLength={150}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Masalan: Asaka Yo‘lovchi Tashish Uyushmasi"
              autoFocus
            />
          </div>

          <div className="form-grid-2">
            <div className="uyushma-form-group">
              <label htmlFor="uy-code">Kod *</label>
              <input
                id="uy-code"
                className="uyushma-input admin-mono"
                value={form.code}
                maxLength={50}
                onChange={(e) => setField('code', e.target.value.toUpperCase())}
                placeholder="AND-02"
                disabled={formMode === 'edit'}
              />
              <span className="hint">
                {formMode === 'edit' ? 'Kodni o‘zgartirib bo‘lmaydi' : 'Noyob: lotin harflari, raqamlar, "-" va "_"'}
              </span>
            </div>
            <div className="uyushma-form-group">
              <label htmlFor="uy-phone">Tashkilot telefoni *</label>
              <input
                id="uy-phone"
                className="uyushma-input"
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="+998742230001"
              />
              <span className="hint">+998XXXXXXXXX</span>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="uyushma-form-group">
              <label htmlFor="uy-region">Hudud</label>
              <input
                id="uy-region"
                className="uyushma-input"
                value={form.region}
                maxLength={150}
                onChange={(e) => setField('region', e.target.value)}
                placeholder="Andijon viloyati, Asaka tumani"
              />
            </div>
            <div className="uyushma-form-group">
              <label htmlFor="uy-contact">Mas’ul shaxs</label>
              <input
                id="uy-contact"
                className="uyushma-input"
                value={form.contact_person}
                maxLength={100}
                onChange={(e) => setField('contact_person', e.target.value)}
                placeholder="F.I.Sh."
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="uyushma-form-group">
              <label htmlFor="uy-address">Manzil</label>
              <input
                id="uy-address"
                className="uyushma-input"
                value={form.address}
                maxLength={255}
                onChange={(e) => setField('address', e.target.value)}
              />
            </div>
            <div className="uyushma-form-group">
              <label htmlFor="uy-license">Litsenziya raqami</label>
              <input
                id="uy-license"
                className="uyushma-input admin-mono"
                value={form.license_number}
                maxLength={60}
                onChange={(e) => setField('license_number', e.target.value)}
                placeholder="Rasmiy hujjatdagi raqam"
              />
            </div>
          </div>

          {formMode === 'edit' && editing && (
            <div className="admin-summary-box">
              <span>Uyushma admin logini</span>
              <strong className="admin-mono">{editing.admin_phone ?? 'Biriktirilmagan'}</strong>
              <span className="admin-muted">
                Admin loginini yaratish yoki parolini tiklash uchun ro‘yxatdagi <i className="ri-key-2-line" /> tugmasidan foydalaning.
              </span>
            </div>
          )}

          {formMode === 'create' && (
            <div className="settings-section-card" style={{ padding: '1rem', gap: '0.85rem' }}>
              <div className="settings-toggle-row" style={{ padding: 0, borderBottom: 'none' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Uyushma admin akkaunti</div>
                  <div className="admin-muted">
                    Uyushma paneliga kirish shu login orqali beriladi. Keyinroq qo‘shib bo‘lmaydi.
                  </div>
                </div>
                <label className="admin-switch">
                  <input
                    type="checkbox"
                    checked={form.withAdmin}
                    onChange={(e) => setField('withAdmin', e.target.checked)}
                    aria-label="Admin akkauntini yaratish"
                  />
                  <span className="admin-switch__track" />
                </label>
              </div>

              {form.withAdmin ? (
                <>
                  <div className="form-grid-2">
                    <div className="uyushma-form-group">
                      <label htmlFor="uy-admin-name">Admin F.I.Sh. *</label>
                      <input
                        id="uy-admin-name"
                        className="uyushma-input"
                        value={form.admin_full_name}
                        maxLength={100}
                        onChange={(e) => setField('admin_full_name', e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="uyushma-form-group">
                      <label htmlFor="uy-admin-phone">Admin telefoni (login) *</label>
                      <input
                        id="uy-admin-phone"
                        className="uyushma-input"
                        type="tel"
                        value={form.admin_phone}
                        onChange={(e) => setField('admin_phone', e.target.value)}
                        autoComplete="off"
                        placeholder="+998901234567"
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="uyushma-form-group">
                      <label htmlFor="uy-admin-pass">Parol *</label>
                      <input
                        id="uy-admin-pass"
                        className="uyushma-input"
                        type={showPassword ? 'text' : 'password'}
                        value={form.admin_password}
                        maxLength={128}
                        onChange={(e) => setField('admin_password', e.target.value)}
                        autoComplete="new-password"
                      />
                      <span className="hint">Kamida 8 ta belgi</span>
                    </div>
                    <div className="uyushma-form-group">
                      <label htmlFor="uy-admin-pass2">Parolni tasdiqlang *</label>
                      <input
                        id="uy-admin-pass2"
                        className={`uyushma-input${form.admin_password_confirm && form.admin_password_confirm !== form.admin_password ? ' invalid' : ''}`}
                        type={showPassword ? 'text' : 'password'}
                        value={form.admin_password_confirm}
                        maxLength={128}
                        onChange={(e) => setField('admin_password_confirm', e.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <label className="admin-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                    Parolni ko‘rsatish
                  </label>
                </>
              ) : (
                <Alert tone="info">
                  Admin akkauntini keyinroq ham ro‘yxatdagi <i className="ri-user-add-line" /> tugmasi orqali yaratish mumkin. Ungacha
                  Uyushma paneliga faqat Super Admin kira oladi.
                </Alert>
              )}
            </div>
          )}
        </AdminModal>
      )}

      {/* Uyushma admin login: create or reset */}
      {accountFor && (
        <AdminModal
          title={accountFor.admin_phone ? 'Admin loginini tiklash' : 'Uyushma admin akkauntini yaratish'}
          icon={accountFor.admin_phone ? 'ri-key-2-line' : 'ri-user-add-line'}
          iconColor="var(--admin-accent)"
          onClose={() => !isSavingAccount && setAccountFor(null)}
          busy={isSavingAccount}
          onSubmit={handleSaveAccount}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={() => setAccountFor(null)} disabled={isSavingAccount}>
                Bekor qilish
              </button>
              <button
                type="submit"
                className="btn-admin-primary"
                disabled={isSavingAccount || accountName.trim().length < 2 || accountPassword.length < 8}
              >
                <i className={isSavingAccount ? 'ri-loader-4-line admin-spin' : 'ri-save-line'} />
                {isSavingAccount ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </>
          }
        >
          <div className="admin-summary-box">
            <span>Uyushma</span>
            <strong>{accountFor.name}</strong>
            <span>
              Hozirgi admin: <span className="admin-mono">{accountFor.admin_phone ?? 'yo‘q'}</span>
            </span>
          </div>
          {accountFor.admin_phone && (
            <Alert tone="warning">Saqlangandan so‘ng eski parol ishlamaydi. Yangi parolni adminga xavfsiz kanal orqali yetkazing.</Alert>
          )}
          {accountError && <Alert>{accountError}</Alert>}
          <div className="uyushma-form-group">
            <label htmlFor="acc-name">Admin F.I.Sh. *</label>
            <input id="acc-name" className="uyushma-input" value={accountName} maxLength={100} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div className="uyushma-form-group">
            <label htmlFor="acc-phone">Login (telefon) *</label>
            <input id="acc-phone" className="uyushma-input admin-mono" value={accountPhone} onChange={(e) => setAccountPhone(e.target.value)} />
          </div>
          <div className="form-grid-2">
            <div className="uyushma-form-group">
              <label htmlFor="acc-pw">Yangi parol (kamida 8 belgi) *</label>
              <input id="acc-pw" type="password" autoComplete="new-password" className="uyushma-input" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} />
            </div>
            <div className="uyushma-form-group">
              <label htmlFor="acc-pw2">Parolni takrorlang *</label>
              <input id="acc-pw2" type="password" autoComplete="new-password" className="uyushma-input" value={accountPassword2} onChange={(e) => setAccountPassword2(e.target.value)} />
            </div>
          </div>
        </AdminModal>
      )}

      {/* Archive confirmation */}
      {archiving && (
        <AdminModal
          title="Uyushmani arxivlash"
          icon="ri-alert-line"
          iconColor="var(--danger)"
          onClose={() => !isArchiving && setArchiving(null)}
          busy={isArchiving}
          onSubmit={handleArchive}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={() => setArchiving(null)} disabled={isArchiving}>
                Bekor qilish
              </button>
              <button type="submit" className="btn-admin-danger" disabled={isArchiving || !archiveReasonOk || !archiveCodeOk}>
                <i className={isArchiving ? 'ri-loader-4-line admin-spin' : 'ri-archive-line'} />
                {isArchiving ? 'Arxivlanmoqda...' : 'Arxivlashni tasdiqlash'}
              </button>
            </>
          }
        >
          <div className="dangerous-action-banner">
            <i className="ri-error-warning-fill" />
            <div>
              <strong>Diqqat!</strong> Arxivlashda Uyushmaning barcha yo‘nalishlari nashrdan olinadi ({archiving.routes_count} ta),
              transportlari va akkauntlari (admin va {archiving.drivers_count} ta haydovchi) faolsizlantiriladi — ular tizimga
              kira olmaydi. Hech qanday ma’lumot o‘chirilmaydi: hamyonlar, to‘lovlar va GPS tarixi saqlanib qoladi.
              Arxivdan qaytarish imkoniyati hozircha yo‘q. Faol smenalar bo‘lsa, avval ularni{' '}
              <Link to="/admin/shifts" className="admin-inline-link">
                yakunlang
              </Link>
              .
            </div>
          </div>

          <div className="admin-summary-box">
            <span>Tashkilot</span>
            <strong>{archiving.name}</strong>
            <span>
              Kod: <span className="admin-mono">{archiving.code}</span>
              {archiving.region ? ` • ${archiving.region}` : ''}
            </span>
          </div>

          {archiveError && (
            <Alert>
              {archiveError.message}
              {archiveError instanceof ApiError && archiveError.status === 409 && (
                <>
                  {' '}
                  <Link to="/admin/shifts" className="admin-inline-link">
                    Jonli smenalarni ochish
                  </Link>
                </>
              )}
            </Alert>
          )}

          <div className="uyushma-form-group">
            <label htmlFor="archive-reason">Arxivlash sababi (audit jurnaliga yoziladi) *</label>
            <textarea
              id="archive-reason"
              className="uyushma-textarea"
              rows={3}
              maxLength={255}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Masalan: shartnoma bekor qilingan, litsenziya muddati tugagan..."
            />
            <span className="hint">Kamida 3 ta belgi • {archiveReason.trim().length}/255</span>
          </div>

          <div className="uyushma-form-group">
            <label htmlFor="archive-code">
              Tasdiqlash uchun Uyushma kodini kiriting: <span className="admin-mono">{archiving.code}</span>
            </label>
            <input
              id="archive-code"
              className="uyushma-input admin-mono"
              value={archiveCodeConfirm}
              onChange={(e) => setArchiveCodeConfirm(e.target.value)}
              autoComplete="off"
            />
          </div>
        </AdminModal>
      )}
    </div>
  )
}
