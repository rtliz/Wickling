// กติกากระดานรายสัปดาห์/รายเดือน (ยกจาก LumiFlip/src/season-rules.js ไม่แก้ตรรกะ) · ไม่มี DOM
// ⚠️ สำเนาเดียวกับ functions/season-rules.js (server) · แก้ที่หนึ่งต้องแก้อีกที่ · รหัสรอบต้องตรงกับ seasonCap ใน firestore.rules
// รอบตัดตามเวลาไทย: สัปดาห์เริ่มวันจันทร์ 00:00 · เดือนเริ่มวันที่ 1 00:00
const DAY = 86400e3;
const THAI = 7 * 3600e3;
const thai = (now: number) => new Date(now + THAI);

export const ALL_BOARD = 'all'; // กระดานถาวร ไม่รีเซ็ต ไม่มีรางวัล
export const BOARD_SIZE = 50;

export const weekId = (now: number = Date.now()): string => {
  const d = thai(now);
  return `W${new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10)}`;
};
export const monthId = (now: number = Date.now()): string => `M${thai(now).toISOString().slice(0, 7)}`;
export const prevWeekId = (now: number = Date.now()): string => weekId(now - 7 * DAY);
export const prevMonthId = (now: number = Date.now()): string => {
  const d = thai(now);
  return `M${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)}`;
};
export const weekEndsAt = (now: number = Date.now()): number => Date.parse(`${weekId(now).slice(1)}T00:00:00Z`) - THAI + 7 * DAY;
export const monthEndsAt = (now: number = Date.now()): number => {
  const d = thai(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - THAI;
};

// [ถึงอันดับ, หัวใจ] แยกตามตัวอักษรหน้ารหัสรอบ (W = สัปดาห์, M = เดือน)
export const REWARD_TIERS: Record<string, [number, number][]> = {
  W: [[1, 10], [3, 6], [10, 3], [50, 1]],
  M: [[1, 50], [3, 30], [10, 15], [50, 5]],
};
export const rewardFor = (id: string, rank: number): number => REWARD_TIERS[id[0]]?.find(([upto]) => rank <= upto)?.[1] ?? 0;
