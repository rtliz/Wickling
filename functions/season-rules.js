// กติกากระดานรายสัปดาห์/รายเดือน (ยกจาก LumiFlip/src/season-rules.js ไม่แก้ตรรกะ)
// ⚠️ สำเนาเดียวกับ src/core/season-rules.ts (เกม) · แก้ที่หนึ่งต้องแก้อีกที่ · functions/test/seasons.test.mjs ตรวจว่าตรงกัน
// รอบตัดตามเวลาไทย: สัปดาห์เริ่มวันจันทร์ 00:00 · เดือนเริ่มวันที่ 1 00:00
const DAY = 86400e3;
const THAI = 7 * 3600e3;
const thai = (now) => new Date(now + THAI);

export const ALL_BOARD = 'all'; // กระดานถาวร ไม่รีเซ็ต ไม่มีรางวัล
export const BOARD_SIZE = 50;

export const weekId = (now = Date.now()) => {
  const d = thai(now);
  return `W${new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10)}`;
};
export const monthId = (now = Date.now()) => `M${thai(now).toISOString().slice(0, 7)}`;
export const prevWeekId = (now = Date.now()) => weekId(now - 7 * DAY);
export const prevMonthId = (now = Date.now()) => {
  const d = thai(now);
  return `M${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)}`;
};
export const weekEndsAt = (now = Date.now()) => Date.parse(`${weekId(now).slice(1)}T00:00:00Z`) - THAI + 7 * DAY;
export const monthEndsAt = (now = Date.now()) => {
  const d = thai(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - THAI;
};

// [ถึงอันดับ, หัวใจ] แยกตามตัวอักษรหน้ารหัสรอบ (W = สัปดาห์, M = เดือน)
export const REWARD_TIERS = {
  W: [[1, 10], [3, 6], [10, 3], [50, 1]],
  M: [[1, 50], [3, 30], [10, 15], [50, 5]],
};
export const rewardFor = (id, rank) => REWARD_TIERS[id[0]]?.find(([upto]) => rank <= upto)?.[1] ?? 0;
