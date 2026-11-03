// ชื่อเล่นผู้เล่น (กติกาจาก LumiFlip: 2–16 ตัว) · ไม่มี DOM · ใช้ทั้งหน้าล็อกอิน (platform/account.ts) และ server (functions/game.js)
// ตัดตัวควบคุม/ตัวมองไม่เห็น (Cc, Cf เช่น zero-width, bidi override) + ตัวขึ้นบรรทัด U+2028/2029 + < > · ช่องว่างหลายตัวรวมเป็นตัวเดียว
// นับความยาวเป็น code point (อีโมจิ/อักษรนอก BMP ไม่ถูกตัดครึ่ง) · ทุกที่ที่แสดงชื่อยังต้องใช้ textContent เท่านั้น
export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const nameLength = (str: string) => Array.from(str).length;
export const cleanName = (str: unknown) =>
  Array.from((typeof str === "string" ? str : "").replace(/[\p{Cc}\p{Cf}\u2028\u2029<>]/gu, "").replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim();
