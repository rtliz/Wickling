// @ts-nocheck — ยกจากต้นแบบ (หน้าต้นไม้สกิล + วิดีโอตัวอย่าง) ยังไม่ใส่ type · TODO ใส่ type แล้วเอา nocheck ออก
import { ICON, BR, NODES } from "../core/skills";
import { type SaveData, starsLeft, writeSave } from "../core/save";
const INK = "#1b1430";
const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
let SAVE: SaveData;
let onChange = () => {};
const S = { get stars() { return starsLeft(SAVE); }, owned: new Set<string>(), sel: "t1", eq: [null, null] as (string | null)[] };
function saveProf() { SAVE.skills.owned = [...S.owned]; SAVE.skills.eq = S.eq; writeSave(SAVE); onChange(); }
const $ = id => document.getElementById(id);
const avail = n => !S.owned.has(n.id) && n.req.every(r => S.owned.has(r));
const colorOf = n => BR[n.br].c;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1400); }
const icon = (n, size) => `<svg viewBox="0 0 24 24" style="color:${colorOf(n)}">${ICON[n.icon]}</svg>`;

function render() {
  $("stars").textContent = S.stars;
  const tree = $("tree"), links = $("links");
  tree.querySelectorAll(".node,.blabel").forEach(e => e.remove());
  const w = tree.clientWidth, h = tree.clientHeight, P = n => [n.x / 100 * w, n.y / 100 * h];
  let ls = `<defs><filter id="gl"><feGaussianBlur stdDeviation="2.2"/></filter></defs>`;
  for (const n of NODES) for (const r of n.req) {
    const [x1, y1] = P(byId[r]), [x2, y2] = P(n), lit = S.owned.has(n.id), col = colorOf(n), my = (y1 + y2) / 2;
    const d = `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    ls += lit ? `<path d="${d}" stroke="${col}" stroke-width="7" fill="none" opacity=".35" filter="url(#gl)"/><path d="${d}" stroke="${col}" stroke-width="2.5" fill="none"/>`
              : `<path d="${d}" stroke="${avail(n) ? "#e6bd5c" : "#3d3150"}" stroke-width="2" fill="none" stroke-dasharray="${avail(n) ? "5 5" : "2 6"}" opacity="${avail(n) ? .8 : 1}"/>`;
  }
  links.innerHTML = ls;
  for (const k of ["time","smoke","light"]) {
    const n = NODES.find(m => m.br === k), [x, y] = P(n), lb = document.createElement("div");
    lb.className = "blabel"; lb.style.left = x + "px"; lb.style.top = (y + 40) + "px"; lb.style.color = BR[k].c; lb.textContent = BR[k].n; tree.appendChild(lb);
  }
  for (const n of NODES) {
    const [x, y] = P(n), el = document.createElement("div");
    const st = S.owned.has(n.id) ? "owned" : avail(n) ? "avail" : "locked";
    el.className = `node ${st}${n.cap ? " cap" : ""}${S.sel === n.id ? " sel" : ""}`;
    el.style.left = x + "px"; el.style.top = y + "px"; el.style.setProperty("--c", colorOf(n));
    el.innerHTML = icon(n) + (n.cost ? `<span class="cost">${n.cost} ★</span>` : "") + (S.eq.includes(n.id) ? `<span class="eq">${S.eq.indexOf(n.id) + 1}</span>` : "");
    el.setAttribute("role", "button"); el.setAttribute("aria-label", n.name);
    el.onclick = () => { S.sel = n.id; render(); };
    tree.appendChild(el);
  }
  S.eq.forEach((id, i) => { const s = $("slot" + i); s.className = "slot" + (id ? " full" : ""); s.innerHTML = id ? icon(byId[id]) : ""; });
  renderDetail();
}
function renderDetail() {
  const n = byId[S.sel], d = $("detail"), owned = S.owned.has(n.id), can = avail(n), equip = S.eq.includes(n.id);
  d.style.setProperty("--c", colorOf(n));
  const lockedBy = n.req.filter(r => !S.owned.has(r)).map(r => byId[r].name).join(", ");
  let btn;
  if (n.id === "root") btn = `<button class="btn" disabled>มีตั้งแต่เริ่มเกม</button>`;
  else if (owned) btn = `<button class="btn ${equip ? "" : "main"}" id="act">${equip ? "ถอดออก" : "ติดตัวเข้าด่าน"}</button>`;
  else if (can) btn = `<button class="btn main" id="act" ${S.stars < n.cost ? "disabled" : ""}>ปลดล็อก ${n.cost} ★</button>`;
  else btn = `<button class="btn" disabled>ต้องปลดล็อก ${lockedBy} ก่อน</button>`;
  d.innerHTML = `<div class="hd"><div class="ic">${icon(n)}</div><div><div class="br">${BR[n.br].n} · ${n.kind}</div><h2>${n.name}</h2></div></div>
    <canvas class="pv" id="pv" width="616" height="300" aria-label="วิดีโอตัวอย่างสกิล ${n.name}"></canvas>
    <p>${n.desc}</p>
    <div class="room"><b>ห้องที่ออกแบบให้ใช้:</b> ${n.room}</div>
    ${!owned && can && S.stars < n.cost ? `<div class="use">ดาวไม่พอ ขาดอีก ${n.cost - S.stars} ★ · เก็บเพิ่มจากด่านหรือห้องประจำวัน</div>` : ""}
    <div class="row">${btn}</div>`;
  const act = $("act");
  if (act) act.onclick = () => {
    if (!owned) { SAVE.skills.spent += n.cost; S.owned.add(n.id); toast(`ปลดล็อก "${n.name}" แล้ว`); }
    else if (equip) { S.eq[S.eq.indexOf(n.id)] = null; }
    else { const i = S.eq.indexOf(null); if (i < 0) { S.eq[1] = n.id; toast("ช่องเต็ม แทนที่ช่อง 2"); } else S.eq[i] = n.id; }
    saveProf(); render();
  };
}

// ---------- วิดีโอตัวอย่างสกิล: ฉากจิ๋ว 7×3 ช่อง เล่นวนด้วย canvas (ไม่ต้องใช้ไฟล์วิดีโอจริง) ----------
const FLAME = new Path2D("M0 -24 Q8 -14 13 -2 Q16 14 0 16 Q-16 14 -13 -2 Q-10 -10 -4 -14 Q-3 -8 0 -8 Q-2 -16 0 -24Z");
const GC = ["#c9b8ff", "#8fe3d0", "#ffb3c7"];
const cl = v => Math.max(0, Math.min(1, v));
function walk(pts, t, t0, spd = .32) {           // เดินตามจุด ช่องละ spd วินาที
  const k = (t - t0) / spd; if (k <= 0) return pts[0];
  const i = Math.floor(k); if (i >= pts.length - 1) return pts[pts.length - 1];
  const f = k - i, a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
const near = (p, c, r) => Math.abs(p[0] - c) < .35 && Math.abs(p[1] - r) < .35;
const ROOM = { walls:[[4,0],[4,2]], door:[4,1], sw:[1,2], exit:[6,1] };
const SC = {
  root: { dur:6.4, room:ROOM, f(t) {
    const P1 = [[2,1],[1,1],[1,2]];
    if (t < 2.4) return { act:[{ k:"p", p:walk(P1, t, .3), a: t > 1.8 ? 1 - cl((t - 1.8) / .6) : 1 }, ...(t > 1.8 ? [{ k:"g", i:0, p:[1,2], a:cl((t - 1.8) / .6) }] : [])],
      cap: t < 1.8 ? "รอบแรก: ไปยืนบนสวิตช์" : "หมดเวลา → รอบนี้กลายเป็นเงา" };
    const u = t - 2.4;
    return { act:[{ k:"g", i:0, p:walk(P1, u, .1) }, { k:"p", p:walk([[2,1],[3,1],[4,1],[5,1],[6,1]], u, 1.2) }], cap:"รอบต่อไป: เงาเหยียบสวิตช์ เปิดประตูให้" }; } },
  t1: { dur:6, room:ROOM, f(t) {
    const P = [[2,1],[1,1],[1,2]], gt = (t % 3), s = .5 + .5 * Math.sin(t * 1.3);
    return { act:[{ k:"g", i:0, p:walk(P, gt, .3) }, { k:"ring", i:0, p:walk(P, s * 2, .3) }, { k:"p", p:[3,1] }], scrub:s, cap:"ลากหลอดเทียน ดูว่าเงาจะอยู่ตรงไหนในวินาทีนั้น" }; } },
  t2: { dur:5.2, room:ROOM, f(t) {
    const fz = t > 1.75 && t < 2.85, gt = t < 1.75 ? t : t < 2.85 ? 1.75 : t - 1.1;
    const gp = gt < 1.9 ? walk([[2,1],[1,1],[1,2]], gt, 0) : walk([[1,2],[1,1],[0,1]], gt, 1.9);
    return { act:[{ k:"g", i:0, p:gp }, { k:"p", p:walk([[2,1],[3,1],[4,1],[5,1],[6,1]], t, 1.15, .36) }], tint:fz ? "#5fa8ff" : null,
      cap: t < 1.75 ? "เงากำลังจะลุกจากสวิตช์ ประตูจะปิด..." : fz ? "หยุดเปลว! เวลาหยุด 1 วิ ตัวจริงยังเดินได้" : "ผ่านประตูทันพอดี" }; } },
  t3: { dur:4.6, room:{ walls:[[0,0],[0,2]], emit:[[0,1,1]] }, f(t) {
    const P = [[2,2],[3,2],[4,2],[4,1]], fw = walk(P, t, .2, .4);
    let p = fw, trail = null;
    if (t > 1.3 && t < 2.3) { const back = 1.3 - (t - 1.3) * 1.25; p = walk(P, Math.max(back, 0), .2, .4); trail = [walk(P, 1.3, .2, .4), p]; }
    else if (t >= 2.3) p = P[0];
    return { act:[{ k:"p", p }], trail, warn: t > .9 && t < 1.3,
      cap: t < 1.3 ? "กำลังจะเดินเข้าลำแสง..." : t < 2.3 ? "ย้อนเปลว! กลับไปจุดเมื่อ 2 วิก่อน" : "รอดแล้ว ลองทางใหม่ได้" }; } },
  s1: { dur:4.2, room:{}, f(t) {
    const a2 = 1 - cl((t - 1.6) / .7);
    return { act:[{ k:"g", i:0, p:[1,0] }, { k:"g", i:1, p:[3,0], a:a2 }, { k:"g", i:2, p:[5,0] }, { k:"p", p:[3,2] }],
      tap: t > 1.1 && t < 1.8 ? [3,0] : null, cap: t < 1.6 ? "แตะเงาตัวที่วางผิด (ตัวไหนก็ได้)" : "เงา #2 หายไป ตัวอื่นยังอยู่ แก้แผนได้ทันที" }; } },
  s2: { dur:5.4, room:ROOM, f(t) {
    const A = [[2,1],[1,1],[1,2]], B = [[1,2],[1,1],[2,1]];
    const g = (off) => { const u = t - off; return u < 1.6 ? walk(A, u, 0) : walk(B, u, 1.6); };
    return { act:[{ k:"g", i:0, p:g(0) }, { k:"g", i:1, p:g(1.4), badge: t < 1.6 ? "+1.4 วิ" : null }, { k:"p", p:walk([[2,1],[3,1],[4,1],[5,1],[6,1]], t, 2.2, .36) }],
      cap: t < 1.6 ? "ตั้งให้เงา #2 ออกตัวช้ากว่า 1.4 วิ" : "เงา #2 มารับช่วงพอดี ประตูเปิดต่อเนื่อง" }; } },
  s3: { dur:5, room:{ walls:[[0,0],[1,0],[2,0],[4,0],[5,0],[6,0],[2,1],[4,1]], door:[3,1], sw:[1,2], sw2:[5,2], exit:[3,0] }, f(t) {
    const P = [[3,2],[2,2],[1,2]], M = [[3,2],[4,2],[5,2]];
    return { act:[{ k:"g", i:0, p:walk(P, t, .2) }, { k:"g", i:0, p:walk(M, t, .2), mirror:true }, { k:"p", p:walk([[3,2],[3,1],[3,0]], t, 1.6, .4) }],
      axis: t < 1.6, cap: t < 1.6 ? "เปิดเงากระจก: เงาเดินกลับซ้าย-ขวาพร้อมกัน" : "สวิตช์สองตัวถูกกดพร้อมกัน ประตูเปิด" }; } },
  l1: { dur:4.4, room:{ emit:[[6,0,-1]], walls:[[6,1],[6,2]] }, f(t) {
    const r = 1.1 + 1.9 * cl((t - 1) / .9);
    return { act:[{ k:"p", p:[1,1] }], dark:r, cap: t < 1.2 ? "ปกติเห็นแค่รอบตัว" : "ส่องไกล: เห็นปืนเลเซอร์ที่ซ่อนอยู่" }; } },
  l2: { dur:4.6, room:ROOM, f(t) {
    const gp = t < 1.5 ? walk([[2,1],[1,1],[1,2]], t, 0) : walk([[1,2],[1,1],[0,1]], t, 1.5);
    let p, dash = false;
    if (t < 1.3) p = walk([[1,0],[2,0],[2,1]], t, .4, .45);
    else if (t < 1.45) { p = [2 + 2 * cl((t - 1.3) / .15), 1]; dash = true; }
    else p = walk([[4,1],[5,1],[6,1]], t, 1.45, .36);
    return { act:[{ k:"g", i:0, p:gp }, { k:"p", p, dash }], cap: t < 1.3 ? "ประตูกำลังจะปิด เดินปกติไม่ทัน" : t < 2 ? "เปลวพุ่ง! 2 ช่องในจังหวะเดียว" : "ทะลุประตูได้ทัน" }; } },
  l3: { dur:5.4, room:ROOM, f(t) {
    const lan = t > 1.1 && t < 4.1;
    let p = t < 1.1 ? walk([[2,1],[1,1],[1,2]], t, .2) : walk([[1,2],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1]], t, 1.3, .36);
    return { act:[{ k:"p", p }, ...(lan ? [{ k:"lantern", p:[1,2], left:1 - (t - 1.1) / 3 }] : [])],
      cap: t < 1.1 ? "เดินไปที่สวิตช์" : lan ? "วางโคมไว้ โคมกดสวิตช์ค้าง 3 วิ" : "โคมดับ ประตูปิด แต่ผ่านไปแล้ว" }; } },
  cap: { dur:5, room:ROOM, f(t) {
    if (t < .8) return { act:[{ k:"p", p:[2,1] }], cap:"ดวงไฟเดียว..." };
    const a = walk([[2,1],[1,1],[1,2]], t, .9), b = walk([[2,1],[3,1],[4,1],[5,1],[6,1]], t, 1.5, .36);
    return { act:[{ k:"p", p:a, s:.85 }, { k:"p", p:b, s:.85, hue:true }], split: t < 1.2 ? [2,1] : null,
      cap: t < 1.5 ? "แยกเปลว! เป็นสองดวง 3 วิ" : "ดวงหนึ่งกดสวิตช์ อีกดวงออกประตู" }; } },
};
let pvStart = performance.now(), pvSel = null;
function pvFrame(now) {
  requestAnimationFrame(pvFrame);
  if (document.getElementById("treeOv").hidden) return;
  const cv = document.getElementById("pv"); if (!cv) return;
  if (pvSel !== S.sel) { pvSel = S.sel; pvStart = now; }
  const sc = SC[S.sel]; if (!sc) return;
  const t = ((now - pvStart) / 1000) % sc.dur, st = sc.f(t), x = cv.getContext("2d"), RM = sc.room;
  const W = 308, H = 150, ts = 36, ox = (W - ts * 7) / 2, oy = 4, P = ([c, r]) => [ox + (c + .5) * ts, oy + (r + .5) * ts];
  x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, W, H);
  const isWall = (c, r) => (RM.walls || []).some(w => w[0] === c && w[1] === r) || (RM.emit || []).some(e => e[0] === c && e[1] === r);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
    const X0 = ox + c * ts, Y0 = oy + r * ts;
    if (isWall(c, r)) { x.fillStyle = "#120d18"; x.fillRect(X0, Y0, ts, ts); x.strokeStyle = "rgba(230,189,92,.5)"; x.lineWidth = 1.5; x.strokeRect(X0 + .75, Y0 + .75, ts - 1.5, ts - 1.5); continue; }
    x.fillStyle = ["#2d2438","#2a2134","#30263c"][(c * 7 + r * 3) % 3]; x.fillRect(X0, Y0, ts, ts);
    x.strokeStyle = "#3d3150"; x.lineWidth = 1; x.strokeRect(X0 + 2, Y0 + 2, ts - 4, ts - 4);
  }
  const acts = st.act || [], bodies = acts.filter(a => a.k === "p" || a.k === "g" || a.k === "lantern");
  const pressed = sw => sw && bodies.some(a => near(a.p, sw[0], sw[1]));
  const occ = d => d && bodies.some(a => near(a.p, d[0], d[1]));
  const open1 = pressed(RM.sw) && (RM.sw2 ? pressed(RM.sw2) : true) || occ(RM.door), open2 = (pressed(RM.sw) && pressed(RM.sw2)) || occ(RM.door2);
  const glowAt = (p, r, col, al) => { const [cx, cy] = P(p), g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); x.globalAlpha = al; x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.globalAlpha = 1; };
  if (RM.exit) { glowAt(RM.exit, 26, "rgba(255,177,59,.8)", .7); const [ex, ey] = P(RM.exit); x.fillStyle = "#ffc35a"; x.strokeStyle = INK; x.lineWidth = 2; x.beginPath(); x.moveTo(ex - 10, ey + 13); x.lineTo(ex - 10, ey - 3); x.quadraticCurveTo(ex - 10, ey - 13, ex, ey - 13); x.quadraticCurveTo(ex + 10, ey - 13, ex + 10, ey - 3); x.lineTo(ex + 10, ey + 13); x.closePath(); x.fill(); x.stroke(); }
  for (const s of [RM.sw, RM.sw2]) if (s) { const on = pressed(s), [sx, sy] = P(s); if (on) glowAt(s, 22, "rgba(230,189,92,.9)", .5);
    x.fillStyle = "#4a3c5c"; x.strokeStyle = INK; x.lineWidth = 1.6; x.beginPath(); x.moveTo(sx - 10, sy + 12); x.lineTo(sx - 7, sy + 2); x.lineTo(sx + 7, sy + 2); x.lineTo(sx + 10, sy + 12); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = "#e6bd5c"; x.fillRect(sx - 9, sy, 18, 3.5); if (on) { x.save(); x.translate(sx, sy - 3); x.scale(.32, .32); x.fillStyle = "#ffe08a"; x.fill(FLAME); x.restore(); } }
  for (const [d, o] of [[RM.door, open1], [RM.door2, open2]]) if (d) { const [dx, dy] = P(d);
    if (o) { x.fillStyle = "#4a3c5c"; x.fillRect(dx - 15, dy + 10, 30, 5); x.setLineDash([3, 3]); x.strokeStyle = "rgba(230,189,92,.5)"; x.strokeRect(dx - 15, dy - 15, 30, 30); x.setLineDash([]); }
    else { x.fillStyle = "#4a3c5c"; x.strokeStyle = INK; x.lineWidth = 2; x.fillRect(dx - 16, dy - 16, 32, 32); x.strokeRect(dx - 16, dy - 16, 32, 32); x.strokeStyle = "#e6bd5c"; x.beginPath(); x.arc(dx, dy, 7, 0, 7); x.stroke(); } }
  for (const e of RM.emit || []) { const [exx, eyy] = P(e), dir = e[2];
    x.fillStyle = "#3a2e48"; x.strokeStyle = INK; x.lineWidth = 2; x.beginPath(); x.ellipse(exx, eyy, 12, 10, 0, 0, 7); x.fill(); x.stroke();
    x.fillStyle = "#ff3a4a"; x.beginPath(); x.ellipse(exx + dir * 6, eyy, 4, 3, 0, 0, 7); x.fill();
    let endC = dir > 0 ? 6.5 : -.5;
    for (const a of acts) if (a.k === "g" && Math.abs(a.p[1] - e[1]) < .4 && (dir > 0 ? a.p[0] > e[0] && a.p[0] < endC : a.p[0] < e[0] && a.p[0] > endC)) endC = a.p[0];
    const x1 = exx + dir * 10, x2 = ox + endC * ts + (dir > 0 ? 0 : ts) - (dir > 0 ? 0 : 0);
    const pulse = .7 + .3 * Math.sin(now / 150);
    x.globalAlpha = .3 * pulse; x.strokeStyle = "#ff3a4a"; x.lineWidth = 9; x.beginPath(); x.moveTo(x1, eyy); x.lineTo(x2, eyy); x.stroke();
    x.globalAlpha = 1; x.strokeStyle = "#ff8a94"; x.lineWidth = 2.4; x.beginPath(); x.moveTo(x1, eyy); x.lineTo(x2, eyy); x.stroke(); }
  if (st.axis) { x.setLineDash([4, 4]); x.strokeStyle = "rgba(201,184,255,.6)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(ox + 3.5 * ts, oy + ts); x.lineTo(ox + 3.5 * ts, oy + 3 * ts); x.stroke(); x.setLineDash([]); }
  if (st.trail) { const [a1, b1] = st.trail.map(P); x.strokeStyle = "rgba(255,177,59,.7)"; x.setLineDash([2, 4]); x.lineWidth = 2; x.beginPath(); x.moveTo(...a1); x.lineTo(...b1); x.stroke(); x.setLineDash([]);
    const [cx, cy] = b1; x.strokeStyle = "#ffb13b"; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, 15, now / 120, now / 120 + 4.5); x.stroke(); }
  for (const a of acts) {
    const [cx, cy] = P(a.p), al = a.a ?? 1;
    if (a.k === "ring") { x.setLineDash([3, 3]); x.strokeStyle = GC[a.i]; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, 15, 0, 7); x.stroke(); x.setLineDash([]); continue; }
    if (a.k === "lantern") { glowAt(a.p, 20, "rgba(255,210,122,.9)", .6); x.fillStyle = "#2a2134"; x.strokeStyle = "#e6bd5c"; x.lineWidth = 2; x.fillRect(cx - 6, cy - 16, 12, 14); x.strokeRect(cx - 6, cy - 16, 12, 14);
      x.fillStyle = "#ffd27a"; x.beginPath(); x.arc(cx, cy - 9, 3, 0, 7); x.fill(); x.strokeStyle = "#ffb13b"; x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cy, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.left); x.stroke(); continue; }
    const g = a.k === "g", col = g ? GC[a.i] : a.hue ? "#c9b8ff" : null, sc2 = (a.s || 1) * .62, bob = g ? Math.sin(now / 380 + a.i) * 1.5 : 0;
    glowAt(a.p, 22, g ? col : "rgba(255,177,59,.9)", g ? .3 * al : .5 * al);
    if (a.dash) { x.globalAlpha = .5; x.fillStyle = "#ffb13b"; for (let k = 1; k <= 3; k++) { x.save(); x.translate(cx - k * 9, cy); x.scale(sc2, sc2); x.fill(FLAME); x.restore(); } x.globalAlpha = 1; }
    x.save(); x.globalAlpha = al * (g ? .85 : 1); x.translate(cx, cy + bob); x.scale(sc2 * (a.mirror ? -1 : 1), sc2 * (1 + (g ? 0 : Math.sin(now / 110) * .04)));
    let fill; if (g || a.hue) { fill = x.createLinearGradient(0, 16, 0, -24); fill.addColorStop(0, "rgba(255,255,255,.1)"); fill.addColorStop(.5, col); fill.addColorStop(1, "#fbf9ff"); }
    else { fill = x.createLinearGradient(0, 16, 0, -24); fill.addColorStop(0, "#ff5a2b"); fill.addColorStop(.45, "#ffb13b"); fill.addColorStop(1, "#fff6c0"); }
    x.fillStyle = fill; x.strokeStyle = INK; x.lineWidth = 2.4 / sc2 * .62; x.fill(FLAME); x.stroke(FLAME);
    x.fillStyle = INK; x.beginPath(); x.ellipse(-4.5, 2, 2, 2.6, 0, 0, 7); x.ellipse(4.5, 2, 2, 2.6, 0, 0, 7); x.fill(); x.restore();
    if (g) { x.fillStyle = "#17111f"; x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath(); x.arc(cx + 11, cy - 13 + bob, 6, 0, 7); x.fill(); x.stroke();
      x.fillStyle = col; x.font = "700 8px Prompt, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(a.i + 1, cx + 11, cy - 12.5 + bob); }
    if (a.badge) { x.fillStyle = "#17111f"; x.strokeStyle = "#c9b8ff"; x.lineWidth = 1.2; x.fillRect(cx - 18, cy + 12, 36, 13); x.strokeRect(cx - 18, cy + 12, 36, 13);
      x.fillStyle = "#c9b8ff"; x.font = "600 8.5px Prompt, sans-serif"; x.textAlign = "center"; x.fillText(a.badge, cx, cy + 19); }
  }
  if (st.split) { const [cx, cy] = P(st.split); x.strokeStyle = "#fff6c0"; x.lineWidth = 2; x.globalAlpha = .8; x.beginPath(); x.arc(cx, cy, 10 + (now % 400) / 20, 0, 7); x.stroke(); x.globalAlpha = 1; }
  if (st.tap) { const [cx, cy] = P(st.tap), k = (now % 700) / 700; x.strokeStyle = "#fff"; x.globalAlpha = 1 - k; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, 6 + k * 14, 0, 7); x.stroke(); x.globalAlpha = 1;
    x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(cx + 6, cy + 8, 4, 0, 7); x.fill(); }
  if (st.dark) { const [cx, cy] = P([1,1]), g = x.createRadialGradient(cx, cy, st.dark * ts * .45, cx, cy, st.dark * ts);
    g.addColorStop(0, "rgba(6,4,10,0)"); g.addColorStop(1, "rgba(6,4,10,.94)"); x.fillStyle = g; x.fillRect(ox, oy, 7 * ts, 3 * ts); }
  if (st.warn) { x.globalAlpha = .25 + .2 * Math.sin(now / 60); x.fillStyle = "#ff3a4a"; x.fillRect(ox + ts, oy + ts, 6 * ts, ts); x.globalAlpha = 1; }
  if (st.tint) { x.globalAlpha = .18; x.fillStyle = st.tint; x.fillRect(ox, oy, 7 * ts, 3 * ts); x.globalAlpha = 1;
    x.fillStyle = "#cfe4ff"; x.font = "700 11px Prompt, sans-serif"; x.textAlign = "right"; x.fillText("❚❚ หยุด", ox + 7 * ts - 6, oy + 12); }
  // หลอดเทียนสำหรับ "ส่องอนาคต"
  let capY = oy + 3 * ts + 15;
  if (st.scrub != null) { const bx = ox, bw = 7 * ts; x.fillStyle = "#e9d2b0"; x.fillRect(bx, oy + 3 * ts + 6, bw * .9, 5);
    const hx = bx + bw * .9 * st.scrub; x.fillStyle = "#c9b8ff"; x.beginPath(); x.arc(hx, oy + 3 * ts + 8.5, 5, 0, 7); x.fill(); capY += 6; }
  x.fillStyle = "#f6ecd6"; x.font = "600 11.5px Prompt, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(st.cap || "", W / 2, Math.min(capY + 6, H - 10));
  x.fillStyle = "rgba(230,189,92,.35)"; x.fillRect(0, H - 3, W, 3); x.fillStyle = "#e6bd5c"; x.fillRect(0, H - 3, W * (t / sc.dur), 3);
  x.fillStyle = "rgba(246,236,214,.55)"; x.font = "600 8px Prompt, sans-serif"; x.textAlign = "left"; x.fillText("▶ ตัวอย่าง", 6, 9);
}
requestAnimationFrame(pvFrame);
new ResizeObserver(render).observe($("tree"));
$("treeClose").onclick = () => { $("treeOv").hidden = true; onChange(); };
if (!import.meta.env.DEV) $("treeBonus").remove();   // ดาวทดสอบมีเฉพาะตอน pnpm dev (กฎกันแฮกข้อ 9)
else $("treeBonus").onclick = () => { SAVE.devBonus += 20; saveProf(); render(); toast("ได้ 20 ดาวสำหรับทดสอบ"); };

export function initTree(save: SaveData, cb: () => void) { SAVE = save; onChange = cb; }
export function openTree(sel?: string) {
  S.owned = new Set(SAVE.skills.owned); S.eq = SAVE.skills.eq; if (sel) S.sel = sel;
  $("treeOv").hidden = false; render();
}
