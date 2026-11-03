// สินค้าในร้าน (ฝั่งเกม): ใช้แสดงว่าแพ็กมีอะไร และให้ร้านจำลองตอน pnpm dev เท่านั้น
// ของที่ได้จริงในแอปตัดสินที่ server (functions/products.js) แล้วส่งกลับมาใน grant · ต้องตรงกันทุกตัว
// (functions/test/purchases.test.mjs ตรวจว่าเหมือนกัน) · product id ใช้ร่วมทั้งสตูดิโอ ห้ามเปลี่ยนหลังสร้างใน Play Console
//
// once = ซื้อครั้งเดียว (non-consumable) · grant: noAds (ลบโฆษณา + หัวใจ 8), unlimitedHours (หัวใจไม่จำกัด ชม.)
// ไฟล์นี้ต้องเป็น TS แบบลบชนิดได้ (ไม่มี enum/namespace) เพราะเทสต์ของ functions import ตรงด้วย Node ≥ 23.6
export const PRODUCTS = {
  remove_ads: {
    once: true, perAccount: false, entitlement: "removeAds", maxRestores: 10,
    grant: { noAds: true },
  },
  unlimited_hearts_2h: {
    once: false, perAccount: false,
    grant: { unlimitedHours: 2 },
  },
};

export type ProductId = keyof typeof PRODUCTS;
export interface Grant { noAds?: boolean; unlimitedHours?: number }

// ราคาสำรองตอนยังโหลดราคาจาก Play ไม่ได้ · ต้องตรงกับทุกเกม (สกิล game-monetization: ฿99 / ฿19)
export const FALLBACK_PRICES: Record<ProductId, string> = { remove_ads: "฿99", unlimited_hearts_2h: "฿19" };
