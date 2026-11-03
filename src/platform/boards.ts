// กระดานคะแนน: หน้าตา/รอบ/รางวัลแบบ LumiFlip (สัปดาห์ · เดือน · ทั้งหมด) แต่แต้มตัดสินที่ server แบบ meowchime
//   เกมส่ง "หลักฐานการชนะ" (src/core/proof.ts) ให้ Cloud Function submitWin → server เล่นซ้ำด้วย sim ตัวเดียวกัน → +1 แต้ม
//   boards/{all|W…|M…}/scores/{uid} { uid, name, pts, at, g } client อ่านได้อย่างเดียว · list ต้อง limit ≤ 50 (firestore.rules)
//   สัปดาห์/เดือน (มีรางวัล) แสดงเฉพาะแถวบัญชี Google (g) แบบเดียวกับที่ server ล็อกอันดับ · ทั้งหมด (ไม่มีรางวัล) แสดงทุกคน
//   นับอันดับนอก 50 คนแรกไม่ได้ (rules ไม่ให้ count) → แสดง "50+"
//   pnpm dev อ่านกระดานจริง (อ่านอย่างเดียว) · ส่งแต้มแบบ dev ได้เฉพาะ Functions emulator (ของจริงตอบ invalid-argument แล้วทิ้ง)
// กฎค่าใช้จ่าย (firebase-cost.md): Firestore lite (อ่านครั้งเดียว ไม่มี realtime) · ทุก query มี limit(BOARD_SIZE)
//   อ่านเฉพาะตอนเปิดหน้าอันดับ · เรียก submitWin เฉพาะตอนชนะห้อง/ชั้นใหม่ (ส่งค้างได้ ส่งห่างกันอย่างน้อย 30 วิ)
// ชื่อผู้เล่นคนอื่นเป็นข้อความจากผู้เล่น → main.ts ใส่ด้วย textContent เท่านั้น
import type { Firestore } from "firebase/firestore/lite";
import { firebaseApp } from "./firebase";
import { Account } from "./account";
import { callFunction } from "./cloud";
import { BOARD_SIZE } from "../core/season-rules";
import type { Proof } from "../core/proof";

type Lite = typeof import("firebase/firestore/lite");
let loaded: Promise<{ db: Firestore; m: Lite }> | null = null;
function load() {
  return (loaded ??= Promise.all([firebaseApp(), import("firebase/firestore/lite"), Account.ready()])
    .then(([app, m]) => ({ db: m.getFirestore(app), m }))
    .catch(err => { loaded = null; throw err; }));
}

const DEV = import.meta.env.DEV;
const scores = (board: string) => `boards/${board}/scores`;
export interface Row { uid: string; name: string; score: number }
export interface Claim { rewards: { id: string; rank: number; hearts: number }[]; hearts: number; needGoogle?: boolean }

// หลักฐานที่ยังส่งไม่ได้ (ไม่มีเน็ต/ยังไม่มีบัญชี) · ไม่ใช่ของมีค่า (server ตรวจเองทุกใบ) จึงเก็บนอกเซฟ
const QUEUE_KEY = "wickling.proofs";
const QUEUE_MAX = 60;   // หลักฐานละ ~1–2 KB · เก็บได้ราว 60 ห้อง/ชั้นที่ชนะตอนออฟไลน์
export const SUBMIT_GAP_MS = 30_000;   // ส่งห่างกันอย่างน้อย 30 วิ (แบบ SEASON_WRITE_GAP_MS ของ LumiFlip) · ชนะหลายห้องติดกันรวมส่งทีเดียว
// hold = วันไทยที่ server ตอบว่าเกินเพดานต่อวัน → เก็บไว้ส่งวันถัดไป (ไม่ทิ้งแต้มของคนเล่นจริง)
interface Queued { proof: Proof; hold?: string }
const thaiDay = (now = Date.now()) => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);

export const Boards = {
  queue(): Queued[] {
    try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
  },
  setQueue(q: Queued[]) {
    try { q.length ? localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))) : localStorage.removeItem(QUEUE_KEY); } catch { /* ไม่เป็นไร */ }
  },
  enqueue(proof: Proof) {
    const key = `${proof.kind}${proof.n}`;
    this.setQueue([...this.queue().filter(x => `${x.proof?.kind}${x.proof?.n}` !== key), { proof }]);
  },

  // ส่งที่ค้างทั้งหมด ทีละใบ · คืนจำนวนแต้มที่ได้ · ใบที่ server ปฏิเสธ (ปลอม/นับแล้ว/เกินเพดาน) ทิ้ง · เน็ตหลุดเก็บไว้ส่งใหม่
  sending: false,
  // ชื่อใส่ตอนส่ง (ชนะก่อนตั้งชื่อก็ยังเก็บไว้ได้) · ยังไม่มีชื่อ = ยังไม่ส่ง
  async flush(name: string | null): Promise<number> {
    if (this.sending || !Account.user || !name) return 0;
    this.sending = true;
    let got = 0;
    const today = thaiDay();
    try {
      for (const item of this.queue()) {
        if (item.hold && item.hold >= today) continue;
        let res: { counted?: boolean; reason?: string; day?: string } | null;
        try {
          res = await callFunction("submitWin", { proof: item.proof, name, dev: DEV }, () => Account.token()) as typeof res;
        } catch (err) {
          const status = (err as { status?: string })?.status;
          if (status === "INVALID_ARGUMENT") res = null;   // หลักฐานใช้ไม่ได้ ทิ้ง
          else break;                                        // เน็ต/server/เกินอัตรา: ส่งใหม่คราวหน้า
        }
        if (res?.reason === "too-fast") break;              // เวลาเล่นสะสมยังไม่พอ: รอแล้วส่งใหม่
        if (res?.reason === "cap") {                         // เกินเพดานวันนี้: เก็บทุกใบไว้ส่งวันถัดไป
          const day = res.day ?? today;
          this.setQueue(this.queue().map(x => ({ ...x, hold: day })));
          break;
        }
        if (res?.counted) got++;
        this.setQueue(this.queue().filter(x => x !== item && JSON.stringify(x.proof) !== JSON.stringify(item.proof)));
      }
    } finally { this.sending = false; }
    return got;
  },

  // [{ uid, name, score }] แต้มมากก่อน เท่ากันคนถึงก่อนอยู่สูงกว่า (ดัชนีใน firestore.indexes.json)
  async top(board: string, googleOnly: boolean): Promise<Row[]> {
    const { db, m } = await load();
    const q = googleOnly
      ? m.query(m.collection(db, scores(board)), m.where("g", "==", true), m.orderBy("pts", "desc"), m.orderBy("at"), m.limit(BOARD_SIZE))
      : m.query(m.collection(db, scores(board)), m.orderBy("pts", "desc"), m.orderBy("at"), m.limit(BOARD_SIZE));
    const snap = await m.getDocs(q);
    return snap.docs.map(s => ({ uid: s.id, name: String(s.data().name ?? ""), score: Number(s.data().pts) || 0 }));
  },

  // แถวของเรา { pts, g } (1 read)
  async mine(board: string): Promise<{ pts: number; g: boolean }> {
    const uid = Account.user?.uid;
    if (!uid) return { pts: 0, g: false };
    const { db, m } = await load();
    const d = (await m.getDoc(m.doc(db, scores(board), uid))).data();
    return { pts: Number(d?.pts) || 0, g: d?.g === true };
  },

  claim: () => callFunction("claimSeason", {}, () => Account.token()) as Promise<Claim | null>,
};
