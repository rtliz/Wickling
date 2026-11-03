// บัญชีผู้เล่น (ยกจาก LumiFlip/src/platform.js `Account`) · Firebase Auth แบบ JS SDK ตัวเดียวทั้งเว็บและแอป
//   guest = Anonymous Auth · Google: แอปใช้ @capacitor-firebase/authentication (skipNativeAuth) ขอ credential แบบเนทีฟ
//   แล้ว signInWithCredential / linkWithCredential เข้า JS SDK · เว็บใช้ popup
//   ผูก guest → Google ด้วย link (uid เดิม ใบเสร็จที่ผูกกับ uid ยังเป็นของบัญชีนี้)
// ความคืบหน้าในเกมอยู่ในเซฟบนเครื่อง (core/save.ts) ไม่ได้อยู่กับบัญชี · ออกจากระบบ/ลบบัญชีไม่แตะเซฟ
// โหลด firebase/auth แบบ lazy (หน้าแรกไม่ต้องรอ) · ไม่มีการอ่าน/เขียน Firestore จาก client
import type { Auth, AuthCredential, User } from "firebase/auth";
import { firebaseApp } from "./firebase";
import { isNative } from "./ads";
import { callFunction } from "./cloud";

export interface Player { uid: string; google: boolean; name: string | null; email: string | null; photo: string | null }
// "เคยผ่านหน้าล็อกอินบนเครื่องนี้" ไม่ใช่ของมีค่า (แก้เองได้แค่ข้ามหน้าล็อกอิน) จึงเก็บนอกเซฟ ไม่ต้องขึ้น SAVE_VERSION
// offline = กดเล่นแบบผู้เยี่ยมชมตอนไม่มีเน็ต → สร้างบัญชีให้ทีหลังเมื่อต่อเน็ตได้ (ensure)
type Hint = "guest" | "google" | "offline";
const HINT_KEY = "wickling.login";

// ชื่อเล่นผู้เล่น (กติกาใน core/name.ts ตัวเดียวกับ server) · ตั้งที่หน้าล็อกอิน แก้ได้ในหน้าบัญชี
// เก็บใน localStorage แยกจากเซฟ (ไม่ใช่ของมีค่า → ไม่ต้องขึ้น SAVE_VERSION) · ไม่ตั้งเป็น displayName ของ Firebase Auth (LumiFlip ก็ไม่ตั้ง)
// ชื่อบนกระดานอันดับ server ทำความสะอาดซ้ำด้วยกติกาเดียวกัน · ทุกที่ที่แสดงชื่อต้องใช้ textContent เท่านั้น
import { NAME_MIN, cleanName, nameLength } from "../core/name";
export { NAME_MIN, NAME_MAX, cleanName, nameLength } from "../core/name";
const NAME_KEY = "wickling.name";

type AuthMod = typeof import("firebase/auth");
let loaded: Promise<{ auth: Auth; m: AuthMod }> | null = null;
function load() {
  return (loaded ??= Promise.all([firebaseApp(), import("firebase/auth")]).then(([app, m]) => ({
    // แอป: ไม่ใช้ popup/redirect resolver (iframe ของ authDomain ช้าและไม่จำเป็นใน WebView)
    auth: isNative ? m.initializeAuth(app, { persistence: m.indexedDBLocalPersistence }) : m.getAuth(app),
    m,
  })).catch(err => { loaded = null; throw err; }));
}

const toPlayer = (u: User | null): Player | null => u && {
  uid: u.uid, google: !u.isAnonymous, name: u.displayName, email: u.email, photo: u.photoURL,
};

// Google แบบเนทีฟ: ได้แค่ credential (skipNativeAuth) แล้วให้ JS SDK เป็นคนเข้าสู่ระบบ
async function nativeGoogle(m: AuthMod): Promise<AuthCredential> {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const { credential } = await FirebaseAuthentication.signInWithGoogle();
  if (!credential?.idToken) throw Object.assign(new Error("no credential"), { code: "auth/cancelled" });
  return m.GoogleAuthProvider.credential(credential.idToken, credential.accessToken);
}
async function nativeSignOut() {
  if (!isNative) return;
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  await FirebaseAuthentication.signOut().catch(() => {});   // ล้างบัญชี Google ที่เลือกไว้ ครั้งหน้าเลือกใหม่ได้
}

const isNetwork = (err: unknown) => (err as { code?: string })?.code === "auth/network-request-failed";

export const Account = {
  user: null as Player | null,
  onChange: (() => {}) as () => void,

  hint(): Hint | null {
    try { return localStorage.getItem(HINT_KEY) as Hint | null; } catch { return null; }
  },
  setHint(h: Hint | null) {
    try { h ? localStorage.setItem(HINT_KEY, h) : localStorage.removeItem(HINT_KEY); } catch { /* ไม่เป็นไร */ }
  },
  // ชื่อเล่นที่ตั้งไว้ (null = ยังไม่ได้ตั้ง → หน้าล็อกอินขอชื่อก่อนเล่น)
  name(): string | null {
    let n = "";
    try { n = cleanName(localStorage.getItem(NAME_KEY)); } catch { /* ไม่เป็นไร */ }
    return nameLength(n) >= NAME_MIN ? n : null;
  },
  setName(n: string | null) {
    try { n ? localStorage.setItem(NAME_KEY, cleanName(n)) : localStorage.removeItem(NAME_KEY); } catch { /* ไม่เป็นไร */ }
  },
  // ยังไม่เคยผ่านหน้าล็อกอิน → ต้องเลือก guest / Google ก่อนเล่น
  needsGate() { return !this.hint(); },

  preload() { load().catch(() => {}); },
  // Firebase Auth พร้อมแล้ว (Firestore ใน boards.ts ต้องใช้ token ของบัญชีนี้)
  ready(): Promise<void> { return load().then(() => {}); },

  // อ่านบัญชีที่ค้างไว้ในเครื่อง (ไม่ใช้เน็ต) · คืน false ถ้าเคยผ่านหน้าล็อกอินแต่บัญชีหายไป (เช่น ล้างข้อมูลเว็บ) → ต้องเข้าใหม่
  async init(): Promise<boolean> {
    const { auth } = await load();
    await auth.authStateReady();
    this.user = toPlayer(auth.currentUser);
    auth.onAuthStateChanged(u => { this.user = toPlayer(u); this.onChange(); });
    const h = this.hint();
    if (h && h !== "offline" && !this.user) { this.setHint(null); return false; }
    if (h === "offline") this.ensure().catch(() => {});
    return true;
  },

  // คืน "ok" | "offline" (guest ตอนไม่มีเน็ต: ให้เล่นได้เลย แล้วสร้างบัญชีทีหลัง)
  async signIn(kind: "guest" | "google"): Promise<"ok" | "offline"> {
    if (kind === "guest") {
      try {
        const { auth, m } = await load();
        this.user = toPlayer((auth.currentUser ?? (await m.signInAnonymously(auth)).user));
      } catch (err) {
        // โหลด SDK ไม่ได้ (ไม่มีเน็ตตั้งแต่เปิดแอป) หรือ Auth ตอบว่าไม่มีเน็ต
        if (!navigator.onLine || isNetwork(err) || !loaded) { this.setHint("offline"); return "offline"; }
        throw err;
      }
      this.setHint("guest");
      return "ok";
    }
    const { auth, m } = await load();
    const u = isNative
      ? (await m.signInWithCredential(auth, await nativeGoogle(m))).user
      : (await m.signInWithPopup(auth, new m.GoogleAuthProvider())).user;
    this.user = toPlayer(u);
    this.setHint("google");
    return "ok";
  },

  // guest ที่เข้าตอนออฟไลน์: สร้างบัญชีเมื่อมีเน็ต (เรียกตอนกลับเข้าแอป / ก่อนซื้อ) · คืน true ถ้ามีบัญชีแล้ว
  async ensure(): Promise<boolean> {
    if (this.user) return true;
    if (this.hint() !== "offline") return false;
    try {
      const { auth, m } = await load();
      this.user = toPlayer(auth.currentUser ?? (await m.signInAnonymously(auth)).user);
      this.setHint("guest");
      this.onChange();
      return true;
    } catch { return false; }
  },

  // guest → Google โดยคง uid เดิม · บัญชี Google ที่เคยใช้กับเกมนี้แล้ว → throw code auth/credential-already-in-use
  async linkGoogle() {
    const { auth, m } = await load();
    const cur = auth.currentUser;
    if (!cur) throw new Error("not signed in");
    const u = isNative
      ? (await m.linkWithCredential(cur, await nativeGoogle(m))).user
      : (await m.linkWithPopup(cur, new m.GoogleAuthProvider())).user;
    await u.reload().catch(() => {});
    this.user = toPlayer(auth.currentUser ?? u);
    this.setHint("google");
    this.onChange();
  },

  async signOut() {
    const { auth, m } = await load();
    await m.signOut(auth);
    await nativeSignOut();
    this.user = null;
    this.setHint(null);
  },

  // ลบบัญชีถาวร (Play บังคับให้แอปที่สร้างบัญชีต้องมี) · server ลบข้อมูลของ uid นี้ตาม (functions: cleanupUser)
  // Google: ยืนยันตัวตนใหม่ก่อน ถ้าเลือกบัญชี Google อื่น Firebase ตอบ auth/user-mismatch → ไม่ลบอะไร
  // guest ยืนยันตัวตนใหม่ไม่ได้ → ถ้า Firebase ตอบว่าเข้าสู่ระบบนานเกินไป ให้ server ลบให้ (functions: deleteAccount)
  async deleteAccount() {
    const { auth, m } = await load();
    const u = auth.currentUser;
    if (!u) { if (this.hint() === "offline") await this.signOut(); return; }
    if (!u.isAnonymous) {
      if (isNative) await m.reauthenticateWithCredential(u, await nativeGoogle(m));
      else await m.reauthenticateWithPopup(u, new m.GoogleAuthProvider());
    }
    try {
      await m.deleteUser(u);
    } catch (err) {
      if ((err as { code?: string })?.code !== "auth/requires-recent-login") throw err;
      const res = await callFunction("deleteAccount", {}, () => u.getIdToken());
      if (!res?.ok) throw new Error("delete failed");
    }
    await this.signOut().catch(() => { this.user = null; this.setHint(null); });
  },

  // ID token สำหรับ Cloud Functions (ใบเสร็จผูกกับ uid นี้)
  async token(): Promise<string | null> {
    if (!this.user && !(await this.ensure())) return null;
    const { auth } = await load();
    return (await auth.currentUser?.getIdToken()) ?? null;
  },
};
