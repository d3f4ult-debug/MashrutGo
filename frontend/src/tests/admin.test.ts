import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { adminApi } from '../services/api/adminApi';

describe('Stage 10 — Super Admin Operations Test Suite', () => {
  test('Uyushmalar CRUD & Dangerous Action: Archive Requires Audit Reason', async () => {
    // 1. Create a new organization
    const newUyushma = await adminApi.createUyushma({
      name: 'Paxtaobod Trans Servis MCHJ',
      region: 'Andijon viloyati, Paxtaobod tumani',
      contact_person: 'Komiljon Karimov',
      contact_phone: '+998 74 777 88 99',
      admin_email: 'paxtaobod@trans.uz',
    });

    assert.ok(newUyushma.id);
    assert.equal(newUyushma.status, 'active');

    // 2. Archive without reason must fail
    await assert.rejects(
      async () => {
        await adminApi.archiveUyushma(newUyushma.id, '  ');
      },
      /audit sababi majburiy/,
      'Archiving without audit reason must be rejected'
    );

    // 3. Archive with mandatory audit reason
    const archived = await adminApi.archiveUyushma(
      newUyushma.id,
      'Faoliyat litsenziyasi muddati tugaganligi sababli'
    );
    assert.equal(archived, true);

    const uyushmalar = await adminApi.getUyushmalar();
    const target = uyushmalar.find(u => u.id === newUyushma.id);
    assert.equal(target?.status, 'archived');
  });

  test('Client User Management: Block and Unblock with Audit Trail', async () => {
    const clients = await adminApi.getClients();
    assert.ok(clients.length > 0);

    const targetClient = clients[0];
    const originalBlockedState = targetClient.is_blocked;

    // Block client with audit reason
    const blocked = await adminApi.toggleClientBlock(
      targetClient.id,
      !originalBlockedState,
      'Qoidalarga zid tranzaksiyalar aniqlandi'
    );
    assert.equal(blocked.is_blocked, !originalBlockedState);

    // Unblock client
    const unblocked = await adminApi.toggleClientBlock(targetClient.id, originalBlockedState);
    assert.equal(unblocked.is_blocked, originalBlockedState);
  });

  test('Live Fleet Monitoring & Force End Shift', async () => {
    const liveShifts = await adminApi.getLiveShifts();
    assert.ok(liveShifts.length > 0);

    const activeShift = liveShifts.find(s => s.is_online);
    if (activeShift) {
      // Force end shift requires audit reason
      await assert.rejects(
        async () => {
          await adminApi.forceEndShift(activeShift.id, '   ');
        },
        /sababi majburiy/,
        'Forcing end-shift without reason must fail'
      );

      const success = await adminApi.forceEndShift(activeShift.id, 'Marshrutdan asossiz chetga chiqish');
      assert.equal(success, true);
    }
  });

  test('System Settings: Telemetry Interval, Commission, and Maintenance Mode', async () => {
    const currentSettings = await adminApi.getSystemSettings();
    assert.ok(currentSettings.gps_interval_seconds > 0);

    const updated = await adminApi.updateSystemSettings({
      gps_interval_seconds: 4,
      platform_commission_percent: 1.2,
      maintenance_mode: false,
    });

    assert.equal(updated.gps_interval_seconds, 4);
    assert.equal(updated.platform_commission_percent, 1.2);
  });

  test('Immutable Audit Logs: Verification of Logged Events', async () => {
    const logs = await adminApi.getAuditLogs();
    assert.ok(logs.length > 0, 'Audit trail must contain recorded actions');

    const firstLog = logs[0];
    assert.ok(firstLog.id);
    assert.ok(firstLog.timestamp);
    assert.ok(firstLog.actor_name);
    assert.ok(firstLog.action_type);
    assert.ok(firstLog.entity_id);
  });
});
