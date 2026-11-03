// ลบบัญชีผู้เล่น (ยก cleanupUser จาก LumiFlip/functions/index.js) แยกจาก index.js เพื่อทดสอบกับ emulator ได้
// createAccounts({ db, auth }) → { cleanup(uid), deleteMe(authCtx) }
//
// ลบเมื่อบัญชี Firebase Auth ถูกลบ (ผู้เล่นกด "ลบบัญชีถาวร" ในแอป):
//   entitlements/{uid}  สิทธิ์ที่ผูกกับบัญชี
//   rate/{uid}          ตัวนับคำขอตรวจใบเสร็จ
//   rate/season-{uid}   ตัวนับคำขอรับรางวัลกระดาน · seasonClaims/{uid} รอบที่รับรางวัลแล้ว
//   players(-dev)/{uid} (+ won/*) สถานะกระดานฝั่ง server · boards(-dev)/*/scores/{uid} แถวกระดานทุกรอบรวมถาวร (collectionGroup scores where uid) · rate/win-{uid}
//   ผลที่ล็อกแล้ว seasons/{id} เก็บ sha256(uid) ระบุตัวไม่ได้ จึงไม่ลบ
// เขียน deleted/{uid} { at } ไว้ให้ submitWin / claimSeason ปฏิเสธ uid นี้ (ไม่มีข้อมูลส่วนตัว)
// เก็บไว้: purchases/{sha256(token)} เป็นหลักฐานการซื้อ/กันใบเสร็จซ้ำ (anti-hack.md ข้อ 2) อ้างได้แค่ uid ที่ถูกลบแล้ว
// ไม่มีชื่อ/อีเมลของผู้เล่น · Play ยอมให้เก็บข้อมูลที่จำเป็นด้านความปลอดภัย/การเงินหลังลบบัญชี
import { HttpsError } from 'firebase-functions/v2/https';
import { ALL_BOARD, weekId, monthId, prevWeekId, prevMonthId } from './season-rules.js';

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function createAccounts({ db, auth }) {
  async function cleanup(uid) {
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return;
    const writer = db.bulkWriter();
    writer.delete(db.doc(`entitlements/${uid}`));
    writer.delete(db.doc(`rate/${uid}`));
    writer.delete(db.doc(`rate/season-${uid}`));
    writer.delete(db.doc(`seasonClaims/${uid}`));
    writer.delete(db.doc(`rate/win-${uid}`));
    // ป้ายบัญชีที่ลบแล้ว: submitWin / claimSeason ปฏิเสธ uid นี้ (กันคำขอที่ค้างอยู่เขียนแถวกลับมา)
    writer.set(db.doc(`deleted/${uid}`), { at: new Date() });
    // แถวกระดานที่รู้ที่อยู่: ลบตรงก่อน (ใช้ได้แม้ดัชนี collectionGroup ยังสร้างไม่เสร็จ)
    const now = Date.now();
    for (const c of ['boards', 'boards-dev']) {
      for (const id of new Set([ALL_BOARD, weekId(now), prevWeekId(now), monthId(now), prevMonthId(now)])) writer.delete(db.doc(`${c}/${id}/scores/${uid}`));
    }
    await writer.flush();
    // รอบเก่ากว่านั้น: collectionGroup scores where uid (ดัชนี uid ใน firestore.indexes.json) · ดัชนีไม่พร้อม = ข้ามไป ลบของที่รู้แล้ว
    try {
      (await db.collectionGroup('scores').where('uid', '==', uid).get()).forEach(d => writer.delete(d.ref));
    } catch (e) { console.error('[cleanup] scores collectionGroup', e?.message); }
    await writer.close();
    // สถานะกระดานฝั่ง server + ห้อง/ชั้นที่นับแต้มแล้ว (subcollection won)
    for (const c of ['players', 'players-dev']) await db.recursiveDelete(db.doc(`${c}/${uid}`));
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
