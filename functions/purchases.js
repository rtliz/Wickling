// ตรรกะตรวจใบเสร็จ (ยกจาก LumiFlip/functions/purchases.js ซึ่งยกจาก Idle-Wuxia-RPG/functions/index.js · ไม่ได้แก้ตรรกะ) แยกจาก index.js เพื่อทดสอบกับ Google ปลอมได้
// createPurchases({ db, play, rate? }) → { verify(auth, data), restore(auth, data) }
//
// ผลตอบกลับ: { ok: true, productId, purchaseId, grant, redelivery?, restored?, entitlementOnly? }
//          หรือ { ok: false, reason } เมื่อใบเสร็จใช้ไม่ได้ (แอปต้องไม่ให้ของและไม่ finish → Google คืนเงินใบที่ไม่ acknowledge เองใน 3 วัน)
// throw HttpsError เมื่อ: ไม่ล็อกอิน (unauthenticated), ข้อมูลผิด (invalid-argument), ต้องผูก Google (failed-precondition),
// เรียกถี่เกิน (resource-exhausted) หรือคุยกับ Google ไม่ได้ (unavailable / internal = ให้แอปลองใหม่ภายหลัง ห้ามถือว่าใบเสร็จปลอม)
//
// Firestore (เขียนด้วย Admin SDK เท่านั้น · rules ปิด client):
//   purchases/{sha256(token)}  { uid, productId, orderId, test, quantity, deliveries, restores, restoredUids,
//                                createdAt, lastAt, restoredAt?, restoredBy?, canceled?, canceledAt? }
//   entitlements/{uid}         { removeAds?, starter?, updatedAt }  (เจ้าของอ่านได้)
//   rate/{uid}                 { start, n }  นับคำขอต่อชั่วโมง (client อ่าน/เขียนไม่ได้ ด้วย default-deny)
//
// ⚠️ ห้ามใช้ entitlements.removeAds (หรือ starter) ให้ของที่ server โดยไม่มีการติดตามคืนเงิน:
//    server ถอนสิทธิ์ได้เฉพาะตอนมีคำขอ verify/restore แล้ว Google ตอบ canceled (ไม่มี RTDN/voided purchases)
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { PRODUCTS } from './products.js';
import { PlayError } from './play.js';

// purchaseState ของ Google Play
const PURCHASED = 0;
const CANCELED = 1;
const PENDING = 2;
// ใบเสร็จเดียวกันให้ของ (ไอเทม/หัวใจ) กับ uid เดิมได้กี่ครั้ง: ครั้งแรก + กู้ 1 ครั้งเมื่อแอปปิดก่อนเซฟ
// consumable: ครบแล้ว server consume เอง · starter: นับรวมทั้ง verify และ restore ที่ได้ของ
const MAX_DELIVERIES = 2;
// remove_ads: uid อื่น (ไม่ใช่คนซื้อ) กู้คืนด้วยใบเดียวกันได้ไม่เกินกี่บัญชี
const MAX_OTHER_UIDS = 3;
// จำกัดคำขอต่อ uid (verify + restore รวมกัน) ก่อนเรียก Google · 1 read + 1 write ต่อคำขอ
const RATE = { max: 10, windowMs: 60 * 60_000 };
// multi-quantity: ให้ของคูณจำนวน (ผู้เล่นไม่เสียของ) · ค่าผิดปกติถือเป็น 1
const MAX_QUANTITY = 100;

const sha256 = s => createHash('sha256').update(s).digest('hex');
// cordova-plugin-purchase (obfuscator 'legacy') ส่ง md5(uid) เป็น obfuscatedAccountId ตอนซื้อ
const md5 = s => createHash('md5').update(s).digest('hex');

const needUser = auth => {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'sign in first');
  return auth.uid;
};
const hasGoogle = auth => 'google.com' in (auth?.token?.firebase?.identities ?? {});

function readArgs(data) {
  const { productId, purchaseToken } = data ?? {};
  if (typeof productId !== 'string' || !Object.hasOwn(PRODUCTS, productId)) {
    throw new HttpsError('invalid-argument', 'unknown product');
  }
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    throw new HttpsError('invalid-argument', 'bad purchase token');
  }
  return { productId, purchaseToken, product: PRODUCTS[productId] };
}

const fail = reason => ({ ok: false, reason });

const quantityOf = data => {
  const q = Number(data.quantity ?? 1);
  return Number.isInteger(q) && q >= 1 && q <= MAX_QUANTITY ? q : 1;
};
// ของคูณจำนวนที่ซื้อ (noAds ไม่คูณ)
function scaled(grant, q) {
  if (q === 1) return grant;
  const out = { ...grant };
  if (grant.unlimitedHours) out.unlimitedHours = grant.unlimitedHours * q;
  if (grant.items) out.items = Object.fromEntries(Object.entries(grant.items).map(([k, v]) => [k, v * q]));
  return out;
}

export function createPurchases({ db, play, log = console, rate = RATE }) {
  const now = FieldValue.serverTimestamp;
  const purchaseRef = token => db.collection('purchases').doc(sha256(token));
  const entRef = uid => db.collection('entitlements').doc(uid);
  const setEntitlement = (tx, uid, product, value = true) => {
    if (product.entitlement) tx.set(entRef(uid), { [product.entitlement]: value, updatedAt: now() }, { merge: true });
  };

  // จำกัดคำขอต่อ uid ต่อชั่วโมง (เวลา server) ก่อนเรียก Google
  async function limit(uid) {
    const ref = db.collection('rate').doc(uid);
    const ok = await db.runTransaction(async tx => {
      const d = (await tx.get(ref)).data();
      const t = Date.now();
      const fresh = !d || !(t - d.start < rate.windowMs);
      const n = fresh ? 0 : d.n;
      if (n >= rate.max) return false;
      tx.set(ref, { start: fresh ? t : d.start, n: n + 1 });
      return true;
    });
    if (!ok) throw new HttpsError('resource-exhausted', 'too many purchase checks');
  }

  // Google ตอบ canceled (ยกเลิก/คืนเงิน) กับใบที่เคยผ่าน server → ถอนสิทธิ์ของทุก uid ที่ได้จากใบนี้
  async function revoke(token, product) {
    if (!product.entitlement) return;
    const ref = purchaseRef(token);
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get('canceled') === true) return;
      tx.update(ref, { canceled: true, canceledAt: now() });
      for (const uid of new Set([doc.get('uid'), ...(doc.get('restoredUids') ?? [])])) setEntitlement(tx, uid, product, false);
    });
  }

  // ถาม Google · คืน { data } หรือ { reject } · ปัญหาฝั่งเรา/เครือข่าย = throw ให้แอปลองใหม่
  async function ask(productId, token, product) {
    let data;
    try {
      data = await play.get(productId, token);
    } catch (err) {
      if (err instanceof PlayError && err.kind === 'invalid') return { reject: fail('invalid') };
      log.error?.('[iap] play.get failed', productId, err?.kind, err?.status, err?.message);
      if (err instanceof PlayError && err.kind === 'config') throw new HttpsError('internal', 'play api permission');
      throw new HttpsError('unavailable', 'play api unavailable');
    }
    if (data?.productId != null && data.productId !== productId) return { reject: fail('invalid') };
    if (data?.purchaseState === CANCELED) {
      await revoke(token, product);
      return { reject: fail('canceled') };
    }
    if (data?.purchaseState === PENDING) return { reject: fail('pending') };
    if (data?.purchaseState !== PURCHASED) return { reject: fail('invalid') };
    return { data };
  }

  // ซื้อโดยบัญชีเกมอื่น (แอปแนบ md5(uid) ตอนซื้อ) · ใบเสร็จที่ไม่มีค่านี้ (เช่น ซื้อตอนยังไม่ล็อกอิน) ปล่อยผ่าน
  const otherAccount = (data, uid) => !!data.obfuscatedExternalAccountId && data.obfuscatedExternalAccountId !== md5(uid);

  // แจ้ง Google หลังบันทึกแล้ว: consume (consumable ที่ครบเพดาน) หรือ acknowledge (กันคืนเงินอัตโนมัติ 3 วัน)
  // พลาดไม่เป็นไร แอปจะ finish ให้อีกชั้น
  async function settle(productId, token, data, consume) {
    try {
      if (consume && data.consumptionState !== 1) await play.consume(productId, token);
      else if (!consume && data.acknowledgementState !== 1) await play.acknowledge(productId, token);
    } catch (err) {
      log.warn?.('[iap] settle failed', consume ? 'consume' : 'acknowledge', productId, err?.kind, err?.status);
    }
  }

  const newPurchase = (uid, productId, data) => ({
    uid, productId,
    orderId: typeof data.orderId === 'string' ? data.orderId.slice(0, 64) : null,
    test: data.purchaseType === 0,
    quantity: quantityOf(data),
    deliveries: 1, restores: 0, restoredUids: [],
    createdAt: now(), lastAt: now(),
  });

  /**
   * ตรวจใบเสร็จก่อนให้ของ (ซื้อใหม่ และใบเสร็จค้างที่แอปยังไม่ finish ตอนเปิดแอปครั้งถัดไป)
   * ใบเสร็จผูกกับ uid แรกที่ส่งมา · uid เดิมเรียกซ้ำได้ (grant เดิม + purchaseId เดิม ให้แอปกันซ้ำ) ไม่เกิน MAX_DELIVERIES
   * consumable ส่งครบเพดานแล้ว server consume เอง · ของครั้งเดียวส่งซ้ำได้เฉพาะตอน Google ยังไม่ได้ acknowledge
   * ของครั้งเดียวต่อบัญชี (perAccount) ต้องผูก Google และบัญชีนั้นยังไม่มีสิทธิ์อยู่
   */
  async function verify(auth, input) {
    const uid = needUser(auth);
    const { productId, purchaseToken, product } = readArgs(input);
    if (product.perAccount && !hasGoogle(auth)) throw new HttpsError('failed-precondition', 'link-google');
    await limit(uid);

    const { data, reject } = await ask(productId, purchaseToken, product);
    if (reject) return reject;
    if (otherAccount(data, uid)) return fail('other-account');

    const purchaseId = sha256(purchaseToken);
    const ref = purchaseRef(purchaseToken);
    const res = await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      const ent = product.perAccount ? await tx.get(entRef(uid)) : null;
      if (doc.exists) {
        const d = doc.data();
        const n = d.deliveries ?? 0;
        if (d.uid !== uid || d.productId !== productId) return fail('used');
        if (data.consumptionState === 1) return fail('used');
        if (product.once && data.acknowledgementState !== 0) return fail('used');
        if (n >= MAX_DELIVERIES) return { ...fail('used'), consume: !product.once };
        tx.update(ref, { deliveries: n + 1, lastAt: now() });
        return { ok: true, redelivery: true, consume: !product.once && n + 1 >= MAX_DELIVERIES };
      }
      // consume ไปแล้วแต่ไม่เคยผ่าน server (ซื้อก่อนมีระบบนี้) = ส่งของไปแล้ว
      if (data.consumptionState === 1) return fail('used');
      if (ent?.exists && ent.get(product.entitlement) === true) return fail('owned');
      tx.create(ref, newPurchase(uid, productId, data));
      setEntitlement(tx, uid, product);
      return { ok: true, redelivery: false, consume: false };
    });
    if (!res.ok) {
      if (res.consume) await settle(productId, purchaseToken, data, true);
      return fail(res.reason);
    }
    await settle(productId, purchaseToken, data, res.consume);
    return { ok: true, productId, purchaseId, grant: scaled(product.grant, quantityOf(data)), redelivery: res.redelivery };
  }

  /**
   * กู้คืนของซื้อครั้งเดียว (ลบเซฟ/ลงแอปใหม่/เปลี่ยนเครื่อง) · Google ต้องยืนยันว่ายังจ่ายแล้วและไม่ถูกยกเลิก
   * - ใบที่ยังไม่เคยผ่าน verify (แอปปิดตอนตรวจ / ซื้อก่อนมีระบบ) = ยังไม่เคยได้ของ → ผูก uid และให้ของเต็ม
   * - starter_adventure: เฉพาะ uid เดิม · คืนสิทธิ์เสมอ แต่ไอเทม/หัวใจให้อีกเฉพาะเมื่อใบนี้ให้ของไปไม่ถึง MAX_DELIVERIES
   *   (ครั้งแรก + กู้ 1 ครั้ง: server รู้ไม่ได้ว่าแอปเซฟทันไหม จึงเผื่อ 1 ครั้งให้ผู้เล่นที่เซฟหาย) นอกนั้น entitlementOnly
   * - remove_ads: เจ้าของ (uid ที่ซื้อ หรือ obfuscatedAccountId = md5(uid)) กู้ได้ตาม maxRestores ·
   *   uid อื่นรวมกันไม่เกิน MAX_OTHER_UIDS บัญชี (บัญชี Play เดียวกันเล่นหลายบัญชีเกม)
   */
  async function restore(auth, input) {
    const uid = needUser(auth);
    const { productId, purchaseToken, product } = readArgs(input);
    if (!product.once) return fail('not-restorable');
    if (product.perAccount && !hasGoogle(auth)) throw new HttpsError('failed-precondition', 'link-google');
    await limit(uid);

    const { data, reject } = await ask(productId, purchaseToken, product);
    if (reject) return reject;

    const purchaseId = sha256(purchaseToken);
    const ref = purchaseRef(purchaseToken);
    const res = await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      const ent = product.perAccount ? await tx.get(entRef(uid)) : null;
      if (!doc.exists) {
        if (otherAccount(data, uid)) return fail('other-account');
        if (ent?.exists && ent.get(product.entitlement) === true) return fail('owned');
        tx.create(ref, newPurchase(uid, productId, data));
        setEntitlement(tx, uid, product);
        return { ok: true, items: true };
      }
      const d = doc.data();
      if (d.productId !== productId) return fail('used');
      if (product.perAccount) {
        if (d.uid !== uid) return fail('other-account');
        const items = (d.deliveries ?? 0) < MAX_DELIVERIES;
        tx.update(ref, { restores: (d.restores ?? 0) + 1, restoredAt: now(), restoredBy: uid, ...(items ? { deliveries: (d.deliveries ?? 0) + 1 } : {}) });
        setEntitlement(tx, uid, product);
        return { ok: true, items };
      }
      const others = d.restoredUids ?? [];
      const owner = d.uid === uid || data.obfuscatedExternalAccountId === md5(uid);
      if (!owner && !others.includes(uid) && others.length >= MAX_OTHER_UIDS) return fail('limit');
      if ((d.restores ?? 0) >= product.maxRestores) return fail('limit');
      tx.update(ref, {
        restores: (d.restores ?? 0) + 1, restoredAt: now(), restoredBy: uid,
        ...(owner || others.includes(uid) ? {} : { restoredUids: FieldValue.arrayUnion(uid) }),
      });
      setEntitlement(tx, uid, product);
      return { ok: true, items: true };
    });
    if (!res.ok) return res;
    await settle(productId, purchaseToken, data, false);
    return {
      ok: true, productId, purchaseId, restored: true,
      grant: res.items ? scaled(product.grant, quantityOf(data)) : {},
      ...(res.items ? {} : { entitlementOnly: true }),
    };
  }

  return { verify, restore };
}
