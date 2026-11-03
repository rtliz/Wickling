// ลบบัญชีผู้เล่น (ยก cleanupUser จาก LumiFlip/functions/index.js) แยกจาก index.js เพื่อทดสอบกับ emulator ได้
// createAccounts({ db, auth }) → { cleanup(uid), deleteMe(authCtx) }
//
// ลบเมื่อบัญชี Firebase Auth ถูกลบ (ผู้เล่นกด "ลบบัญชีถาวร" ในแอป):
//   entitlements/{uid}  สิทธิ์ที่ผูกกับบัญชี
//   rate/{uid}          ตัวนับคำขอตรวจใบเสร็จ
// เก็บไว้: purchases/{sha256(token)} เป็นหลักฐานการซื้อ/กันใบเสร็จซ้ำ (anti-hack.md ข้อ 2) อ้างได้แค่ uid ที่ถูกลบแล้ว
// ไม่มีชื่อ/อีเมลของผู้เล่น · Play ยอมให้เก็บข้อมูลที่จำเป็นด้านความปลอดภัย/การเงินหลังลบบัญชี
import { HttpsError } from 'firebase-functions/v2/https';

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function createAccounts({ db, auth }) {
  async function cleanup(uid) {
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return;
    const writer = db.bulkWriter();
    writer.delete(db.doc(`entitlements/${uid}`));
    writer.delete(db.doc(`rate/${uid}`));
    await writer.close();
  }

  // ลบบัญชีที่ server: ใช้เมื่อแอปลบเองไม่ได้ (บัญชีผู้เยี่ยมชมเข้าสู่ระบบนานเกิน Firebase ให้ลบจาก client และยืนยันตัวตนใหม่ไม่ได้)
  // ผู้เรียกลบได้เฉพาะบัญชีตัวเอง (uid จาก ID token) · ลบแล้ว cleanupUser ทำงานต่อเอง + ลบตรงนี้อีกชั้น (ลบซ้ำไม่เป็นไร)
  async function deleteMe(authCtx) {
    const uid = authCtx?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in first');
    try {
      await auth.deleteUser(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw new HttpsError('internal', 'delete failed');
    }
    await cleanup(uid);
    return { ok: true };
  }

  return { cleanup, deleteMe };
}
