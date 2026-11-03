// การซื้อในแอป (ยกจาก LumiFlip/src/platform.js `Billing` แล้วแปลงเป็น TS · ตัดแพ็กที่ต้องผูก Google ออก)
// ทุกใบเสร็จต้องผ่าน Cloud Function verifyPurchase (ถาม Google ที่ server) ก่อนให้ของ · ของที่ได้มาจากตารางที่ server
// ขั้นตอน: ซื้อ → approved → callFunction('verifyPurchase') → handlers.onGrant(...) (เกมให้ของ + เซฟ) → t.finish()
// ล้มเหลวกลางทาง (เน็ตหลุด, แอปปิด) = ไม่ finish ใบเสร็จยังค้างที่ Google → เปิดแอปครั้งหน้า/retryPending() ส่งของต่อ
// server ส่งใบเสร็จเดิมซ้ำด้วย purchaseId เดิม → ฝั่งเกมกันให้ของซ้ำด้วย purchaseId (hearts.tx)
//
// ⚠️ IAP_SERVER_READY = false: Functions ยังไม่ได้ deploy (โปรเจกต์ยังเป็น Spark) → ซ่อนปุ่มซื้อทั้งหมดใน build จริง
//    เปิดเป็น true ได้ก็ต่อเมื่อทำครบตาม functions/README.md (Blaze, budget, deploy, สิทธิ์ Play, เปิด Anonymous Auth)
import { isNative } from "./ads";
import { firebaseApp } from "./firebase";
import { PRODUCTS, FALLBACK_PRICES, type ProductId, type Grant } from "./products";

export const IAP_SERVER_READY = false;
const FUNCTIONS_REGION = "asia-southeast1";     // ต้องตรงกับ REGION ใน functions/index.js
const FIREBASE_PROJECT = "wickling-rtliz";
const FN_TIMEOUT_MS = 20_000;
const FN_RETRY_MS = [1500, 5000];               // ลองใหม่ไม่เกิน 2 ครั้ง (รวม 3) · RESOURCE_EXHAUSTED ไม่ลองซ้ำทันที
const FN_RETRYABLE = new Set(["NETWORK", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "UNKNOWN"]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fnError = (status: string, message?: string) => Object.assign(new Error(message || status), { status });

// ---------- บัญชี guest (Firebase Anonymous Auth) ใช้แค่ให้ server รู้ว่าใบเสร็จเป็นของใคร ----------
// เกมไม่มีหน้าล็อกอิน · โหลด firebase/auth เฉพาะตอนต่อร้านจริง (IAP_SERVER_READY)
let authUser: Promise<{ uid: string; token: () => Promise<string> } | null> | null = null;
function account() {
  return (authUser ??= (async () => {
    try {
      const [app, { getAuth, signInAnonymously }] = await Promise.all([firebaseApp(), import("firebase/auth")]);
      const auth = getAuth(app);
      await auth.authStateReady();
      const u = auth.currentUser ?? (await signInAnonymously(auth)).user;
      return { uid: u.uid, token: () => u.getIdToken() };
    } catch { authUser = null; return null; }
  })());
}

async function callOnce(name: string, data: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await (await account())?.token().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FN_TIMEOUT_MS);
  let res: Response, body: { error?: { status?: string; message?: string }; result?: unknown };
  try {
    res = await fetch(`https://${FUNCTIONS_REGION}-${FIREBASE_PROJECT}.cloudfunctions.net/${name}`, {
      method: "POST", headers, body: JSON.stringify({ data }), signal: ctl.signal,
    });
    body = await res.json().catch(() => ({}));
  } catch { throw fnError("NETWORK"); }
  finally { clearTimeout(timer); }
  if (body?.error) throw fnError(body.error.status ?? "UNKNOWN", body.error.message);
  if (!res.ok) throw fnError(res.status >= 500 || res.status === 429 ? "UNAVAILABLE" : "FAILED");
  return body.result;
}

async function callFunction(name: string, data: unknown): Promise<any> {
  for (let i = 0; ; i++) {
    try { return await callOnce(name, data); }
    catch (err) {
      if (!FN_RETRYABLE.has((err as { status?: string }).status ?? "") || i >= FN_RETRY_MS.length) throw err;
      await sleep(FN_RETRY_MS[i]);
    }
  }
}

export interface GrantEvent { productId: ProductId; purchaseId: string; grant: Grant; restored: boolean }
export interface BillingHandlers {
  onGrant(e: GrantEvent): void | Promise<void>;   // ให้ของ + เซฟ · throw = ยังไม่ finish (ส่งใหม่ภายหลัง)
  onRevoked(productId: ProductId): void;           // Google บอกว่ายกเลิก/คืนเงิน (remove_ads)
  shouldRestore(productId: ProductId): boolean;    // ของครั้งเดียวที่ Google บอกว่ามีแต่เซฟไม่มี → กู้คืนตอนเปิดแอป
}

const waitForCordova = () => new Promise<void>(resolve => {
  if ((window as any).CdvPurchase) return resolve();
  document.addEventListener("deviceready", () => resolve(), { once: true });
  setTimeout(resolve, 4000);
});

type Tx = any; // CdvPurchase.Transaction
type Pending = [Tx, ProductId, "verifyPurchase" | "restorePurchase"];

export const Billing = {
  // ซื้อจริงได้เฉพาะในแอป Android เมื่อ server พร้อม · บนเว็บใช้ร้านจำลองได้แค่ตอน dev
  available: (isNative && IAP_SERVER_READY) || import.meta.env.DEV,
  prices: { ...FALLBACK_PRICES } as Record<ProductId, string>,
  handlers: { onGrant() {}, onRevoked() {}, shouldRestore: () => false } as BillingHandlers,
  owned: new Map<ProductId, Tx>(),   // ของซื้อครั้งเดียวที่ส่งของไปแล้ว (Google จำไว้) ใช้ตอนกู้คืน
  pending: new Map<string, Pending>(),
  inFlight: new Set<string>(),

  priceOf(id: ProductId) { return this.prices[id] ?? ""; },
  get store(): any { return isNative ? (window as any).CdvPurchase?.store : null; },

  async init(handlers: BillingHandlers) {
    this.handlers = handlers;
    if (!isNative || !IAP_SERVER_READY) return;
    await waitForCordova();
    const C = (window as any).CdvPurchase;
    if (!C) return;
    const { store, ProductType, Platform } = C;
    const user = await account();
    // แนบ md5(uid) ไปกับการซื้อ (obfuscatedAccountId) server จึงรู้ว่าใบเสร็จเป็นของบัญชีไหน
    store.applicationUsername = () => user?.uid;
    store.obfuscator = "legacy";
    store.register(Object.entries(PRODUCTS).map(([id, p]) => ({
      id, type: p.once ? ProductType.NON_CONSUMABLE : ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY,
    })));
    store.when()
      .productUpdated((p: any) => { if (p.pricing && p.id in PRODUCTS) this.prices[p.id as ProductId] = p.pricing.price; })
      .approved((t: Tx) => this.onApproved(t));
    let receiptsReady!: () => void;
    const ready = new Promise<void>(r => { receiptsReady = r; });
    store.when().receiptsReady(receiptsReady);
    const errors = await store.initialize([Platform.GOOGLE_PLAY]);
    if (errors?.length) return;   // ต่อ Play ไม่ครบ: ห้ามถอนสิทธิ์ (ออฟไลน์จะโดนถอนผิด ๆ)
    await ready;
    if (!store.localReceipts.some((r: any) => r.transactions.some((t: any) => t.products.some((p: any) => p.id === "remove_ads")))) {
      this.handlers.onRevoked("remove_ads");
    }
    for (const [id, t] of this.owned) if (this.handlers.shouldRestore(id)) this.deliver(t, id, "restorePurchase");
  },

  onApproved(t: Tx) {
    if (t.isPending) return;
    for (const { id } of t.products) {
      if (!(id in PRODUCTS)) continue;
      const pid = id as ProductId;
      if (PRODUCTS[pid].once && t.isAcknowledged) this.owned.set(pid, t);
      else this.deliver(t, pid, "verifyPurchase");
    }
  },

  // ส่งใบเสร็จให้ server ตรวจ แล้วให้ของ · คืน { ok, reason? }
  async deliver(t: Tx, productId: ProductId, fn: Pending[2]): Promise<{ ok: boolean; reason?: string }> {
    const token = t.purchaseId;
    const key = `${fn}:${token}`;
    if (!token || this.inFlight.has(key)) return { ok: false, reason: "busy" };
    this.inFlight.add(key);
    try {
      const res = await callFunction(fn, { productId, purchaseToken: token });
      this.pending.delete(key);
      // ใบเสร็จใช้ไม่ได้ (ปลอม/ใช้แล้ว/ของบัญชีอื่น/ยกเลิก) → ไม่ให้ของ ไม่ finish (Google คืนเงินใบที่ไม่ acknowledge เองใน 3 วัน)
      if (!res?.ok) {
        if (res?.reason === "canceled") this.handlers.onRevoked(productId);
        return { ok: false, reason: res?.reason ?? "invalid" };
      }
      await this.handlers.onGrant({ productId, purchaseId: res.purchaseId, grant: res.grant ?? {}, restored: !!res.restored });
      if (fn === "verifyPurchase") await Promise.resolve(t.finish()).catch(() => {});
      return { ok: true };
    } catch (err) {
      console.warn("[iap]", fn, productId, (err as { status?: string })?.status ?? err);
      this.pending.set(key, [t, productId, fn]);
      return { ok: false, reason: (err as { status?: string })?.status === "RESOURCE_EXHAUSTED" ? "rate" : "offline" };
    } finally {
      this.inFlight.delete(key);
    }
  },

  async retryPending() {
    let n = 0;
    for (const [t, id, fn] of [...this.pending.values()]) if ((await this.deliver(t, id, fn)).ok) n++;
    return n;
  },

  // คืน true ถ้าเริ่มสั่งซื้อสำเร็จ — การให้ของจริงเกิดหลัง server ตรวจใบเสร็จแล้ว → handlers.onGrant
  async buy(productId: ProductId): Promise<boolean> {
    if (!this.available || !(productId in PRODUCTS)) return false;
    if (!isNative) {
      // ร้านจำลอง: เฉพาะ pnpm dev (build จริงโค้ดนี้ถูกตัดทิ้ง)
      if (!import.meta.env.DEV) return false;
      await this.handlers.onGrant({ productId, purchaseId: `mock-${productId}-${Date.now()}`, grant: structuredClone(PRODUCTS[productId].grant), restored: false });
      return true;
    }
    if (!(await account())) return false;
    const offer = this.store?.get(productId)?.getOffer();
    if (!offer) return false;
    return !(await offer.order());
  },

  // ปุ่ม "กู้คืนการซื้อ": ขอรายการจาก Google แล้วให้ server ยืนยันของซื้อครั้งเดียวทุกตัว · คืน true ถ้ากู้ได้อย่างน้อย 1
  async restore(): Promise<boolean> {
    if (!isNative) return false;
    if (!this.store) return false;
    await this.store.restorePurchases();
    let any = false;
    for (const [id, t] of this.owned) if ((await this.deliver(t, id, "restorePurchase")).ok) any = true;
    return any;
  },
};
