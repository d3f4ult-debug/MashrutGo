import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, WALLET_ADJUST_LIMIT_UZS } from '../../services/api/adminApi'
import { errorMessage, newIdempotencyKey } from '../../services/api/client'
import { formatDate, formatDateTime, formatSom, timeAgo } from '../../utils/format'
import type { AdminClientUser, Paginated, WalletLedgerEntry } from '../../types/admin'
import {
  AdminModal,
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  Toast,
  isAbortError,
  useDebounced,
  useToast,
} from './adminShared'
import './AdminOperations.css'
import '../uyushma/UyushmaOperations.css'

const PAGE_SIZE = 25

type AdjustDirection = 'credit' | 'debit'
type AdjustStep = 'form' | 'confirm' | 'done'

function parseAmount(text: string): number {
  const digits = text.replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

export function AdminClients() {
  const { toast, show: showToast, hide: hideToast } = useToast()

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput.trim(), 400)
  const [pageState, setPageState] = useState({ search: '', page: 1 })
  const page = pageState.search === search ? pageState.page : 1

  const [data, setData] = useState<Paginated<AdminClientUser> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Block / unblock
  const [blockTarget, setBlockTarget] = useState<AdminClientUser | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [blockError, setBlockError] = useState<string | null>(null)
  const [isBlocking, setIsBlocking] = useState(false)

  // Wallet adjustment
  const [adjustTarget, setAdjustTarget] = useState<AdminClientUser | null>(null)
  const [adjustStep, setAdjustStep] = useState<AdjustStep>('form')
  const [adjustDirection, setAdjustDirection] = useState<AdjustDirection>('credit')
  const [adjustAmountText, setAdjustAmountText] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustChecked, setAdjustChecked] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [adjustResult, setAdjustResult] = useState<WalletLedgerEntry | null>(null)
  // One key per confirmed correction: a retry after a network error cannot post it twice
  const [adjustKey, setAdjustKey] = useState('')

  const load = useCallback(async (searchTerm: string, pageNo: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await adminApi.getClients({ search: searchTerm, page: pageNo, size: PAGE_SIZE }, controller.signal)
      if (controller.signal.aborted) return
      setData(result)
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return
      setLoadError(errorMessage(err, 'Mijozlar ro‘yxatini yuklab bo‘lmadi'))
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load(search, page)
  }, [load, search, page])

  useEffect(() => () => abortRef.current?.abort(), [])

  const reload = () => load(search, page)
  const goToPage = (p: number) => setPageState({ search, page: p })

  const replaceClient = (updated: AdminClientUser) =>
    setData((prev) => (prev ? { ...prev, items: prev.items.map((c) => (c.id === updated.id ? updated : c)) } : prev))

  // ── Block / unblock ──
  const openBlock = (c: AdminClientUser) => {
    setBlockTarget(c)
    setBlockReason('')
    setBlockError(null)
  }

  const handleBlock = async () => {
    if (!blockTarget) return
    const blocking = !blockTarget.is_blocked
    setBlockError(null)
    setIsBlocking(true)
    try {
      const updated = await adminApi.setClientBlocked(blockTarget.id, blocking, blockReason)
      replaceClient(updated)
      showToast(blocking ? `${updated.phone} bloklandi.` : `${updated.phone} blokdan chiqarildi.`)
      setBlockTarget(null)
    } catch (err) {
      setBlockError(errorMessage(err, 'Amalni bajarib bo‘lmadi'))
    } finally {
      setIsBlocking(false)
    }
  }

  // ── Wallet adjustment ──
  const openAdjust = (c: AdminClientUser) => {
    setAdjustTarget(c)
    setAdjustStep('form')
    setAdjustDirection('credit')
    setAdjustAmountText('')
    setAdjustReason('')
    setAdjustChecked(false)
    setAdjustError(null)
    setAdjustResult(null)
  }

  const closeAdjust = () => {
    if (isAdjusting) return
    setAdjustTarget(null)
  }

  const adjustAmount = parseAmount(adjustAmountText)
  const signedAmount = adjustDirection === 'credit' ? adjustAmount : -adjustAmount
  const expectedBalance = adjustTarget ? adjustTarget.wallet_balance + signedAmount : 0

  const adjustFormError = (): string | null => {
    if (!adjustTarget) return null
    if (adjustAmount <= 0) return 'Summani kiriting'
    if (adjustAmount > WALLET_ADJUST_LIMIT_UZS) return `Bir martalik tuzatish ${formatSom(WALLET_ADJUST_LIMIT_UZS)}dan oshmasligi kerak`
    if (adjustDirection === 'debit' && adjustAmount > adjustTarget.wallet_balance) {
      return `Yechiladigan summa joriy balansdan (${formatSom(adjustTarget.wallet_balance)}) katta — balans manfiy bo‘lib qoladi`
    }
    const r = adjustReason.trim().length
    if (r < 3) return 'Sabab kamida 3 ta belgidan iborat bo‘lishi kerak'
    if (r > 255) return 'Sabab 255 ta belgidan oshmasligi kerak'
    return null
  }

  const handleAdjustContinue = () => {
    const err = adjustFormError()
    if (err) {
      setAdjustError(err)
      return
    }
    setAdjustError(null)
    setAdjustChecked(false)
    setAdjustKey(newIdempotencyKey())
    setAdjustStep('confirm')
  }

  const handleAdjustSubmit = async () => {
    if (!adjustTarget || isAdjusting) return
    setAdjustError(null)
    setIsAdjusting(true)
    try {
      const entry = await adminApi.adjustWallet(adjustTarget.id, signedAmount, adjustReason, adjustKey)
      setAdjustResult(entry)
      setAdjustStep('done')
      replaceClient({ ...adjustTarget, wallet_balance: entry.balance_after_uzs })
      showToast(`Hamyon tuzatildi: ${signedAmount > 0 ? '+' : '−'}${formatSom(Math.abs(entry.amount_uzs))}`)
    } catch (err) {
      setAdjustError(errorMessage(err, 'Tuzatishni amalga oshirib bo‘lmadi'))
    } finally {
      setIsAdjusting(false)
    }
  }

  const items = data?.items ?? []

  return (
    <div className="admin-page-container">
      <Toast toast={toast} onClose={hideToast} />

      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-user-heart-line" style={{ color: 'var(--admin-accent)' }} />
            Mijozlar va hamyonlar
          </h1>
          <p>Ro‘yxatdan o‘tgan yo‘lovchilar, hamyon balanslari, bloklash va audit qilinadigan balans tuzatishlari</p>
        </div>
        <div className="uyushma-page-header__actions">
          <button type="button" className="btn-secondary-action" onClick={reload} disabled={isLoading}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Yangilash
          </button>
        </div>
      </div>

      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className={isLoading && data ? 'ri-loader-4-line admin-spin' : 'ri-search-line'} />
          <input
            type="search"
            placeholder="Telefon raqami yoki F.I.Sh. bo‘yicha qidirish..."
            value={searchInput}
            maxLength={50}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Mijoz qidirish"
          />
        </div>
        {data && (
          <div className="admin-counter">
            {search ? 'Topildi' : 'Jami mijozlar'}: <strong>{data.total.toLocaleString('ru-RU')}</strong>
          </div>
        )}
      </div>

      {loadError && data && <Alert>Ro‘yxatni yangilab bo‘lmadi: {loadError}</Alert>}

      <div className="admin-panel">
        {!data && isLoading ? (
          <LoadingState label="Mijozlar yuklanmoqda..." />
        ) : !data ? (
          <ErrorState message={loadError ?? 'Mijozlar ro‘yxatini yuklab bo‘lmadi'} onRetry={reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="ri-user-search-line"
            title={search ? `“${search}” bo‘yicha mijoz topilmadi` : 'Hali ro‘yxatdan o‘tgan mijoz yo‘q'}
          />
        ) : (
          <>
            <div className="uyushma-table-wrapper">
              <table className="uyushma-table">
                <thead>
                  <tr>
                    <th>Mijoz</th>
                    <th>Hamyon balansi</th>
                    <th>Qatnovlar</th>
                    <th>Holat</th>
                    <th>So‘nggi faollik</th>
                    <th>Ro‘yxatdan o‘tgan</th>
                    <th style={{ textAlign: 'right' }}>Amallar</th>
                  </tr>
                </thead>
                <tbody style={{ opacity: isLoading ? 0.6 : 1 }}>
                  {items.map((c) => (
                    <tr key={c.id} style={c.is_blocked ? { background: 'rgba(239, 68, 68, 0.04)' } : undefined}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.full_name || 'Ismi kiritilmagan'}</div>
                        <div className="admin-muted">
                          {c.phone} • ID {c.id}
                        </div>
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatSom(c.wallet_balance)}</td>
                      <td className="admin-muted">{c.total_rides.toLocaleString('ru-RU')} ta</td>
                      <td>
                        {c.is_blocked ? (
                          <div>
                            <span className="status-pill danger">
                              <i className="ri-forbid-line" /> Bloklangan
                            </span>
                            {c.block_reason && (
                              <div className="admin-muted" style={{ maxWidth: 220, marginTop: '0.2rem' }} title={c.block_reason}>
                                {c.block_reason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="status-pill active">
                            <i className="ri-checkbox-circle-line" /> Faol
                          </span>
                        )}
                      </td>
                      <td className="admin-muted" title={c.last_active_at ? formatDateTime(c.last_active_at) : undefined}>
                        {c.last_active_at ? timeAgo(c.last_active_at) : 'Ma’lumot yo‘q'}
                      </td>
                      <td className="admin-muted">{formatDate(c.created_at)}</td>
                      <td>
                        <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="btn-admin-chip accent" onClick={() => openAdjust(c)}>
                            <i className="ri-scales-3-line" /> Balansni tuzatish
                          </button>
                          <button
                            type="button"
                            className={`btn-admin-chip ${c.is_blocked ? 'success' : 'danger'}`}
                            onClick={() => openBlock(c)}
                          >
                            <i className={c.is_blocked ? 'ri-lock-unlock-line' : 'ri-user-forbid-line'} />
                            {c.is_blocked ? 'Blokdan chiqarish' : 'Bloklash'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} disabled={isLoading} onPage={goToPage} />
          </>
        )}
      </div>

      {/* Block / unblock confirmation */}
      {blockTarget && (
        <AdminModal
          title={blockTarget.is_blocked ? 'Mijozni blokdan chiqarish' : 'Mijozni bloklash'}
          icon={blockTarget.is_blocked ? 'ri-lock-unlock-line' : 'ri-user-forbid-line'}
          iconColor={blockTarget.is_blocked ? 'var(--success)' : 'var(--danger)'}
          onClose={() => !isBlocking && setBlockTarget(null)}
          busy={isBlocking}
          maxWidth={520}
          onSubmit={handleBlock}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={() => setBlockTarget(null)} disabled={isBlocking}>
                Bekor qilish
              </button>
              {blockTarget.is_blocked ? (
                <button type="submit" className="btn-admin-success" disabled={isBlocking}>
                  <i className={isBlocking ? 'ri-loader-4-line admin-spin' : 'ri-lock-unlock-line'} />
                  {isBlocking ? 'Bajarilmoqda...' : 'Blokdan chiqarishni tasdiqlash'}
                </button>
              ) : (
                <button type="submit" className="btn-admin-danger" disabled={isBlocking || blockReason.trim().length < 3}>
                  <i className={isBlocking ? 'ri-loader-4-line admin-spin' : 'ri-user-forbid-line'} />
                  {isBlocking ? 'Bajarilmoqda...' : 'Bloklashni tasdiqlash'}
                </button>
              )}
            </>
          }
        >
          {blockTarget.is_blocked ? (
            <Alert tone="info">Mijoz qayta tizimga kira oladi va hamyonidan to‘lov qila oladi.</Alert>
          ) : (
            <div className="dangerous-action-banner">
              <i className="ri-alarm-warning-line" />
              <div>
                <strong>Diqqat:</strong> bloklangan mijoz tizimga kira olmaydi, joriy sessiyalari darhol ishlamay qoladi va to‘lov qila
                olmaydi. Hamyon balansi saqlanadi. Amal audit jurnaliga yoziladi.
              </div>
            </div>
          )}

          <div className="admin-summary-box">
            <strong>{blockTarget.full_name || 'Ismi kiritilmagan'}</strong>
            <span>
              {blockTarget.phone} • Balans: {formatSom(blockTarget.wallet_balance)}
            </span>
            {blockTarget.is_blocked && blockTarget.block_reason && <span>Bloklash sababi: {blockTarget.block_reason}</span>}
          </div>

          {blockError && <Alert>{blockError}</Alert>}

          <div className="uyushma-form-group">
            <label htmlFor="block-reason">
              {blockTarget.is_blocked ? 'Izoh (ixtiyoriy, audit jurnaliga yoziladi)' : 'Bloklash sababi (audit jurnaliga yoziladi) *'}
            </label>
            <textarea
              id="block-reason"
              className="uyushma-textarea"
              rows={3}
              maxLength={255}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder={blockTarget.is_blocked ? 'Masalan: mijoz murojaati ko‘rib chiqildi' : 'Masalan: to‘lovlarda firibgarlik belgilari'}
              autoFocus
            />
            {!blockTarget.is_blocked && <span className="hint">Kamida 3 ta belgi • {blockReason.trim().length}/255</span>}
          </div>
        </AdminModal>
      )}

      {/* Wallet adjustment (financial, audited) */}
      {adjustTarget && (
        <AdminModal
          title="Hamyon balansini tuzatish"
          icon="ri-scales-3-line"
          onClose={closeAdjust}
          busy={isAdjusting}
          maxWidth={540}
          onSubmit={adjustStep === 'form' ? handleAdjustContinue : adjustStep === 'confirm' ? handleAdjustSubmit : closeAdjust}
          footer={
            adjustStep === 'form' ? (
              <>
                <button type="button" className="btn-secondary-action" onClick={closeAdjust}>
                  Bekor qilish
                </button>
                <button type="submit" className="btn-admin-primary">
                  Davom etish <i className="ri-arrow-right-line" />
                </button>
              </>
            ) : adjustStep === 'confirm' ? (
              <>
                <button type="button" className="btn-secondary-action" onClick={() => setAdjustStep('form')} disabled={isAdjusting}>
                  <i className="ri-arrow-left-line" /> Orqaga
                </button>
                <button
                  type="submit"
                  className={adjustDirection === 'credit' ? 'btn-admin-success' : 'btn-admin-danger'}
                  disabled={isAdjusting || !adjustChecked}
                >
                  <i className={isAdjusting ? 'ri-loader-4-line admin-spin' : 'ri-check-double-line'} />
                  {isAdjusting ? 'Bajarilmoqda...' : 'Tasdiqlash va o‘tkazish'}
                </button>
              </>
            ) : (
              <button type="submit" className="btn-admin-primary">
                Yopish
              </button>
            )
          }
        >
          <div className="admin-summary-box">
            <strong>{adjustTarget.full_name || 'Ismi kiritilmagan'}</strong>
            <span>
              {adjustTarget.phone} • ID {adjustTarget.id}
            </span>
            <span>
              Joriy balans (ro‘yxat yuklangan paytdagi): <strong>{formatSom(adjustTarget.wallet_balance)}</strong>
            </span>
          </div>

          {adjustError && <Alert>{adjustError}</Alert>}

          {adjustStep === 'form' && (
            <>
              <Alert tone="info">
                Balans to‘g‘ridan-to‘g‘ri o‘zgartirilmaydi: ledgerga yangi <span className="admin-mono">adjustment</span> yozuvi
                qo‘shiladi va amal audit jurnalida saqlanadi. Xato tuzatishni teskari yozuv bilan qoplash mumkin.
              </Alert>

              <div className="admin-segmented" role="radiogroup" aria-label="Tuzatish turi">
                <button
                  type="button"
                  role="radio"
                  aria-checked={adjustDirection === 'credit'}
                  className={adjustDirection === 'credit' ? 'active' : ''}
                  onClick={() => setAdjustDirection('credit')}
                >
                  <i className="ri-add-line" /> Hisobga qo‘shish
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={adjustDirection === 'debit'}
                  className={adjustDirection === 'debit' ? 'active' : ''}
                  onClick={() => setAdjustDirection('debit')}
                >
                  <i className="ri-subtract-line" /> Hisobdan yechish
                </button>
              </div>

              <div className="uyushma-form-group">
                <label htmlFor="adjust-amount">Summa (so‘m) *</label>
                <input
                  id="adjust-amount"
                  className="uyushma-input"
                  inputMode="numeric"
                  maxLength={14}
                  value={adjustAmount ? adjustAmount.toLocaleString('ru-RU') : adjustAmountText.replace(/[^\d]/g, '')}
                  onChange={(e) => setAdjustAmountText(e.target.value)}
                  placeholder="Masalan: 15 000"
                  autoFocus
                />
                <span className="hint">
                  Butun so‘m, maksimal {formatSom(WALLET_ADJUST_LIMIT_UZS)}
                  {adjustAmount > 0 && ` • kutilayotgan balans: ${formatSom(expectedBalance)}`}
                </span>
              </div>

              <div className="uyushma-form-group">
                <label htmlFor="adjust-reason">Sabab (audit jurnaliga yoziladi) *</label>
                <textarea
                  id="adjust-reason"
                  className="uyushma-textarea"
                  rows={3}
                  maxLength={255}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Masalan: Click to‘lovi hamyonga tushmagan, tranzaksiya #…"
                />
                <span className="hint">Kamida 3 ta belgi • {adjustReason.trim().length}/255</span>
              </div>
            </>
          )}

          {adjustStep === 'confirm' && (
            <>
              <div className={`dangerous-action-banner${adjustDirection === 'credit' ? ' warning' : ''}`}>
                <i className="ri-bank-card-line" />
                <div>
                  <strong>Moliyaviy amalni tasdiqlang.</strong> Yozuv ledgerdan o‘chirilmaydi.
                </div>
              </div>
              <dl className="admin-dl">
                <dt>Amal</dt>
                <dd style={{ color: adjustDirection === 'credit' ? 'var(--success)' : 'var(--danger)', fontSize: '1.05rem' }}>
                  {adjustDirection === 'credit' ? '+' : '−'}
                  {formatSom(adjustAmount)}
                </dd>
                <dt>Mijoz</dt>
                <dd>
                  {adjustTarget.full_name || '—'} ({adjustTarget.phone})
                </dd>
                <dt>Kutilayotgan balans</dt>
                <dd>{formatSom(expectedBalance)}</dd>
                <dt>Sabab</dt>
                <dd>{adjustReason.trim()}</dd>
              </dl>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={adjustChecked} onChange={(e) => setAdjustChecked(e.target.checked)} />
                <span>Summa, yo‘nalish (qo‘shish/yechish) va mijozni tekshirdim.</span>
              </label>
            </>
          )}

          {adjustStep === 'done' && adjustResult && (
            <>
              <Alert tone="success">Tuzatish ledgerga yozildi.</Alert>
              <dl className="admin-dl">
                <dt>Ledger yozuvi</dt>
                <dd className="admin-mono">#{adjustResult.id} ({adjustResult.entry_type})</dd>
                <dt>Summa</dt>
                <dd>
                  {adjustResult.amount_uzs > 0 ? '+' : '−'}
                  {formatSom(Math.abs(adjustResult.amount_uzs))}
                </dd>
                <dt>Yangi balans</dt>
                <dd>{formatSom(adjustResult.balance_after_uzs)}</dd>
                <dt>Vaqt</dt>
                <dd>{formatDateTime(adjustResult.created_at)}</dd>
                <dt>Izoh</dt>
                <dd>{adjustResult.description}</dd>
              </dl>
            </>
          )}
        </AdminModal>
      )}
    </div>
  )
}
