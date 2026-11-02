import {
  parseRoom, newRound, step, tapCell, toGhost, useSkill, starsFor,
  ACTIVE_SKILLS, MAX_GHOSTS, TICKS, TICK_MS, type Ghost, type Room, type Round, type SkillId,
} from "./core/sim";
import { LEVELS } from "./core/levels";
import { genTower } from "./core/tower";
import { loadSave, writeSave, type SaveData } from "./core/save";
import { BR, ICON, nodeById } from "./core/skills";
import { createBoard, COL, type Quality } from "./render/board";
import { initTree, openTree } from "./ui/tree";
import { initAnalytics, track } from "./platform/analytics";

// ---------- สถานะ ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const save: SaveData = loadSave();
type Phase = "ready" | "run" | "zap" | "win";
let levelIdx = 0;                 // -1 = หอคอย ∞
let room: Room, ghosts: Ghost[] = [], r: Round, phase: Phase = "ready";
let last = 0, flash: { color: string; at: number } | null = null, scrub: number | null = null, zapTimer = 0, barPct = -1;
const has = (id: SkillId) => save.skills.eq.includes(id);
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
    ghosts = []; startRound();
    banner(`${why} · เงาครบ ${MAX_GHOSTS} ตัวแล้ว เริ่มห้องใหม่ทั้งหมด ลองวางแผนอีกแบบ`);
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
  if (levelIdx >= 0) save.best[levelIdx] = Math.max(save.best[levelIdx] || 0, stars);
  else save.tower.best = Math.max(save.tower.best, save.tower.floor);
  writeSave(save);
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
  if (phase === "ready") { phase = "run"; last = performance.now(); banner(""); updateHud(); }
});
$("btnEnd").onclick = () => { if (phase === "run") { r.outcome = "timeout"; endRound("จบรอบเอง"); } };
$("btnUndo").onclick = () => { if (phase === "ready" && ghosts.length) { ghosts.pop(); startRound(); } };
$("btnReset").onclick = () => loadLevel(levelIdx);
$("btnRetry").onclick = () => loadLevel(levelIdx);
$("btnNext").onclick = () => {
  if (levelIdx < 0) { save.tower.floor++; writeSave(save); loadLevel(-1); }
  else loadLevel(levelIdx < LEVELS.length - 1 ? levelIdx + 1 : -1);
};

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
  add("ต้นไม้สกิล ✦", "tree", () => openTree());
  LEVELS.forEach((_, i) => add(`${i + 1}<small>${"★".repeat(save.best[i] || 0) || "&nbsp;"}</small>`, i === levelIdx ? "on" : "", () => loadLevel(i), `ห้อง ${i + 1}`));
  add(`หอคอย ∞<small>${save.tower.best ? "ชั้น " + save.tower.best : "&nbsp;"}</small>`, levelIdx < 0 ? "on" : "", () => loadLevel(-1), "โหมดหอคอยไม่รู้จบ");
  const names: Record<string, string> = { auto: "อัตโนมัติ", high: "สูง", mid: "กลาง", low: "ต่ำ" };
  add(`ภาพ<small>${names[qSetting]}${qSetting === "auto" ? "·" + names[qAuto] : ""}</small>`, "q", () => {
    const order = ["auto", "high", "mid", "low"] as const;
    qSetting = order[(order.indexOf(qSetting) + 1) % order.length];
    try { localStorage.setItem(QKEY, JSON.stringify({ quality: qSetting })); } catch { /* ไม่เป็นไร */ }
    renderLevelChips();
  }, "ระดับกราฟิก");
}

initTree(save, () => { renderSkillBar(); updateHud(); renderLevelChips(); if (phase === "ready") startRound(); });

// ---------- ลูปหลัก ----------
function frame(now: number) {
  requestAnimationFrame(frame);
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

renderSkillBar();
loadLevel(0);
requestAnimationFrame(frame);
initAnalytics();
