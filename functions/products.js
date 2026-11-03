// ตารางสินค้าที่ server ใช้ตัดสินว่าใบเสร็จแต่ละแบบได้ของอะไร (client กำหนดจำนวนเองไม่ได้)
// ต้องตรงกับ src/platform/products.ts ฝั่งเกม (test/purchases.test.mjs ตรวจให้) · product id ใช้ร่วมทั้งสตูดิโอ ห้ามเปลี่ยนหลังสร้างใน Play Console
//
// once        = ซื้อครั้งเดียว (Google: non-consumable, acknowledge ไม่ consume) กู้คืนได้ด้วย restorePurchase
// perAccount  = จำกัด 1 ครั้งต่อบัญชีและต้องผูก Google (Wickling ยังไม่มีสินค้าแบบนี้ · ตรรกะใน purchases.js ยังรองรับ)
// entitlement = ชื่อช่องใน entitlements/{uid} ที่ตั้งเป็น true เมื่อซื้อ/กู้คืนสำเร็จ
// maxRestores = ใบเสร็จ 1 ใบกู้คืนได้กี่ครั้ง
// grant       = ของที่ได้: noAds (ลบโฆษณา + หัวใจ 8), unlimitedHours (หัวใจไม่จำกัด ชม.)
export const PRODUCTS = {
  remove_ads: {
    once: true, perAccount: false, entitlement: 'removeAds', maxRestores: 10,
    grant: { noAds: true },
  },
  unlimited_hearts_2h: {
    once: false, perAccount: false,
    grant: { unlimitedHours: 2 },
  },
};
