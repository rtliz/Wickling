// จำกัดคำขอต่อบัญชีต่อช่วงเวลา (เวลา server) ก่อนทำงานที่แพงหรือเดาสุ่มได้ (ถาม Google, ลองโค้ด)
// เก็บที่ rate/{key} (client อ่าน/เขียนไม่ได้ ด้วย default-deny) · 1 read + 1 write ต่อคำขอ
import { HttpsError } from 'firebase-functions/v2/https';

export async function limitRate(db, key, { max, windowMs }, message = 'too many requests') {
  const ref = db.collection('rate').doc(key);
  const ok = await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data();
    const t = Date.now();
    const fresh = !d || !(t - d.start < windowMs);
    const n = fresh ? 0 : d.n;
    if (n >= max) return false;
    tx.set(ref, { start: fresh ? t : d.start, n: n + 1 });
    return true;
  });
  if (!ok) throw new HttpsError('resource-exhausted', message);
}
