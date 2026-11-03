// หัวใจ (ยกกติกาจาก LumiFlip/src/main.js แล้วปรับให้เข้ากับห้องของ Wickling) · ไม่มี DOM ใช้ได้ทั้งเกมและ scripts/check.ts
//
// กติกา:
// - วันละ 5 ดวง (ซื้อลบโฆษณาแล้ว 8) เติมตอนเที่ยงคืนตามนาฬิกาเครื่อง · มีเกินอยู่แล้วไม่ตัดทิ้ง
// - เสีย 1 ดวงตอน "เริ่มเล่น" ห้อง/ชั้นหอคอยที่ยังไม่เคยผ่าน (แตะเดินครั้งแรกของความพยายามนั้น)
//   ความพยายามจบเมื่อเงาถูกล้างทั้งหมด (กด "เริ่มห้องใหม่", ใช้เงาครบแล้วยังไม่ผ่าน, ย้ายห้อง) หรือผ่านห้อง
//   รอบ/เงาภายในห้องไม่เสียหัวใจ (เป็นกลไกหลักของเกม) · ลบเงาล่าสุดไม่เสีย
// - ไม่เสีย: ห้องที่เคยผ่านแล้ว, ห้อง 1–2 (FREE_ROOMS), ช่วงหัวใจไม่จำกัด
// - ⚠️ ใช้นาฬิกาเครื่องแบบเดียวกับ LumiFlip (เกมนี้ออฟไลน์ ไม่มีเวลา server) · กันย้อนนาฬิกาด้วย unlimitedFrom
//   และเติมเฉพาะเมื่อวันเดินหน้า · ช่องโหว่บันทึกไว้ใน ../.claude/skills/game-security/SKILL.md
import { LEVELS } from "./levels";

export const HEARTS = {
  perDay: 5,
  perDayNoAds: 8,
  max: 8,                    // เพดานที่ validate() ยอม (= ลบโฆษณา 8) · โฆษณาให้หัวใจได้เฉพาะตอนหมด จึงไม่เกินนี้
  adPerDay: 3,               // ดูโฆษณา +1 ได้วันละกี่ครั้ง
  freeRooms: 2,              // ห้อง 1–2 ไม่ใช้หัวใจ (แบบ GUIDED_LEVELS ของ LumiFlip)
  unlimitedMs: 2 * 60 * 60_000,
  unlimitedMaxSpanMs: 48 * 60 * 60_000, // ซื้อซ้อนกันได้ แต่ช่วงรวมเกินนี้ถือว่าเซฟผิดปกติ
  offerEvery: 10,            // เสนอหัวใจไม่จำกัดทุก ๆ กี่ห้อง/ชั้นที่ผ่านครั้งแรก (แทนโฆษณาคั่นรอบนั้น)
  interstitialEvery: 3,      // โฆษณาคั่นทุก ๆ กี่ห้องที่ผ่าน
  adsAfterCleared: 5,        // แบนเนอร์/โฆษณาคั่นเริ่มหลังผ่านห้องพื้นฐาน 1–5 ครบ
  txKeep: 20,                // จำ purchaseId ล่าสุดกี่ใบ กันให้ของซ้ำ
} as const;

export interface HeartState {
  n: number;                 // หัวใจที่มี
  day: string;               // วันที่เติมล่าสุด (YYYY-MM-DD เวลาเครื่อง)
  ad: number;                // ดูโฆษณาได้หัวใจไปแล้วกี่ครั้งวันนี้
  from: number;              // หัวใจไม่จำกัด: เวลาเริ่ม (ms) · ย้อนนาฬิกาไปก่อนนี้ = หมดสิทธิ์
  until: number;             // หัวใจไม่จำกัด: หมดเวลา (ms)
  noAds: boolean;            // ซื้อลบโฆษณาแล้ว (ได้จาก server หลังตรวจใบเสร็จเท่านั้น)
  tx: string[];              // purchaseId ที่ให้ของไปแล้ว
  attempt: string | null;    // ห้องที่จ่ายหัวใจแล้วและยังเล่นอยู่ ("r4" = ห้อง 5, "t12" = หอคอยชั้น 12)
}

export const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
export const freshHearts = (now = Date.now()): HeartState =>
  ({ n: HEARTS.perDay, day: dayKey(new Date(now)), ad: 0, from: 0, until: 0, noAds: false, tx: [], attempt: null });

export const dailyHearts = (h: HeartState) => (h.noAds ? HEARTS.perDayNoAds : HEARTS.perDay);
// ต้องอยู่ระหว่างเวลาที่ซื้อกับหมดอายุ (ย้อนนาฬิกาเครื่องไปก่อนเวลาซื้อ = หมดสิทธิ์ ไม่ได้ยืดเวลา)
export const unlimited = (h: HeartState, now = Date.now()) => now >= h.from && now < h.until;

// เติมหัวใจเมื่อขึ้นวันใหม่ · เติมเฉพาะเมื่อวันเดินหน้า (ย้อนนาฬิกาไม่ได้หัวใจ) · คืน true ถ้าเติม
export function refreshDay(h: HeartState, now = Date.now()) {
  const d = dayKey(new Date(now));
  if (d <= h.day) return false;
  h.day = d;
  h.n = Math.max(h.n, dailyHearts(h));
  h.ad = 0;
  return true;
}

// เริ่มนับหัวใจไม่จำกัด หรือต่อเวลาถ้ายังไม่หมด
export function addUnlimited(h: HeartState, ms: number, now = Date.now()) {
  const active = unlimited(h, now);
  if (!active) h.from = now;
  h.until = (active ? h.until : now) + ms;
}

// key ของห้อง: levelIdx >= 0 = ห้องที่ออกแบบเอง, -1 = หอคอยชั้นปัจจุบัน
export const attemptKey = (levelIdx: number, floor: number) => (levelIdx < 0 ? `t${floor}` : `r${levelIdx}`);

export interface Progress { best: Record<string, number>; tower: { floor: number; best: number } }
export const roomCleared = (p: Progress, levelIdx: number) =>
  levelIdx < 0 ? p.tower.floor <= p.tower.best : (p.best[levelIdx] ?? 0) > 0;
export const roomIsFree = (p: Progress, levelIdx: number) =>
  roomCleared(p, levelIdx) || (levelIdx >= 0 && levelIdx < HEARTS.freeRooms);
// ห้อง/ชั้นที่ผ่านครั้งแรกแล้วทั้งหมด (ใช้นับจังหวะโฆษณาคั่น/เสนอแพ็ก) · ได้จากดาวในเซฟ ไม่ต้องเก็บแยก
export const clearedCount = (p: Progress) =>
  Object.keys(p.best).filter(k => Number(k) < LEVELS.length).length + p.tower.best;

/**
 * เรียกตอนผู้เล่นจะเริ่มเดิน (แตะครั้งแรกของรอบ) · คืน
 *   "ok"    = เล่นได้ ไม่เสียหัวใจ (ห้องฟรี / จ่ายไปแล้วในความพยายามนี้ / ไม่จำกัด)
 *   "paid"  = หักหัวใจ 1 ดวงแล้ว (ต้องเซฟ)
 *   "empty" = หัวใจหมด เล่นไม่ได้
 */
export function payToPlay(h: HeartState, p: Progress, levelIdx: number, now = Date.now()): "ok" | "paid" | "empty" {
  const key = attemptKey(levelIdx, p.tower.floor);
  if (h.attempt === key || roomIsFree(p, levelIdx) || unlimited(h, now)) { h.attempt = key; return "ok"; }
  if (h.n <= 0) return "empty";
  h.n--;
  h.attempt = key;
  return "paid";
}
