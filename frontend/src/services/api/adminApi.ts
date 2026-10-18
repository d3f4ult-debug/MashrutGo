import { apiClient } from './client';
import type {
  AdminGlobalKPIs,
  AdminUyushma,
  AdminClientUser,
  AdminLiveShift,
  AdminSystemSettings,
  AuditLogEntry,
} from '../../types/admin';

// In-memory dev store for Admin
let devUyushmalar: AdminUyushma[] = [];
let devClients: AdminClientUser[] = [];
let devShifts: AdminLiveShift[] = [];
let devSettings: AdminSystemSettings | null = null;
let devAuditLogs: AuditLogEntry[] = [];

function initDevData() {
  devUyushmalar = [];
  devClients = [];
  devShifts = [];
  devAuditLogs = [];
}

export const adminApi = {
  // ── Global KPIs ──
  async getGlobalKPIs(): Promise<AdminGlobalKPIs> {
    try {
      const dash = await apiClient.get<any>('/admin/dashboard');
      return {
        total_uyushmalar: dash.total_uyushmas ?? 0,
        total_routes: dash.total_routes ?? 0,
        total_drivers: dash.total_drivers ?? 0,
        total_vehicles: dash.total_vehicles ?? 0,
        active_shifts: dash.active_shifts_count ?? 0,
        total_clients: dash.total_clients ?? 0,
        total_parkings: dash.total_parkings ?? 0,
        today_gross_revenue: dash.total_payment_volume_uzs ?? 0,
        today_platform_commission: Math.round((dash.total_payment_volume_uzs ?? 0) * 0.01),
        system_status: 'healthy',
      };
    } catch {
      return {
        total_uyushmalar: 0,
        total_routes: 0,
        total_drivers: 0,
        total_vehicles: 0,
        active_shifts: 0,
        total_clients: 0,
        total_parkings: 0,
        today_gross_revenue: 0,
        today_platform_commission: 0,
        system_status: 'healthy',
      };
    }
  },

  // ── Uyushmalar CRUD ──
  async getUyushmalar(): Promise<AdminUyushma[]> {
    try {
      return await apiClient.get<AdminUyushma[]>('/admin/uyushmalar');
    } catch {
      initDevData();
      return [...devUyushmalar];
    }
  },

  async createUyushma(data: Partial<AdminUyushma>): Promise<AdminUyushma> {
    try {
      return await apiClient.post<AdminUyushma>('/admin/uyushmalar', data);
    } catch {
      initDevData();
      const newU: AdminUyushma = {
        id: `uyushma-${Date.now().toString().slice(-4)}`,
        name: data.name || 'Yangi Uyushma',
        region: data.region || 'Andijon viloyati',
        contact_person: data.contact_person || 'Mas\'ul shaxs',
        contact_phone: data.contact_phone || '+998 ',
        admin_email: data.admin_email || 'admin@uyushma.uz',
        license_number: data.license_number || `LNZ-AND-${new Date().getFullYear()}-001`,
        routes_count: 0,
        drivers_count: 0,
        vehicles_count: 0,
        status: 'active',
        created_at: new Date().toISOString(),
      };
      devUyushmalar.unshift(newU);

      // Log to audit
      devAuditLogs.unshift({
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_id: 'usr-admin-1',
        actor_name: 'Super Admin',
        actor_role: 'super_admin',
        action_type: 'create_uyushma',
        entity_type: 'uyushma',
        entity_id: newU.id,
        description: `Yangi uyushma ro'yxatdan o'tkazildi: ${newU.name}`,
      });

      return newU;
    }
  },

  async updateUyushma(id: string, updates: Partial<AdminUyushma>): Promise<AdminUyushma> {
    try {
      return await apiClient.put<AdminUyushma>(`/admin/uyushmalar/${id}`, updates);
    } catch {
      const idx = devUyushmalar.findIndex(u => u.id === id);
      if (idx !== -1) {
        devUyushmalar[idx] = { ...devUyushmalar[idx], ...updates };
        return devUyushmalar[idx];
      }
      throw new Error('Uyushma topilmadi');
    }
  },

  async archiveUyushma(id: string, auditReason: string): Promise<boolean> {
    if (!auditReason.trim()) {
      throw new Error("Uyushmani arxivlash uchun audit sababi majburiy!");
    }
    try {
      await apiClient.post(`/admin/uyushmalar/${id}/archive`, { reason: auditReason });
      return true;
    } catch {
      const target = devUyushmalar.find(u => u.id === id);
      if (target) {
        target.status = 'archived';
        devAuditLogs.unshift({
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor_id: 'usr-admin-1',
          actor_name: 'Super Admin',
          actor_role: 'super_admin',
          action_type: 'archive_uyushma',
          entity_type: 'uyushma',
          entity_id: id,
          description: `Uyushma arxivlandi: ${target.name}`,
          audit_reason: auditReason,
        });
      }
      return true;
    }
  },

  // ── Clients Management ──
  async getClients(): Promise<AdminClientUser[]> {
    try {
      const res = await apiClient.get<any>('/admin/clients');
      const list = Array.isArray(res) ? res : (res?.items || []);
      return list.map((c: any) => ({
        id: String(c.id),
        phone: c.phone || '',
        full_name: c.full_name || 'Yo‘lovchi',
        wallet_balance: c.wallet_balance_uzs ?? c.wallet_balance ?? 0,
        total_rides: c.rides_count ?? c.total_rides ?? 0,
        is_blocked: c.is_blocked !== undefined ? c.is_blocked : !c.is_active,
        block_reason: c.block_reason,
        last_active_at: c.last_active_at || c.created_at,
        created_at: c.created_at || new Date().toISOString(),
      }));
    } catch {
      return [...devClients];
    }
  },

  async toggleClientBlock(clientId: string, block: boolean, reason?: string): Promise<AdminClientUser> {
    try {
      return await apiClient.post<AdminClientUser>(`/admin/clients/${clientId}/toggle-block`, {
        block,
        reason,
      });
    } catch {
      const target = devClients.find(c => c.id === clientId);
      if (!target) throw new Error('Mijoz topilmadi');
      target.is_blocked = block;
      target.block_reason = block ? reason : undefined;

      devAuditLogs.unshift({
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_id: 'usr-admin-1',
        actor_name: 'Super Admin',
        actor_role: 'super_admin',
        action_type: block ? 'block_client' : 'unblock_client',
        entity_type: 'client',
        entity_id: clientId,
        description: block ? `Mijoz bloklandi: ${target.phone}` : `Mijoz blokdan chiqarildi: ${target.phone}`,
        audit_reason: reason,
      });

      return { ...target };
    }
  },

  // ── Shifts & Live Monitor ──
  async getLiveShifts(): Promise<AdminLiveShift[]> {
    try {
      return await apiClient.get<AdminLiveShift[]>('/admin/shifts/live');
    } catch {
      initDevData();
      return [...devShifts];
    }
  },

  async forceEndShift(shiftId: string, reason: string): Promise<boolean> {
    if (!reason.trim()) throw new Error('Smenani majburiy to\'xtatish sababi majburiy!');
    try {
      await apiClient.post(`/admin/shifts/${shiftId}/force-end`, { reason });
      return true;
    } catch {
      const target = devShifts.find(s => s.id === shiftId);
      if (target) {
        target.is_online = false;
        devAuditLogs.unshift({
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor_id: 'usr-admin-1',
          actor_name: 'Super Admin',
          actor_role: 'super_admin',
          action_type: 'force_end_shift',
          entity_type: 'shift',
          entity_id: shiftId,
          description: `Smena majburiy yakunlandi (${target.driver_name} / ${target.vehicle_plate})`,
          audit_reason: reason,
        });
      }
      return true;
    }
  },

  // ── System Settings ──
  async getSystemSettings(): Promise<AdminSystemSettings> {
    try {
      return await apiClient.get<AdminSystemSettings>('/admin/settings');
    } catch {
      initDevData();
      return { ...devSettings! };
    }
  },

  async updateSystemSettings(updates: Partial<AdminSystemSettings>): Promise<AdminSystemSettings> {
    try {
      return await apiClient.put<AdminSystemSettings>('/admin/settings', updates);
    } catch {
      devSettings = {
        ...devSettings!,
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: 'Super Admin',
      };

      devAuditLogs.unshift({
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_id: 'usr-admin-1',
        actor_name: 'Super Admin',
        actor_role: 'super_admin',
        action_type: 'update_system_settings',
        entity_type: 'settings',
        entity_id: 'global-config',
        description: 'Tizim global sozlamalari tahrirlandi',
      });

      return { ...devSettings };
    }
  },

  // ── Audit Logs ──
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    try {
      return await apiClient.get<AuditLogEntry[]>('/admin/audit/logs');
    } catch {
      initDevData();
      return [...devAuditLogs];
    }
  },
};
