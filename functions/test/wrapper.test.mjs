// ตรวจตัวห่อ onCall ใน index.js: ไม่ล็อกอิน = unauthenticated ก่อนแตะ Google / ก่อนลบอะไร · ตั้ง region/maxInstances · trigger ลบบัญชี
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT ??= 'demo-wickling';
const fns = await import('../index.js');

test('verifyPurchase / restorePurchase ไม่ล็อกอิน → unauthenticated', async () => {
  for (const fn of [fns.verifyPurchase, fns.restorePurchase]) {
    const err = await fn.run({ data: { productId: 'unlimited_hearts_2h', purchaseToken: 'x'.repeat(20) }, rawRequest: {} }).then(() => null, e => e);
    assert.equal(err?.code, 'unauthenticated');
  }
});

test('deleteAccount ไม่ล็อกอิน → unauthenticated', async () => {
  const err = await fns.deleteAccount.run({ data: {}, rawRequest: {} }).then(() => null, e => e);
  assert.equal(err?.code, 'unauthenticated');
});

test('cleanupUser = Auth trigger ตอนลบบัญชี (asia-southeast1, maxInstances 3)', () => {
  const ep = fns.cleanupUser.__endpoint;
  assert.equal(ep.eventTrigger?.eventType, 'providers/firebase.auth/eventTypes/user.delete');
  assert.deepEqual(ep.region, ['asia-southeast1']);
  assert.equal(ep.maxInstances, 3);
});

test('ตั้ง region asia-southeast1 + maxInstances + callable', () => {
  for (const fn of [fns.verifyPurchase, fns.restorePurchase, fns.deleteAccount]) {
    const ep = fn.__endpoint;
    assert.deepEqual(ep.region, ['asia-southeast1']);
    assert.equal(ep.maxInstances, 3);
    assert.ok(ep.callableTrigger);
  }
});
