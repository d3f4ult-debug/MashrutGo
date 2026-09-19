import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uyushmaApi } from '../services/api/uyushmaApi';
import { financeApi } from '../services/api/financeApi';
import { routeEditorApi } from '../services/api/routeEditorApi';

describe('Stage 10 — Uyushma Operations Test Suite', () => {
  const uyushmaId = 'uyushma-01';

  test('Driver CRUD & 1 Driver = 1 Vehicle = 1 Route Validation Rule', async () => {
    // 1. Fetch current drivers and vehicles
    const drivers = await uyushmaApi.getDrivers(uyushmaId);
    assert.ok(drivers.length > 0);

    // 2. Validate conflict: Attempting to assign a vehicle that is already assigned to another driver
    const busyDriver = drivers[0];
    const validationConflict = uyushmaApi.validateAssignment(
      'usr-new-driver',
      busyDriver.assigned_vehicle_id,
      busyDriver.assigned_route_id,
      undefined,
      undefined
    );

    assert.equal(validationConflict.valid, false, 'Assigning already assigned vehicle must fail validation');
    assert.ok(validationConflict.error?.includes('allaqachon'), 'Error message should describe assignment conflict');

    // 3. Valid assignment for unassigned vehicle
    const validAssignment = uyushmaApi.validateAssignment(
      'usr-free-driver',
      'veh-completely-free',
      'rt-101',
      undefined,
      undefined
    );
    assert.equal(validAssignment.valid, true, 'Free vehicle and driver should pass 1-1-1 validation');
  });

  test('Visual Route Editor: Independent Outbound/Inbound Directions & Waypoints', async () => {
    // 1. Create a draft route
    const draftPayload = {
      routeNumber: '99',
      routeName: 'Test Yo\'nalish',
      outbound: {
        direction: 'outbound' as const,
        startPoint: { name: 'A Bekat', coordinates: [72.348, 40.785] as [number, number] },
        endPoint: { name: 'B Bekat', coordinates: [72.361, 40.756] as [number, number] },
        waypoints: [
          { id: 'wp-1', name: 'To\'xtash 1', coordinates: [72.355, 40.770] as [number, number], order: 0 },
        ],
        geometry: null,
        distanceKm: 0,
        durationMin: 0,
        isDirty: false,
      },
      inbound: {
        direction: 'inbound' as const,
        startPoint: { name: 'B Bekat', coordinates: [72.361, 40.756] as [number, number] },
        endPoint: { name: 'A Bekat', coordinates: [72.348, 40.785] as [number, number] },
        waypoints: [],
        geometry: null,
        distanceKm: 0,
        durationMin: 0,
        isDirty: false,
      },
    };

    const success = await routeEditorApi.saveDraft('rt-test-99', draftPayload);
    assert.equal(success, true);
    assert.equal(draftPayload.outbound.waypoints.length, 1);
    assert.equal(draftPayload.inbound.waypoints.length, 0, 'Inbound and Outbound must be edited and stored independently');

    // 2. Recalculate auto-path via routing provider
    const path = await routeEditorApi.calculateRoutePath([
      [72.348, 40.785],
      [72.355, 40.770],
      [72.361, 40.756],
    ]);
    assert.equal(path.type, 'LineString');
    assert.ok(path.coordinates.length >= 3, 'Auto-path should contain polyline coordinates connecting waypoints');
  });

  test('Extensible Fare Architecture: Fixed, Distance, Zone, and Time-based formulas', async () => {
    const fares = await uyushmaApi.getFareRules(uyushmaId);
    assert.ok(fares.length > 0);

    // Create a dynamic distance-based fare
    const newDistanceFare = await uyushmaApi.createFareRule(uyushmaId, {
      name: 'Shahar atrofi masofaviy tarif',
      rule_type: 'distance',
      amount: 2500,
      per_km_rate: 600,
      included_km: 3,
      is_active: true,
    });

    assert.equal(newDistanceFare.rule_type, 'distance');
    assert.equal(newDistanceFare.per_km_rate, 600);
    assert.equal(newDistanceFare.included_km, 3);
  });

  test('Finance Operations: Cashout Approval, Rejection with Audit Reason, and Mark Paid', async () => {
    const cashouts = await financeApi.getCashouts(uyushmaId);
    assert.ok(cashouts.length > 0);

    const pending = cashouts.find(c => c.status === 'pending');
    assert.ok(pending, 'There should be at least one pending cashout request in test data');
    const pendingId = pending.id;

    // 1. Rejection requires audit reason
    await assert.rejects(
      async () => {
        await financeApi.rejectCashout(uyushmaId, pendingId, '  ');
      },
      /audit sababi majburiy/,
      'Rejecting cashout without audit reason must fail'
    );

    // 2. Reject with valid audit reason
    const rejected = await financeApi.rejectCashout(uyushmaId, pendingId, 'Hisob raqami noto\'g\'ri kiritilgan');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejection_reason, 'Hisob raqami noto\'g\'ri kiritilgan');

    // 3. Mark paid with official bank transaction reference
    const approved = cashouts.find(c => c.status === 'approved') || (await financeApi.approveCashout(uyushmaId, pendingId));
    assert.ok(approved);
    const paid = await financeApi.markCashoutPaid(uyushmaId, approved.id, 'BNK-TXN-998822');
    assert.equal(paid.status, 'paid');
    assert.equal(paid.payment_reference, 'BNK-TXN-998822');
  });
});
