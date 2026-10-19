import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth as useSystemAuth } from '../../contexts/AuthContext';
import { useAuth as useClientAuth } from '../../services/auth/AuthProvider';
import { API_BASE } from '../../services/api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: 'client' | 'driver' | 'uyushma' | 'admin';
}

function formatUzPhone(value: string): string {
  let raw = value.replace(/\D/g, '');
  if (raw.startsWith('998')) {
    raw = raw.slice(3);
  }
  raw = raw.slice(0, 9);

  let formatted = '+998';
  if (raw.length > 0) formatted += ' ' + raw.slice(0, 2);
  if (raw.length > 2) formatted += ' ' + raw.slice(2, 5);
  if (raw.length > 5) formatted += ' ' + raw.slice(5, 7);
  if (raw.length > 7) formatted += ' ' + raw.slice(7, 9);
  return formatted;
}

export function WelcomeRoleModal({ isOpen, onClose, defaultRole }: Props) {
  const navigate = useNavigate();
  const { login: systemLogin } = useSystemAuth();
  const { signin: clientSignin } = useClientAuth();

  // Screen selection: 'selector' | 'client_auth' | 'driver_auth' | 'admin_auth'
  const [activeScreen, setActiveScreen] = useState<'selector' | 'client_auth' | 'driver_auth' | 'admin_auth'>('client_auth');

  // Sub-tabs for passenger/driver: 'login' | 'register'
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Common fields
  const [phone, setPhone] = useState('+998 ');
  const [fullName, setFullName] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState('');

  // Driver-specific fields
  const [licenseNumber, setLicenseNumber] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [selectedUyushmaId, setSelectedUyushmaId] = useState<string>('');
  const [uyushmasList, setUyushmasList] = useState<Array<{ id: number; name: string }>>([]);

  // Admin / Uyushma fields
  const [adminUsername, setAdminUsername] = useState('Admin');
  const [adminPassword, setAdminPassword] = useState('Adminkeldi1');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync defaultRole if opened with one
  useEffect(() => {
    if (defaultRole === 'driver') {
      setActiveScreen('driver_auth');
    } else if (defaultRole === 'admin' || defaultRole === 'uyushma') {
      setActiveScreen('admin_auth');
    } else if (defaultRole === 'client') {
      setActiveScreen('client_auth');
    } else {
      setActiveScreen('client_auth');
    }
  }, [defaultRole, isOpen]);

  // Fetch Uyushmas list for driver registration
  useEffect(() => {
    if (activeScreen === 'driver_auth') {
      fetch(`${API_BASE}/auth/uyushmas`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setUyushmasList(data);
            if (data.length > 0 && !selectedUyushmaId) {
              setSelectedUyushmaId(String(data[0].id));
            }
          }
        })
        .catch(() => {});
    }
  }, [activeScreen]);

  if (!isOpen) return null;

  const resetForm = () => {
    setError(null);
    setCodeSent(false);
    setSmsCode('');
    setLoading(false);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    if (nextVal.length < 4) {
      setPhone('+998 ');
      return;
    }
    setPhone(formatUzPhone(nextVal));
  };

  // ─────────────────────────────────────────────────────────────
  // PASSENGER AUTH
  // ─────────────────────────────────────────────────────────────
  const handlePassengerSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(3);
    if (digits.length !== 9) {
      setError('Telefon raqamini to‘liq kiriting: +998 99 999 99 99 (aniq 9 ta raqam)');
      return;
    }
    if (authMode === 'register' && !fullName.trim()) {
      setError('Iltimos, ism va familiyangizni kiriting');
      return;
    }
    setError(null);
    setLoading(true);

    const cleanPhone = '+998' + digits;
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, purpose: authMode === 'register' ? 'signup' : 'signin' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCodeSent(true);
      } else {
        setError(data.detail || 'SMS yuborishda xatolik yuz berdi');
      }
    } catch {
      // Local fallback
      setCodeSent(true);
    } finally {
      setLoading(false);
    }
  };

  const handlePassengerVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCode.trim()) {
      setError('Tasdiqlash kodini kiriting');
      return;
    }
    setError(null);
    setLoading(true);

    const cleanPhone = '+998' + phone.replace(/\D/g, '').slice(3);

    try {
      // Direct real OTP authentication/registration via DevSMS-verified endpoint
      const res = await fetch(`${API_BASE}/auth/login-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          code: smsCode.trim(),
          full_name: fullName.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || 'Tasdiqlash kodi noto‘g‘ri!');
        setLoading(false);
        return;
      }

      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      localStorage.setItem('mashrutgo_wallet_balance', '0');
      clientSignin({
        id: String(data.user.id),
        name: data.user.full_name,
        roles: ['client'],
      });
      onClose();
      window.location.reload();
    } catch (err: any) {
      setError(err?.message || 'Tarmoqqa ulanishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // DRIVER AUTH (Registration & Verification flow)
  // ─────────────────────────────────────────────────────────────
  const handleDriverSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(3);
    if (digits.length !== 9) {
      setError('Telefon raqamini to‘liq kiriting: +998 99 999 99 99 (9 ta raqam)');
      return;
    }
    if (authMode === 'register') {
      if (!fullName.trim() || !licenseNumber.trim() || !plateNumber.trim() || !vehicleModel.trim()) {
        setError('Barcha maydonlarni to‘ldiring (F.I.SH, Guvohnoma, Davlat raqami, Mashina modeli)');
        return;
      }
      if (!password || password.length < 6) {
        setError('Parol kamida 6 belgidan iborat bo‘lishi lozim');
        return;
      }
    } else {
      if (!password) {
        setError('Iltimos, parolingizni kiriting');
        return;
      }
    }

    setError(null);
    setLoading(true);

    const cleanPhone = '+998' + digits;
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, purpose: authMode === 'register' ? 'signup' : 'signin' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCodeSent(true);
      } else {
        setError(data.detail || 'SMS yuborishda xatolik yuz berdi');
      }
    } catch {
      setCodeSent(true);
    } finally {
      setLoading(false);
    }
  };

  const handleDriverVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCode.trim()) {
      setError('Tasdiqlash kodini kiriting');
      return;
    }
    setError(null);
    setLoading(true);

    const cleanPhone = '+998' + phone.replace(/\D/g, '').slice(3);

    try {
      // Verify OTP with backend
      const vRes = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, code: smsCode.trim() }),
      });

      if (!vRes.ok) {
        const vData = await vRes.json().catch(() => ({}));
        setError(vData.detail || 'Tasdiqlash kodi noto‘g‘ri!');
        setLoading(false);
        return;
      }
      if (authMode === 'register') {
        const regRes = await fetch(`${API_BASE}/auth/register-driver`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: cleanPhone,
            password: password,
            full_name: fullName.trim(),
            license_number: licenseNumber.trim(),
            plate_number: plateNumber.trim(),
            vehicle_model: vehicleModel.trim(),
            uyushma_id: selectedUyushmaId ? parseInt(selectedUyushmaId) : undefined,
          }),
        });

        if (!regRes.ok) {
          const errData = await regRes.json().catch(() => ({}));
          throw new Error(errData.detail || 'Haydovchi ro‘yxatdan o‘tishda xatolik yuz berdi');
        }

        const data = await regRes.json();
        localStorage.setItem('auth_token', data.access_token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        clientSignin({
          id: String(data.user.id),
          name: data.user.full_name,
          roles: ['driver'],
        });
        onClose();
        navigate('/driver');
        window.location.reload();
        return;
      }

      // Driver Login
      await systemLogin({ phone: cleanPhone, password: password });
      onClose();
      navigate('/driver');
    } catch (err: any) {
      setError(err?.message || 'Haydovchi tizimga kirishida xatolik');
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // SUPER ADMIN & UYUSHMA AUTH
  // ─────────────────────────────────────────────────────────────
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const val = adminUsername.trim();
    const formattedLogin = val.toLowerCase() === 'admin' ? 'Admin' : (val.startsWith('+') ? val : `+${val}`);

    try {
      await systemLogin({ phone: formattedLogin, password: adminPassword });
      onClose();
      // SystemAuth will redirect to role home
      const stored = localStorage.getItem('auth_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role === 'uyushma' || u.role === 'uyushma_admin') {
          navigate('/uyushma');
        } else {
          navigate('/admin');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Login yoki parol noto‘g‘ri kiritildi');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative my-auto max-h-[90vh] flex flex-col">
        {/* Top Header */}
        <div className="p-6 pb-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 text-white relative shrink-0">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-colors"
          >
            <i className="ri-close-line text-lg" />
          </button>

          {activeScreen !== 'selector' && (
            <button
              onClick={() => {
                setActiveScreen('selector');
                resetForm();
              }}
              className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white mb-2 transition-colors"
            >
              <i className="ri-arrow-left-line" /> Ortga qaytish
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-blue-300 text-2xl shadow-inner">
              {activeScreen === 'selector' && <i className="ri-steering-2-fill" />}
              {activeScreen === 'client_auth' && <i className="ri-user-heart-fill" />}
              {activeScreen === 'driver_auth' && <i className="ri-taxi-fill" />}
              {activeScreen === 'admin_auth' && <i className="ri-shield-user-fill" />}
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">MashrutGo</h2>
              <p className="text-xs text-blue-200/80">
                {activeScreen === 'selector' && 'Andijon jamoat transporti ekotizimi'}
                {activeScreen === 'client_auth' && 'Yo‘lovchi portali'}
                {activeScreen === 'driver_auth' && 'Haydovchi portali & Ro‘yxatdan o‘tish'}
                {activeScreen === 'admin_auth' && 'Uyushma & Super Admin portali'}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
              <i className="ri-error-warning-fill text-base shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ──────────────── SCREEN 1: ROLE SELECTOR ──────────────── */}
          {activeScreen === 'selector' && (
            <div className="space-y-4">
              <div className="text-center mb-5">
                <h3 className="text-lg font-bold text-slate-800">Siz kimsiz?</h3>
                <p className="text-xs text-slate-500">Iltimos, tizimga kirish turini tanlang</p>
              </div>

              {/* Main Options: Passenger & Driver */}
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => {
                    setActiveScreen('client_auth');
                    resetForm();
                  }}
                  className="group flex items-center p-4 rounded-2xl border-2 border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 transition-all text-left shadow-xs hover:shadow-md"
                >
                  <div className="w-14 h-14 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0 mr-4">
                    <i className="ri-user-line" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-base">Yo‘lovchi (Passenger)</span>
                      <i className="ri-arrow-right-line text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Marshrut qidirish, bekatlar, QR to‘lov va hamyon balansi
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActiveScreen('driver_auth');
                    resetForm();
                  }}
                  className="group flex items-center p-4 rounded-2xl border-2 border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 transition-all text-left shadow-xs hover:shadow-md"
                >
                  <div className="w-14 h-14 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0 mr-4">
                    <i className="ri-steering-2-line" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-base">Haydovchi (Driver)</span>
                      <i className="ri-arrow-right-line text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Smena ochish, GPS navigatsiya, tushumlar va Uyushma tasdiqlashi
                    </p>
                  </div>
                </button>
              </div>

              {/* Discreet Section: Uyushma & Admin */}
              <div className="pt-4 border-t border-slate-100 mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-center mb-2.5">
                  Boshqaruv va Ma'muriyat
                </div>
                <div className="flex items-center justify-center gap-4 text-xs font-medium">
                  <button
                    onClick={() => {
                      setActiveScreen('admin_auth');
                      setAdminUsername('');
                      setAdminPassword('');
                      resetForm();
                    }}
                    className="text-slate-600 hover:text-emerald-600 flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <i className="ri-building-line text-emerald-600" /> Uyushma Portali
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={() => {
                      setActiveScreen('admin_auth');
                      setAdminUsername('Admin');
                      setAdminPassword('Adminkeldi1');
                      resetForm();
                    }}
                    className="text-slate-600 hover:text-indigo-600 flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <i className="ri-shield-keyhole-line text-indigo-600" /> Super Admin
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── SCREEN 2: PASSENGER AUTH ──────────────── */}
          {activeScreen === 'client_auth' && (
            <div>
              {/* Tab: Login / Register */}
              <div className="flex rounded-xl bg-slate-100 p-1 mb-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    resetForm();
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${authMode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                >
                  Kirish
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    resetForm();
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${authMode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                >
                  Ro‘yxatdan o‘tish
                </button>
              </div>

              {!codeSent ? (
                <form onSubmit={handlePassengerSendOtp} className="space-y-3">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">F.I.SH (Ism-Familiya)</label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        placeholder="Masalan: Sardor Rahimov"
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Telefon raqam</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={handlePhoneChange}
                      placeholder="+998 90 123 45 67"
                      maxLength={17}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Format: +998 XX XXX XX XX (9 ta raqam)</p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    {loading ? 'Yuborilmoqda...' : 'SMS kod olish'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handlePassengerVerifyOtp} className="space-y-4">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-2">
                      <strong>{phone}</strong> raqamiga yuborilgan 4 xonali SMS kodni kiriting
                    </p>
                    <input
                      type="text"
                      maxLength={4}
                      value={smsCode}
                      onChange={e => setSmsCode(e.target.value)}
                      placeholder="____"
                      autoFocus
                      className="w-48 mx-auto text-center tracking-widest text-2xl font-bold py-2.5 border-2 border-blue-500 rounded-xl focus:outline-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    {loading ? 'Tasdiqlanmoqda...' : 'Tasdiqlash va tizimga kirish'}
                  </button>
                </form>
              )}

              <div className="pt-4 border-t border-slate-100 mt-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setActiveScreen('selector');
                    resetForm();
                  }}
                  className="text-xs text-slate-500 hover:text-blue-600 transition-colors font-medium inline-flex items-center gap-1"
                >
                  <i className="ri-steering-2-line text-slate-400" />
                  <span>Haydovchi yoki Boshqaruv xodimisizmi?</span>
                  <i className="ri-arrow-right-s-line text-sm" />
                </button>
              </div>
            </div>
          )}

          {/* ──────────────── SCREEN 3: DRIVER AUTH ──────────────── */}
          {activeScreen === 'driver_auth' && (
            <div>
              <div className="flex rounded-xl bg-slate-100 p-1 mb-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    resetForm();
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${authMode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                >
                  Kirish
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    resetForm();
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${authMode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                >
                  Haydovchi Ro‘yxatdan o‘tish
                </button>
              </div>

              {!codeSent ? (
                <form onSubmit={handleDriverSendOtp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Telefon raqam</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={handlePhoneChange}
                      placeholder="+998 90 123 45 67"
                      maxLength={17}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>

                  {authMode === 'register' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">F.I.SH (To‘liq)</label>
                        <input
                          type="text"
                          value={fullName}
                          onChange={e => setFullName(e.target.value)}
                          placeholder="Akramov Jamshid"
                          className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Guvohnoma №</label>
                          <input
                            type="text"
                            value={licenseNumber}
                            onChange={e => setLicenseNumber(e.target.value.toUpperCase())}
                            placeholder="AB 1234567"
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Davlat raqami</label>
                          <input
                            type="text"
                            value={plateNumber}
                            onChange={e => setPlateNumber(e.target.value.toUpperCase())}
                            placeholder="60 A 777 AA"
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Transport modeli</label>
                          <input
                            type="text"
                            value={vehicleModel}
                            onChange={e => setVehicleModel(e.target.value)}
                            placeholder="Isuzu NP37 / Damas"
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Uyushma tanlang</label>
                          <select
                            value={selectedUyushmaId}
                            onChange={e => setSelectedUyushmaId(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                          >
                            {uyushmasList.length === 0 ? (
                              <option value="1">Andijon Shahar Trans Servis</option>
                            ) : (
                              uyushmasList.map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Maxfiy parol</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    {loading ? 'Yuborilmoqda...' : 'SMS kod olish'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleDriverVerifyOtp} className="space-y-4">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-2">
                      <strong>{phone}</strong> raqamiga yuborilgan 4 xonali SMS kodni kiriting
                    </p>
                    <input
                      type="text"
                      maxLength={4}
                      value={smsCode}
                      onChange={e => setSmsCode(e.target.value)}
                      placeholder="____"
                      autoFocus
                      className="w-48 mx-auto text-center tracking-widest text-2xl font-bold py-2.5 border-2 border-emerald-500 rounded-xl focus:outline-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    {loading ? 'Tasdiqlanmoqda...' : 'Tasdiqlash va ro‘yxatga olish'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ──────────────── SCREEN 4: ADMIN / UYUSHMA AUTH ──────────────── */}
          {activeScreen === 'admin_auth' && (
            <form onSubmit={handleAdminLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Login / Foydalanuvchi nomi
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400">
                    <i className="ri-user-star-line text-base" />
                  </span>
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={e => setAdminUsername(e.target.value)}
                    placeholder="Admin yoki Uyushma logini"
                    className="w-full pl-10 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Parol</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400">
                    <i className="ri-lock-2-line text-base" />
                  </span>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                <div>🛡️ <strong>Super Admin:</strong> Admin / Adminkeldi1</div>
                <div>🏢 <strong>Uyushma:</strong> Super Admin tomonidan yaratilgan login/parol</div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? 'Kirilmoqda...' : 'Tizimga kirish'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
