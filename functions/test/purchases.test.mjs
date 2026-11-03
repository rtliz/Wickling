// ทดสอบตรวจใบเสร็จกับ Firestore emulator + Google Play ปลอม (ไม่ต่อ Google จริง)
// ต้องใช้ Node ≥ 23.6 (import ไฟล์ .ts ของเกมตรง ๆ) · รัน: firebase emulators:exec --only firestore --project demo-wickling "npm test"  (ดู README.md)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createPurchases } from '../purchases.js';
import { PlayError } from '../play.js';
import { PRODUCTS } from '../products.js';
import { PRODUCTS as CLIENT_PRODUCTS } from '../../src/platform/products.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('ต้องรันผ่าน Firestore emulator: firebase emulators:exec --only firestore --project demo-wickling "npm test"');
}
process.env.GCLOUD_PROJECT ??= 'demo-wickling';
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

// Google ปลอม: tokens[token] = ProductPurchase · token ที่ไม่มี = 400 (Google ตอบแบบนี้กับ token ปลอม)
const tokens = {};
const acked = [];
const consumed = [];
let playDown = null;
const play = {
  async get(productId, token) {
    if (playDown) throw new PlayError(playDown, playDown === 'config' ? 403 : 503);
    const p = tokens[token];
    if (!p || p.productId !== productId) throw new PlayError('invalid', 400);
    const { answerAs, ackFails, ...rest } = p;
    return { ...rest, productId: answerAs ?? p.productId };
  },
  async acknowledge(productId, token) {
    if (tokens[token].ackFails) throw new PlayError('transient', 503);
    acked.push(token);
    tokens[token].acknowledgementState = 1;
  },
  async consume(productId, token) {
    consumed.push(token);
    tokens[token].consumptionState = 1;
  },
};
const md5 = s => createHash('md5').update(s).digest('hex');
let seq = 0;
function buy(productId, extra = {}) {
  const token = `tok-${productId}-${++seq}-${'x'.repeat(20)}`;
  tokens[token] = { productId, purchaseState: 0, consumptionState: 0, acknowledgementState: 0, orderId: `GPA.${seq}`, purchaseType: 0, ...extra };
  return token;
}
const consume = token => { tokens[token].consumptionState = 1; };

const silent = { error() {}, warn() {} };
// เทสต์ทั่วไปขยายเพดาน rate (มีเทสต์ rate แยกด้านล่าง)
const { verify, restore } = createPurchases({ db, play, log: silent, rate: { max: 1000, windowMs: 3_600_000 } });
const guest = uid => ({ uid, token: { firebase: { identities: {}, sign_in_provider: 'anonymous' } } });
const code = async (p, c) => assert.equal((await p.then(() => null, e => e)).code, c);

before(async () => {
  for (const name of ['purchases', 'entitlements', 'rate']) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map(d => d.ref.delete()));
  }
});

test('ตารางสินค้า server ตรงกับ src/platform/products.ts ของเกม', () => {
  assert.deepEqual(PRODUCTS, CLIENT_PRODUCTS);
  assert.deepEqual(Object.keys(PRODUCTS).sort(), ['remove_ads', 'unlimited_hearts_2h']);
});

test('ใบเสร็จถูก → ได้ของตามตาราง server ครั้งเดียว + acknowledge + ผูก uid', async () => {
  const t = buy('unlimited_hearts_2h');
  const r = await verify(guest('u1'), { productId: 'unlimited_hearts_2h', purchaseToken: t, grant: { unlimitedHours: 999 } });
  assert.equal(r.ok, true);
  assert.equal(r.redelivery, false);
  assert.deepEqual(r.grant, { unlimitedHours: 2 }, 'ของมาจากตาราง server ไม่ใช่ค่าที่ client ส่ง');
  assert.match(r.purchaseId, /^[0-9a-f]{64}$/);
  assert.ok(acked.includes(t));
  const doc = (await db.doc(`purchases/${r.purchaseId}`).get()).data();
  assert.equal(doc.uid, 'u1');
  assert.equal(doc.productId, 'unlimited_hearts_2h');
  assert.equal(doc.test, true);
  assert.equal(JSON.stringify(doc).includes(t), false, 'ไม่เก็บ token ดิบ');
});

test('ใบเสร็จเดิมซ้ำหลังแอป consume แล้ว → ไม่ได้ของ', async () => {
  const t = buy('unlimited_hearts_2h');
  assert.equal((await verify(guest('u2'), { productId: 'unlimited_hearts_2h', purchaseToken: t })).ok, true);
  consume(t);
  assert.deepEqual(await verify(guest('u2'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'used' });
});

test('consumable ค้าง (ยังไม่ consume) → uid เดิมได้ grant + purchaseId เดิมอีก 1 ครั้ง แล้ว server consume เอง', async () => {
  const t = buy('unlimited_hearts_2h');
  const a = await verify(guest('u3'), { productId: 'unlimited_hearts_2h', purchaseToken: t });
  assert.equal(consumed.includes(t), false);
  const b = await verify(guest('u3'), { productId: 'unlimited_hearts_2h', purchaseToken: t });
  assert.equal(b.ok, true);
  assert.equal(b.redelivery, true);
  assert.equal(b.purchaseId, a.purchaseId);
  assert.ok(consumed.includes(t), 'ครบเพดาน 2 ครั้ง → consume ที่ server');
  assert.deepEqual(await verify(guest('u3'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'used' });
});

test('consumable ครบเพดานแต่ consume ครั้งก่อนพลาด → ปฏิเสธและ consume อีกรอบ', async () => {
  const t = buy('unlimited_hearts_2h');
  const ref = db.doc(`purchases/${createHash('sha256').update(t).digest('hex')}`);
  await verify(guest('u3b'), { productId: 'unlimited_hearts_2h', purchaseToken: t });
  await ref.update({ deliveries: 2 });
  assert.deepEqual(await verify(guest('u3b'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'used' });
  assert.ok(consumed.includes(t));
});

test('ใบเสร็จของคนอื่น (uid อื่น) → ไม่ได้ของ', async () => {
  const t = buy('unlimited_hearts_2h');
  assert.equal((await verify(guest('u4'), { productId: 'unlimited_hearts_2h', purchaseToken: t })).ok, true);
  assert.deepEqual(await verify(guest('thief'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'used' });
});

test('ซื้อด้วย obfuscatedAccountId ของ uid อื่น → other-account', async () => {
  const t = buy('unlimited_hearts_2h', { obfuscatedExternalAccountId: md5('owner') });
  assert.deepEqual(await verify(guest('thief2'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'other-account' });
  assert.equal((await verify(guest('owner'), { productId: 'unlimited_hearts_2h', purchaseToken: t })).ok, true);
});

test('token ปลอม / สินค้าไม่ตรง token → invalid', async () => {
  assert.deepEqual(await verify(guest('u5'), { productId: 'unlimited_hearts_2h', purchaseToken: 'fake-token-123456' }), { ok: false, reason: 'invalid' });
  const t = buy('unlimited_hearts_2h');
  assert.deepEqual(await verify(guest('u5'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'invalid' });
});

test('Google ตอบ productId ไม่ตรงกับที่ขอ → invalid', async () => {
  const t = buy('remove_ads', { answerAs: 'unlimited_hearts_2h' });
  assert.deepEqual(await verify(guest('u5b'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'invalid' });
});

test('multi-quantity → ของคูณจำนวน (noAds ไม่คูณ) · ค่าผิดปกติ = 1', async () => {
  const t = buy('unlimited_hearts_2h', { quantity: 3 });
  const r = await verify(guest('q1'), { productId: 'unlimited_hearts_2h', purchaseToken: t });
  assert.deepEqual(r.grant, { unlimitedHours: 6 });
  const h = buy('unlimited_hearts_2h', { quantity: 2 });
  assert.equal((await verify(guest('q1'), { productId: 'unlimited_hearts_2h', purchaseToken: h })).grant.unlimitedHours, 4);
  const w = buy('unlimited_hearts_2h', { quantity: -5 });
  assert.equal((await verify(guest('q1'), { productId: 'unlimited_hearts_2h', purchaseToken: w })).grant.unlimitedHours, 2);
  assert.deepEqual(PRODUCTS.unlimited_hearts_2h.grant.unlimitedHours, 2, 'ตารางต้นฉบับไม่ถูกแก้');
});

test('สถานะ cancelled/refunded → canceled · pending → pending · ไม่บันทึกในฐานข้อมูล', async () => {
  const c = buy('unlimited_hearts_2h', { purchaseState: 1 });
  assert.deepEqual(await verify(guest('u6'), { productId: 'unlimited_hearts_2h', purchaseToken: c }), { ok: false, reason: 'canceled' });
  const p = buy('unlimited_hearts_2h', { purchaseState: 2 });
  assert.deepEqual(await verify(guest('u6'), { productId: 'unlimited_hearts_2h', purchaseToken: p }), { ok: false, reason: 'pending' });
  const h = createHash('sha256').update(c).digest('hex');
  assert.equal((await db.doc(`purchases/${h}`).get()).exists, false);
});

test('consume ไปแล้วแต่ไม่เคยผ่าน server → used', async () => {
  const t = buy('unlimited_hearts_2h', { consumptionState: 1 });
  assert.deepEqual(await verify(guest('u7'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), { ok: false, reason: 'used' });
});

test('productId ไม่รู้จัก / token ผิดรูปแบบ → invalid-argument', async () => {
  await code(verify(guest('u8'), { productId: 'gems_9999', purchaseToken: 'whatever-123456' }), 'invalid-argument');
  await code(verify(guest('u8'), { productId: '__proto__', purchaseToken: 'whatever-123456' }), 'invalid-argument');
  await code(verify(guest('u8'), { productId: 'unlimited_hearts_2h', purchaseToken: 42 }), 'invalid-argument');
  await code(verify(guest('u8'), { productId: 'unlimited_hearts_2h' }), 'invalid-argument');
  await code(verify(guest('u8'), null), 'invalid-argument');
});

test('ไม่ล็อกอิน → unauthenticated (verify และ restore)', async () => {
  const t = buy('unlimited_hearts_2h');
  await code(verify(undefined, { productId: 'unlimited_hearts_2h', purchaseToken: t }), 'unauthenticated');
  await code(verify({}, { productId: 'unlimited_hearts_2h', purchaseToken: t }), 'unauthenticated');
  await code(restore(null, { productId: 'remove_ads', purchaseToken: t }), 'unauthenticated');
});

test('remove_ads: guest ซื้อได้ · ตั้ง entitlements.removeAds', async () => {
  const t = buy('remove_ads');
  const r = await verify(guest('r1'), { productId: 'remove_ads', purchaseToken: t });
  assert.equal(r.ok, true);
  assert.deepEqual(r.grant, { noAds: true });
  assert.equal((await db.doc('entitlements/r1').get()).get('removeAds'), true);
});

test('restore: remove_ads เจ้าของกู้ได้ตาม maxRestores · uid อื่นรวมไม่เกิน 3 บัญชี', async () => {
  const t = buy('remove_ads', { obfuscatedExternalAccountId: md5('r2') });
  assert.equal((await verify(guest('r2'), { productId: 'remove_ads', purchaseToken: t })).ok, true);
  // เจ้าของลงแอปใหม่ได้ uid ใหม่ แต่ obfuscatedAccountId = md5(uid เดิม) → uid ใหม่ถือเป็นคนอื่น
  for (const u of ['x1', 'x2', 'x3']) {
    const r = await restore(guest(u), { productId: 'remove_ads', purchaseToken: t });
    assert.equal(r.ok, true);
    assert.equal((await db.doc(`entitlements/${u}`).get()).get('removeAds'), true);
  }
  assert.equal((await restore(guest('x1'), { productId: 'remove_ads', purchaseToken: t })).ok, true, 'uid เดิมในรายชื่อกู้ซ้ำได้');
  assert.deepEqual(await restore(guest('x4'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'limit' });
  // เจ้าของ (uid ที่ซื้อ) กู้ได้จนครบ maxRestores รวม
  const used = (await db.doc(`purchases/${createHash('sha256').update(t).digest('hex')}`).get()).get('restores');
  for (let i = used; i < PRODUCTS.remove_ads.maxRestores; i++) assert.equal((await restore(guest('r2'), { productId: 'remove_ads', purchaseToken: t })).ok, true);
  assert.deepEqual(await restore(guest('r2'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'limit' });
});

test('restore: remove_ads ที่ไม่มี obfuscatedAccountId → uid ที่ซื้อเป็นเจ้าของ uid อื่นจำกัด 3', async () => {
  const t = buy('remove_ads');
  assert.equal((await verify(guest('o1'), { productId: 'remove_ads', purchaseToken: t })).ok, true);
  for (const u of ['o2', 'o3', 'o4']) assert.equal((await restore(guest(u), { productId: 'remove_ads', purchaseToken: t })).ok, true);
  assert.deepEqual(await restore(guest('o5'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'limit' });
  assert.equal((await restore(guest('o1'), { productId: 'remove_ads', purchaseToken: t })).ok, true);
});

test('restore: ใบเสร็จถูกคืนเงิน → canceled (แอปถอนลบโฆษณา) · ของใช้แล้วหมดกู้ไม่ได้', async () => {
  const t = buy('remove_ads');
  assert.equal((await verify(guest('c1'), { productId: 'remove_ads', purchaseToken: t })).ok, true);
  tokens[t].purchaseState = 1;
  assert.deepEqual(await restore(guest('c1'), { productId: 'remove_ads', purchaseToken: t }), { ok: false, reason: 'canceled' });
  const s = buy('unlimited_hearts_2h');
  assert.deepEqual(await restore(guest('c1'), { productId: 'unlimited_hearts_2h', purchaseToken: s }), { ok: false, reason: 'not-restorable' });
});

test('rate limit: เกิน max ต่อชั่วโมงต่อ uid → resource-exhausted ก่อนถาม Google · uid อื่นไม่โดน', async () => {
  let calls = 0;
  const counting = { ...play, get: (...a) => { calls++; return play.get(...a); } };
  const limited = createPurchases({ db, play: counting, log: silent, rate: { max: 3, windowMs: 3_600_000 } });
  for (let i = 0; i < 3; i++) await limited.verify(guest('rl1'), { productId: 'unlimited_hearts_2h', purchaseToken: 'fake-token-123456' });
  await code(limited.verify(guest('rl1'), { productId: 'unlimited_hearts_2h', purchaseToken: 'fake-token-123456' }), 'resource-exhausted');
  await code(limited.restore(guest('rl1'), { productId: 'remove_ads', purchaseToken: 'fake-token-123456' }), 'resource-exhausted');
  assert.equal(calls, 3);
  assert.equal((await limited.verify(guest('rl2'), { productId: 'unlimited_hearts_2h', purchaseToken: 'fake-token-123456' })).reason, 'invalid');
  // หน้าต่างหมดเวลา → นับใหม่
  await db.doc('rate/rl1').update({ start: Date.now() - 3_600_001 });
  assert.equal((await limited.verify(guest('rl1'), { productId: 'unlimited_hearts_2h', purchaseToken: 'fake-token-123456' })).reason, 'invalid');
});

test('restore: ใบเสร็จที่ไม่เคยผ่าน verify (แอปปิดกลางทาง) → ผูกครั้งแรก', async () => {
  const t = buy('remove_ads', { acknowledgementState: 1 });
  const r = await restore(guest('n1'), { productId: 'remove_ads', purchaseToken: t });
  assert.equal(r.ok, true);
  assert.equal((await db.doc(`purchases/${r.purchaseId}`).get()).get('uid'), 'n1');
});

test('Google ล่ม / สิทธิ์ service account ยังไม่ตั้ง → throw ให้แอปลองใหม่ (ไม่ใช่ปฏิเสธใบเสร็จ)', async () => {
  const t = buy('unlimited_hearts_2h');
  playDown = 'transient';
  await code(verify(guest('d1'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), 'unavailable');
  playDown = 'config';
  await code(verify(guest('d1'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), 'internal');
  playDown = null;
  assert.equal((await verify(guest('d1'), { productId: 'unlimited_hearts_2h', purchaseToken: t })).ok, true);
});

test('ซื้อพร้อมกัน 2 คำขอด้วยใบเดียว (uid ต่างกัน) → ได้ของคนเดียว', async () => {
  const t = buy('unlimited_hearts_2h');
  const rs = await Promise.all([verify(guest('race1'), { productId: 'unlimited_hearts_2h', purchaseToken: t }), verify(guest('race2'), { productId: 'unlimited_hearts_2h', purchaseToken: t })]);
  assert.equal(rs.filter(r => r.ok).length, 1);
});
