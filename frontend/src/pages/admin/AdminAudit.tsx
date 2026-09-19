import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api/adminApi';
import type { AuditLogEntry } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminAudit() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionCategory, setActionCategory] = useState<'all' | 'uyushma' | 'client' | 'shift' | 'settings'>('all');
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.getAuditLogs();
      setLogs(data);
    } catch {
      // Handled in adminApi fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getActionBadgeClass = (action: AuditLogEntry['action_type']) => {
    switch (action) {
      case 'create_uyushma':
        return 'audit-badge create';
      case 'archive_uyushma':
      case 'block_client':
      case 'force_end_shift':
        return 'audit-badge archive';
      case 'unblock_client':
        return 'audit-badge create';
      case 'update_system_settings':
        return 'audit-badge settings';
      default:
        return 'audit-badge';
    }
  };

  const formatActionName = (action: AuditLogEntry['action_type']) => {
    switch (action) {
      case 'create_uyushma':
        return 'Uyushma yaratish';
      case 'archive_uyushma':
        return 'Uyushmani arxivlash';
      case 'block_client':
        return 'Mijozni bloklash';
      case 'unblock_client':
        return 'Blokdan chiqarish';
      case 'force_end_shift':
        return 'Smenani to\'xtatish';
      case 'update_system_settings':
        return 'Sozlamalarni yangilash';
      case 'reject_cashout':
        return 'Cashout rad etish';
      case 'refund_payment':
        return 'To\'lovni qaytarish';
      default:
        return action;
    }
  };

  const filteredLogs = logs.filter(log => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      log.actor_name.toLowerCase().includes(query) ||
      log.description.toLowerCase().includes(query) ||
      log.entity_id.toLowerCase().includes(query) ||
      (log.audit_reason || '').toLowerCase().includes(query);

    let matchesCategory = true;
    if (actionCategory === 'uyushma') {
      matchesCategory = log.entity_type === 'uyushma';
    } else if (actionCategory === 'client') {
      matchesCategory = log.entity_type === 'client';
    } else if (actionCategory === 'shift') {
      matchesCategory = log.entity_type === 'shift';
    } else if (actionCategory === 'settings') {
      matchesCategory = log.entity_type === 'settings';
    }

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="admin-page-container">
      {/* Page Header */}
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-shield-check-line" style={{ color: 'var(--admin-accent)' }} />
            Tizim Audit va Xavfsizlik Jurnali
          </h1>
          <p>Barcha ma'muriy amallar, xavfli qarorlar va o'zgarishlarning o'zgarmas (immutable) arxivi</p>
        </div>

        <button
          className="btn-operations-secondary"
          onClick={loadData}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <i className="ri-refresh-line" /> Yangilash
        </button>
      </div>

      {/* Filter Bar */}
      <div className="operations-filter-bar">
        <div className="operations-filter-bar__search">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Ma'mur, amal tavsifi, sabab yoki ob'ekt ID bo'yicha qidiruv..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className={`finance-tab ${actionCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActionCategory('all')}
          >
            Hammasi ({logs.length})
          </button>
          <button
            className={`finance-tab ${actionCategory === 'uyushma' ? 'active' : ''}`}
            onClick={() => setActionCategory('uyushma')}
          >
            Uyushmalar
          </button>
          <button
            className={`finance-tab ${actionCategory === 'client' ? 'active' : ''}`}
            onClick={() => setActionCategory('client')}
          >
            Mijozlar
          </button>
          <button
            className={`finance-tab ${actionCategory === 'shift' ? 'active' : ''}`}
            onClick={() => setActionCategory('shift')}
          >
            Smenalar
          </button>
          <button
            className={`finance-tab ${actionCategory === 'settings' ? 'active' : ''}`}
            onClick={() => setActionCategory('settings')}
          >
            Sozlamalar
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="operations-table-card">
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <i className="ri-loader-4-line ri-spin" style={{ fontSize: '2rem', color: 'var(--admin-accent)' }} />
            <p style={{ marginTop: '0.5rem' }}>Audit jurnali yuklanmoqda...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <i className="ri-file-search-line" style={{ fontSize: '2.5rem', opacity: 0.5 }} />
            <p style={{ marginTop: '0.5rem' }}>Mos keluvchi audit yozuvlari topilmadi</p>
          </div>
        ) : (
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Vaqt</th>
                  <th>Amal Turi</th>
                  <th>Ijrochi (Ma'mur)</th>
                  <th>Ob'ekt</th>
                  <th>Tavsif va Sabab</th>
                  <th>IP Manzil</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <div>{new Date(log.timestamp).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '0.725rem' }}>
                        {new Date(log.timestamp).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </td>
                    <td>
                      <span className={getActionBadgeClass(log.action_type)}>
                        {formatActionName(log.action_type)}
                      </span>
                    </td>
                    <td>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          {log.actor_name}
                        </div>
                        <div style={{ display: 'inline-block', fontSize: '0.7rem', color: 'var(--admin-accent)', background: 'var(--admin-accent-subtle)', padding: '0.1rem 0.4rem', borderRadius: '4px', marginTop: '0.2rem' }}>
                          {log.actor_role}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--surface-sunken)', padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                        {log.entity_type}:{log.entity_id}
                      </span>
                    </td>
                    <td>
                      <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                        {log.description}
                      </div>
                      {log.audit_reason && (
                        <div style={{ marginTop: '0.35rem', background: 'rgba(239, 68, 68, 0.08)', borderLeft: '3px solid var(--danger)', padding: '0.3rem 0.6rem', borderRadius: '0 4px 4px 0', fontSize: '0.78rem', color: '#fca5a5' }}>
                          <span style={{ fontWeight: 600, marginRight: '0.3rem' }}>Sabab:</span>
                          "{log.audit_reason}"
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                      {log.ip_address || '127.0.0.1'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
