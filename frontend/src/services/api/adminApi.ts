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
  if (devUyushmalar.length > 0) return;

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

  devUyushmalar = [
    {
      id: 'uyushma-01',
      name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      region: 'Andijon viloyati, Andijon shahri',
      contact_person: 'Erkin Mahmudov',
      contact_phone: '+998 74 223 44 55',
      admin_email: 'andijon.trans@mashrutgo.uz',
      license_number: 'LNZ-AND-2024-091',
      routes_count: 8,
      drivers_count: 42,
      vehicles_count: 45,
      status: 'active',
      created_at: daysAgo(120),
    },
    {
      id: 'uyushma-02',
      name: 'Asaka Trans Servis MCHJ',
      region: 'Andijon viloyati, Asaka tumani',
      contact_person: 'Dilshod Tursunov',
      contact_phone: '+998 74 331 22 11',
      admin_email: 'asaka.trans@mashrutgo.uz',
      license_number: 'LNZ-AND-2024-114',
      routes_count: 4,
      drivers_count: 24,
      vehicles_count: 26,
      status: 'active',
      created_at: daysAgo(90),
    },
    {
      id: 'uyushma-03',
      name: 'Shahrixon Avto Express XK',
      region: 'Andijon viloyati, Shahrixon tumani',
      contact_person: 'Nodirbek Yusupov',
      contact_phone: '+998 74 445 10 20',
      admin_email: 'shahrixon@mashrutgo.uz',
      license_number: 'LNZ-AND-2023-048',
      routes_count: 3,
      drivers_count: 15,
      vehicles_count: 15,
      status: 'archived',
      created_at: daysAgo(200),
    },
  ];

  devClients = [
    {
      id: 'cli-001',
      phone: '+998 90 555 11 22',
      full_name: 'Sardorbek Aliyev',
      wallet_balance: 45000,
      total_rides: 84,
      is_blocked: false,
      last_active_at: minutesAgo(15),
      created_at: daysAgo(45),
    },
    {
      id: 'cli-002',
      phone: '+998 91 666 33 44',
      full_name: 'Malika Rahimova',
      wallet_balance: 12000,
      total_rides: 32,
      is_blocked: false,
      last_active_at: hoursAgo(2),
      created_at: daysAgo(30),
    },
    {
      id: 'cli-003',
      phone: '+998 93 777 88 99',
      full_name: 'Javohir Qosimov',
      wallet_balance: 2000,
      total_rides: 112,
      is_blocked: true,
      block_reason: 'To\'lov tizimida shubhali faollik qayd etilgan',
      last_active_at: daysAgo(3),
      created_at: daysAgo(60),
    },
    {
      id: 'cli-004',
      phone: '+998 94 888 00 11',
      full_name: 'Nigora Karimova',
      wallet_balance: 85000,
      total_rides: 65,
      is_blocked: false,
      last_active_at: hoursAgo(5),
      created_at: daysAgo(20),
    },
  ];

  devShifts = [
    {
      id: 'shf-1',
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      driver_phone: '+998 90 123 45 67',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      vehicle_id: 'veh-101',
      vehicle_plate: '60 A 777 AA',
      route_id: 'rt-101',
      route_number: '12',
      started_at: hoursAgo(3.5),
      last_heartbeat_at: minutesAgo(1),
      is_online: true,
      current_lat: 40.785,
      current_lng: 72.348,
    },
    {
      id: 'shf-2',
      driver_id: 'usr-driver-2',
      driver_name: 'Jasur Saidov',
      driver_phone: '+998 91 234 56 78',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      vehicle_id: 'veh-102',
      vehicle_plate: '60 B 123 BB',
      route_id: 'rt-101',
      route_number: '12',
      started_at: hoursAgo(2.1),
      last_heartbeat_at: minutesAgo(2),
      is_online: true,
      current_lat: 40.772,
      current_lng: 72.355,
    },
    {
      id: 'shf-4',
      driver_id: 'usr-driver-4',
      driver_name: 'Bobur Xolmatov',
      driver_phone: '+998 94 456 78 90',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      vehicle_id: 'veh-104',
      vehicle_plate: '60 D 999 DD',
      route_id: 'rt-103',
      route_number: '24',
      started_at: hoursAgo(1.2),
      last_heartbeat_at: minutesAgo(1),
      is_online: true,
      current_lat: 40.791,
      current_lng: 72.339,
    },
  ];

  devSettings = {
    gps_interval_seconds: 5,
    refund_window_minutes: 30,
    platform_commission_percent: 1.0,
    maintenance_mode: false,
    fcm_notifications_enabled: true,
    max_unassigned_vehicles: 50,
    updated_at: daysAgo(5),
    updated_by: 'Super Admin',
  };

  devAuditLogs = [
    {
      id: 'aud-001',
      timestamp: minutesAgo(10),
      actor_id: 'usr-admin-1',
      actor_name: 'Super Admin',
      actor_role: 'super_admin',
      action_type: 'update_system_settings',
      entity_type: 'settings',
      entity_id: 'global-config',
      description: 'GPS yuborish intervali 5 soniyaga yangilandi',
      ip_address: '192.168.1.45',
    },
    {
      id: 'aud-002',
      timestamp: hoursAgo(2),
      actor_id: 'usr-admin-1',
      actor_name: 'Super Admin',
      actor_role: 'super_admin',
      action_type: 'create_uyushma',
      entity_type: 'uyushma',
      entity_id: 'uyushma-02',
      description: 'Yangi uyushma yaratildi: Asaka Trans Servis MCHJ',
      ip_address: '192.168.1.45',
    },
    {
      id: 'aud-003',
      timestamp: daysAgo(1),
      actor_id: 'usr-admin-1',
      actor_name: 'Super Admin',
      actor_role: 'super_admin',
      action_type: 'block_client',
      entity_type: 'client',
      entity_id: 'cli-003',
      description: 'Mijoz akkaunti bloklandi',
      audit_reason: 'To\'lov tizimida shubhali faollik qayd etilgan',
      ip_address: '192.168.1.45',
    },
  ];
}

export const adminApi = {
  // ── Global KPIs ──
  async getGlobalKPIs(): Promise<AdminGlobalKPIs> {
    try {
      return await apiClient.get<AdminGlobalKPIs>('/admin/kpis');
    } catch {
      initDevData();
      return {
        total_uyushmalar: devUyushmalar.filter(u => u.status === 'active').length,
        total_routes: 15,
        total_drivers: 81,
        total_vehicles: 86,
        active_shifts: devShifts.filter(s => s.is_online).length,
        total_clients: devClients.length + 1420,
        total_parkings: 12,
        today_gross_revenue: 5240000,
        today_platform_commission: 52400,
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
      return await apiClient.get<AdminClientUser[]>('/admin/clients');
    } catch {
      initDevData();
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
