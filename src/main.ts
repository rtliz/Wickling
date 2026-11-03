import {
  parseRoom, newRound, step, tapCell, toGhost, useSkill, starsFor,
  ACTIVE_SKILLS, MAX_GHOSTS, TICKS, TICK_MS, type Ghost, type Room, type Round, type SkillId,
} from "./core/sim";
import { LEVELS } from "./core/levels";
import { genTower } from "./core/tower";
import { loadSave, writeSave, earnedStars, type SaveData } from "./core/save";
import { BR, ICON, nodeById } from "./core/skills";
import { createBoard, COL, type Quality } from "./render/board";
import { initTree, openTree } from "./ui/tree";
import { initAnalytics, track } from "./platform/analytics";
import { HEARTS, payToPlay, refreshDay, unlimited, addUnlimited, roomIsFree, clearedCount, dailyHearts } from "./core/hearts";
import { Ads, isNative } from "./platform/ads";
import { Billing, type GrantEvent } from "./platform/billing";
import { Account } from "./platform/account";
import type { ProductId } from "./platform/products";
import { App } from "@capacitor/app";

// ---------- สถานะ ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const save: SaveData = loadSave();
type Phase = "ready" | "run" | "zap" | "win";
let levelIdx = 0;                 // -1 = หอคอย ∞
let room: Room, ghosts: Ghost[] = [], r: Round, phase: Phase = "ready";
let last = 0, flash: { color: string; at: number } | null = null, scrub: number | null = null, zapTimer = 0, barPct = -1;
const has = (id: SkillId) => save.skills.eq.includes(id);
const H = save.hearts;
// เว็บ build จริงซื้อไม่ได้ (Billing.available = false) จึงไม่มีทางมีสิทธิ์ที่ซื้อโดยชอบ (แบบ LumiFlip)
if (!Billing.available) { H.noAds = false; H.from = 0; H.until = 0; }
let paused = false;               // โฆษณาเต็มจอกำลังขึ้น: หยุดลูปเกม (sim ไม่เดินระหว่างโฆษณา)
let lastWinFirst = false, replayWins = 0;
const board = createBoard($<HTMLCanvasElement>("cv"), $("stage"));

// ระดับกราฟิก · อัตโนมัติ = เริ่มสูง แล้วลดเองถ้าเฟรมช้า (กฎ performance.md)
const QKEY = "wickling.settings";
let qSetting: "auto" | Quality = "auto", qAuto: Quality = "high";
try { qSetting = JSON.parse(localStorage.getItem(QKEY) || "{}").quality || "auto"; } catch { /* ใช้ค่าเริ่มต้น */ }
const quality = (): Quality => (qSetting === "auto" ? qAuto : qSetting);
let slowFrames = 0, lastFrame = 0;

// ---------- เสียง (Web Audio) ----------
let ac: AudioContext | null = null;
function unlockAudio() { if (!ac) { try { ac = new AudioContext(); } catch { /* ไม่มีเสียงก็เล่นได้ */ } } }
function note(f: number, dur: number, type: OscillatorType = "sine", vol = .12) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const NOTES = [523.25, 659.25, 783.99, 987.77];

// ---------- ห้องและรอบ ----------
function loadLevel(i: number) {
  levelIdx = i;
  H.attempt = null;               // ล้างเงา = จบความพยายามเดิม (เริ่มเดินครั้งหน้าในห้องที่ยังไม่ผ่านใช้หัวใจ)
  room = parseRoom(i < 0 ? genTower(save.tower.floor) : LEVELS[i]);
  ghosts = [];
  $("win").hidden = true;
  startRound();
  renderLevelChips();
}

function startRound() {
  clearTimeout(zapTimer);
  r = newRound(room, ghosts); phase = "ready"; flash = null;
  $("gmenu").hidden = true;
  updateHud();
  const sk = room.def.skill ? nodeById(room.def.skill) : null;
  const skLine = sk ? `<br><small>สกิลแนะนำ: ${sk.name} · ${has(sk.id) ? "ติดตัวอยู่" : save.skills.owned.includes(sk.id) ? "ปลดล็อกแล้ว ไปติดตัวที่ต้นไม้สกิล" : "ยังไม่มี ผ่านด้วยเงาได้ (ดาวน้อยลง)"}</small>` : "";
  banner(ghosts.length === 0 ? room.def.hint + skLine
    : `เงา #${ghosts.length} พร้อมแล้ว · แตะเพื่อเริ่ม<b>รอบที่ ${ghosts.length + 1}</b>`
      + (ghosts.length === 1 ? `<br><small>วงประ = ที่ที่เงาจะอยู่ตอนคุณเดินไปถึง · แตะจุดสีมุมขวาบนเพื่อปรับเงา</small>` : ""));
}

function endRound(why: string) {
  if (ghosts.length >= MAX_GHOSTS) {
    ghosts = []; H.attempt = null; writeSave(save); startRound();
    banner(`${why} · เงาครบ ${MAX_GHOSTS} ตัวแล้ว เริ่มห้องใหม่ทั้งหมด ลองวางแผนอีกแบบ` + (needsHeartNow() ? "<br><small>เริ่มเดินอีกครั้งใช้หัวใจ 1 ดวง</small>" : ""));
    return;
  }
  ghosts.push(toGhost(r));
  note(330, .25);
  startRound();
}

function onZap() {
  phase = "zap"; flash = { color: COL.laser, at: performance.now() };
  note(110, .35, "sawtooth", .08);
  banner("โดนเลเซอร์! แต่ไม่เป็นไร รอบนี้ยังกลายเป็นเงาได้");
  zapTimer = window.setTimeout(() => endRound("โดนเลเซอร์"), 750);
}

function onWin() {
  phase = "win"; flash = { color: COL.exit, at: performance.now() };
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => note(f, .25), i * 110));
  const n = ghosts.length, par = room.def.par, stars = starsFor(n, par);
  const before = clearedCount(save);
  H.attempt = null;
  if (levelIdx >= 0) save.best[levelIdx] = Math.max(save.best[levelIdx] || 0, stars);
  else save.tower.best = Math.max(save.tower.best, save.tower.floor);
  lastWinFirst = clearedCount(save) > before;
  if (!lastWinFirst) replayWins++;
  writeSave(save);
  if (adsOn() && before < HEARTS.adsAfterCleared) Ads.showBanner();
  track("level_complete", { level: levelIdx < 0 ? "tower" : String(levelIdx + 1), floor: levelIdx < 0 ? save.tower.floor : 0, ghosts: n, par, stars, skills: save.skills.eq.filter(Boolean).join("+") || "none" });
  $("winTitle").textContent = n < par ? "เหนือชั้น!" : "ผ่านแล้ว!";
  $("winStars").innerHTML = "★".repeat(stars) + "<s>" + "★".repeat(3 - stars) + "</s>";
  $("winMsg").textContent = n < par ? `ใช้เงาแค่ ${n} ตัว น้อยกว่าที่ออกแบบไว้ (${par})`
    : `ใช้เงา ${n} ตัว` + (stars < 3 ? (par === 0 ? " · ลองผ่านโดยไม่ใช้เงาเลยเพื่อรับ 3 ดาว" : ` · ลองใช้แค่ ${par} ตัวเพื่อรับ 3 ดาว`) : "");
  $("btnNext").textContent = levelIdx < 0 ? `ขึ้นชั้น ${save.tower.floor + 1}` : levelIdx < LEVELS.length - 1 ? "ห้องต่อไป" : "ไปหอคอย ∞";
  $("win").hidden = false;
  banner(""); updateHud(); renderLevelChips();
}

function tick() {
  const ev = step(room, ghosts, r);
  for (const f of ev.fresh) note(f === "p" ? 392 : NOTES[f % 4], .18);
  if (ev.cloneLost) { note(110, .3, "sawtooth", .06); banner("ดวงที่สองโดนลำแสงดับไป"); updateHud(); }
  if (ev.cloneExpired) { banner("ดวงที่สองดับแล้ว"); updateHud(); }
  if (r.outcome === "zap") onZap();
  else if (r.outcome === "win") onWin();
  else if (r.outcome === "timeout") endRound("หมดเวลา");
}

// ---------- ปุ่มและการแตะ ----------
$("cv").addEventListener("pointerdown", ev => {
  unlockAudio();
  if (phase !== "ready" && phase !== "run") return;
  const p = board.cellAt(ev.clientX, ev.clientY);
  if (!p || !tapCell(room, r, p)) return;
  if (phase === "ready" && !payHeart()) return;
  if (phase === "ready") { phase = "run"; last = performance.now(); banner(""); updateHud(); }
});
$("btnEnd").onclick = () => { if (phase === "run") { r.outcome = "timeout"; endRound("จบรอบเอง"); } };
$("btnUndo").onclick = () => { if (phase === "ready" && ghosts.length) { ghosts.pop(); startRound(); } };
$("btnReset").onclick = () => loadLevel(levelIdx);
$("btnRetry").onclick = async () => { await afterWin(); loadLevel(levelIdx); };
$("btnNext").onclick = async () => {
  await afterWin();
  if (levelIdx < 0) { save.tower.floor++; writeSave(save); loadLevel(-1); }
  else loadLevel(levelIdx < LEVELS.length - 1 ? levelIdx + 1 : -1);
};

// ---------- หัวใจ (กติกาใน core/hearts.ts) ----------
const HEART_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5S3.5 15.2 3.5 9.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.5c0 6.1-8.5 11.4-8.5 11.4z" fill="var(--heart)" stroke="#1b1430" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.6 8.6a2.2 2.2 0 0 1 2.4-1.2" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const needsHeartNow = () => !roomIsFree(save, levelIdx) && !unlimited(H);
// โฆษณาที่ผู้เล่นไม่ได้กดเอง (แบนเนอร์ + คั่นห้อง) เริ่มหลังผ่านห้องพื้นฐานครบ
const adsOn = () => Ads.available && !H.noAds && clearedCount(save) >= HEARTS.adsAfterCleared;
const timeLeft = (ms: number) => { const m = Math.ceil(ms / 60_000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

let toastTimer = 0;
function toast(msg: string) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

// แตะเดินครั้งแรกของรอบ · คืน false = เล่นไม่ได้ (หัวใจหมด)
function payHeart() {
  refreshDay(H);
  const res = payToPlay(H, save, levelIdx);
  if (res === "empty") { openHearts(true); return false; }
  if (res === "paid") { writeSave(save); toast(`ใช้หัวใจ 1 ดวง · เหลือ ${H.n}`); }
  renderHearts();
  return true;
}

let heartsHtml = "";
function renderHearts() {
  const inf = unlimited(H);
  const html = HEART_SVG + (inf ? `∞<small>${timeLeft(H.until - Date.now())}</small>` : `${H.n}`);
  if (html !== heartsHtml) { heartsHtml = html; $("hearts").innerHTML = html; }
  $("hearts").classList.toggle("empty", !inf && H.n <= 0);
  $("hearts").classList.toggle("unl", inf);
  $("hearts").setAttribute("aria-label", inf ? `หัวใจไม่จำกัด เหลือเวลา ${timeLeft(H.until - Date.now())} ชั่วโมง` : `หัวใจ ${H.n} ดวง`);
  const rb = $("btnReset");
  const label = needsHeartNow() && H.attempt ? "เริ่มห้องใหม่ (ใช้หัวใจ 1)" : "เริ่มห้องใหม่";
  if (rb.textContent !== label) rb.textContent = label;
}

// นับถอยหลังหัวใจไม่จำกัดบนป้ายทุกวินาที จนหมดเวลา (timer เดียว ไม่สร้างใหม่ทุกเฟรม)
let unlTimer = 0;
function watchUnlimited() {
  clearInterval(unlTimer);
  if (!unlimited(H)) return;
  unlTimer = window.setInterval(() => {
    renderHearts();
    if (unlimited(H)) return;
    clearInterval(unlTimer); toast("หัวใจไม่จำกัดหมดเวลาแล้ว");
  }, 1000);
}

// หน้าหัวใจ: empty = หัวใจหมดตอนจะเล่น · ไม่งั้นเป็นหน้าข้อมูล/ร้าน (แตะป้ายหัวใจ)
let countTimer = 0, hEmpty = false;
function openHearts(empty: boolean) {
  hEmpty = empty;
  if (empty) track("hearts_empty", { level: levelIdx < 0 ? "tower" : String(levelIdx + 1) });
  renderHeartsPanel();
  $("heartsOv").hidden = false;
  clearInterval(countTimer);
  const tick = () => {
    if (refreshDay(H)) { writeSave(save); afterHeartGained(); return; }
    const now = new Date(), midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const sec = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
    $("hCount").textContent = [sec / 3600, (sec % 3600) / 60, sec % 60].map(v => String(Math.floor(v)).padStart(2, "0")).join(":");
  };
  tick(); countTimer = window.setInterval(tick, 1000);
}
function closeHearts() { clearInterval(countTimer); $("heartsOv").hidden = true; }

function renderHeartsPanel() {
  const inf = unlimited(H);
  $("hTitle").textContent = hEmpty && !inf && H.n <= 0 ? "หัวใจหมดแล้ว" : "หัวใจ";
  $("hBig").innerHTML = HEART_SVG + (inf ? `∞<small>เหลือ ${timeLeft(H.until - Date.now())} ชม.</small>` : `${H.n}<small>/ ${dailyHearts(H)} ต่อวัน</small>`);
  $("hText").textContent = "ห้องหรือชั้นที่ยังไม่เคยผ่านใช้หัวใจ 1 ดวงต่อการเริ่ม (เล่นกี่รอบในห้องก็ได้) · ห้องที่ผ่านแล้วและห้อง 1–2 เล่นฟรี";
  const adLeft = HEARTS.adPerDay - H.ad;
  // ดูโฆษณาได้เฉพาะตอนหัวใจหมด (หัวใจจึงไม่เกินเพดาน 8) และวันละ 3 ครั้ง
  $("hAd").hidden = !Ads.available || inf || H.n > 0;
  $<HTMLButtonElement>("hAd").disabled = adLeft <= 0;
  $("hAdLeft").textContent = adLeft > 0 ? `วันนี้ดูได้อีก ${adLeft} ครั้ง` : "วันนี้ดูครบ 3 ครั้งแล้ว";
  $("hUnl").hidden = !Billing.available;
  $("hUnlPrice").textContent = Billing.priceOf("unlimited_hearts_2h");
  $("hNoAds").hidden = !Billing.available || H.noAds || hEmpty;
  $("hNoAdsPrice").textContent = Billing.priceOf("remove_ads");
  $("hRestore").hidden = !Billing.available;
  $("hWait").hidden = inf;
}

// ได้หัวใจเพิ่มระหว่างหน้า "หัวใจหมด" เปิดอยู่ → ปิดแล้วเล่นต่อ
function afterHeartGained() {
  renderHearts();
  if (!$("heartsOv").hidden) { if (hEmpty) closeHearts(); else renderHeartsPanel(); }
  updateHud();
}

let watchingAd = false;
$("hAd").onclick = async () => {
  if (watchingAd || H.ad >= HEARTS.adPerDay || H.n > 0) return;
  watchingAd = true;
  const ok = await Ads.rewarded().finally(() => { watchingAd = false; });
  if (!ok) return toast("ต้องดูโฆษณาจนจบถึงจะได้หัวใจ");
  H.n = Math.min(HEARTS.max, H.n + 1); H.ad++;
  writeSave(save); toast("ได้หัวใจ +1"); afterHeartGained();
};
$("hearts").onclick = () => openHearts(false);
$("hClose").onclick = closeHearts;
$("hUnl").onclick = () => buy("unlimited_hearts_2h", "hUnl");
$("hNoAds").onclick = () => buy("remove_ads", "hNoAds");
$("hRestore").onclick = async () => {
  const b = $<HTMLButtonElement>("hRestore");
  if (b.disabled) return;
  b.disabled = true; b.textContent = "กำลังตรวจ…";
  const ok = await Billing.restore().catch(() => false);
  b.disabled = false; b.textContent = "กู้คืนการซื้อ";
  toast(ok ? "กู้คืนการซื้อแล้ว" : Billing.pending.size ? "ยังตรวจใบเสร็จไม่ได้ จะลองใหม่อัตโนมัติ" : "ไม่พบการซื้อที่กู้คืนได้");
};

// ---------- หลังผ่านห้อง: เสนอแพ็ก / โฆษณาคั่น (แบบ goNext ของ LumiFlip) ----------
async function afterWin() {
  const n = clearedCount(save);
  if (lastWinFirst && Billing.available && !unlimited(H) && n % HEARTS.offerEvery === 0) await openOffer(n);
  else if (adsOn() && (lastWinFirst ? n > HEARTS.adsAfterCleared && n % HEARTS.interstitialEvery === 0
    : replayWins % HEARTS.interstitialEvery === 0)) await Ads.interstitial();
  lastWinFirst = false;
}

let offerDone: (() => void) | null = null;
function openOffer(n: number) {
  track("offer", { product: "unlimited_hearts_2h", action: "view", cleared: n });
  $("oTitle").textContent = `ผ่านมาแล้ว ${n} ห้อง!`;
  $("oBig").innerHTML = HEART_SVG + "∞<small>2 ชั่วโมง</small>";
  $("oBuy").textContent = `ซื้อ ${Billing.priceOf("unlimited_hearts_2h")}`;
  $("offerOv").hidden = false;
  return new Promise<void>(res => { offerDone = res; });
}
function closeOffer() { $("offerOv").hidden = true; offerDone?.(); offerDone = null; }
$("oLater").onclick = () => { track("offer", { product: "unlimited_hearts_2h", action: "later" }); closeOffer(); };
$("oBuy").onclick = async () => { await buy("unlimited_hearts_2h", "oBuy"); if (unlimited(H)) closeOffer(); };

// ---------- การซื้อ: ของทุกชิ้นมาจาก server หลังตรวจใบเสร็จ (platform/billing.ts) ----------
async function buy(id: ProductId, btnId: string) {
  const b = $<HTMLButtonElement>(btnId);
  b.disabled = true;
  track("offer", { product: id, action: "buy_tap" });
  const ok = await Billing.buy(id).catch(() => false);
  b.disabled = false;
  if (!ok) toast("ซื้อไม่สำเร็จ ลองใหม่อีกครั้ง");
}

// onGrant ต้องเซฟเสร็จก่อน return · กันให้ของซ้ำด้วย purchaseId
function onGrant({ productId, purchaseId, grant, restored }: GrantEvent) {
  if (purchaseId && H.tx.includes(purchaseId)) return;
  if (purchaseId) H.tx = [...H.tx, purchaseId].slice(-HEARTS.txKeep);
  if (grant.noAds) unlockNoAds();
  if ((grant.unlimitedHours ?? 0) > 0) addUnlimited(H, Math.min(grant.unlimitedHours!, 24) * 3_600_000);
  writeSave(save);
  track("purchase_granted", { product: productId, restored: restored ? 1 : 0 });
  afterHeartGained(); watchUnlimited();
  const until = new Date(H.until).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  toast(grant.noAds ? "ลบโฆษณาแล้ว · หัวใจวันละ 8 ดวง" : `หัวใจไม่จำกัดถึง ${until} น.`);
  if (!$("offerOv").hidden && unlimited(H)) closeOffer();
}
function unlockNoAds() {
  if (H.noAds) return;
  H.noAds = true;
  H.n = Math.max(H.n, HEARTS.perDayNoAds);
  Ads.hideBanner();
}
function onRevoked(productId: ProductId) {   // Google ไม่พบการซื้อแล้ว (เช่น คืนเงิน) → ถอนสิทธิ์
  if (productId !== "remove_ads" || !H.noAds) return;
  H.noAds = false; writeSave(save);
  if (adsOn()) Ads.showBanner();
  renderHearts();
}
const shouldRestore = (productId: ProductId) => productId === "remove_ads" && !H.noAds;

function pressSkill(id: SkillId) {
  if (phase !== "run") return;
  const msg = useSkill(room, ghosts, r, id);
  if (!msg) return;
  if (id === "t3") flash = { color: COL.player, at: performance.now() };
  note(id === "t2" ? 880 : 640, .3, "triangle", .07);
  banner(msg); updateHud();
}

// ส่องอนาคต: กดค้างที่หลอดเทียนแล้วลาก
const tb = $("timerBar");
const scrubAt = (ev: PointerEvent) => { const b = tb.getBoundingClientRect(); scrub = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)); };
tb.addEventListener("pointerdown", ev => { if (has("t1")) { tb.setPointerCapture(ev.pointerId); scrubAt(ev); } });
tb.addEventListener("pointermove", ev => { if (scrub != null) scrubAt(ev); });
for (const e of ["pointerup", "pointercancel"]) tb.addEventListener(e, () => { scrub = null; });

// ---------- บัญชี (ยกจาก LumiFlip main.js: requireLogin / backToGate / linkGoogle / signOut / deleteAccount / renderAccount) ----------
// ความคืบหน้าอยู่ในเซฟบนเครื่อง ไม่ได้อยู่กับบัญชี → ออกจากระบบ/ลบบัญชีไม่ลบเซฟ (บอกผู้เล่นในหน้าถามยืนยันทุกครั้ง)
const SPIRIT_SVG = `<svg viewBox="-16 -26 32 44" aria-hidden="true"><use href="#wkHero"/></svg>`;
const errCode = (err: unknown) => (err as { code?: string })?.code ?? "";
let gateOpen = false;

// หน้าล็อกอิน: ปิดเองไม่ได้จนกว่าจะเลือก guest หรือ Google
function requireLogin() {
  gateOpen = true;
  $("profileOv").hidden = true;
  $("login").hidden = false;
  Account.preload();
}

function setLoginBusy(busy: boolean) {
  for (const id of ["googleBtn", "guestBtn"]) $<HTMLButtonElement>(id).disabled = busy;
}

async function loginWith(kind: "guest" | "google") {
  if ($<HTMLButtonElement>("guestBtn").disabled) return;
  unlockAudio();
  setLoginBusy(true);
  try {
    const res = await Account.signIn(kind);
    gateOpen = false;
    $("login").hidden = true;
    renderAccount();
    if (res === "offline") toast("ยังไม่มีเน็ต เล่นไปก่อนได้เลย จะสร้างบัญชีให้เมื่อต่อเน็ต");
    else toast(kind === "google" ? `เข้าสู่ระบบแล้ว · ${Account.user?.name || "Google"}` : "ยินดีต้อนรับ ภูติน้อย");
    if (Billing.pending.size) Billing.retryPending().catch(() => 0);
  } catch {
    toast("เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง");   // รวมกรณีผู้เล่นกดยกเลิกเอง (แบบ LumiFlip)
  } finally {
    setLoginBusy(false);
  }
}
$("googleBtn").onclick = () => loginWith("google");
$("guestBtn").onclick = () => loginWith("guest");

// ถามยืนยัน · คืน true เมื่อกดปุ่มยืนยัน
let askDone: ((ok: boolean) => void) | null = null;
function ask(title: string, text: string, yes: string) {
  askDone?.(false);
  $("askTitle").textContent = title; $("askText").textContent = text; $("askYes").textContent = yes;
  $("askOv").hidden = false;
  return new Promise<boolean>(res => { askDone = res; });
}
function closeAsk(ok: boolean) { $("askOv").hidden = true; askDone?.(ok); askDone = null; }
$("askNo").onclick = () => closeAsk(false);
$("askYes").onclick = () => closeAsk(true);

// guest → Google: uid เดิม ใบเสร็จที่ผูกกับบัญชีนี้ยังอยู่
async function linkGoogle() {
  const b = $<HTMLButtonElement>("pLink");
  b.disabled = true;
  try {
    await Account.linkGoogle();
    renderAccount();
    toast("ผูกบัญชี Google แล้ว");
  } catch (err) {
    toast(errCode(err) === "auth/credential-already-in-use"
      ? "บัญชี Google นี้เคยใช้กับเกมนี้แล้ว · ออกจากระบบแล้วเข้าด้วย Google แทนได้"
      : "ผูกบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง");
  } finally { b.disabled = false; }
}

async function signOut() {
  const guest = !Account.user?.google;
  if (!(await ask("ออกจากระบบ?", guest
    ? "บัญชีผู้เยี่ยมชมนี้จะเข้ากลับไม่ได้อีก · ความคืบหน้าในเกมบนเครื่องนี้ยังอยู่ครบ"
    : "เข้าด้วย Google บัญชีเดิมได้ทุกเมื่อ · ความคืบหน้าในเกมบนเครื่องนี้ยังอยู่ครบ", "ออกจากระบบ"))) return;
  await Account.signOut().catch(() => { Account.user = null; Account.setHint(null); });
  backToGate();
}

// ออกจากบัญชีแล้วกลับไปหน้าล็อกอิน (เล่นต่อไม่ได้จนกว่าจะเข้าใหม่)
function backToGate() {
  $("profileOv").hidden = true;
  renderAccount();
  requireLogin();
}

// Play บังคับให้แอปที่สร้างบัญชีต้องลบบัญชีในแอปได้ · ถามยืนยันสองครั้ง
async function deleteAccount() {
  if (!(await ask("ลบบัญชีถาวร?", "บัญชีนี้และข้อมูลของบัญชีบนเซิร์ฟเวอร์จะถูกลบ กู้คืนไม่ได้ · ความคืบหน้าในเกมบนเครื่องนี้ยังอยู่", "ลบบัญชี"))) return;
  const google = !!Account.user?.google;
  if (!(await ask("ยืนยันอีกครั้ง", google ? "แน่ใจนะ? ขั้นต่อไปให้เลือกบัญชี Google เดิมเพื่อยืนยันตัวตน แล้วบัญชีจะถูกลบทันที" : "แน่ใจนะ? ลบแล้วย้อนกลับไม่ได้", "ลบถาวร"))) return;
  const b = $<HTMLButtonElement>("pDelete");
  b.disabled = true;
  try {
    await Account.deleteAccount();
  } catch (err) {
    return toast(errCode(err) === "auth/user-mismatch" ? "บัญชี Google ไม่ตรงกับบัญชีนี้ ยังไม่ได้ลบ" : "ลบบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง");
  } finally { b.disabled = false; }
  backToGate();
  toast("ลบบัญชีแล้ว");
}

function renderAccount() {
  const u = Account.user, offline = Account.hint() === "offline";
  const av = $("pAvatar");
  if (u?.photo) {
    // รูปจาก Google: ตั้งผ่าน property (ไม่ใช้ innerHTML กับข้อมูลจากบัญชี)
    const img = document.createElement("img");
    img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = u.photo;
    img.onerror = () => { av.innerHTML = SPIRIT_SVG; };
    av.replaceChildren(img);
  } else av.innerHTML = SPIRIT_SVG;
  $("pName").textContent = u?.name || (u?.google ? "ผู้เล่น Google" : "ผู้เยี่ยมชม");
  $("pType").textContent = u ? (u.google ? `บัญชี Google${u.email ? " · " + u.email : ""}` : "บัญชีผู้เยี่ยมชม")
    : offline ? "ผู้เยี่ยมชม · ยังไม่ได้เชื่อมต่อ (รอเน็ต)" : "";
  const stars = earnedStars(save);
  $("pStats").innerHTML = `<div><b>${stars}</b><small>ดาวที่ได้</small></div><div><b>${clearedCount(save)}</b><small>ห้องที่ผ่าน</small></div><div><b>${save.tower.best}</b><small>หอคอยสูงสุด</small></div>`;
  $("pLink").hidden = !u || u.google;
  $("pNote").textContent = u && !u.google
    ? "ผูก Google แล้วยังเป็นบัญชีเดิม และไม่หายเมื่อลบแอป · ความคืบหน้าในเกมเก็บไว้ในเครื่องนี้"
    : "ความคืบหน้าในเกมเก็บไว้ในเครื่องนี้ ออกจากระบบแล้วก็ยังอยู่";
  $("pDelete").hidden = !u;
}

function openProfile() { renderAccount(); $("profileOv").hidden = false; }
$("pClose").onclick = () => { $("profileOv").hidden = true; };
$("pLink").onclick = linkGoogle;
$("pSignOut").onclick = signOut;
$("pDelete").onclick = deleteAccount;
Account.onChange = renderAccount;

// splash ในแอป (ยกจาก LumiFlip setupSplash): ลบออกเมื่อแอนิเมชันจบ เกมโหลดอยู่ข้างใต้ไม่รอ splash · ?nosplash / ?splashat=ms เฉพาะ dev
function setupSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  const q = new URLSearchParams(location.search);
  if (import.meta.env.DEV && q.has("nosplash")) return el.remove();
  if (import.meta.env.DEV && q.has("splashat")) {   // หยุดภาพไว้ที่เวลานี้ (แคปภาพตรวจงาน)
    for (const a of el.getAnimations({ subtree: true })) { a.currentTime = Number(q.get("splashat")); a.pause(); }
    return;
  }
  const done = () => { clearTimeout(timer); el.removeEventListener("animationend", onEnd); el.remove(); };
  const onEnd = (e: AnimationEvent) => { if (e.animationName === "sp-out") done(); };
  el.addEventListener("animationend", onEnd);
  const timer = setTimeout(done, 3500);   // กันค้างถ้า animationend ไม่มา
}

// ---------- HUD ----------
function banner(html: string) { $("banner").innerHTML = html; }

function updateHud() {
  $("lvlNo").textContent = levelIdx < 0 ? `หอคอย ∞ · สถิติสูงสุด ชั้น ${save.tower.best} · 3 ดาวเมื่อใช้เงา ≤ ${room.def.par}`
    : `ห้อง ${levelIdx + 1}/${LEVELS.length} · 3 ดาวเมื่อใช้เงา ≤ ${room.def.par}`;
  $("lvlName").textContent = room.def.name;
  $("ghostTxt").textContent = `เงา ${ghosts.length}/${MAX_GHOSTS}`;
  const dots = $("dots"); dots.innerHTML = "";
  for (let i = 0; i < MAX_GHOSTS; i++) {
    const d = document.createElement("span"); d.className = "dot";
    if (i < ghosts.length) {
      d.style.background = COL.ghost[i]; d.style.borderColor = COL.ghost[i];
      if (phase === "ready") { d.classList.add("tap"); d.onclick = () => ghostMenu(i); d.title = "ปรับเงาตัวนี้"; }
    }
    dots.appendChild(d);
  }
  $<HTMLButtonElement>("btnEnd").disabled = phase !== "run";
  $("btnEnd").className = phase === "run" ? "primary" : "";
  $<HTMLButtonElement>("btnUndo").disabled = !(phase === "ready" && ghosts.length);
  renderHearts();
  save.skills.eq.forEach((id, i) => {
    const b = document.getElementById("sk" + i) as HTMLButtonElement | null;
    if (!b || !id || !ACTIVE_SKILLS.has(id)) return;
    const toggling = id === "cap" && !!r.clone;
    b.disabled = phase !== "run" || (!!r.used[id] && !toggling);
    b.classList.toggle("used", !!r.used[id] && !toggling);
    const small = b.querySelector("small");
    if (small) small.textContent = toggling ? (r.ctrl === "clone" ? "แตะเพื่อบังคับดวงแรก" : "แตะเพื่อบังคับดวงที่สอง") : "กดใช้ · รอบละครั้ง";
  });
}

function renderSkillBar() {
  const bar = $("skillBar"); bar.innerHTML = "";
  save.skills.eq.forEach((id, i) => {
    const b = document.createElement("button"); b.id = "sk" + i;
    const n = id ? nodeById(id) : undefined;
    if (!n) { b.innerHTML = `<span>ช่องสกิล ${i + 1} ว่าง<small>แตะเพื่อเปิดต้นไม้สกิล</small></span>`; b.onclick = () => openTree(); }
    else {
      b.innerHTML = `<svg viewBox="0 0 24 24" style="color:${BR[n.br].c}">${ICON[n.icon]}</svg><span>${n.name}<small>${ACTIVE_SKILLS.has(n.id) ? "กดใช้ · รอบละครั้ง" : "ทำงานเอง"}</small></span>`;
      if (ACTIVE_SKILLS.has(n.id)) b.onclick = () => pressSkill(n.id); else b.classList.add("passive");
    }
    bar.appendChild(b);
  });
}

function ghostMenu(i: number) {
  const m = $("gmenu"), g = ghosts[i];
  if (phase !== "ready" || !g) return;
  const lastOne = i === ghosts.length - 1;
  let h = `<b style="color:${COL.ghost[i]}">เงา #${i + 1}</b>`;
  if (has("s1") || lastOne) h += `<button data-a="del">ลบเงา #${i + 1}</button>`;
  else h += `<small>ลบได้เฉพาะเงาตัวล่าสุด (สกิล "เรียกควันกลับ" ลบตัวไหนก็ได้)</small>`;
  if (has("s2")) h += `<button data-a="delay">ออกตัวช้า: ${g.delay / 4} วิ → ${((g.delay + 4) % 16) / 4} วิ</button>`;
  if (has("s3")) h += `<button data-a="twin">เงากระจก: ${g.twin ? "ปิด" : "เปิด"}</button>`;
  if (!has("s2") && !has("s3")) h += `<small>ติดตัวสกิลกิ่ง "ควันวิญญาณ" เพื่อปรับเงาได้มากขึ้น</small>`;
  h += `<button data-a="close">ปิด</button>`;
  m.innerHTML = h; m.hidden = false;
  m.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "del") ghosts.splice(i, 1);
    if (a === "delay") g.delay = (g.delay + 4) % 16;
    if (a === "twin") g.twin = !g.twin;
    m.hidden = true;
    if (a !== "close") startRound();
  });
}

function renderLevelChips() {
  const box = $("levels"); box.innerHTML = "";
  const add = (html: string, cls: string, onclick: () => void, label?: string) => {
    const b = document.createElement("button"); b.className = cls; b.innerHTML = html; b.onclick = onclick;
    if (label) b.setAttribute("aria-label", label); box.appendChild(b);
  };
  add(`${SPIRIT_SVG}<small>บัญชี</small>`, "acct", openProfile, "บัญชีผู้เล่น");
  add("ต้นไม้สกิล ✦", "tree", () => openTree());
    // แตะห้องที่กำลังเล่นอยู่ = ไม่ทำอะไร (เริ่มใหม่ต้องกดปุ่ม "เริ่มห้องใหม่" ซึ่งบอกว่าใช้หัวใจ)
  const go = (i: number) => () => { if (i !== levelIdx || phase === "win") loadLevel(i); };
  LEVELS.forEach((_, i) => add(`${i + 1}<small>${"★".repeat(save.best[i] || 0) || "&nbsp;"}</small>`, i === levelIdx ? "on" : "", go(i), `ห้อง ${i + 1}`));
  add(`หอคอย ∞<small>${save.tower.best ? "ชั้น " + save.tower.best : "&nbsp;"}</small>`, levelIdx < 0 ? "on" : "", go(-1), "โหมดหอคอยไม่รู้จบ");
  const names: Record<string, string> = { auto: "อัตโนมัติ", high: "สูง", mid: "กลาง", low: "ต่ำ" };
  add(`ภาพ<small>${names[qSetting]}${qSetting === "auto" ? "·" + names[qAuto] : ""}</small>`, "q", () => {
    const order = ["auto", "high", "mid", "low"] as const;
    qSetting = order[(order.indexOf(qSetting) + 1) % order.length];
    try { localStorage.setItem(QKEY, JSON.stringify({ quality: qSetting })); } catch { /* ไม่เป็นไร */ }
    renderLevelChips();
  }, "ระดับกราฟิก");
  document.body.classList.toggle("q-low", quality() === "low");
}

initTree(save, () => { renderSkillBar(); updateHud(); renderLevelChips(); if (phase === "ready") startRound(); });

// ---------- ลูปหลัก ----------
function frame(now: number) {
  requestAnimationFrame(frame);
  if (paused || gateOpen) { last = now; lastFrame = 0; return; }   // โฆษณาเต็มจอ / หน้าล็อกอินบังทั้งจอ: ไม่เดิน sim ไม่วาด ไม่นับเฟรมช้า
  if (lastFrame && qSetting === "auto" && qAuto !== "low" && !document.hidden) {
    slowFrames = now - lastFrame > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 90) { qAuto = qAuto === "high" ? "mid" : "low"; slowFrames = 0; renderLevelChips(); }
  }
  lastFrame = now;
  if (phase === "run") while (now - last >= TICK_MS && phase === "run") { last += TICK_MS; tick(); }
  const a = phase === "run" ? Math.max(0, Math.min(1, (now - last) / TICK_MS)) : 1;
  board.draw(now, { room, ghosts, r, a, phase, scrub, quality: quality(), lightRadius: has("l1") ? 3.4 : 1.5, flash });
  const left = phase === "run" ? 1 - Math.min(1, (r.t + a) / TICKS) : phase === "ready" ? 1 : 1 - r.t / TICKS;
  const pct = Math.round(Math.max(0, Math.min(1, left)) * 1000) / 10;
  if (pct !== barPct) { barPct = pct; $("bar").style.width = `calc(${pct}% - 20px)`; }
}

// ---------- โฆษณาจำลอง (pnpm dev บนเบราว์เซอร์เท่านั้น · build จริงโค้ดนี้ถูกตัดทิ้ง) ----------
if (import.meta.env.DEV && !isNative) {
  document.body.insertAdjacentHTML("beforeend", `<div id="mockAd" class="ov" hidden><div class="card">
    <small class="adtag">โฆษณาทดสอบ (จำลอง)</small><h2 id="mockKind">โฆษณา</h2>
    <p>ใน build จริงตรงนี้คือโฆษณาจาก AdMob</p><button id="mockClose" disabled>3</button></div></div>
    <div id="mockBanner" hidden>แบนเนอร์โฆษณาทดสอบ (จำลอง) · สูง 50px</div>`);
  Ads.mock = {
    setBanner(on) { $("mockBanner").hidden = !on; document.documentElement.style.setProperty("--banner-h", on ? "50px" : "0px"); },
    play(rewarded) {
      return new Promise(resolve => {
        let left = 3;
        const btn = $<HTMLButtonElement>("mockClose");
        $("mockKind").textContent = rewarded ? "โฆษณาแบบเลือกดู (รับหัวใจ)" : "โฆษณาคั่น";
        btn.disabled = true; btn.textContent = String(left); $("mockAd").hidden = false;
        const timer = setInterval(() => {
          left--;
          btn.textContent = left > 0 ? String(left) : "ปิด";
          if (left <= 0) { clearInterval(timer); btn.disabled = false; }
        }, 1000);
        btn.onclick = () => { $("mockAd").hidden = true; resolve(true); };
      });
    },
  };
}
Ads.onShowing = on => { paused = on; };

// ---------- ปุ่ม back ของ Android: ปิดหน้าต่างบนสุดก่อน · กดสองครั้งออกจากเกม ----------
let lastBack = 0;
if (isNative) App.addListener("backButton", () => {
  if (Ads.busy) return;
  if (!$("askOv").hidden) return closeAsk(false);
  if (!$("profileOv").hidden) { $("profileOv").hidden = true; return; }
  if (!$("offerOv").hidden) return closeOffer();
  if (!$("heartsOv").hidden) return closeHearts();
  if (!$("treeOv").hidden) { $("treeClose").click(); return; }
  if (!$("gmenu").hidden) { $("gmenu").hidden = true; return; }
  if (Date.now() - lastBack < 2000) { App.exitApp(); return; }
  lastBack = Date.now(); toast("กดย้อนกลับอีกครั้งเพื่อออกจากเกม");
});

// กลับเข้าแอป/แท็บ: เติมหัวใจถ้าข้ามเที่ยงคืน + ลองส่งใบเสร็จที่ค้าง
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (refreshDay(H)) { writeSave(save); afterHeartGained(); }
  if (Account.hint() === "offline") Account.ensure().then(ok => ok && renderAccount()).catch(() => {});
  if (Billing.pending.size) Billing.retryPending().catch(() => 0);
});

setupSplash();
// ครั้งแรก/หลังออกจากระบบ: หน้าล็อกอินขึ้นทันที (ใต้ splash) · เคยเข้าแล้ว: อ่านบัญชีตอนว่าง ถ้าบัญชีหายไปค่อยเปิดหน้าล็อกอิน
if (Account.needsGate()) requireLogin();
const startAccount = () => Account.init().then(ok => { renderAccount(); if (!ok) requireLogin(); }).catch(() => {});
if (gateOpen) startAccount();
else "requestIdleCallback" in window ? requestIdleCallback(startAccount, { timeout: 3000 }) : setTimeout(startAccount, 1500);
if (refreshDay(H)) writeSave(save);
renderSkillBar();
loadLevel(0);
watchUnlimited();
requestAnimationFrame(frame);
initAnalytics();
Ads.init().then(() => { if (adsOn()) Ads.showBanner(); });
// ให้สคริปต์ทดสอบ/แคปภาพอ่านและตั้งสถานะได้ (pnpm dev เท่านั้น)
if (import.meta.env.DEV) (window as unknown as { __wk: unknown }).__wk = { save, H, openHearts, openOffer, renderHearts, loadLevel, adsOn, Ads, writeSave, Account, requireLogin, openProfile, renderAccount };
Billing.init({ onGrant, onRevoked, shouldRestore }).catch(() => {});
