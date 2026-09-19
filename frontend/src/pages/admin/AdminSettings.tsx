import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api/adminApi';
import type { AdminSystemSettings } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminSettings() {
  const [settings, setSettings] = useState<AdminSystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [gpsInterval, setGpsInterval] = useState(5);
  const [refundWindow, setRefundWindow] = useState(30);
  const [commissionPercent, setCommissionPercent] = useState(1.0);
  const [maxUnassignedVehicles, setMaxUnassignedVehicles] = useState(50);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [fcmNotifications, setFcmNotifications] = useState(true);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.getSystemSettings();
      setSettings(data);
      setGpsInterval(data.gps_interval_seconds);
      setRefundWindow(data.refund_window_minutes);
      setCommissionPercent(data.platform_commission_percent);
      setMaxUnassignedVehicles(data.max_unassigned_vehicles || 50);
      setMaintenanceMode(data.maintenance_mode);
      setFcmNotifications(data.fcm_notifications_enabled);
    } catch {
      // Handled in adminApi fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updated = await adminApi.updateSystemSettings({
        gps_interval_seconds: Number(gpsInterval),
        refund_window_minutes: Number(refundWindow),
        platform_commission_percent: Number(commissionPercent),
        max_unassigned_vehicles: Number(maxUnassignedVehicles),
        maintenance_mode: maintenanceMode,
        fcm_notifications_enabled: fcmNotifications,
      });
      setSettings(updated);
      setToastMessage("Tizim global parametrlari muvaffaqiyatli saqlandi.");
    } catch (err: any) {
      alert("Sozlamalarni saqlashda xatolik: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="admin-page-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '1.5rem',
            right: '1.5rem',
            zIndex: 9999,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--admin-accent)',
            color: 'var(--text-primary)',
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <i className="ri-checkbox-circle-fill" style={{ color: 'var(--admin-accent)', fontSize: '1.25rem' }} />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', marginLeft: '0.5rem' }}
          >
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-settings-4-line" style={{ color: 'var(--admin-accent)' }} />
            Tizim Global Sozlamalari
          </h1>
          <p>Butun platforma bo'yicha telemetriya, moliyaviy komissiya, push xabarlar va texnik xizmat rejimi</p>
        </div>

        {settings && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            So'nggi yangilanish: {new Date(settings.updated_at).toLocaleString('uz-UZ')} ({settings.updated_by})
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="ri-loader-4-line ri-spin" style={{ fontSize: '2.5rem', color: 'var(--admin-accent)' }} />
          <p style={{ marginTop: '0.75rem' }}>Sozlamalar yuklanmoqda...</p>
        </div>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 860 }}>
          {/* Telemetriya & GPS Sozlamalari */}
          <div className="settings-section-card">
            <h3>
              <i className="ri-map-pin-time-line" style={{ color: 'var(--admin-accent)' }} />
              Telemetriya va Jonli Geoxaritalash
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div className="form-group">
                <label>
                  Haydovchi GPS uzatish davriyligi (soniya)
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'block', fontWeight: 'normal' }}>
                    Tavsiya etiladi: 3-10 soniya oralig'ida
                  </span>
                </label>
                <input
                  type="number"
                  min="2"
                  max="60"
                  value={gpsInterval}
                  onChange={e => setGpsInterval(Number(e.target.value))}
                  required
                />
              </div>

              <div className="form-group">
                <label>
                  To'lovni bekor qilish (Refund) vaqti (daqiqa)
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'block', fontWeight: 'normal' }}>
                    Haydovchi qabul qilgandan keyin ruxsat etilgan muddat
                  </span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={refundWindow}
                  onChange={e => setRefundWindow(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </div>

          {/* Moliya va Komissiya */}
          <div className="settings-section-card">
            <h3>
              <i className="ri-percent-line" style={{ color: 'var(--admin-accent)' }} />
              Platforma Komissiyasi va Moliyaviy Limitlar
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div className="form-group">
                <label>
                  Platforma komissiyasi (%)
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'block', fontWeight: 'normal' }}>
                    Har bir qatnov to'lovidan avtomatik ushlab qolinadigan ulush
                  </span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="20"
                  value={commissionPercent}
                  onChange={e => setCommissionPercent(Number(e.target.value))}
                  required
                />
              </div>

              <div className="form-group">
                <label>
                  Bitta uyushmaga ruxsat etilgan erkin mashinalar soni
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'block', fontWeight: 'normal' }}>
                    Yo'nalishga biriktirilmagan zaxira transportlar limiti
                  </span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={maxUnassignedVehicles}
                  onChange={e => setMaxUnassignedVehicles(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </div>

          {/* Tizim Rejimlari va Integratsiyalar */}
          <div className="settings-section-card">
            <h3>
              <i className="ri-shield-keyhole-line" style={{ color: 'var(--admin-accent)' }} />
              Tizim Xavfsizligi va Rejimlari
            </h3>

            <div className="settings-toggle-row">
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  FCM Push Bildirishnomalari
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Haydovchi va yo'lovchi PWA/mobil ilovalariga avtomatik bildirishnomalar yuborish
                </div>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 46, height: 26 }}>
                <input
                  type="checkbox"
                  checked={fcmNotifications}
                  onChange={e => setFcmNotifications(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: fcmNotifications ? 'var(--admin-accent)' : 'var(--surface-sunken)',
                    borderRadius: 34,
                    transition: '0.3s',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      content: '""',
                      height: 18,
                      width: 18,
                      left: fcmNotifications ? 22 : 4,
                      bottom: 3,
                      background: 'white',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }}
                  />
                </span>
              </label>
            </div>

            <div className="settings-toggle-row">
              <div>
                <div style={{ fontWeight: 600, color: maintenanceMode ? 'var(--danger)' : 'var(--text-primary)' }}>
                  Texnik Xizmat Ko'rsatish Rejimi (Maintenance Mode)
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Yoqilganda mobil ilovalar va dispecher panellari faoliyatini vaqtinchalik to'xtatadi
                </div>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: 46, height: 26 }}>
                <input
                  type="checkbox"
                  checked={maintenanceMode}
                  onChange={e => setMaintenanceMode(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: maintenanceMode ? 'var(--danger)' : 'var(--surface-sunken)',
                    borderRadius: 34,
                    transition: '0.3s',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      content: '""',
                      height: 18,
                      width: 18,
                      left: maintenanceMode ? 22 : 4,
                      bottom: 3,
                      background: 'white',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }}
                  />
                </span>
              </label>
            </div>

            {maintenanceMode && (
              <div className="dangerous-action-banner" style={{ marginTop: '0.5rem' }}>
                <i className="ri-alert-line" />
                <div>
                  <strong>DIQQAT:</strong> Texnik xizmat rejimi yoqilgan paytda yangi qatnovlar va to'lovlar qabul qilinmaydi! Faqat Super Admin hisoblari tizimga kira oladi.
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              type="button"
              className="btn-operations-secondary"
              onClick={loadData}
              disabled={isSaving}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              className="btn-admin-primary"
              disabled={isSaving}
              style={{ padding: '0.75rem 1.75rem', fontSize: '0.9rem' }}
            >
              {isSaving ? (
                <>
                  <i className="ri-loader-4-line ri-spin" /> Saqlanmoqda...
                </>
              ) : (
                <>
                  <i className="ri-save-3-line" /> Sozlamalarni Saqlash
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
