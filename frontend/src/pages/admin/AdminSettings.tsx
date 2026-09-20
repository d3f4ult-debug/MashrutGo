import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, diffSettings, NUMERIC_SETTING_SPECS, validateSettings } from '../../services/api/adminApi'
import { errorMessage } from '../../services/api/client'
import { formatDateTime, formatSom } from '../../utils/format'
import type { AdminSettingsValues, AdminSystemSettings, BooleanSettingKey, NumericSettingKey } from '../../types/admin'
import { AdminModal, Alert, ErrorState, LoadingState, Toast, isAbortError, useToast } from './adminShared'
import './AdminOperations.css'
import '../uyushma/UyushmaOperations.css'

interface NumericFieldMeta {
  label: string
  description: string
  unit: string
  step: number
}

const NUMERIC_FIELDS: Record<NumericSettingKey, NumericFieldMeta> = {
  gps_interval_seconds: {
    label: 'Haydovchi GPS yuborish intervali',
    description: 'Haydovchi ilovasi joylashuvni necha soniyada bir yuboradi',
    unit: 'soniya',
    step: 1,
  },
  refund_window_minutes: {
    label: 'To‘lovni qaytarish muddati',
    description: 'Haydovchi qabul qilingan to‘lovni shu vaqt ichida qaytara oladi (0 = qaytarib bo‘lmaydi)',
    unit: 'daqiqa',
    step: 1,
  },
  platform_commission_percent: {
    label: 'Platforma komissiyasi',
    description: 'Har bir yo‘l haqi to‘lovidan ushlab qolinadigan ulush',
    unit: '%',
    step: 0.1,
  },
  max_unassigned_vehicles: {
    label: 'Biriktirilmagan transportlar limiti',
    description: 'Bitta Uyushmada yo‘nalishga biriktirilmagan transportlar soni chegarasi',
    unit: 'ta',
    step: 1,
  },
  min_topup_uzs: {
    label: 'Minimal hamyon to‘ldirish summasi',
    description: 'Mijoz bir martada to‘ldira oladigan eng kichik summa',
    unit: 'so‘m',
    step: 100,
  },
  max_topup_uzs: {
    label: 'Maksimal hamyon to‘ldirish summasi',
    description: 'Mijoz bir martada to‘ldira oladigan eng katta summa',
    unit: 'so‘m',
    step: 1000,
  },
}

const BOOLEAN_FIELDS: Record<BooleanSettingKey, { label: string; description: string }> = {
  fcm_notifications_enabled: {
    label: 'Push bildirishnomalar (FCM)',
    description: 'Haydovchi va yo‘lovchi ilovalariga push bildirishnomalar yuborish',
  },
  maintenance_mode: {
    label: 'Texnik xizmat rejimi',
    description: 'Yoqilganda yangi yo‘l haqi to‘lovlari va hamyonni to‘ldirish bloklanadi',
  },
}

const SECTIONS: { title: string; icon: string; keys: NumericSettingKey[] }[] = [
  { title: 'Telemetriya', icon: 'ri-map-pin-time-line', keys: ['gps_interval_seconds'] },
  {
    title: 'To‘lovlar va komissiya',
    icon: 'ri-percent-line',
    keys: ['platform_commission_percent', 'refund_window_minutes', 'min_topup_uzs', 'max_topup_uzs'],
  },
  { title: 'Uyushma limitlari', icon: 'ri-bus-2-line', keys: ['max_unassigned_vehicles'] },
]

type NumericDraft = Record<NumericSettingKey, string>

const NUMERIC_KEYS = Object.keys(NUMERIC_SETTING_SPECS) as NumericSettingKey[]

function toDraft(s: AdminSettingsValues): NumericDraft {
  return NUMERIC_KEYS.reduce((acc, key) => ({ ...acc, [key]: String(s[key]) }), {} as NumericDraft)
}

function formatValue(key: keyof AdminSettingsValues, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yoqilgan' : 'O‘chirilgan'
  if (key === 'min_topup_uzs' || key === 'max_topup_uzs') return formatSom(Number(value))
  const meta = NUMERIC_FIELDS[key as NumericSettingKey]
  return meta ? `${Number(value).toLocaleString('ru-RU')} ${meta.unit}` : String(value)
}

function labelOf(key: keyof AdminSettingsValues): string {
  return NUMERIC_FIELDS[key as NumericSettingKey]?.label ?? BOOLEAN_FIELDS[key as BooleanSettingKey]?.label ?? key
}

export function AdminSettings() {
  const { toast, show: showToast, hide: hideToast } = useToast()

  const [settings, setSettings] = useState<AdminSystemSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [numbers, setNumbers] = useState<NumericDraft | null>(null)
  const [flags, setFlags] = useState<Record<BooleanSettingKey, boolean> | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const applyServer = (s: AdminSystemSettings) => {
    setSettings(s)
    setNumbers(toDraft(s))
    setFlags({ maintenance_mode: s.maintenance_mode, fcm_notifications_enabled: s.fcm_notifications_enabled })
  }

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)
    try {
      const s = await adminApi.getSettings(controller.signal)
      if (controller.signal.aborted) return
      applyServer(s)
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return
      setLoadError(errorMessage(err, 'Sozlamalarni yuklab bo‘lmadi'))
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const draft: AdminSettingsValues | null = useMemo(() => {
    if (!numbers || !flags) return null
    const parsed = NUMERIC_KEYS.reduce(
      (acc, key) => ({ ...acc, [key]: numbers[key].trim() === '' ? Number.NaN : Number(numbers[key]) }),
      {} as Record<NumericSettingKey, number>,
    )
    return { ...parsed, ...flags }
  }, [numbers, flags])

  const errors = useMemo(() => (draft ? validateSettings(draft) : {}), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const changes = useMemo(() => (settings && draft ? diffSettings(settings, draft) : {}), [settings, draft])
  const changedKeys = Object.keys(changes) as (keyof AdminSettingsValues)[]
  const enablingMaintenance = changes.maintenance_mode === true

  const resetDraft = () => {
    if (settings) applyServer(settings)
    setSaveError(null)
  }

  const handleSave = async () => {
    if (!changedKeys.length || hasErrors) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const updated = await adminApi.updateSettings(changes)
      applyServer(updated)
      setConfirmOpen(false)
      showToast(`${changedKeys.length} ta sozlama saqlandi va audit jurnaliga yozildi.`)
    } catch (err) {
      setSaveError(errorMessage(err, 'Sozlamalarni saqlab bo‘lmadi'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="admin-page-container">
      <Toast toast={toast} onClose={hideToast} />

      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-settings-4-line" style={{ color: 'var(--admin-accent)' }} />
            Tizim sozlamalari
          </h1>
          <p>
            {settings
              ? settings.updated_at
                ? `So‘nggi o‘zgartirish: ${formatDateTime(settings.updated_at)}${settings.updated_by ? ` • ${settings.updated_by}` : ''}`
                : 'Hali o‘zgartirilmagan — standart qiymatlar amalda'
              : 'Platforma bo‘yicha global parametrlar'}
          </p>
        </div>
        <div className="uyushma-page-header__actions">
          <button type="button" className="btn-secondary-action" onClick={load} disabled={isLoading || isSaving}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Qayta yuklash
          </button>
        </div>
      </div>

      {!settings && isLoading ? (
        <div className="admin-panel">
          <LoadingState label="Sozlamalar yuklanmoqda..." />
        </div>
      ) : !settings || !numbers || !flags || !draft ? (
        <div className="admin-panel">
          <ErrorState message={loadError ?? 'Sozlamalarni yuklab bo‘lmadi'} onRetry={load} />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (changedKeys.length && !hasErrors) {
              setSaveError(null)
              setConfirmOpen(true)
            }
          }}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 920 }}
        >
          {loadError && <Alert>Qayta yuklab bo‘lmadi: {loadError}</Alert>}

          {settings.maintenance_mode && (
            <Alert tone="warning">
              <strong>Texnik xizmat rejimi hozir yoqilgan.</strong> Yangi yo‘l haqi to‘lovlari va hamyonni to‘ldirish qabul qilinmayapti.
            </Alert>
          )}

          {SECTIONS.map((section) => (
            <section key={section.title} className="settings-section-card">
              <h3>
                <i className={section.icon} style={{ color: 'var(--admin-accent)' }} />
                {section.title}
              </h3>
              <div className="settings-grid">
                {section.keys.map((key) => {
                  const meta = NUMERIC_FIELDS[key]
                  const spec = NUMERIC_SETTING_SPECS[key]
                  const error = errors[key]
                  const changed = key in changes
                  return (
                    <div key={key} className="uyushma-form-group">
                      <label htmlFor={`setting-${key}`}>
                        {meta.label} ({meta.unit})
                        {changed && <span className="settings-changed-dot" title="O‘zgartirilgan, hali saqlanmagan" />}
                      </label>
                      <input
                        id={`setting-${key}`}
                        className={`uyushma-input${error ? ' invalid' : ''}`}
                        type="number"
                        inputMode={spec.integer ? 'numeric' : 'decimal'}
                        min={spec.min}
                        max={spec.max}
                        step={meta.step}
                        value={numbers[key]}
                        onChange={(e) => setNumbers((n) => (n ? { ...n, [key]: e.target.value } : n))}
                        aria-invalid={Boolean(error)}
                        disabled={isSaving}
                      />
                      {error ? (
                        <span className="admin-field-error">{error}</span>
                      ) : (
                        <span className="hint">
                          {meta.description}. Ruxsat: {spec.min.toLocaleString('ru-RU')}–{spec.max.toLocaleString('ru-RU')}
                          {changed && ` • hozirgi: ${formatValue(key, settings[key])}`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          <section className="settings-section-card">
            <h3>
              <i className="ri-shield-keyhole-line" style={{ color: 'var(--admin-accent)' }} />
              Tizim rejimlari
            </h3>
            {(Object.keys(BOOLEAN_FIELDS) as BooleanSettingKey[]).map((key) => (
              <div key={key} className="settings-toggle-row">
                <div>
                  <div style={{ fontWeight: 600, color: key === 'maintenance_mode' && flags[key] ? 'var(--danger)' : 'var(--text-primary)' }}>
                    {BOOLEAN_FIELDS[key].label}
                    {key in changes && <span className="settings-changed-dot" title="O‘zgartirilgan, hali saqlanmagan" />}
                  </div>
                  <div className="admin-muted" style={{ fontSize: '0.8rem' }}>
                    {BOOLEAN_FIELDS[key].description}
                  </div>
                </div>
                <label className={`admin-switch${key === 'maintenance_mode' ? ' danger' : ''}`}>
                  <input
                    type="checkbox"
                    checked={flags[key]}
                    onChange={(e) => setFlags((f) => (f ? { ...f, [key]: e.target.checked } : f))}
                    disabled={isSaving}
                    aria-label={BOOLEAN_FIELDS[key].label}
                  />
                  <span className="admin-switch__track" />
                </label>
              </div>
            ))}
            {enablingMaintenance && (
              <div className="dangerous-action-banner">
                <i className="ri-alert-line" />
                <div>
                  <strong>Diqqat:</strong> saqlangandan so‘ng barcha mijozlar uchun yo‘l haqi to‘lash va hamyonni to‘ldirish to‘xtaydi,
                  toki rejim o‘chirilmaguncha. Kirish, GPS kuzatuv va jonli xarita ishlashda davom etadi.
                </div>
              </div>
            )}
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {changedKeys.length > 0 && (
              <span className="admin-muted">{changedKeys.length} ta o‘zgarish saqlanmagan</span>
            )}
            <button type="button" className="btn-secondary-action" onClick={resetDraft} disabled={isSaving || !changedKeys.length}>
              O‘zgarishlarni bekor qilish
            </button>
            <button type="submit" className="btn-admin-primary" disabled={isSaving || !changedKeys.length || hasErrors}>
              <i className="ri-save-3-line" />
              Saqlash
            </button>
          </div>
        </form>
      )}

      {confirmOpen && settings && (
        <AdminModal
          title="Sozlamalarni saqlashni tasdiqlang"
          icon={enablingMaintenance ? 'ri-alert-line' : 'ri-save-3-line'}
          iconColor={enablingMaintenance ? 'var(--danger)' : undefined}
          onClose={() => !isSaving && setConfirmOpen(false)}
          busy={isSaving}
          maxWidth={560}
          onSubmit={handleSave}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={() => setConfirmOpen(false)} disabled={isSaving}>
                Orqaga
              </button>
              <button type="submit" className={enablingMaintenance ? 'btn-admin-danger' : 'btn-admin-primary'} disabled={isSaving}>
                <i className={isSaving ? 'ri-loader-4-line admin-spin' : 'ri-check-line'} />
                {isSaving ? 'Saqlanmoqda...' : 'Tasdiqlash va saqlash'}
              </button>
            </>
          }
        >
          <p className="admin-muted" style={{ margin: 0 }}>
            Quyidagi o‘zgarishlar butun platformaga darhol ta’sir qiladi va audit jurnaliga yoziladi.
          </p>
          <div className="uyushma-table-wrapper" style={{ boxShadow: 'none' }}>
            <table className="uyushma-table">
              <thead>
                <tr>
                  <th>Sozlama</th>
                  <th>Hozirgi</th>
                  <th>Yangi</th>
                </tr>
              </thead>
              <tbody>
                {changedKeys.map((key) => (
                  <tr key={key}>
                    <td>{labelOf(key)}</td>
                    <td className="admin-muted">{formatValue(key, settings[key])}</td>
                    <td style={{ fontWeight: 700 }}>{formatValue(key, changes[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {enablingMaintenance && (
            <Alert tone="danger">Texnik xizmat rejimi yoqiladi: yangi to‘lovlar va hamyonni to‘ldirish darhol bloklanadi.</Alert>
          )}
          {saveError && <Alert>{saveError}</Alert>}
        </AdminModal>
      )}
    </div>
  )
}
