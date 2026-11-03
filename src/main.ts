import {
  parseRoom, newRound, step, tapCell, toGhost, useSkill, starsFor,
  ACTIVE_SKILLS, MAX_GHOSTS, TICKS, TICK_MS, type Ghost, type Room, type Round, type SkillId,
} from "./core/sim";
import { LEVELS } from "./core/levels";
import { genTower } from "./core/tower";
import { loadSave, writeSave, earnedStars, starsLeft, type SaveData } from "./core/save";
import { BR, ICON, NODES, nodeById } from "./core/skills";
import { createBoard, COL, type Quality } from "./render/board";
import { initTree, openTree } from "./ui/tree";
import { initAnalytics, track } from "./platform/analytics";
import { HEARTS, payToPlay, refreshDay, unlimited, addUnlimited, roomIsFree, clearedCount, dailyHearts } from "./core/hearts";
import { Ads, isNative } from "./platform/ads";
import { Billing, type GrantEvent } from "./platform/billing";
import { Account, cleanName, NAME_MIN } from "./platform/account";
import type { ProductId } from "./platform/products";
import { Boards, type Row } from "./platform/boards";
import { weekId, monthId, weekEndsAt, monthEndsAt, REWARD_TIERS, BOARD_SIZE } from "./core/season-rules";
import { SIM_VERSION, type Proof, type ProofRound, type Op } from "./core/proof";
import { version as APP_VERSION } from "../package.json";
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
let soundOn = true;
try { const st = JSON.parse(localStorage.getItem(QKEY) || "{}"); qSetting = st.quality || "auto"; soundOn = st.sound !== false; } catch { /* ใช้ค่าเริ่มต้น */ }
const saveSettings = () => { try { localStorage.setItem(QKEY, JSON.stringify({ quality: qSetting, sound: soundOn })); } catch { /* ไม่เป็นไร */ } };
const quality = (): Quality => (qSetting === "auto" ? qAuto : qSetting);
let slowFrames = 0, lastFrame = 0;

// ---------- เสียง (Web Audio) ----------
let ac: AudioContext | null = null;
function unlockAudio() { if (!ac) { try { ac = new AudioContext(); } catch { /* ไม่มีเสียงก็เล่นได้ */ } } }
function note(f: number, dur: number, type: OscillatorType = "sine", vol = .12) {
  if (!ac || !soundOn) return;
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
  $("helpPop").hidden = true;
  proof = { v: 1, sv: SIM_VERSION, kind: i < 0 ? "t" : "r", n: i < 0 ? save.tower.floor : i, eq: [...save.skills.eq], rounds: [] };
  renderSkillBar();
  startRound();
}

// ---------- หลักฐานการชนะ (src/core/proof.ts) ----------
// จดทุกการแตะ/สกิล/การปรับเงาของห้องนี้ · ชนะห้อง/ชั้นใหม่ → ส่งให้ server เล่นซ้ำแล้วให้แต้มอันดับ (functions/wins.js)
let proof: Proof = { v: 1, sv: SIM_VERSION, kind: "r", n: 0, eq: [null, null], rounds: [] };
const proofRound = (): ProofRound => {
  const last = proof.rounds[proof.rounds.length - 1];
  if (last && !last.inp.length) return last;
  const rd: ProofRound = { ops: [], inp: [] };
  proof.rounds.push(rd);
  return rd;
};
const proofOp = (op: Op) => proofRound().ops.push(op);

function startRound() {
  clearTimeout(zapTimer);
  r = newRound(room, ghosts); phase = "ready"; flash = null;
  proofRound();
  $("gmenu").hidden = true;
  updateHud();
  // คำใบ้บรรทัดเดียวขึ้นครั้งแรกที่เปิดห้องนี้ (ต่อการเปิดแอป) · ดูซ้ำ/อ่านเต็มได้ที่ปุ่ม ?
  const key = levelIdx < 0 ? `t${save.tower.floor}` : String(levelIdx);
  if (ghosts.length === 0 && screen === "play" && !tipSeen.has(key)) { tipSeen.add(key); banner(room.def.tip ?? ""); }
  else banner(ghosts.length ? `รอบ <b>${ghosts.length + 1}</b> · แตะเพื่อเดิน` : "");
}
const tipSeen = new Set<string>();

// ปุ่ม ?: คำอธิบายเต็มของห้อง + สกิลแนะนำ + วิธีปรับเงา (ข้อมูลห้องเขียนในโค้ด ไม่ใช่ข้อความผู้เล่น)
function openHelp() {
  const sk = room.def.skill ? nodeById(room.def.skill) : null;
  $("helpText").innerHTML = room.def.hint;
  $("helpMore").textContent = [
    sk ? `สกิลแนะนำ: ${sk.name} · ${has(sk.id) ? "ติดตัวอยู่" : save.skills.owned.includes(sk.id) ? "ปลดล็อกแล้ว ไปติดตัวที่ต้นไม้สกิล" : "ยังไม่มี ผ่านด้วยเงาได้ (ดาวน้อยลง)"}` : "",
    ghosts.length ? "วงประ = ที่ที่เงาจะอยู่ตอนคุณไปถึง · แตะจุดสีมุมขวาบนเพื่อปรับเงา" : "",
    `3 ดาวเมื่อใช้เงาไม่เกิน ${room.def.par} ตัว`,
  ].filter(Boolean).join("\n");
  $("helpPop").hidden = false;
}
$("btnHelp").onclick = () => { if ($("helpPop").hidden) openHelp(); else $("helpPop").hidden = true; };
$("helpPop").onclick = () => { $("helpPop").hidden = true; };
$("banner").onclick = () => banner("");

function endRound(why: string) {
  if (ghosts.length >= MAX_GHOSTS) {
    ghosts = []; H.attempt = null; writeSave(save); startRound();
    banner(`เงาครบ ${MAX_GHOSTS} · เริ่มห้องใหม่`);   // ค่าหัวใจดูจากป้ายบนปุ่มเริ่มใหม่
    return;
  }
  ghosts.push(toGhost(r));
  note(330, .25);
  startRound();
}

function onZap() {
  phase = "zap"; flash = { color: COL.laser, at: performance.now() };
  note(110, .35, "sawtooth", .08);
  banner("โดนเลเซอร์! กลายเป็นเงา");
  zapTimer = window.setTimeout(() => endRound("โดนเลเซอร์"), 750);
}

function onWin() {
  phase = "win"; flash = { color: COL.exit, at: performance.now() };
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => note(f, .25), i * 110));
  const n = ghosts.length, par = room.def.par, stars = starsFor(n, par);
  const before = clearedCount(save), starsBefore = earnedStars(save);
  H.attempt = null;
  if (levelIdx >= 0) save.best[levelIdx] = Math.max(save.best[levelIdx] || 0, stars);
  else save.tower.best = Math.max(save.tower.best, save.tower.floor);
  lastWinFirst = clearedCount(save) > before;
  if (!lastWinFirst) replayWins++;
  writeSave(save);
  if (adsOn() && before < HEARTS.adsAfterCleared) Ads.showBanner();
  track("level_complete", { level: levelIdx < 0 ? "tower" : String(levelIdx + 1), floor: levelIdx < 0 ? save.tower.floor : 0, ghosts: n, par, stars, skills: save.skills.eq.filter(Boolean).join("+") || "none" });
  const gained = earnedStars(save) - starsBefore;
  if (levelIdx >= 0) {
    $("winStars").innerHTML = [0, 1, 2].map(k => ic(k < stars ? "star" : "star0")).join("");
    $("winTitle").textContent = n < par ? "เหนือชั้น!" : "ผ่านแล้ว";
    $("winMsg").textContent = `ห้อง ${levelIdx + 1} · ${room.def.name}`;
    $("btnNextT").textContent = levelIdx < LEVELS.length - 1 ? "ด่านต่อไป" : "ไปหอคอย ∞";
    $("btnWinOut").innerHTML = `${ic("map")}<span>แผนที่</span>`;
  } else {
    $("winStars").innerHTML = ic("tower", "xl");
    $("winTitle").textContent = `ชั้น ${save.tower.floor} สำเร็จ`;
    $("winMsg").textContent = "หอคอย ∞";
    $("btnNextT").textContent = "ขึ้นชั้นต่อไป";
    $("btnWinOut").innerHTML = `${ic("home")}<span>หน้าแรก</span>`;
  }
  $("winBest").hidden = !(levelIdx < 0 && lastWinFirst);
  // ชิปรางวัล: ดาวที่ได้เพิ่ม · จำนวนเงาที่ใช้ (เทียบเป้า) · แต้มอันดับ (ขึ้นเมื่อ server นับแล้ว)
  $("winChips").innerHTML = `<div class="chip">${ic("star")}<span>+${gained}</span></div>`
    + `<div class="chip" title="เป้า 3 ดาว: ใช้เงาไม่เกิน ${par}">${ic("ghost", "s")}<span>${n} เงา</span><small>/ ${par}</small></div>`
    + `<div class="chip" id="winPts" hidden>${ic("trophy", "s")}<span>+1 อันดับ</span></div>`;
  if (lastWinFirst) submitWin();
  $("win").hidden = false;
  banner(""); updateHud();
}

function tick() {
  const ev = step(room, ghosts, r);
  for (const f of ev.fresh) note(f === "p" ? 392 : NOTES[f % 4], .18);
  if (ev.cloneLost) { note(110, .3, "sawtooth", .06); banner("ดวงที่ 2 โดนลำแสง"); updateHud(); }
  if (ev.cloneExpired) { banner("ดวงที่ 2 ดับแล้ว"); updateHud(); }
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
  proofRound().inp.push([r.t, "tap", p[0], p[1]]);
  if (phase === "ready") { phase = "run"; last = performance.now(); banner(""); $("helpPop").hidden = true; updateHud(); }
});
$("btnEnd").onclick = () => { if (phase === "run") { proofRound().inp.push([r.t, "end"]); r.outcome = "timeout"; endRound("จบรอบเอง"); } };
$("btnUndo").onclick = () => { if (phase === "ready" && ghosts.length) { proofOp(["undo"]); ghosts.pop(); startRound(); } };
$("btnReset").onclick = () => loadLevel(levelIdx);
$("btnRetry").onclick = async () => { await afterWin(); loadLevel(levelIdx); };
$("btnNext").onclick = async () => {
  await afterWin();
  if (levelIdx < 0) { save.tower.floor++; writeSave(save); loadLevel(-1); }
  else loadLevel(levelIdx < LEVELS.length - 1 ? levelIdx + 1 : -1);
};
// ออกจากหน้าผล: ห้อง → แผนที่ · หอคอย → หน้าแรก
$("btnWinOut").onclick = async () => {
  await afterWin();
  $("win").hidden = true;
  if (levelIdx < 0) { save.tower.floor++; writeSave(save); show("home"); } else show("map");
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
  $("tbHeartsN").textContent = inf ? "∞" : String(H.n);
  $("hearts").classList.toggle("empty", !inf && H.n <= 0);
  $("hearts").classList.toggle("unl", inf);
  $("hearts").setAttribute("aria-label", inf ? `หัวใจไม่จำกัด เหลือเวลา ${timeLeft(H.until - Date.now())} ชั่วโมง` : `หัวใจ ${H.n} ดวง`);
  // เริ่มห้องใหม่ที่ต้องจ่ายหัวใจ: ป้ายหัวใจ 1 ที่มุมปุ่มแทนข้อความ
  const cost = needsHeartNow() && !!H.attempt;
  const rc = $("resetCost");
  if (rc.hidden === cost) { rc.hidden = !cost; $("btnReset").setAttribute("aria-label", cost ? "เริ่มห้องใหม่ ใช้หัวใจ 1 ดวง" : "เริ่มห้องใหม่"); }
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
  const inf = unlimited(H), daily = dailyHearts(H);
  $("hTitle").textContent = hEmpty && !inf && H.n <= 0 ? "หัวใจหมดแล้ว" : "หัวใจและร้าน";
  $("hBig").innerHTML = inf ? `<span class="inf">${ic("heart", "l")}∞<small>เหลือ ${timeLeft(H.until - Date.now())} ชม.</small></span>`
    : Array.from({ length: Math.max(daily, H.n) }, (_, k) => ic("heart", k < H.n ? "" : "off")).join("");
  $("hBig").setAttribute("aria-label", inf ? "หัวใจไม่จำกัด" : `หัวใจ ${H.n} จาก ${daily} ดวงต่อวัน`);
  $("hText").textContent = "ห้อง/ชั้นใหม่ใช้ 1 ดวงต่อการเริ่ม · ห้องที่ผ่านแล้วและห้อง 1–2 ฟรี";
  const adLeft = HEARTS.adPerDay - H.ad;
  // ดูโฆษณาได้เฉพาะตอนหัวใจหมด (หัวใจจึงไม่เกินเพดาน 8) และวันละ 3 ครั้ง
  $("hAdRow").hidden = !Ads.available || inf || H.n > 0;
  $<HTMLButtonElement>("hAd").disabled = adLeft <= 0;
  $("hAdLeft").textContent = adLeft > 0 ? `วันนี้เหลือ ${adLeft} ครั้ง` : "วันนี้ดูครบ 3 ครั้งแล้ว";
  $("hUnlRow").hidden = !Billing.available;
  priceTag("hUnl", "hUnlPrice", "unlimited_hearts_2h");
  $("hNoAdsRow").hidden = !Billing.available || H.noAds;
  priceTag("hNoAds", "hNoAdsPrice", "remove_ads");
  $("hRestore").hidden = !Billing.available;
  $("hWait").hidden = inf;
}

// ราคาจาก Play (Billing.prices อัปเดตเมื่อ Play ส่งราคามา) · สินค้าที่ Play ไม่มี/ต่อไม่ได้ขึ้นป้ายบอก ปุ่มยังกดได้เพื่อบอกเหตุผล
const STATUS_TAG: Record<string, string> = { loading: "กำลังโหลด…", missing: "ยังไม่เปิดขาย", offline: "ต่อ Play ไม่ได้" };
function priceTag(btnId: string, tagId: string, id: ProductId) {
  const st = Billing.status(id);
  $(tagId).textContent = st === "ready" ? Billing.priceOf(id) : STATUS_TAG[st];
  $(btnId).classList.toggle("off", st !== "ready");
}
Billing.onChange = () => {
  if (!$("heartsOv").hidden) renderHeartsPanel();
  if (!$("offerOv").hidden) offerLabel();
};

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
  toast(ok ? "กู้คืนการซื้อแล้ว" : isNative && Billing.storeState !== "ready" ? BUY_FAIL[Billing.storeState] : Billing.pending.size ? "ยังตรวจใบเสร็จไม่ได้ จะลองใหม่อัตโนมัติ" : "ไม่พบการซื้อที่กู้คืนได้");
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
  offerLabel();
  $("offerOv").hidden = false;
  return new Promise<void>(res => { offerDone = res; });
}
function offerLabel() {
  const st = Billing.status("unlimited_hearts_2h");
  $("oBuy").textContent = st === "ready" ? `ซื้อ ${Billing.priceOf("unlimited_hearts_2h")}` : STATUS_TAG[st];
  $("oBuy").classList.toggle("off", st !== "ready");
}
function closeOffer() { $("offerOv").hidden = true; offerDone?.(); offerDone = null; }
$("oLater").onclick = () => { track("offer", { product: "unlimited_hearts_2h", action: "later" }); closeOffer(); };
$("oBuy").onclick = async () => { await buy("unlimited_hearts_2h", "oBuy"); if (unlimited(H)) closeOffer(); };

// ---------- การซื้อ: ของทุกชิ้นมาจาก server หลังตรวจใบเสร็จ (platform/billing.ts) ----------
const BUY_FAIL: Record<string, string> = {
  missing: "สินค้านี้ยังไม่เปิดขายใน Google Play ลองใหม่ภายหลัง",
  loading: "กำลังโหลดร้านจาก Google Play รอสักครู่แล้วลองใหม่",
  offline: "เชื่อมต่อ Google Play ไม่ได้ ตรวจเน็ตและบัญชี Play Store แล้วลองใหม่",
  signin: "ต้องต่อเน็ตเพื่อสร้างบัญชีก่อนซื้อ ลองใหม่อีกครั้ง",
  cancelled: "",
  failed: "ซื้อไม่สำเร็จ ลองใหม่อีกครั้ง",
};
async function buy(id: ProductId, btnId: string) {
  const b = $<HTMLButtonElement>(btnId);
  b.disabled = true;
  track("offer", { product: id, action: "buy_tap" });
  const ok = await Billing.buy(id).catch(() => { Billing.lastError = "failed"; return false; });
  b.disabled = false;
  if (!ok) { const m = BUY_FAIL[Billing.lastError ?? "failed"]; if (m) toast(m); }
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
  proofRound().inp.push([r.t, "sk", id]);
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

// หน้าล็อกอิน + ตั้งชื่อ (แบบ LumiFlip openLogin/renderLogin/readName/submitLogin/signInGoogle)
// signIn = เลือก Google หรือผู้เยี่ยมชม (+ตั้งชื่อ) · name = เข้าแล้วแต่ยังไม่มีชื่อ (เช่น เครื่องที่เข้าก่อนมีช่องชื่อ) · rename = เปลี่ยนชื่อจากหน้าบัญชี
// signIn/name ปิดเองไม่ได้จนกว่าจะเสร็จ · ชื่อเก็บด้วย Account.setName (localStorage แยกจากเซฟ) · แสดงด้วย textContent เท่านั้น
type LoginMode = "signIn" | "name" | "rename";
let loginMode: LoginMode = "signIn";
const nameInput = $<HTMLInputElement>("nameInput");

function openLogin(mode: LoginMode) {
  loginMode = mode;
  gateOpen = mode !== "rename";
  nameInput.value = mode === "rename" ? Account.name() ?? "" : mode === "name" ? cleanName(Account.user?.name) : "";
  showNameError(null);
  const signIn = mode === "signIn";
  $("lgBrand").hidden = !signIn;
  $("lgTitle").hidden = signIn;
  $("lgTitle").textContent = mode === "rename" ? "เปลี่ยนชื่อเล่น" : "ตั้งชื่อเล่นก่อนเล่นต่อ";
  $("loginText").hidden = $("loginGoogle").hidden = $("loginNote").hidden = !signIn;
  $("guestBtn").textContent = signIn ? "เริ่มเล่นเลย" : "บันทึก";
  $("loginClose").hidden = mode !== "rename";
  $("profileOv").hidden = true;
  $("login").hidden = false;
  if (signIn) Account.preload();
}
function requireLogin() { openLogin(Account.hint() && Account.user ? "name" : "signIn"); }
function closeLogin() { gateOpen = false; $("login").hidden = true; }

function showNameError(msg: string | null) {
  $("nameError").textContent = msg ?? "";
  $("nameError").hidden = !msg;
  nameInput.setAttribute("aria-invalid", msg ? "true" : "false");
}
function readName(): string | null {
  const name = cleanName(nameInput.value);
  if (name.length >= NAME_MIN) return name;
  showNameError(name ? `ชื่อต้องยาวอย่างน้อย ${NAME_MIN} ตัวอักษร` : "กรุณาตั้งชื่อก่อนเริ่มเล่น");
  nameInput.focus();
  return null;
}

function setLoginBusy(busy: boolean) {
  for (const id of ["googleBtn", "guestBtn", "loginClose"]) $<HTMLButtonElement>(id).disabled = busy;
}

// ข้อความตอนเข้าด้วย Google ไม่สำเร็จ: แนบรหัสสั้น ๆ ช่วยหาสาเหตุบนเครื่องจริง (เช่น SHA-1 ไม่ตรง = DEVELOPER_ERROR / 10)
function googleFailMsg(err: unknown) {
  const e = err as { code?: string; message?: string };
  const raw = `${e?.code ?? ""} ${e?.message ?? ""}`;
  if (/cancel/i.test(raw)) return "ยกเลิกการเข้าด้วย Google";
  const code = (e?.code || e?.message || "").replace(/\s+/g, " ").slice(0, 48);
  return code ? `เข้าด้วย Google ไม่สำเร็จ (${code})` : "เข้าด้วย Google ไม่สำเร็จ ลองใหม่อีกครั้ง";
}

function finishLogin(name: string) {
  Account.setName(name);
  closeLogin();
  renderAccount();
}

async function submitLogin() {
  if ($<HTMLButtonElement>("guestBtn").disabled) return;
  const name = readName();
  if (!name) return;
  if (loginMode !== "signIn") {
    finishLogin(name);
    return toast(loginMode === "rename" ? "บันทึกชื่อแล้ว" : `ยินดีต้อนรับ ${name}`);
  }
  unlockAudio();
  setLoginBusy(true);
  try {
    const res = await Account.signIn("guest");
    finishLogin(name);
    toast(res === "offline" ? "ยังไม่มีเน็ต เล่นไปก่อนได้เลย จะสร้างบัญชีให้เมื่อต่อเน็ต" : `ยินดีต้อนรับ ${name}`);
    if (Billing.pending.size) Billing.retryPending().catch(() => 0);
  } catch {
    toast("เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง");
  } finally {
    setLoginBusy(false);
  }
}

// Google: ใช้ชื่อที่พิมพ์ไว้ถ้าถูกกติกา ไม่งั้นใช้ชื่อจาก Google (เปลี่ยนทีหลังได้ในหน้าบัญชี)
async function signInGoogle() {
  if ($<HTMLButtonElement>("googleBtn").disabled) return;
  unlockAudio();
  setLoginBusy(true);
  try {
    await Account.signIn("google");
    const typed = cleanName(nameInput.value), google = cleanName(Account.user?.name);
    const name = typed.length >= NAME_MIN ? typed : google.length >= NAME_MIN ? google : "ภูติน้อย";
    finishLogin(name);
    toast(`ยินดีต้อนรับ ${name}`);
    if (Billing.pending.size) Billing.retryPending().catch(() => 0);
  } catch (err) {
    toast(googleFailMsg(err));
  } finally {
    setLoginBusy(false);
  }
}
$("loginForm").onsubmit = e => { e.preventDefault(); submitLogin(); };
$("googleBtn").onclick = signInGoogle;
$("loginClose").onclick = () => { if (loginMode === "rename") closeLogin(); };
nameInput.oninput = () => { if (!$("nameError").hidden) showNameError(null); };

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
      : googleFailMsg(err).replace("เข้าด้วย", "ผูก"));
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
  Account.setName(null);   // แบบ LumiFlip: ชื่อเป็นของบัญชีเดิม · หน้าล็อกอินขอชื่อใหม่
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

function avatarInto(el: HTMLElement) {
  const photo = Account.user?.photo;
  if (photo) {
    // รูปจาก Google: ตั้งผ่าน property (ไม่ใช้ innerHTML กับข้อมูลจากบัญชี)
    const img = document.createElement("img");
    img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = photo;
    img.onerror = () => { el.innerHTML = SPIRIT_SVG; };
    el.replaceChildren(img);
  } else el.innerHTML = SPIRIT_SVG;
}

function renderAccount() {
  const u = Account.user, offline = Account.hint() === "offline";
  avatarInto($("pAvatar")); avatarInto($("tbAvatar"));
  $("pName").textContent = Account.name() ?? (cleanName(u?.name) || (u?.google ? "ผู้เล่น Google" : "ผู้เยี่ยมชม"));
  $("pType").innerHTML = u?.google ? `${ic("link", "s")}<span></span>` : "<span></span>";
  $("pType").querySelector("span")!.textContent = u ? (u.google ? "ผูก Google แล้ว" : "ผู้เยี่ยมชม") : offline ? "ผู้เยี่ยมชม · รอเน็ต" : "";
  const stat = (icon: string, val: string, label: string) => `<div class="stat">${ic(icon, "l")}<div><b>${val}</b><small>${label}</small></div></div>`;
  const rooms = Object.keys(save.best).filter(k => Number(k) < LEVELS.length).length;
  $("pStats").innerHTML = stat("gate", `${rooms}/${LEVELS.length}`, "ห้องที่ผ่าน") + stat("star", String(earnedStars(save)), "ดาวสะสม")
    + stat("tower", `ชั้น ${save.tower.best}`, "หอคอยสูงสุด") + stat("trophy", weekRank ? `#${weekRank}` : "–", "อันดับสัปดาห์");
  $("pLink").hidden = !u || u.google;
  $("pNote").textContent = u && !u.google
    ? "ผูก Google แล้วยังเป็นบัญชีเดิม ไม่หายเมื่อลบแอป และรับรางวัลอันดับได้ · ความคืบหน้าในเกมเก็บไว้ในเครื่องนี้"
    : "ความคืบหน้าในเกมเก็บไว้ในเครื่องนี้ ออกจากระบบแล้วก็ยังอยู่";
  $("pDelete").hidden = !u;
}

function openProfile() { renderAccount(); $("profileOv").hidden = false; }
$("pClose").onclick = () => { $("profileOv").hidden = true; };
$("pRename").onclick = () => openLogin("rename");
$("pLink").onclick = linkGoogle;
$("pSignOut").onclick = signOut;
$("pDelete").onclick = deleteAccount;
Account.onChange = () => { renderAccount(); if (Account.user) { flushWins(); claimSeasons(); } };

// ---------- ไอคอน UI (symbol จาก docs/ui-mockup/ux-v2 ใน index.html) ----------
function ic(name: string, cls = "") { return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }

// ---------- หน้าจอ: หน้าแรก / แผนที่ / หน้าเล่น / ต้นไม้ + เมนูล่าง ----------
type Screen = "home" | "map" | "play" | "tree";
let screen: Screen = "home";
function show(to: Screen) {
  screen = to;
  for (const [id, sc] of [["scrHome", "home"], ["scrMap", "map"], ["scrPlay", "play"], ["scrTree", "tree"]] as const) $(id).hidden = sc !== to;
  document.body.classList.toggle("playing", to === "play");
  for (const b of $("nav").querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.nav === to);
  if (to === "tree") {
    // ต้นไม้วางระหว่างแถบบนกับเมนูล่าง (วัดจริง เพราะ safe-area/แบนเนอร์ต่างกันแต่ละเครื่อง)
    const de = document.documentElement.style;
    de.setProperty("--top-h", `${$("topbar").getBoundingClientRect().bottom + 8}px`);
    de.setProperty("--nav-h", `${window.innerHeight - $("nav").getBoundingClientRect().top + 4 - (parseFloat(getComputedStyle(document.body).paddingBottom) || 0)}px`);
    openTree();
  } else $("treeOv").hidden = true;
  if (to !== "play") { $("win").hidden = true; $("gmenu").hidden = true; }
  renderTop();
  if (to === "home") renderHome();
  if (to === "map") renderMap();
}
for (const b of $("nav").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => (b.dataset.nav === "rank" ? openRank() : show(b.dataset.nav as Screen));
const play = (i: number) => { show("play"); loadLevel(i); };
$("btnBack").onclick = () => show(levelIdx < 0 ? "home" : "map");
$("btnGear").onclick = openSettings;

// แถบบน: รูป · หัวใจ (+ ไปร้าน) · ดาวที่ใช้ได้ · ร้าน · ตั้งค่า
function canBuySkill() { const left = starsLeft(save); return NODES.some(n => !save.skills.owned.includes(n.id) && n.req.every(q => save.skills.owned.includes(q)) && n.cost > 0 && n.cost <= left); }
function renderTop() {
  $("tbStars").textContent = String(starsLeft(save));
  const dot = canBuySkill();
  $("navTreeDot").hidden = !dot;
  $("homeTreeDot").hidden = !dot;
}
$("tbAvatar").onclick = openProfile;
$("tbHearts").onclick = () => openHearts(false);
$("tbShop").onclick = () => openHearts(false);
$("tbSettings").onclick = openSettings;

// ---------- หน้าแรก ----------
const nextRoom = () => { for (let i = 0; i < LEVELS.length; i++) if (!save.best[i]) return i; return -1; };
function renderHome() {
  const nx = nextRoom();
  $("homePlayT").textContent = clearedCount(save) ? "เล่นต่อ" : "เริ่มเล่น";
  $("homePlayS").textContent = nx < 0 ? `หอคอย ∞ · ชั้น ${save.tower.floor}` : `ห้อง ${nx + 1} · ${LEVELS[nx].name}`;
  $("homeMapN").textContent = `${Object.keys(save.best).filter(k => Number(k) < LEVELS.length).length}/${LEVELS.length}`;
  $("homeTowerN").textContent = `ชั้น ${save.tower.floor}`;
  $("homeTreeN").textContent = String(starsLeft(save));
  $("homeRankS").textContent = weekRank ? `ที่ ${weekRank} สัปดาห์นี้` : "รางวัลหัวใจ";
  $("homeShopS").textContent = unlimited(H) ? "ไม่จำกัดอยู่" : `เหลือ ${H.n} ดวง`;
}
$("homePlay").onclick = () => { unlockAudio(); play(nextRoom()); };
$("homeMap").onclick = () => show("map");
$("homeTower").onclick = () => { unlockAudio(); play(-1); };
$("homeTree").onclick = () => show("tree");
$("homeRank").onclick = () => openRank();
$("homeShop").onclick = () => openHearts(false);

// ---------- แผนที่: ทางเดินโคมไฟ (บท 1 = ห้อง 1–5 · บท 2 = ห้อง 6–13 · บท 3 = เร็ว ๆ นี้) ----------
const CHAPTERS = [
  { name: "บทที่ 1 · พื้นฐาน", icon: "gate", from: 0, to: 4 },
  { name: "บทที่ 2 · สกิล", icon: "tree", from: 5, to: LEVELS.length - 1 },
];
const MAP_STEP = 96, MAP_CHAP = 88, MAP_XS = [0.5, 0.74, 0.3, 0.7, 0.36, 0.5, 0.28, 0.72, 0.4, 0.7, 0.3, 0.62, 0.5];
let mapBuilt = "";
function renderMap() {
  const box = $("mapInner"), W = Math.min($("mapScroll").clientWidth || 360, 560);
  const sig = `${W}|${JSON.stringify(save.best)}`;
  if (sig === mapBuilt) return scrollMapToCurrent();
  mapBuilt = sig;
  const nx = nextRoom();
  // ห้องแรกอยู่ล่างสุด: วางจากล่างขึ้นบน · หัวบทอยู่เหนือห้องของบทนั้น
  const pos: [number, number][] = [];
  let y = 90;
  const chapY: number[] = [];
  CHAPTERS.forEach(ch => {
    for (let i = ch.from; i <= ch.to; i++) { pos[i] = [Math.round(W * MAP_XS[i % MAP_XS.length]), y]; y += MAP_STEP; }
    chapY.push(y - 20); y += MAP_CHAP;
  });
  const soonY = y + 10, H = soonY + 120;
  const Y = (v: number) => H - v;
  let d = "", lit = "";
  for (let i = 0; i < pos.length; i++) {
    const [x, yy] = pos[i];
    if (!i) { d = `M ${x} ${Y(yy)}`; continue; }
    const [px, py] = pos[i - 1], my = (Y(py) + Y(yy)) / 2, seg = ` C ${px} ${my}, ${x} ${my}, ${x} ${Y(yy)}`;
    d += seg;
    if (save.best[i - 1] && (save.best[i] || i === nx)) lit += (lit ? "" : `M ${px} ${Y(py)}`) + seg;
  }
  const nodes = pos.map(([x, yy], i) => {
    const done = !!save.best[i], cur = i === nx, lock = !done && !cur;
    const def = LEVELS[i], sk = def.skill ? nodeById(def.skill) : null;
    const badge = sk ? `<span class="badge"><svg viewBox="0 0 24 24" style="color:${BR[sk.br].c}">${ICON[sk.icon]}</svg></span>` : "";
    const st = done ? `<span class="stars">${[0, 1, 2].map(k => ic(k < save.best[i] ? "star" : "star0")).join("")}</span>` : "";
    const you = cur ? `<svg class="you" viewBox="-16 -26 32 44" aria-hidden="true"><use href="#wkHero"/></svg>` : "";
    const fin = i === CHAPTERS[0].to || i === LEVELS.length - 1 ? " fin" : "";
    return `<button class="node${lock ? " lock" : ""}${cur ? " cur" : ""}${fin}" data-room="${i}" style="left:${x}px;top:${Y(yy)}px" aria-label="ห้อง ${i + 1} ${def.name}${lock ? " (ล็อก)" : ""}">${lock ? ic("lock") : i + 1}${badge}${st}${you}</button>`;
  }).join("");
  const stars = (from: number, to: number) => { let n = 0; for (let i = from; i <= to; i++) n += save.best[i] || 0; return `${ic("star", "s")}${n}/${(to - from + 1) * 3}`; };
  const chaps = CHAPTERS.map((ch, k) => `<div class="chap" style="top:${Y(chapY[k]) - 26}px">${ic(ch.icon, "l")}${ch.name}<small>${stars(ch.from, ch.to)}</small></div>`).join("")
    + `<div class="chap soon" style="top:${Y(soonY) - 26}px">${ic("fog", "l")}บทที่ 3<small>เร็ว ๆ นี้</small></div>`;
  box.style.width = `${W}px`; box.style.height = `${H}px`;
  box.innerHTML = `<svg class="path" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <path d="${d}" fill="none" stroke="#1b1430" stroke-width="12" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="#7c6ea6" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 13" opacity=".7"/>
      ${lit ? `<path d="${lit}" fill="none" stroke="#ffb13b" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 13"/>` : ""}
    </svg>${chaps}${nodes}<div class="map-fog"></div>`;
  for (const b of box.querySelectorAll<HTMLButtonElement>(".node")) b.onclick = () => {
    const i = Number(b.dataset.room);
    if (b.classList.contains("lock")) return toast("ผ่านห้องก่อนหน้าก่อนนะ");
    unlockAudio(); play(i);
  };
  scrollMapToCurrent();
}
function scrollMapToCurrent() {
  const cur = $("mapInner").querySelector<HTMLElement>(".node.cur") ?? $("mapInner").querySelector<HTMLElement>(".node:not(.lock):last-of-type");
  const sc = $("mapScroll");
  sc.scrollTop = cur ? Math.max(0, cur.offsetTop - sc.clientHeight * 0.55) : sc.scrollHeight;
}

// ---------- อันดับ (หน้าตา/รอบ/รางวัลแบบ LumiFlip · แต้มจาก server เท่านั้น) ----------
let rankScope: "week" | "month" | "all" = "week", rankLoad = 0, weekRank = 0;
const SCOPES = { week: { id: () => weekId(), ends: weekEndsAt, tier: "W" }, month: { id: () => monthId(), ends: monthEndsAt, tier: "M" }, all: { id: () => "all", ends: null, tier: "" } } as const;
function openRank() {
  $("rankOv").hidden = false;
  flushWins();
  claimSeasons();
  loadRank();
}
$("rankClose").onclick = () => { $("rankOv").hidden = true; };
for (const b of $("rankSeg").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => { rankScope = b.dataset.scope as typeof rankScope; loadRank(); };
async function loadRank() {
  const load = ++rankLoad, sc = SCOPES[rankScope];
  for (const b of $("rankSeg").querySelectorAll<HTMLButtonElement>("button")) { b.classList.toggle("on", b.dataset.scope === rankScope); b.setAttribute("aria-checked", String(b.dataset.scope === rankScope)); }
  // รางวัลหัวใจ (สัปดาห์/เดือน) + เวลาที่เหลือ
  const tiers = sc.tier ? REWARD_TIERS[sc.tier] : [];
  let from = 1;
  $("rankPrizes").hidden = !tiers.length;
  $("rankPrizes").innerHTML = tiers.map(([upto, hearts], k) => {
    const label = from === upto ? `ที่ ${upto}` : `${from}–${upto}`; from = upto + 1;
    return `<div>${k < 3 ? `<span class="medal ${["g", "s", "b"][k]}" style="width:22px;height:22px;font-size:11px">${k + 1}</span>` : ""}<span>${label}</span><b>${ic("heart")}${hearts}</b></div>`;
  }).join("");
  if (sc.ends) { const h = Math.max(1, Math.ceil((sc.ends() - Date.now()) / 3600e3)); $("rankEnds").innerHTML = `${ic("clock", "s")}<span>เหลือ ${h >= 48 ? `${Math.ceil(h / 24)} วัน` : `${h} ชม.`}</span>`; }
  else $("rankEnds").innerHTML = `${ic("clock", "s")}<span>ไม่รีเซ็ต</span>`;
  const list = $("rankList");
  const note = (msg: string) => { const li = document.createElement("li"); li.className = "note"; li.textContent = msg; list.replaceChildren(li); };
  $("rankMine").hidden = true;
  if (!Account.user) return note("เชื่อมต่อเน็ตเพื่อดูอันดับ");
  note("กำลังโหลด…");
  try {
    const id = sc.id();
    const [rows, mine] = await Promise.all([Boards.top(id), Boards.mine(id)]);
    const meIn = rows.findIndex(x => x.uid === Account.user?.uid);
    const myRank = mine > 0 ? (meIn >= 0 ? meIn + 1 : await Boards.rank(id, mine)) : 0;
    if (load !== rankLoad) return;
    if (rankScope === "week") { weekRank = myRank; renderHome(); }
    renderRankRows(rows, mine, myRank);
  } catch {
    if (load === rankLoad) note("โหลดอันดับไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
  }
}
// ชื่อผู้เล่นคนอื่นมาจาก server → textContent เท่านั้น (กฎกันแฮกข้อ 7)
function renderRankRows(rows: Row[], mine: number, myRank: number) {
  const list = $("rankList"), me = Account.user?.uid;
  if (!rows.length) { const li = document.createElement("li"); li.className = "note"; li.textContent = "ยังไม่มีใครขึ้นกระดานนี้ ชนะห้องใหม่เพื่อเป็นคนแรก!"; list.replaceChildren(li); }
  else list.replaceChildren(...rows.slice(0, BOARD_SIZE).map((row, k) => {
    const li = document.createElement("li");
    li.className = (k < 3 ? `t${k + 1}` : "") + (row.uid === me ? " me" : "");
    li.innerHTML = (k < 3 ? `<span class="medal ${["g", "s", "b"][k]}">${k + 1}</span>` : `<span class="rk">${k + 1}</span>`)
      + `<span class="nm"></span><span class="sc">${ic("star", "s")}<span></span></span>`;
    li.querySelector(".nm")!.textContent = row.name;
    li.querySelector(".sc span")!.textContent = String(row.score);
    return li;
  }));
  // แถบของเรา ค้างใต้รายการเสมอ
  $("rankMine").hidden = mine <= 0;
  $("rankMineN").textContent = myRank ? String(myRank) : "–";
  $("rankMineName").textContent = `${Account.name() ?? "คุณ"} (คุณ)`;
  $("rankMinePts").textContent = String(mine);
}

// ส่งหลักฐานการชนะ: ห้อง/ชั้นใหม่เท่านั้น · เซฟที่ถูกแก้/เคยใช้ดาวทดสอบไม่ส่ง (กฎกันแฮกข้อ 5) · ส่งห่างกัน ≥ 30 วิ
let lastFlush = 0, flushTimer = 0;
function submitWin() {
  if (save.lb.flagged || save.lb.debug || !Account.name()) return;
  Boards.enqueue(JSON.parse(JSON.stringify(proof)) as Proof, Account.name()!);
  flushWins(true);
}
function flushWins(fromWin = false) {
  if (!Boards.queue().length || !Account.user) return;
  clearTimeout(flushTimer);
  const wait = Math.max(0, lastFlush + 30_000 - Date.now());
  flushTimer = window.setTimeout(async () => {
    lastFlush = Date.now();
    const got = await Boards.flush().catch(() => 0);
    if (got > 0 && fromWin && !$("win").hidden) $("winPts").hidden = false;
    else if (got > 0) toast(`ได้แต้มอันดับ +${got}`);
  }, wait);
}

// รางวัลรอบล่าสุดที่จบแล้ว: ถาม server ครั้งเดียวต่อรอบ · ยังไม่ผูก Google = ยังไม่จด ถามใหม่ทีหลัง (แบบ claimSeasons ของ LumiFlip)
async function claimSeasons() {
  const round = `${Account.user?.uid}:${weekId()}:${monthId()}`;
  if (import.meta.env.DEV || !Account.user || save.lb.flagged || save.lb.debug || save.lb.checked === round) return;
  const res = await Boards.claim().catch(() => null);
  if (!res) return;
  if (res.needGoogle) return toast(`ติดอันดับรอบที่แล้ว! ผูก Google เพื่อรับ ${res.hearts} หัวใจ`);
  save.lb.checked = round;
  if (res.hearts > 0) {
    // หัวใจเก็บในเครื่องได้สูงสุด HEARTS.max (validate ตัดที่เกิน)
    H.n = Math.min(HEARTS.max, H.n + res.hearts);
    afterHeartGained();
    toast(`รางวัลอันดับ: ได้หัวใจ +${res.hearts}`);
  }
  writeSave(save);
}

// ---------- ตั้งค่า ----------
function openSettings() { renderSettings(); $("settingsOv").hidden = false; }
function renderSettings() {
  $("setSoundT").classList.toggle("on", soundOn);
  $("setSound").setAttribute("aria-checked", String(soundOn));
  for (const b of $("setQ").querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.q === qSetting);
  const names: Record<string, string> = { high: "สูง", mid: "กลาง", low: "ต่ำ" };
  $("setQAuto").textContent = qSetting === "auto" ? ` · ตอนนี้ ${names[qAuto]}` : "";
  $("setVer").textContent = APP_VERSION;
}
$("setClose").onclick = () => { $("settingsOv").hidden = true; };
$("setSound").onclick = () => { soundOn = !soundOn; saveSettings(); renderSettings(); if (soundOn) { unlockAudio(); note(660, .15); } };
for (const b of $("setQ").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => { qSetting = b.dataset.q as typeof qSetting; saveSettings(); applyQuality(); };
$("setHelp").onclick = () => ask("วิธีเล่น",
  "แตะช่องเพื่อเดิน · เดินได้รอบละ 10 วินาที · จบรอบแล้วรอบนั้นกลายเป็นเงาที่เดินซ้ำแบบเดิม · ให้เงายืนสวิตช์เปิดประตูหรือบังเลเซอร์ แล้วพาดวงไฟไปทางออก · ใช้เงาน้อยได้ดาวมาก · ดาวใช้ปลดสกิลในต้นไม้", "เข้าใจแล้ว");

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
const PLUS_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
let subHtml = "";
function banner(html: string) { $("banner").innerHTML = html; }

function updateHud() {
  // หัว: ห้อง N / ชั้น N + ชื่อ · แถบเป้า: ★★★ ใช้เงา ≤ par · จุดเงา (ตัวเลข/ข้อความจากโค้ด ไม่มีข้อความผู้เล่น)
  $("lvlNo").textContent = levelIdx < 0 ? `ชั้น ${save.tower.floor}` : `ห้อง ${levelIdx + 1}`;
  $("lvlName").textContent = levelIdx < 0 ? `หอคอย ∞ · สูงสุด ${save.tower.best}` : room.def.name;
  const goal = `${ic("star")}${ic("star")}${ic("star")}<span>ใช้เงา ≤ ${room.def.par}</span>`;
  if (goal !== subHtml) { subHtml = goal; $("goal").innerHTML = goal; $("goal").setAttribute("aria-label", `3 ดาวเมื่อใช้เงาไม่เกิน ${room.def.par} ตัว`); }
  $("dots").setAttribute("aria-label", `เงา ${ghosts.length} จาก ${MAX_GHOSTS} ตัว`);
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
  $("btnEnd").className = phase === "run" ? "act primary" : "act";
  $<HTMLButtonElement>("btnUndo").disabled = !(phase === "ready" && ghosts.length);
  renderHearts();
  save.skills.eq.forEach((id, i) => {
    const b = document.getElementById("sk" + i) as HTMLButtonElement | null;
    if (!b || !id || !ACTIVE_SKILLS.has(id)) return;
    const toggling = id === "cap" && !!r.clone;
    b.disabled = phase !== "run" || (!!r.used[id] && !toggling);
    b.classList.toggle("used", !!r.used[id] && !toggling);
    const small = b.querySelector("small");
    if (small) small.textContent = toggling ? (r.ctrl === "clone" ? "→ ดวง 1" : "→ ดวง 2") : "";
  });
}

function renderSkillBar() {
  const bar = $("skillBar"); bar.innerHTML = "";
  const recId = room?.def.skill;
  const recSk = recId && !has(recId) ? nodeById(recId) ?? null : null;
  let recShown = false;
  save.skills.eq.forEach((id, i) => {
    const b = document.createElement("button"); b.id = "sk" + i;
    const n = id ? nodeById(id) : undefined;
    if (!n) {
      // ช่องว่าง: ไอคอน + · ถ้าห้องนี้แนะนำสกิลที่ยังไม่ได้ติดตัว ช่องว่างช่องแรกโชว์ไอคอนสกิลนั้นจาง ๆ และเรืองแสง
      const showRec = recSk && !recShown;
      if (showRec) recShown = true;
      b.className = "empty" + (showRec ? " rec" : "");
      b.innerHTML = (showRec ? `<svg viewBox="0 0 24 24" class="ghosted" style="color:${BR[recSk!.br].c}">${ICON[recSk!.icon]}</svg>` : PLUS_SVG) + `<small>${showRec ? recSk!.name : `ช่อง ${i + 1}`}</small>`;
      b.setAttribute("aria-label", showRec ? `ช่องสกิลว่าง · ห้องนี้แนะนำ ${recSk!.name} แตะเพื่อเปิดต้นไม้สกิล` : "ช่องสกิลว่าง แตะเพื่อเปิดต้นไม้สกิล");
      b.onclick = () => show("tree");
    } else {
      b.innerHTML = `<svg viewBox="0 0 24 24" style="color:${BR[n.br].c}">${ICON[n.icon]}</svg><span>${n.name}<small></small></span>`;
      b.setAttribute("aria-label", `${n.name} · ${ACTIVE_SKILLS.has(n.id) ? "กดใช้ได้รอบละครั้ง" : "ทำงานเอง"}`);
      if (n.id === room?.def.skill) b.classList.add("rec");
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
    if (a === "del") { proofOp(["del", i]); ghosts.splice(i, 1); }
    if (a === "delay") { proofOp(["delay", i]); g.delay = (g.delay + 4) % 16; }
    if (a === "twin") { proofOp(["twin", i]); g.twin = !g.twin; }
    m.hidden = true;
    if (a !== "close") startRound();
  });
}

// ระดับกราฟิก: ภาพต่ำตัดแสงฟุ้ง/ลาย/แอนิเมชันเรือง (CSS .q-low)
function applyQuality() {
  document.body.classList.toggle("q-low", quality() === "low");
  if (!$("settingsOv").hidden) renderSettings();
}

initTree(save, () => { proof.eq = [...save.skills.eq]; renderSkillBar(); updateHud(); renderTop(); if (phase === "ready") startRound(); });

// ---------- ลูปหลัก ----------
function frame(now: number) {
  requestAnimationFrame(frame);
  // โฆษณาเต็มจอ / หน้าล็อกอิน / ไม่ได้อยู่หน้าเล่น: ไม่เดิน sim ไม่วาด ไม่นับเฟรมช้า (กฎ performance.md)
  if (paused || gateOpen || screen !== "play") { last = now; lastFrame = 0; return; }   // โฆษณาเต็มจอ / หน้าล็อกอินบังทั้งจอ: ไม่เดิน sim ไม่วาด ไม่นับเฟรมช้า
  if (lastFrame && qSetting === "auto" && qAuto !== "low" && !document.hidden) {
    slowFrames = now - lastFrame > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 90) { qAuto = qAuto === "high" ? "mid" : "low"; slowFrames = 0; applyQuality(); }
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
  if (!$("login").hidden && loginMode === "rename") return closeLogin();
  if (!$("profileOv").hidden) { $("profileOv").hidden = true; return; }
  if (!$("offerOv").hidden) return closeOffer();
  if (!$("heartsOv").hidden) return closeHearts();
  if (!$("settingsOv").hidden) { $("settingsOv").hidden = true; return; }
  if (!$("rankOv").hidden) { $("rankOv").hidden = true; return; }
  if (!$("gmenu").hidden) { $("gmenu").hidden = true; return; }
  if (!$("helpPop").hidden) { $("helpPop").hidden = true; return; }
  if (!$("win").hidden) { $("btnWinOut").click(); return; }
  if (screen === "play") return show(levelIdx < 0 ? "home" : "map");
  if (screen !== "home") return show("home");
  if (Date.now() - lastBack < 2000) { App.exitApp(); return; }
  lastBack = Date.now(); toast("กดย้อนกลับอีกครั้งเพื่อออกจากเกม");
});

// กลับเข้าแอป/แท็บ: เติมหัวใจถ้าข้ามเที่ยงคืน + ลองส่งใบเสร็จที่ค้าง
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (refreshDay(H)) { writeSave(save); afterHeartGained(); }
  if (Account.hint() === "offline") Account.ensure().then(ok => ok && renderAccount()).catch(() => {});
  if (Billing.pending.size) Billing.retryPending().catch(() => 0);
  flushWins();
});

setupSplash();
// ครั้งแรก/หลังออกจากระบบ: หน้าล็อกอินขึ้นทันที (ใต้ splash) · เคยเข้าแล้ว: อ่านบัญชีตอนว่าง ถ้าบัญชีหายไปค่อยเปิดหน้าล็อกอิน
// เคยเข้าแล้วแต่ยังไม่มีชื่อ (เครื่องที่ติดตั้งก่อนมีช่องชื่อ) → ขอชื่ออย่างเดียว ไม่ต้องเข้าบัญชีใหม่
if (Account.needsGate()) openLogin("signIn");
else if (!Account.name()) openLogin("name");
const startAccount = () => Account.init().then(ok => {
  renderAccount();
  if (ok && Account.user) { flushWins(); claimSeasons(); }
  if (!ok) openLogin("signIn");
  else if (loginMode === "name" && !$("login").hidden && !nameInput.value) nameInput.value = cleanName(Account.user?.name);
}).catch(() => {});
if (gateOpen) startAccount();
else "requestIdleCallback" in window ? requestIdleCallback(startAccount, { timeout: 3000 }) : setTimeout(startAccount, 1500);
if (refreshDay(H)) writeSave(save);
loadLevel(nextRoom() < 0 ? 0 : nextRoom());
applyQuality();
show("home");
watchUnlimited();
requestAnimationFrame(frame);
initAnalytics();
Ads.init().then(() => { if (adsOn()) Ads.showBanner(); });
// ให้สคริปต์ทดสอบ/แคปภาพอ่านและตั้งสถานะได้ (pnpm dev เท่านั้น)
if (import.meta.env.DEV) (window as unknown as { __wk: unknown }).__wk = { save, H, openHearts, openOffer, renderHearts, loadLevel, adsOn, Ads, writeSave, Account, requireLogin, openProfile, renderAccount, show, play, openRank, openSettings, renderRankRows, onWin: () => onWin(), get proof() { return proof; } };
Billing.init({ onGrant, onRevoked, shouldRestore }).catch(() => {});
