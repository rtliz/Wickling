# Cloud Functions ของ Wickling: ตรวจใบเสร็จ Google Play

ยกจาก `LumiFlip/functions/` (ตรรกะใน `purchases.js` ไม่ได้แก้) · ทุกการซื้อในแอป Android ต้องผ่าน `verifyPurchase` ก่อนเกมให้ของ: server ถาม Google ว่าจ่ายจริงไหม กันใบเสร็จซ้ำ ผูกใบเสร็จกับบัญชี แล้วส่งรายการของกลับไป (ตารางของอยู่ที่ server)

> **สถานะ: deploy แล้ว (2026-11-03)** · Blaze + budget alert ✅ · Firestore `(default)` asia-southeast1 + rules deny-all ✅ · Anonymous Auth ✅ · androidpublisher API ✅ · ยังเหลือข้อ 4 (สินค้าใน Play Console) และ 6 (สิทธิ์ service account) แล้วค่อยตั้ง `IAP_SERVER_READY = true` (`src/platform/billing.ts`)

| ไฟล์ | คืออะไร |
|---|---|
| `index.js` | `verifyPurchase` และ `restorePurchase` (region `asia-southeast1`, `maxInstances: 3`, App Check ปิดไว้ก่อน) |
| `purchases.js` | ตรรกะตรวจใบเสร็จ (เหมือน LumiFlip ทุกบรรทัด) |
| `account.js` | ลบบัญชี: `deleteAccount` + `cleanupUser` ลบ `entitlements/{uid}`, `rate/*`, `seasonClaims/{uid}`, `players(-dev)/{uid}` (+`won`), แถวกระดานทุกรอบ (`scores` where uid) · deploy แล้ว 2026-11-03 (ส่วนกระดานยังไม่ deploy) |
| `wins.js` | **`submitWin`** แต้มกระดาน: รับหลักฐานการชนะ → เล่นซ้ำด้วย `game.js` → +1 ให้กระดาน `all` / สัปดาห์ / เดือน · ห้อง/ชั้นละ 1 แต้มต่อบัญชี (`players/{uid}/won/{key}`) · เพดาน 60 แต้ม/วัน (เวลาไทย) · เวลาเล่นสะสม (แต้มมาเร็วกว่าเวลาเล่นจริงไม่ได้) · 120 คำขอ/ชม. · **ยังไม่ได้ deploy** |
| `seasons.js` | `claimSeason` รางวัลหัวใจรอบล่าสุดที่จบ (ยก LumiFlip: Google เท่านั้น ครั้งเดียวต่อรอบ ล็อก 50 อันดับเป็น hash) + `writePoints` · **ยังไม่ได้ deploy** |
| `season-rules.js` | รหัสรอบ (เวลาไทย) + ตารางรางวัล · สำเนาของ `../src/core/season-rules.ts` (เทสต์ตรวจว่าตรงกัน) |
| `game.js` | **ไฟล์สร้าง (ไม่อยู่ใน git)**: `npm run sync` รวม `../src/core/proof.ts` + `sim.ts` + `levels.ts` + `tower.ts` ด้วย rolldown · รันเองก่อน `npm test` และใน predeploy (`firebase.json`) จึงเป็นกติกาเดียวกับเกมเสมอ |
| `products.js` | ตารางสินค้า → ของที่ได้ **ต้องตรงกับ `../src/platform/products.ts`** (เทสต์ตรวจให้) |
| `play.js` | คุยกับ Google Play Developer API (`com.wickling.puzzle`) ด้วย service account ของ Functions (ไม่มีไฟล์ key) |
| `test/` | เทสต์กับ Firestore emulator + Google ปลอม |

## สินค้า (product id ใช้ร่วมทุกเกมของสตูดิโอ)

| product id | ชนิดใน Play Console | ราคา | ได้ |
|---|---|---|---|
| `remove_ads` | ซื้อครั้งเดียว | ฿35 | ลบโฆษณาคั่น/แบนเนอร์ + หัวใจวันละ 8 |
| `unlimited_hearts_2h` | ใช้แล้วหมด (ซื้อซ้ำได้) | ฿19 | หัวใจไม่จำกัด 2 ชม. |

กติกาส่งของซ้ำ/กู้คืน/จำกัดคำขอ เหมือน `LumiFlip/functions/README.md` · Firestore ที่ใช้: `purchases/{sha256(token)}`, `entitlements/{uid}`, `rate/{uid}` เขียนด้วย Admin SDK เท่านั้น (`firestore.rules` default-deny ไม่ต้องแก้)

บัญชีผู้เล่น: หน้าล็อกอินให้เลือกผู้เยี่ยมชม (Anonymous) หรือ Google (`src/platform/account.ts`) · ใบเสร็จผูกกับ uid นั้น · ลงแอปใหม่แบบผู้เยี่ยมชมได้ uid ใหม่ → กู้คืนลบโฆษณาผ่าน `restorePurchase` ได้ (uid อื่นรวมไม่เกิน 3 บัญชีต่อใบ)

ลบบัญชี (Play บังคับ): แอปลบบัญชี Firebase เอง → `cleanupUser` ลบ `entitlements/{uid}` + `rate/{uid}` · เก็บ `purchases/*` ไว้เป็นหลักฐานการซื้อและกันใบเสร็จซ้ำ (มีแค่ uid ที่ถูกลบแล้ว ไม่มีชื่อ/อีเมล) · บัญชีผู้เยี่ยมชมที่เข้าสู่ระบบนานจนลบจาก client ไม่ได้ แอปเรียก `deleteAccount` ให้ server ลบแทน
Deploy (ให้ Claude ทำได้หลังเทสต์ผ่าน): `firebase deploy --only functions --project wickling-rtliz` (ครั้งแรกของ Auth trigger อาจต้องเปิด API ตามที่ CLI ถาม)

## กระดานคะแนน (ยังไม่ได้ deploy · ต้องได้รับอนุมัติจากเจ้าของเกม)

ต้อง deploy 3 อย่างพร้อมกันก่อนปล่อยแอปที่มีหน้าอันดับ: `firebase deploy --only firestore:rules,firestore:indexes,functions --project wickling-rtliz`
(rules: client อ่านกระดานได้อย่างเดียว · indexes: `scores` เรียง pts desc, at asc + uid สำหรับ cleanup)

## ทดสอบ (ไม่ต่อ Google จริง)

ต้องมี Java (`brew install openjdk@21`) และ Node ≥ 23.6 (เทสต์ import `src/platform/products.ts` ตรง ๆ):

```bash
cd functions && npm install
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH
mkdir -p /tmp/wk-fn && cd /tmp/wk-fn && echo '{"emulators":{"firestore":{"port":8182}}}' > firebase.json
firebase emulators:exec --only firestore --project demo-wickling 'cd "<โฟลเดอร์เกม>/Wickling/functions" && npm test'
```

ไฟล์เทสต์รันทีละไฟล์ (`--test-concurrency=1`) เพราะใช้ emulator ตัวเดียวกันและ `purchases.test.mjs` ล้างคอลเลกชันตอนเริ่ม

## ขั้นตอนที่เจ้าของเกมต้องทำเอง ก่อนเปิดร้านจริง (ทีละขั้น)

1. **อัป Blaze:** https://console.firebase.google.com → โปรเจกต์ **wickling-rtliz** → Upgrade → Blaze
2. **ตั้งงบเตือนทันที:** https://console.cloud.google.com/billing → Budgets & alerts → Create budget → ชื่อ `wickling`, โปรเจกต์ `wickling-rtliz`, 100 บาท, เตือน 50% / 100%
3. **เปิด Anonymous sign-in:** Firebase Console → Authentication → Sign-in method → Anonymous → Enable
4. **สร้างสินค้าใน Play Console:** แอป Wickling → Monetize with Play → Products → One-time products → สร้าง `remove_ads` (35 บาท) และ `unlimited_hearts_2h` (19 บาท) พิมพ์ id ให้ตรง (เปลี่ยนไม่ได้หลังสร้าง) → Activate · อย่าเปิด multi-quantity
5. **เปิด API:** https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com?project=wickling-rtliz → Enable
6. **ให้สิทธิ์ service account:** หาอีเมล Default compute service account (`812461468465-compute@developer.gserviceaccount.com`) ที่ IAM → Play Console → Users and permissions → Invite → App permissions เลือก Wickling → ติ๊ก View financial data และ Manage orders → Invite (มีผลภายในไม่กี่ชั่วโมงถึง 24 ชม.)
7. **Deploy (ให้ Claude ทำได้หลังข้อ 1–6):** `firebase deploy --only functions --project wickling-rtliz`
8. **เปิดร้านในแอป:** แก้ `IAP_SERVER_READY = true` ใน `src/platform/billing.ts` → `pnpm check` → build Android ใหม่
9. **ทดสอบด้วย License tester:** ซื้อแต่ละตัว / ปิดแอปทันทีหลังซื้อ (เปิดใหม่ต้องได้ของครั้งเดียว) / ลบแอปแล้วลงใหม่ + กดกู้คืน / คืนเงินแล้วกดกู้คืน → ลบโฆษณาถูกถอน

## ข้อจำกัดที่รู้อยู่

- หัวใจ/ลบโฆษณา/เวลาไม่จำกัดเก็บในเซฟในเครื่อง (ลงลายเซ็นแต่ key อยู่ใน bundle) และนับเวลาด้วยนาฬิกาเครื่อง (มีตัวกันย้อนนาฬิกาแบบ LumiFlip) · server กันได้ว่า "ไม่มีของจากการซื้อปลอม" และ "ใบเสร็จหนึ่งใบไม่ถูกใช้หลายบัญชี"
- คืนเงินหลังได้ของ: ถอนสิทธิ์ได้เมื่อแอปเห็นว่า Google ไม่ส่งใบเสร็จลบโฆษณามาแล้ว หรือมีคำขอ verify/restore แล้ว Google ตอบยกเลิก
