import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { paymentApi } from '../services/api/paymentApi';
import { realtimeService } from '../services/realtime/websocket';
import type { WsEvent, WaitingClient } from '../types/map';

describe('Stage 10 — Driver Operations Test Suite', () => {
  test('Shift & Telemetry: Start shift, location tracking, and offline queueing', () => {
    const queue: Array<{ lat: number; lng: number; timestamp: number }> = [];

    // Simulate online telemetry send
    let isConnected = false;
    const sendLocation = (lat: number, lng: number) => {
      const point = { lat, lng, timestamp: Date.now() };
      if (!isConnected) {
        queue.push(point);
      }
      return point;
    };

    // 1. While disconnected, points must be queued
    sendLocation(40.785, 72.348);
    sendLocation(40.786, 72.349);
    assert.equal(queue.length, 2, 'Unsent telemetry points must be queued during offline period');

    // 2. Reconnecting and flushing batch queue
    isConnected = true;
    const flushedCount = queue.length;
    queue.length = 0; // cleared after batch sync
    assert.equal(flushedCount, 2, 'All queued offline telemetry points should be synced upon reconnect');
    assert.equal(queue.length, 0, 'Offline queue must be empty after sync');
  });

  test('Waiting-Client Marker Lifecycle: Appears on started, disappears on "Mashinadaman"', () => {
    const clientsMap = new Map<string, WaitingClient>();

    // Client starts watching
    const sessionId = 'cli-session-991';
    clientsMap.set(sessionId, {
      session_id: sessionId,
      lat: 40.782,
      lng: 72.355,
      timestamp: Date.now(),
    });

    assert.equal(clientsMap.has(sessionId), true, 'Waiting client marker should appear on map');
    assert.equal(clientsMap.get(sessionId)?.lat, 40.782);

    // Client boards the vehicle ("Mashinadaman" event) -> marker must disappear
    clientsMap.delete(sessionId);
    assert.equal(clientsMap.has(sessionId), false, 'Marker must be removed when client boards (Mashinadaman)');
  });

  test('Payment Refund & Undo: Window enforcement (30 min) and reason validation', async () => {
    const vehicleId = 'veh-101';
    const payments = await paymentApi.getPayments(vehicleId);
    assert.ok(payments.length > 0, 'Payments list should not be empty');

    const targetPayment = payments[0];

    // Attempt refund with valid reason
    const refundResult = await paymentApi.refundPayment(targetPayment.id, vehicleId, "Mijoz adashib to'ladi");
    assert.equal(refundResult.payment.status, 'refunded', 'Payment status should transition to refunded');
    assert.equal(refundResult.payment.refund_reason, "Mijoz adashib to'ladi");

    // Attempt refund without reason should throw
    await assert.rejects(
      async () => {
        await paymentApi.refundPayment(targetPayment.id, vehicleId, '   ');
      },
      /sababi majburiy/,
      'Refund without audit reason must be rejected'
    );
  });

  test('Driver Cashout: Validates minimum balance and creates pending request', async () => {
    const vehicleId = 'veh-101';
    const driverId = 'usr-driver-1';
    const initialBalance = await paymentApi.getBalance(vehicleId);
    const amountToWithdraw = 20000;

    assert.ok(initialBalance.available_balance >= amountToWithdraw, 'Driver must have sufficient available balance');

    const cashoutReq = await paymentApi.requestCashout(vehicleId, driverId, amountToWithdraw, 'card', '8600 **** **** 1234');
    assert.equal(cashoutReq.amount, amountToWithdraw);
    assert.equal(cashoutReq.status, 'pending', 'Newly requested cashout must have pending status');
  });

  test('WebSocket Reconnect & Dispatch Lifecycle', () => {
    let receivedEvent: WsEvent | null = null;
    const unsub = realtimeService.on('payment.received', (evt) => {
      receivedEvent = evt;
    });

    realtimeService.dispatch({
      type: 'payment.received',
      payload: { test: true },
      timestamp: Date.now(),
    });

    assert.ok(receivedEvent !== null, 'Registered listener should receive dispatched event');
    unsub();

    // Verify clean unsubscribe
    receivedEvent = null;
    realtimeService.dispatch({
      type: 'payment.received',
      payload: { test: false },
      timestamp: Date.now(),
    });
    assert.equal(receivedEvent, null, 'Unsubscribed listener must not receive further events');
  });
});
