// Cloud Functions ของ Wickling: ตรวจใบเสร็จ Google Play ก่อนให้ของที่ซื้อด้วยเงินจริง
// ยกจาก LumiFlip/functions/index.js (ตัดรางวัลกระดานออก) · แอปเรียกผ่าน callFunction() ใน src/platform/billing.ts
// ไม่มี scheduled function · ทำงานเฉพาะตอนผู้เล่นซื้อ/กู้คืน
// ⚠️ ยังไม่ได้ deploy: โปรเจกต์ wickling-rtliz ยังเป็นแผน Spark (ดูขั้นตอนใน README.md)
import { onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineBoolean } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createPurchases } from './purchases.js';
import { play } from './play.js';

// ต้องตรงกับ FUNCTIONS_REGION ใน src/platform/billing.ts
const REGION = 'asia-southeast1';
// maxInstances ต่ำ: ซื้อไม่ได้เกิดถี่ และกันบอทยิงจนบิลพุ่ง (มี rate/{uid} จำกัดต่อบัญชีอีกชั้น)
setGlobalOptions({ region: REGION, maxInstances: 3 });
initializeApp();

// App Check ยังไม่เปิด · เปิดเมื่อ Metrics ใน Console เห็น verified ส่วนใหญ่แล้ว (ดู README.md)
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false });

const purchases = createPurchases({ db: getFirestore(), play });
const callable = handler => onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, memory: '256MiB', timeoutSeconds: 30 },
  req => handler(req.auth, req.data),
);

export const verifyPurchase = callable(purchases.verify);
export const restorePurchase = callable(purchases.restore);
