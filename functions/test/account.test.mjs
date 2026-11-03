// ทดสอบลบบัญชี (account.js) กับ Firestore emulator · Auth ปลอม (ไม่ต่อ Firebase Auth จริง)
// รัน: firebase emulators:exec --only firestore --project demo-wickling "npm test"  (ดู README.md)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createAccounts } from '../account.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('ต้องรันผ่าน Firestore emulator: firebase emulators:exec --only firestore --project demo-wickling "npm test"');
}
process.env.GCLOUD_PROJECT ??= 'demo-wickling';
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

const deleted = [];
let authFails = null;
const auth = {
  async deleteUser(uid) {
    if (authFails) throw Object.assign(new Error(authFails), { code: authFails });
    deleted.push(uid);
  },
};
const { cleanup, deleteMe } = createAccounts({ db, auth });

const exists = async path => (await db.doc(path).get()).exists;
async function seed(uid, token) {
  await db.doc(`entitlements/${uid}`).set({ removeAds: true });
  await db.doc(`rate/${uid}`).set({ start: Date.now(), n: 2 });
  await db.doc(`purchases/${token}`).set({ uid, productId: 'remove_ads' });
}

before(async () => {
  await seed('other', 'p-other');
});

test('cleanup ลบ entitlements และ rate ของ uid นั้น · เก็บ purchases (กันใบเสร็จซ้ำ) และไม่แตะบัญชีอื่น', async () => {
  await seed('u1', 'p-u1');
  await cleanup('u1');
  assert.equal(await exists('entitlements/u1'), false);
  assert.equal(await exists('rate/u1'), false);
  assert.equal(await exists('purchases/p-u1'), true);
  assert.equal(await exists('entitlements/other'), true);
  assert.equal(await exists('rate/other'), true);
});

test('cleanup กับ uid ที่ไม่มีข้อมูล / uid แปลก ไม่พัง', async () => {
  await cleanup('nobody');
  await cleanup('../other');
  await cleanup(undefined);
  assert.equal(await exists('entitlements/other'), true);
});

test('deleteMe: ไม่ล็อกอิน → unauthenticated และไม่ลบอะไร', async () => {
  const err = await deleteMe(undefined).then(() => null, e => e);
  assert.equal(err?.code, 'unauthenticated');
  assert.equal(deleted.length, 0);
});

test('deleteMe: ลบบัญชีของผู้เรียกเอง + ล้างข้อมูล', async () => {
  await seed('u2', 'p-u2');
  assert.deepEqual(await deleteMe({ uid: 'u2' }), { ok: true });
  assert.deepEqual(deleted, ['u2']);
  assert.equal(await exists('entitlements/u2'), false);
  assert.equal(await exists('rate/u2'), false);
  assert.equal(await exists('entitlements/other'), true);
});

test('deleteMe: บัญชีถูกลบไปแล้ว (user-not-found) ยังล้างข้อมูลและตอบ ok · ลบไม่ได้ด้วยเหตุอื่น → internal ไม่ล้างข้อมูล', async () => {
  await seed('u3', 'p-u3');
  authFails = 'auth/user-not-found';
  assert.deepEqual(await deleteMe({ uid: 'u3' }), { ok: true });
  assert.equal(await exists('entitlements/u3'), false);
  await seed('u4', 'p-u4');
  authFails = 'auth/internal-error';
  const err = await deleteMe({ uid: 'u4' }).then(() => null, e => e);
  assert.equal(err?.code, 'internal');
  assert.equal(await exists('entitlements/u4'), true);
  authFails = null;
});
