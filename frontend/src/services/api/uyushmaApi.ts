import { apiClient } from './client';
import type {
  UyushmaKPIs,
  UyushmaRoute,
  UyushmaDriver,
  UyushmaVehicle,
  UyushmaParking,
  UyushmaFareRule,
} from '../../types/uyushma';

const isDev = typeof import.meta !== 'undefined' && import.meta.env
  ? Boolean(import.meta.env.DEV)
  : true;

// ── In-Memory Store for Dev Mode ──
let devRoutes: UyushmaRoute[] = [];
let devDrivers: UyushmaDriver[] = [];
let devVehicles: UyushmaVehicle[] = [];
let devParkings: UyushmaParking[] = [];
let devFares: UyushmaFareRule[] = [];

function initDevData(uyushmaId: string) {
  if (devRoutes.length > 0) return;

  devRoutes = [
    {
      id: 'rt-101',
      uyushma_id: uyushmaId,
      route_number: '12',
      route_name: "O'sh ko'chasi — Yangi Bozor",
      description: "Markaziy bozor va talabalar shaharchasi orqali asosiy magistral",
      is_active: true,
      assigned_vehicles_count: 3,
      assigned_drivers_count: 3,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      directions: [
        {
          id: 'dir-101-out',
          direction: 'outbound',
          start_name: "O'sh ko'chasi (A)",
          end_name: "Yangi Bozor (B)",
          stops_count: 14,
          distance_km: 11.2,
          estimated_duration_min: 28,
          is_active: true,
        },
        {
          id: 'dir-101-in',
          direction: 'inbound',
          start_name: "Yangi Bozor (B)",
          end_name: "O'sh ko'chasi (A)",
          stops_count: 15,
          distance_km: 11.5,
          estimated_duration_min: 30,
          is_active: true,
        },
      ],
    },
    {
      id: 'rt-102',
      uyushma_id: uyushmaId,
      route_number: '1',
      route_name: "Temiryo'l vokzali — Aeroport",
      description: "Shahar vokzali va xalqaro aeroportni bog'lovchi yo'nalish",
      is_active: true,
      assigned_vehicles_count: 2,
      assigned_drivers_count: 2,
      created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
      directions: [
        {
          id: 'dir-102-out',
          direction: 'outbound',
          start_name: "Temiryo'l vokzali",
          end_name: "Aeroport",
          stops_count: 12,
          distance_km: 9.8,
          estimated_duration_min: 22,
          is_active: true,
        },
        {
          id: 'dir-102-in',
          direction: 'inbound',
          start_name: "Aeroport",
          end_name: "Temiryo'l vokzali",
          stops_count: 12,
          distance_km: 9.8,
          estimated_duration_min: 22,
          is_active: true,
        },
      ],
    },
    {
      id: 'rt-103',
      uyushma_id: uyushmaId,
      route_number: '24',
      route_name: "Eski shahar — Bog'i Bobur",
      description: "Madaniy markaz va istirohat bog'i yo'nalishi",
      is_active: true,
      assigned_vehicles_count: 1,
      assigned_drivers_count: 1,
      created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      directions: [
        {
          id: 'dir-103-out',
          direction: 'outbound',
          start_name: "Eski shahar",
          end_name: "Bog'i Bobur",
          stops_count: 18,
          distance_km: 14.0,
          estimated_duration_min: 35,
          is_active: true,
        },
        {
          id: 'dir-103-in',
          direction: 'inbound',
          start_name: "Bog'i Bobur",
          end_name: "Eski shahar",
          stops_count: 18,
          distance_km: 14.2,
          estimated_duration_min: 36,
          is_active: true,
        },
      ],
    },
  ];

  devVehicles = [
    {
      id: 'veh-101',
      uyushma_id: uyushmaId,
      license_plate: '60 A 777 AA',
      model: 'Isuzu NP37',
      color: 'Oq',
      type: 'isuzu',
      is_active: true,
      assigned_route_id: 'rt-101',
      assigned_route_number: '12',
      assigned_driver_id: 'usr-driver-1',
      assigned_driver_name: 'Anvar Qodirov',
      is_on_shift: true,
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'veh-102',
      uyushma_id: uyushmaId,
      license_plate: '60 B 123 BB',
      model: 'Isuzu HC40',
      color: 'Ko\'k',
      type: 'isuzu',
      is_active: true,
      assigned_route_id: 'rt-101',
      assigned_route_number: '12',
      assigned_driver_id: 'usr-driver-2',
      assigned_driver_name: 'Jasur Saidov',
      is_on_shift: true,
      created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    },
    {
      id: 'veh-103',
      uyushma_id: uyushmaId,
      license_plate: '60 C 456 CC',
      model: 'Damas DLX',
      color: 'Kumush',
      type: 'damas',
      is_active: true,
      assigned_route_id: 'rt-102',
      assigned_route_number: '1',
      assigned_driver_id: 'usr-driver-3',
      assigned_driver_name: 'Olimjon Rustamov',
      is_on_shift: false,
      created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
    {
      id: 'veh-104',
      uyushma_id: uyushmaId,
      license_plate: '60 D 999 DD',
      model: 'Yutong ZK',
      color: 'Yashil',
      type: 'bus',
      is_active: true,
      assigned_route_id: 'rt-103',
      assigned_route_number: '24',
      assigned_driver_id: 'usr-driver-4',
      assigned_driver_name: 'Bobur Xolmatov',
      is_on_shift: true,
      created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    },
  ];

  devDrivers = [
    {
      id: 'usr-driver-1',
      uyushma_id: uyushmaId,
      full_name: 'Anvar Qodirov',
      phone: '+998 90 123 45 67',
      email: 'driver@mashrutgo.uz',
      is_active: true,
      assigned_vehicle_id: 'veh-101',
      assigned_vehicle_plate: '60 A 777 AA (Isuzu NP37)',
      assigned_route_id: 'rt-101',
      assigned_route_number: '12',
      active_shift: {
        id: 'shf-1',
        started_at: new Date(Date.now() - 3 * 3600000).toISOString(),
        is_online: true,
      },
      created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
    },
    {
      id: 'usr-driver-2',
      uyushma_id: uyushmaId,
      full_name: 'Jasur Saidov',
      phone: '+998 91 234 56 78',
      email: 'jasur@mashrutgo.uz',
      is_active: true,
      assigned_vehicle_id: 'veh-102',
      assigned_vehicle_plate: '60 B 123 BB (Isuzu HC40)',
      assigned_route_id: 'rt-101',
      assigned_route_number: '12',
      active_shift: {
        id: 'shf-2',
        started_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        is_online: true,
      },
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'usr-driver-3',
      uyushma_id: uyushmaId,
      full_name: 'Olimjon Rustamov',
      phone: '+998 93 345 67 89',
      email: 'olim@mashrutgo.uz',
      is_active: true,
      assigned_vehicle_id: 'veh-103',
      assigned_vehicle_plate: '60 C 456 CC (Damas DLX)',
      assigned_route_id: 'rt-102',
      assigned_route_number: '1',
      active_shift: null,
      created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
    {
      id: 'usr-driver-4',
      uyushma_id: uyushmaId,
      full_name: 'Bobur Xolmatov',
      phone: '+998 94 456 78 90',
      email: 'bobur@mashrutgo.uz',
      is_active: true,
      assigned_vehicle_id: 'veh-104',
      assigned_vehicle_plate: '60 D 999 DD (Yutong ZK)',
      assigned_route_id: 'rt-103',
      assigned_route_number: '24',
      active_shift: {
        id: 'shf-4',
        started_at: new Date(Date.now() - 1 * 3600000).toISOString(),
        is_online: true,
      },
      created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
  ];

  devParkings = [
    {
      id: 'prk-01',
      uyushma_id: uyushmaId,
      name: "O'sh ko'chasi bosh stoyankasi",
      lat: 40.785,
      lng: 72.348,
      radius_m: 120,
      capacity: 15,
      current_vehicle_count: 4,
      is_active: true,
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'prk-02',
      uyushma_id: uyushmaId,
      name: "Yangi Bozor oxirgi bekati",
      lat: 40.756,
      lng: 72.361,
      radius_m: 150,
      capacity: 25,
      current_vehicle_count: 7,
      is_active: true,
      created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    },
    {
      id: 'prk-03',
      uyushma_id: uyushmaId,
      name: "Temiryo'l vokzali avtoturargohi",
      lat: 40.789,
      lng: 72.335,
      radius_m: 100,
      capacity: 12,
      current_vehicle_count: 3,
      is_active: true,
      created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
  ];

  devFares = [
    {
      id: 'fare-01',
      uyushma_id: uyushmaId,
      name: 'Standart shahar tarifi',
      rule_type: 'fixed',
      amount: 3000,
      target_route_id: undefined, // All routes
      is_active: true,
      description: "Barcha yo'nalishlar uchun belgilangan asosiy qatnov haqi",
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'fare-02',
      uyushma_id: uyushmaId,
      name: 'Talaba va imtiyozli tarif',
      rule_type: 'fixed',
      amount: 2000,
      target_route_id: 'rt-101',
      target_route_number: '12',
      is_active: true,
      description: "Talabalar shaharchasi bo'ylab imtiyozli qatnov",
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'fare-03',
      uyushma_id: uyushmaId,
      name: 'Kechki qatnov tarifi (20:00 dan so\'ng)',
      rule_type: 'fixed',
      amount: 4000,
      target_route_id: undefined,
      is_active: true,
      description: "Soat 20:00 dan keyingi tungi reyslar uchun",
      created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
  ];
}

export const uyushmaApi = {
  // ── KPIs & Dashboard ──
  async getKPIs(uyushmaId: string): Promise<UyushmaKPIs> {
    try {
      return await apiClient.get<UyushmaKPIs>(`/uyushma/${uyushmaId}/kpis`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const activeShifts = devDrivers.filter(d => d.active_shift?.is_online).length;
        const visibleVehicles = devVehicles.filter(v => v.is_on_shift).length;

        return {
          uyushma_id: uyushmaId,
          owned_routes_count: devRoutes.length,
          active_shifts_count: activeShifts,
          visible_vehicles_count: visibleVehicles,
          parkings_count: devParkings.length,
          today_payments_total: 1845000,
          today_payments_count: 615,
          pending_cashouts_count: 3,
          pending_cashouts_total: 420000,
        };
      }
      throw err;
    }
  },

  // ── 1 Driver = 1 Vehicle = 1 Route Validation ──
  validateAssignment(
    driverId: string | undefined,
    vehicleId: string | undefined,
    routeId: string | undefined,
    currentDriverId?: string,
    currentVehicleId?: string
  ): { valid: boolean; error?: string } {
    if (driverId && vehicleId) {
      // Check if vehicle is already assigned to ANOTHER driver
      const vehicleInUse = devVehicles.find(
        v => v.id === vehicleId && v.assigned_driver_id && v.assigned_driver_id !== (currentDriverId || driverId)
      );
      if (vehicleInUse) {
        return {
          valid: false,
          error: `Qoida buzilishi (1 Driver = 1 Vehicle): Ushbu transport (${vehicleInUse.license_plate || vehicleInUse.id}) allaqachon boshqa haydovchiga (${vehicleInUse.assigned_driver_name}) biriktirilgan!`,
        };
      }

      // Check if driver already has ANOTHER vehicle
      const driverWithVehicle = devDrivers.find(
        d => d.id === driverId && d.assigned_vehicle_id && d.assigned_vehicle_id !== (currentVehicleId || vehicleId)
      );
      if (driverWithVehicle) {
        return {
          valid: false,
          error: `Qoida buzilishi (1 Driver = 1 Vehicle): Haydovchi (${driverWithVehicle.full_name}) allaqachon boshqa transportga biriktirilgan!`,
        };
      }
    }

    if (vehicleId && routeId) {
      // Check if vehicle's route conflicts with assigned driver's route
      if (driverId) {
        const driver = devDrivers.find(d => d.id === driverId);
        if (driver?.assigned_route_id && driver.assigned_route_id !== routeId) {
          return {
            valid: false,
            error: `Qoida buzilishi (1 Vehicle = 1 Route): Tanlangan transport yo'nalishi bilan haydovchining yo'nalishi mos kelishi shart!`,
          };
        }
      }
    }

    return { valid: true };
  },

  // ── Routes CRUD ──
  async getRoutes(uyushmaId: string): Promise<UyushmaRoute[]> {
    try {
      return await apiClient.get<UyushmaRoute[]>(`/uyushma/${uyushmaId}/routes`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        return [...devRoutes];
      }
      throw err;
    }
  },

  async createRoute(uyushmaId: string, routeData: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    try {
      return await apiClient.post<UyushmaRoute>(`/uyushma/${uyushmaId}/routes`, routeData);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const newRoute: UyushmaRoute = {
          id: `rt-${Date.now().toString().slice(-4)}`,
          uyushma_id: uyushmaId,
          route_number: routeData.route_number || 'Yangi',
          route_name: routeData.route_name || 'Yangi yo\'nalish',
          description: routeData.description || '',
          is_active: routeData.is_active ?? true,
          assigned_vehicles_count: 0,
          assigned_drivers_count: 0,
          created_at: new Date().toISOString(),
          directions: routeData.directions || [
            {
              id: `dir-${Date.now()}-out`,
              direction: 'outbound',
              start_name: 'Bosh bekat (A)',
              end_name: 'Oxirgi bekat (B)',
              stops_count: 10,
              distance_km: 8.5,
              estimated_duration_min: 20,
              is_active: true,
            },
            {
              id: `dir-${Date.now()}-in`,
              direction: 'inbound',
              start_name: 'Oxirgi bekat (B)',
              end_name: 'Bosh bekat (A)',
              stops_count: 10,
              distance_km: 8.5,
              estimated_duration_min: 20,
              is_active: true,
            },
          ],
        };
        devRoutes.unshift(newRoute);
        return newRoute;
      }
      throw err;
    }
  },

  async updateRoute(uyushmaId: string, routeId: string, updates: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    try {
      return await apiClient.put<UyushmaRoute>(`/uyushma/${uyushmaId}/routes/${routeId}`, updates);
    } catch (err) {
      if (isDev) {
        const idx = devRoutes.findIndex(r => r.id === routeId);
        if (idx !== -1) {
          devRoutes[idx] = { ...devRoutes[idx], ...updates };
          return devRoutes[idx];
        }
      }
      throw err;
    }
  },

  async deleteRoute(uyushmaId: string, routeId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/routes/${routeId}`);
      return true;
    } catch (err) {
      if (isDev) {
        devRoutes = devRoutes.filter(r => r.id !== routeId);
        return true;
      }
      throw err;
    }
  },

  // ── Drivers CRUD (Create Account — No Driver Self-Registration) ──
  async getDrivers(uyushmaId: string): Promise<UyushmaDriver[]> {
    try {
      return await apiClient.get<UyushmaDriver[]>(`/uyushma/${uyushmaId}/drivers`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        return [...devDrivers];
      }
      throw err;
    }
  },

  async createDriver(
    uyushmaId: string,
    data: {
      full_name: string;
      phone: string;
      email: string;
      password: string;
      assigned_vehicle_id?: string;
      assigned_route_id?: string;
    }
  ): Promise<UyushmaDriver> {
    // Validate 1 Driver = 1 Vehicle = 1 Route
    const val = this.validateAssignment(undefined, data.assigned_vehicle_id, data.assigned_route_id);
    if (!val.valid) {
      throw new Error(val.error);
    }

    try {
      return await apiClient.post<UyushmaDriver>(`/uyushma/${uyushmaId}/drivers`, data);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const vehicle = devVehicles.find(v => v.id === data.assigned_vehicle_id);
        const route = devRoutes.find(r => r.id === data.assigned_route_id);

        const newDriver: UyushmaDriver = {
          id: `usr-driver-${Date.now().toString().slice(-4)}`,
          uyushma_id: uyushmaId,
          full_name: data.full_name,
          phone: data.phone,
          email: data.email,
          is_active: true,
          assigned_vehicle_id: data.assigned_vehicle_id,
          assigned_vehicle_plate: vehicle ? `${vehicle.license_plate || vehicle.id} (${vehicle.model || ''})` : undefined,
          assigned_route_id: data.assigned_route_id,
          assigned_route_number: route?.route_number,
          active_shift: null,
          created_at: new Date().toISOString(),
        };

        devDrivers.unshift(newDriver);

        // Update vehicle's assigned driver
        if (vehicle) {
          vehicle.assigned_driver_id = newDriver.id;
          vehicle.assigned_driver_name = newDriver.full_name;
        }

        if (route) {
          route.assigned_drivers_count += 1;
        }

        return newDriver;
      }
      throw err;
    }
  },

  async updateDriver(uyushmaId: string, driverId: string, updates: Partial<UyushmaDriver>): Promise<UyushmaDriver> {
    // Validate assignment
    if (updates.assigned_vehicle_id || updates.assigned_route_id) {
      const val = this.validateAssignment(driverId, updates.assigned_vehicle_id, updates.assigned_route_id, driverId);
      if (!val.valid) throw new Error(val.error);
    }

    try {
      return await apiClient.put<UyushmaDriver>(`/uyushma/${uyushmaId}/drivers/${driverId}`, updates);
    } catch (err) {
      if (isDev) {
        const idx = devDrivers.findIndex(d => d.id === driverId);
        if (idx !== -1) {
          devDrivers[idx] = { ...devDrivers[idx], ...updates };
          return devDrivers[idx];
        }
      }
      throw err;
    }
  },

  async deleteDriver(uyushmaId: string, driverId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/drivers/${driverId}`);
      return true;
    } catch (err) {
      if (isDev) {
        devDrivers = devDrivers.filter(d => d.id !== driverId);
        return true;
      }
      throw err;
    }
  },

  // ── Vehicles CRUD ──
  async getVehicles(uyushmaId: string): Promise<UyushmaVehicle[]> {
    try {
      return await apiClient.get<UyushmaVehicle[]>(`/uyushma/${uyushmaId}/vehicles`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        return [...devVehicles];
      }
      throw err;
    }
  },

  async createVehicle(uyushmaId: string, data: Partial<UyushmaVehicle>): Promise<UyushmaVehicle> {
    if (!data.id) {
      throw new Error("Ichki transport ID (masalan: VEH-105) majburiy!");
    }

    const val = this.validateAssignment(data.assigned_driver_id, data.id, data.assigned_route_id);
    if (!val.valid) throw new Error(val.error);

    try {
      return await apiClient.post<UyushmaVehicle>(`/uyushma/${uyushmaId}/vehicles`, data);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const route = devRoutes.find(r => r.id === data.assigned_route_id);
        const driver = devDrivers.find(d => d.id === data.assigned_driver_id);

        const newVehicle: UyushmaVehicle = {
          id: data.id,
          uyushma_id: uyushmaId,
          license_plate: data.license_plate,
          model: data.model,
          color: data.color,
          type: data.type || 'isuzu',
          is_active: data.is_active ?? true,
          assigned_route_id: data.assigned_route_id,
          assigned_route_number: route?.route_number,
          assigned_driver_id: data.assigned_driver_id,
          assigned_driver_name: driver?.full_name,
          is_on_shift: false,
          created_at: new Date().toISOString(),
        };

        devVehicles.unshift(newVehicle);

        if (route) route.assigned_vehicles_count += 1;
        if (driver) {
          driver.assigned_vehicle_id = newVehicle.id;
          driver.assigned_vehicle_plate = `${newVehicle.license_plate || newVehicle.id} (${newVehicle.model || ''})`;
        }

        return newVehicle;
      }
      throw err;
    }
  },

  async updateVehicle(uyushmaId: string, vehicleId: string, updates: Partial<UyushmaVehicle>): Promise<UyushmaVehicle> {
    const val = this.validateAssignment(updates.assigned_driver_id, vehicleId, updates.assigned_route_id, undefined, vehicleId);
    if (!val.valid) throw new Error(val.error);

    try {
      return await apiClient.put<UyushmaVehicle>(`/uyushma/${uyushmaId}/vehicles/${vehicleId}`, updates);
    } catch (err) {
      if (isDev) {
        const idx = devVehicles.findIndex(v => v.id === vehicleId);
        if (idx !== -1) {
          devVehicles[idx] = { ...devVehicles[idx], ...updates };
          return devVehicles[idx];
        }
      }
      throw err;
    }
  },

  async deleteVehicle(uyushmaId: string, vehicleId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/vehicles/${vehicleId}`);
      return true;
    } catch (err) {
      if (isDev) {
        devVehicles = devVehicles.filter(v => v.id !== vehicleId);
        return true;
      }
      throw err;
    }
  },

  // ── Parkings / Stoyankalar CRUD ──
  async getParkings(uyushmaId: string): Promise<UyushmaParking[]> {
    try {
      return await apiClient.get<UyushmaParking[]>(`/uyushma/${uyushmaId}/parkings`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        return [...devParkings];
      }
      throw err;
    }
  },

  async createParking(uyushmaId: string, data: Partial<UyushmaParking>): Promise<UyushmaParking> {
    try {
      return await apiClient.post<UyushmaParking>(`/uyushma/${uyushmaId}/parkings`, data);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const newParking: UyushmaParking = {
          id: `prk-${Date.now().toString().slice(-4)}`,
          uyushma_id: uyushmaId,
          name: data.name || 'Yangi stoyanka',
          lat: data.lat || 40.783,
          lng: data.lng || 72.344,
          radius_m: data.radius_m || 100,
          capacity: data.capacity || 10,
          current_vehicle_count: 0,
          is_active: data.is_active ?? true,
          created_at: new Date().toISOString(),
        };
        devParkings.unshift(newParking);
        return newParking;
      }
      throw err;
    }
  },

  async updateParking(uyushmaId: string, parkingId: string, updates: Partial<UyushmaParking>): Promise<UyushmaParking> {
    try {
      return await apiClient.put<UyushmaParking>(`/uyushma/${uyushmaId}/parkings/${parkingId}`, updates);
    } catch (err) {
      if (isDev) {
        const idx = devParkings.findIndex(p => p.id === parkingId);
        if (idx !== -1) {
          devParkings[idx] = { ...devParkings[idx], ...updates };
          return devParkings[idx];
        }
      }
      throw err;
    }
  },

  async deleteParking(uyushmaId: string, parkingId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/parkings/${parkingId}`);
      return true;
    } catch (err) {
      if (isDev) {
        devParkings = devParkings.filter(p => p.id !== parkingId);
        return true;
      }
      throw err;
    }
  },

  // ── Fare Rules CRUD ──
  async getFareRules(uyushmaId: string): Promise<UyushmaFareRule[]> {
    try {
      return await apiClient.get<UyushmaFareRule[]>(`/uyushma/${uyushmaId}/fares`);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        return [...devFares];
      }
      throw err;
    }
  },

  async createFareRule(uyushmaId: string, data: Partial<UyushmaFareRule>): Promise<UyushmaFareRule> {
    try {
      return await apiClient.post<UyushmaFareRule>(`/uyushma/${uyushmaId}/fares`, data);
    } catch (err) {
      if (isDev) {
        initDevData(uyushmaId);
        const route = devRoutes.find(r => r.id === data.target_route_id);

        const newFare: UyushmaFareRule = {
          id: `fare-${Date.now().toString().slice(-4)}`,
          uyushma_id: uyushmaId,
          name: data.name || 'Yangi tarif',
          rule_type: data.rule_type || 'fixed',
          amount: data.amount || 3000,
          target_route_id: data.target_route_id,
          target_route_number: route?.route_number,
          is_active: data.is_active ?? true,
          description: data.description,
          per_km_rate: data.per_km_rate,
          included_km: data.included_km,
          cross_zone_extra: data.cross_zone_extra,
          peak_multiplier: data.peak_multiplier,
          created_at: new Date().toISOString(),
        };
        devFares.unshift(newFare);
        return newFare;
      }
      throw err;
    }
  },

  async updateFareRule(uyushmaId: string, fareId: string, updates: Partial<UyushmaFareRule>): Promise<UyushmaFareRule> {
    try {
      return await apiClient.put<UyushmaFareRule>(`/uyushma/${uyushmaId}/fares/${fareId}`, updates);
    } catch (err) {
      if (isDev) {
        const idx = devFares.findIndex(f => f.id === fareId);
        if (idx !== -1) {
          devFares[idx] = { ...devFares[idx], ...updates };
          return devFares[idx];
        }
      }
      throw err;
    }
  },

  async deleteFareRule(uyushmaId: string, fareId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/fares/${fareId}`);
      return true;
    } catch (err) {
      if (isDev) {
        devFares = devFares.filter(f => f.id !== fareId);
        return true;
      }
      throw err;
    }
  },
};
