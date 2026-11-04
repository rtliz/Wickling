// submitWin: แต้มกระดานมาจากที่นี่ที่เดียว (firestore.rules ห้าม client เขียนกระดาน) — แบบ submitLevel ของ meowchime
// client ส่ง "หลักฐานการชนะ" (ทุกการแตะ/สกิล/การปรับเงาของห้องนั้น) → เล่นซ้ำด้วย sim ตัวเดียวกับเกม (game.js สร้างจาก src/core/proof.ts)
// ชนะจริง → +1 แต้มให้กระดานถาวร/สัปดาห์/เดือน ตามเวลา server
//
// กันโกง:
//   - เล่นซ้ำจริงทุกครั้ง: ทางเดินต้องเดินได้ตามกติกา ประตู/เลเซอร์/เงาตรงกับเกม · สกิลที่ใช้ต้องอยู่ในช่องติดตัวที่ส่งมา (ไม่เกิน 2)
//   - ห้อง/ชั้นละ 1 แต้มต่อบัญชี (players/{uid}/won/{key} create) → ส่งหลักฐานเดิมซ้ำไม่ได้แต้ม (แบบ S.cleared ของ LumiFlip: เล่นซ้ำไม่นับ)
//   - เพดานแต้มต่อวัน (เวลาไทย) · แถวที่ได้แต้มจากบัญชี guest มี g = false → ขึ้นทุกกระดานแต่ไม่ติดอันดับรางวัล (บอทสร้าง guest ได้ไม่จำกัด)
//   - "เวลาเล่นสะสม": แต้มมาเร็วกว่าจังหวะที่เล่นจริง × 0.25 วิ ไม่ได้ · ⚠️ แค่ทำให้แต้มไหลไม่เร็วเกินคนจริงต่อบัญชี กันบอทไม่ได้
//     (บอทรอเวลาได้ และเปิดหลายบัญชีได้) · ของที่กันบอทจริงคือเพดานต่อวัน + อันดับรางวัลนับเฉพาะ Google
//   - บัญชีที่ลบแล้ว (deleted/{uid}) ส่งไม่ได้ · dev (boards-dev) เฉพาะ Functions emulator
//   - จำกัดคำขอต่อชั่วโมงต่อบัญชี (rate/win-{uid}) · ขนาดหลักฐานจำกัดใน proof.ts
// ช่องโหว่ที่รู้: server ไม่รู้ว่าผู้เล่นมีสกิลจริงไหม (ดาว/ต้นไม้สกิลอยู่ในเซฟเครื่อง) และหอคอยแก้ด้วยโปรแกรมได้ → เพดานต่อวันคุมไว้
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { replayProof, proofKey } from './game.js';
import { hasGoogle } from './seasons.js';
import { cleanName, nameLength } from './game.js';
import { limitRate } from './limit.js';

const ALREADY_EXISTS = 6;
export const WIN_POINTS_PER_DAY = 60;             // แต้มต่อวันต่อบัญชี (≈ 60 ชั้นหอคอย) · กระดานรายสัปดาห์ cap ในตัวเอง 420
export const TICK_MS = 250;                        // ต้องตรงกับ TICK_MS ใน src/core/sim.ts
export const PLAY_CREDIT_MAX_MS = 6 * 3600_000;    // เล่นออฟไลน์แล้วส่งทีหลังได้ไม่เกิน 6 ชม. ของการเล่น
export const PLAY_CREDIT_FIRST_MS = 30 * 60_000;  // บัญชีที่เพิ่งส่งครั้งแรก (เล่นมาก่อนล็อกอิน)
const PLAY_SLACK = 0.8;                            // เผื่อเครื่องช้า/เน็ตหน่วง (ต้องใช้เวลาอย่างน้อย 80% ของจังหวะที่เล่น)
const RATE = { max: 120, windowMs: 60 * 60_000 };
const NAME_COOLDOWN_MS = 7 * 86_400_000;           // เปลี่ยนชื่อบนกระดานได้ทุก 7 วัน (แบบ LumiFlip)
const thaiDay = now => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);

export function createWins({ db, seasons, rate = RATE, allowDev = false }) {
  // data = { proof, name, dev? } → { counted: true, pts: 1, name } | { counted: false, reason: 'already' | 'cap' | 'too-fast' }
  async function submit(auth, data, now = Date.now()) {
    const uid = auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in first');
    const proof = data?.proof;
    if (JSON.stringify(proof ?? null).length > 20_000) throw new HttpsError('invalid-argument', 'proof too large');
    await limitRate(db, `win-${uid}`, rate, 'too many wins');
    const res = replayProof(proof);
    if (!res.ok) throw new HttpsError('invalid-argument', `proof rejected: ${res.why}`);

    // dev ใช้ได้เฉพาะใน Functions emulator · ของจริงไม่รับ (กันข้อมูลทดสอบปน และกันใครส่ง dev มาหลบเพดาน)
    const dev = data?.dev === true;
    if (dev && process.env.FUNCTIONS_EMULATOR !== 'true' && !allowDev) throw new HttpsError('invalid-argument', 'dev submissions are emulator-only');
    const players = dev ? 'players-dev' : 'players';
    const pref = db.doc(`${players}/${uid}`);
    const wref = db.doc(`${players}/${uid}/won/${proofKey(proof)}`);
    const wantName = cleanName(data?.name);
    return db.runTransaction(async t => {
      const [p, w, gone] = await Promise.all([t.get(pref), t.get(wref), t.get(db.doc(`deleted/${uid}`))]);
      if (gone.exists) throw new HttpsError('permission-denied', 'account deleted');
      if (w.exists) return { counted: false, reason: 'already' };
      const d = p.data() ?? {};
      const day = thaiDay(now);
      const used = d.day?.d === day ? d.day.n : 0;
      if (used >= WIN_POINTS_PER_DAY) return { counted: false, reason: 'cap', day };
      // เวลาเล่นสะสม: ได้เพิ่มตามเวลาจริงที่ผ่านไป (สูงสุด 6 ชม.) ใช้ไปตามจังหวะที่หลักฐานเล่นจริง
      const last = typeof d.lastAt === 'number' ? d.lastAt : 0;
      const credit = last ? Math.min(PLAY_CREDIT_MAX_MS, (d.credit ?? 0) + Math.max(0, now - last)) : PLAY_CREDIT_FIRST_MS;
      const need = res.ticks * TICK_MS * PLAY_SLACK;
      if (credit < need) return { counted: false, reason: 'too-fast' };

      const old = cleanName(d.name);
      const canRename = !d.nameAt || now - d.nameAt >= NAME_COOLDOWN_MS;
      const name = (nameLength(wantName) >= 2 && (!old || wantName === old || canRename) ? wantName : old) || 'ผู้เล่น';
      const renamed = !!old && name !== old;
      t.set(pref, {
        name, day: { d: day, n: used + 1 }, credit: credit - need, lastAt: now,
        ...(renamed ? { nameAt: now } : {}),
      }, { merge: true });
      t.create(wref, { at: Timestamp.fromMillis(now), stars: res.stars });
      const g = hasGoogle(auth);
      seasons.writePoints(t, uid, name, 1, now, dev, g);
      return { counted: true, pts: 1, name, g };
    }).catch(e => {
      if (e?.code === ALREADY_EXISTS) return { counted: false, reason: 'already' };   // ส่งซ้อนกันสองครั้ง ครั้งแรกชนะไปแล้ว
      throw e;
    });
  }

  return { submit };
}
