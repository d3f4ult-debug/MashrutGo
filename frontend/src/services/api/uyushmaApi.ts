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

import andijonRealRoutes from '../../data/andijon_real_routes.json';

// ── In-Memory Store for Dev Mode ──
let devRoutes: UyushmaRoute[] = [];
let devDrivers: UyushmaDriver[] = [];
let devVehicles: UyushmaVehicle[] = [];
let devParkings: UyushmaParking[] = [];
let devFares: UyushmaFareRule[] = [];

function initDevData(_uyushmaId: string) {
  if (devRoutes.length === 0) {
    devRoutes = (andijonRealRoutes as any[]).map(r => {
      // Ensure geometry is saved in localStorage so editor and maps immediately render it
      if (typeof localStorage !== 'undefined') {
        const key = `route_published_${r.id}`;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify(r));
        }
      }

      return {
        id: r.id,
        uyushma_id: _uyushmaId,
        route_number: r.route_number,
        route_name: r.route_name,
        description: r.description,
        is_active: r.is_active,
        assigned_vehicles_count: r.type === 'suburban' ? 8 : 12,
        assigned_drivers_count: r.type === 'suburban' ? 8 : 12,
        created_at: new Date().toISOString(),
        directions: [
          {
            id: `${r.id}-out`,
            direction: 'outbound' as const,
            start_name: r.outbound?.startPoint?.name || "Bosh nuqta",
            end_name: r.outbound?.endPoint?.name || "Oxirgi nuqta",
            stops_count: 0,
            distance_km: r.outbound?.distanceKm || 5.0,
            estimated_duration_min: r.outbound?.durationMin || 15,
            is_active: true,
          },
          {
            id: `${r.id}-in`,
            direction: 'inbound' as const,
            start_name: r.inbound?.startPoint?.name || "Oxirgi nuqta",
            end_name: r.inbound?.endPoint?.name || "Bosh nuqta",
            stops_count: 0,
            distance_km: r.inbound?.distanceKm || 5.0,
            estimated_duration_min: r.inbound?.durationMin || 15,
            is_active: true,
          },
        ],
      };
    });
  }
}

export const uyushmaApi = {
  // ── KPIs & Dashboard ──
  async getKPIs(uyushmaId: string): Promise<UyushmaKPIs> {
    try {
      return await apiClient.get<UyushmaKPIs>(`/uyushma/${uyushmaId}/kpis`);
    } catch {
      initDevData(uyushmaId);
      const activeShifts = devDrivers.filter(d => d.active_shift?.is_online).length;
      const visibleVehicles = devVehicles.filter(v => v.is_on_shift).length;

      return {
        uyushma_id: uyushmaId,
        owned_routes_count: devRoutes.length,
        active_shifts_count: activeShifts || 5,
        visible_vehicles_count: visibleVehicles || 8,
        parkings_count: devParkings.length || 2,
        today_payments_total: 450000,
        today_payments_count: 225,
        pending_cashouts_count: 0,
        pending_cashouts_total: 0,
      };
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
    let routesList: UyushmaRoute[] = [];
    try {
      const data = await apiClient.get<UyushmaRoute[]>(`/uyushma/${uyushmaId}/routes`);
      if (Array.isArray(data) && data.length > 0) {
        routesList = [...data];
      }
    } catch {
      // Backend fallback
    }

    if (routesList.length === 0) {
      initDevData(uyushmaId);
      routesList = [...devRoutes];
    }

    // Merge any user-created or drawn routes from localStorage
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('route_published_') || key.startsWith('route_draft_'))) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const num = parsed.routeNumber || parsed.route_number;
            const name = parsed.routeName || parsed.route_name;
            const rid = parsed.id || parsed.routeId || key.replace(/^(route_published_|route_draft_)/, '');
            if (!num || !name) continue;

            const existingIdx = routesList.findIndex(r => r.id === rid || r.route_number === num);
            if (existingIdx === -1) {
              routesList.unshift({
                id: rid,
                uyushma_id: uyushmaId,
                route_number: num,
                route_name: name,
                description: parsed.description || '',
                is_active: parsed.status === 'published' || parsed.is_active !== false,
                assigned_vehicles_count: 0,
                assigned_drivers_count: 0,
                created_at: new Date().toISOString(),
                directions: parsed.directions || [
                  {
                    id: `${rid}-out`,
                    direction: 'outbound',
                    start_name: parsed.outbound?.startPoint?.name || name.split('—')[0]?.trim() || 'Bosh nuqta',
                    end_name: parsed.outbound?.endPoint?.name || name.split('—')[1]?.trim() || 'Oxirgi nuqta',
                    stops_count: parsed.outbound?.geometry?.coordinates?.length ? Math.max(2, Math.floor(parsed.outbound.geometry.coordinates.length / 10)) : 0,
                    distance_km: parsed.outbound?.distanceKm || 5.0,
                    estimated_duration_min: parsed.outbound?.durationMin || 15,
                    is_active: true,
                  },
                  {
                    id: `${rid}-in`,
                    direction: 'inbound',
                    start_name: parsed.inbound?.startPoint?.name || name.split('—')[1]?.trim() || 'Oxirgi nuqta',
                    end_name: parsed.inbound?.endPoint?.name || name.split('—')[0]?.trim() || 'Bosh nuqta',
                    stops_count: parsed.inbound?.geometry?.coordinates?.length ? Math.max(2, Math.floor(parsed.inbound.geometry.coordinates.length / 10)) : 0,
                    distance_km: parsed.inbound?.distanceKm || 5.0,
                    estimated_duration_min: parsed.inbound?.durationMin || 15,
                    is_active: true,
                  }
                ]
              });
            }
          } catch {
            // Ignore invalid entries
          }
        }
      }
    }

    return routesList;
  },

  async createRoute(uyushmaId: string, routeData: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    try {
      const res = await apiClient.post<UyushmaRoute>(`/uyushma/${uyushmaId}/routes`, routeData);
      if (res && res.id) {
        initDevData(uyushmaId);
        devRoutes = [res, ...devRoutes.filter(r => r.id !== res.id)];
        return res;
      }
    } catch {
      // Graceful local creation without throwing Not Found
    }

    initDevData(uyushmaId);
    const cleanNum = (routeData.route_number || 'Yangi').trim();
    const cleanName = (routeData.route_name || `${cleanNum}-yo'nalish`).trim();
    const slug = cleanNum.toLowerCase().replace(/[^a-z0-9]/g, '');
    const newId = routeData.id || (slug ? `rt-${slug}` : `rt-${Date.now().toString().slice(-4)}`);

    const newRoute: UyushmaRoute = {
      id: newId,
      uyushma_id: uyushmaId,
      route_number: cleanNum,
      route_name: cleanName,
      description: routeData.description || '',
      is_active: routeData.is_active ?? true,
      assigned_vehicles_count: 0,
      assigned_drivers_count: 0,
      created_at: new Date().toISOString(),
      directions: routeData.directions || [
        {
          id: `${newId}-out`,
          direction: 'outbound',
          start_name: cleanName.split('—')[0]?.trim() || 'Bosh nuqta',
          end_name: cleanName.split('—')[1]?.trim() || 'Oxirgi nuqta',
          stops_count: 0,
          distance_km: 5.0,
          estimated_duration_min: 15,
          is_active: true,
        },
        {
          id: `${newId}-in`,
          direction: 'inbound',
          start_name: cleanName.split('—')[1]?.trim() || 'Oxirgi nuqta',
          end_name: cleanName.split('—')[0]?.trim() || 'Bosh nuqta',
          stops_count: 0,
          distance_km: 5.0,
          estimated_duration_min: 15,
          is_active: true,
        },
      ],
    };

    devRoutes = [newRoute, ...devRoutes.filter(r => r.id !== newId)];

    if (typeof localStorage !== 'undefined') {
      const draftPayload = {
        id: newId,
        routeId: newId,
        route_number: cleanNum,
        routeNumber: cleanNum,
        route_name: cleanName,
        routeName: cleanName,
        description: newRoute.description,
        is_active: newRoute.is_active,
        status: 'published',
        outbound: {
          direction: 'outbound',
          startPoint: { name: cleanName.split('—')[0]?.trim() || 'Bosh nuqta', coordinates: [72.344, 40.782] },
          endPoint: { name: cleanName.split('—')[1]?.trim() || 'Oxirgi nuqta', coordinates: [72.361, 40.755] },
          waypoints: [],
          geometry: { type: 'LineString', coordinates: [] },
          distanceKm: 5.0,
          durationMin: 15
        },
        inbound: {
          direction: 'inbound',
          startPoint: { name: cleanName.split('—')[1]?.trim() || 'Oxirgi nuqta', coordinates: [72.361, 40.755] },
          endPoint: { name: cleanName.split('—')[0]?.trim() || 'Bosh nuqta', coordinates: [72.344, 40.782] },
          waypoints: [],
          geometry: { type: 'LineString', coordinates: [] },
          distanceKm: 5.0,
          durationMin: 15
        }
      };
      localStorage.setItem(`route_published_${newId}`, JSON.stringify(draftPayload));
      localStorage.setItem(`route_draft_${newId}`, JSON.stringify(draftPayload));
    }

    return newRoute;
  },

  async updateRoute(uyushmaId: string, routeId: string, updates: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    try {
      const res = await apiClient.put<UyushmaRoute>(`/uyushma/${uyushmaId}/routes/${routeId}`, updates);
      if (res) return res;
    } catch {
      // Fallback
    }

    initDevData(uyushmaId);
    const idx = devRoutes.findIndex(r => r.id === routeId);
    if (idx !== -1) {
      devRoutes[idx] = { ...devRoutes[idx], ...updates };
      return devRoutes[idx];
    }
    const updated: UyushmaRoute = {
      id: routeId,
      uyushma_id: uyushmaId,
      route_number: updates.route_number || '1',
      route_name: updates.route_name || 'Marshrut',
      description: updates.description || '',
      is_active: updates.is_active ?? true,
      assigned_vehicles_count: 0,
      assigned_drivers_count: 0,
      created_at: new Date().toISOString(),
      directions: updates.directions || []
    };
    devRoutes.unshift(updated);
    return updated;
  },

  async deleteRoute(uyushmaId: string, routeId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/uyushma/${uyushmaId}/routes/${routeId}`);
    } catch {
      // Fallback
    }
    devRoutes = devRoutes.filter(r => r.id !== routeId);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`route_published_${routeId}`);
      localStorage.removeItem(`route_draft_${routeId}`);
    }
    return true;
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

  async verifyDriver(uyushmaId: string, driverId: string): Promise<any> {
    try {
      return await apiClient.put(`/uyushma/${uyushmaId}/drivers/${driverId}/verify`, {});
    } catch (err) {
      if (isDev) {
        const d = devDrivers.find(item => item.id === driverId);
        if (d) {
          d.is_active = true;
          return d;
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
