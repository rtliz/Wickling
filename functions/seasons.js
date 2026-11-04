// กระดานรายสัปดาห์ / รายเดือน / ถาวร และรางวัลหัวใจ — server คิดแต้มและตัดสินรางวัลทั้งหมด (แบบ meowchime/functions/seasons.js)
// หน้าตาและรอบแบบ LumiFlip (สัปดาห์/เดือน/ทั้งหมด, รางวัล REWARD_TIERS, claimSeason) แต่ client เขียนแต้มเองไม่ได้
//
// boards/{all|W2026-11-02|M2026-11}/scores/{uid}  { uid, name, pts, at, g }  คนที่ล็อกอินอ่านได้ (limit ≤ 50) · client เขียนไม่ได้ (firestore.rules)
//   g = บัญชีผูก Google ตอนได้แต้มล่าสุด (guest ผูกแล้วได้แต้มครั้งถัดไป → true) · ทุกกระดานในเกมแสดงทุกคน (guest ด้วย)
//   อันดับรางวัล (lockRanks) นับเฉพาะ g == true (บอทสร้างบัญชี guest ได้ไม่จำกัด จึงห้ามแย่งที่รางวัล)
// players/{uid}                                   { name, nameAt, day: { d, n }, credit, lastAt } สถานะฝั่ง server · client อ่าน/เขียนไม่ได้
// players/{uid}/won/{r0|t12}                      { at } ห้อง/ชั้นที่นับแต้มแล้ว (ชนะซ้ำไม่ได้แต้ม)
// seasons/{W…|M…}                                 { ranks: { sha256(uid): อันดับ } } ผลที่ล็อกแล้ว
// seasonClaims/{uid}                              { ids } รอบที่รับรางวัลแล้ว
// deleted/{uid}                                   { at } บัญชีที่ลบแล้ว (submitWin/claimSeason ปฏิเสธ)
// boards-dev / players-dev = ข้อมูลทดสอบ เขียนได้เฉพาะใน Functions emulator (wins.js)
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ALL_BOARD, BOARD_SIZE, weekId, monthId, prevWeekId, prevMonthId, rewardFor } from './season-rules.js';
import { limitRate } from './limit.js';

const ALREADY_EXISTS = 6;
const RATE = { max: 10, windowMs: 60 * 60_000 };
const CLAIMS_KEPT = 8;

// ชื่อ: กติกาเดียวกับหน้าล็อกอินของเกม (src/core/name.ts รวมมาใน game.js)
export { cleanName, nameLength } from './game.js';
const hashUid = uid => createHash('sha256').update(uid).digest('hex');
export const hasGoogle = auth => 'google.com' in (auth?.token?.firebase?.identities ?? {});

export function createSeasons({ db, rate = RATE }) {
  // +pts ให้กระดานถาวร สัปดาห์ และเดือนของเวลา server ตอนนี้ (เรียกใน transaction)
  function writePoints(t, uid, name, pts, now, dev = false, g = false) {
    const boards = dev ? 'boards-dev' : 'boards';
    const entry = { uid, name, pts: FieldValue.increment(pts), at: Timestamp.fromMillis(now), g };
    for (const id of [ALL_BOARD, weekId(now), monthId(now)]) t.set(db.doc(`${boards}/${id}/scores/${uid}`), entry, { merge: true });
  }

  async function lockRanks(id) {
    const ref = db.doc(`seasons/${id}`);
    const cur = await ref.get();
    if (cur.exists) return cur.get('ranks');
    // เฉพาะแถวบัญชี Google (ดัชนี g + pts desc + at ใน firestore.indexes.json)
    const top = await db.collection(`boards/${id}/scores`).where('g', '==', true).orderBy('pts', 'desc').orderBy('at').limit(BOARD_SIZE).get();
    const ranks = Object.fromEntries(top.docs.map((d, i) => [hashUid(d.id), i + 1]));
    const created = await ref.create({ ranks, lockedAt: FieldValue.serverTimestamp() }).then(() => true, e => {
      if (e.code !== ALREADY_EXISTS) throw e;
      return false;
    });
    return created ? ranks : (await ref.get()).get('ranks');
  }

  // ยกจาก LumiFlip: รอบล่าสุดที่จบแล้ว · Google เท่านั้น · ครั้งเดียวต่อรอบ · หัวใจอยู่ในเครื่อง client จึงเป็นคนเพิ่มหัวใจเอง
  // → { rewards: [{ id, rank, hearts }], hearts } | { rewards: [], needGoogle: true, hearts }
  async function claim(auth, _data, now = Date.now()) {
    const uid = auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in first');
    if ((await db.doc(`deleted/${uid}`).get()).exists) throw new HttpsError('permission-denied', 'account deleted');
    await limitRate(db, `season-${uid}`, rate, 'too many season claims');
    const me = hashUid(uid);
    const ids = [prevWeekId(now), prevMonthId(now)];
    const won = (await Promise.all(ids.map(async id => {
      const rank = (await lockRanks(id))[me];
      return rank ? { id, rank, hearts: rewardFor(id, rank) } : null;
    }))).filter(Boolean);
    if (!won.length) return { rewards: [], hearts: 0 };

    const ref = db.doc(`seasonClaims/${uid}`);
    return db.runTransaction(async t => {
      const claims = (await t.get(ref)).get('ids') ?? [];
      const rewards = won.filter(w => !claims.includes(w.id));
      const hearts = rewards.reduce((a, w) => a + w.hearts, 0);
      if (!rewards.length) return { rewards: [], hearts: 0 };
      if (!hasGoogle(auth)) return { rewards: [], needGoogle: true, hearts };
      t.set(ref, { ids: [...claims, ...rewards.map(w => w.id)].slice(-CLAIMS_KEPT) });
      return { rewards, hearts };
    });
  }

  return { writePoints, claim };
}
