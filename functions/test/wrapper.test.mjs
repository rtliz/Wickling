// ตรวจตัวห่อ onCall ใน index.js: ไม่ล็อกอิน = unauthenticated ก่อนแตะ Google · ตั้ง region/maxInstances
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

test('ตั้ง region asia-southeast1 + maxInstances + callable', () => {
  for (const fn of [fns.verifyPurchase, fns.restorePurchase]) {
    const ep = fn.__endpoint;
    assert.deepEqual(ep.region, ['asia-southeast1']);
    assert.equal(ep.maxInstances, 3);
    assert.ok(ep.callableTrigger);
  }
});
