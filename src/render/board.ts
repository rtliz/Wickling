import { LANTERN_TICKS, TICKS, ghostList, pulseOff, type Ghost, type Pos, type Room, type Round } from "../core/sim";

// วาดกระดานด้วย Canvas 2D · ภาพทั้งหมดเป็น SVG ในโค้ด แปลงเป็นภาพครั้งเดียว แล้ววาดซ้ำทุกเฟรม (ไม่สร้างของใหม่ในลูป)
// ระดับกราฟิก: high = ความมืด + แสงเรือง + ประกาย · mid = ตัดประกายและแสงของเงา · low = ไม่มีความมืด/แสงเรือง (ยกเว้นห้องมืด)

export type Quality = "high" | "mid" | "low";
export interface View {
  room: Room; ghosts: Ghost[]; r: Round; a: number; phase: string;
  scrub: number | null; quality: Quality; lightRadius: number; flash: { color: string; at: number } | null;
}

const INK = "#1b1430";
export const COL = {
  wall: "#120d18", gold: "#e6bd5c", stone: ["#2d2438", "#2a2134", "#30263c"], stoneLine: "#3d3150", crack: "#1e1728",
  player: "#ffb13b", laser: "#ff3a4a", exit: "#ffd27a", a: "#e6bd5c", b: "#ff8f6b",
  ghost: ["#c9b8ff", "#8fe3d0", "#ffb3c7", "#9fd4ff"],
} as const;
const keyCol = (k: string) => (k === "a" ? COL.a : COL.b);

const U = 44;   // หน่วยของ SVG: 1 ช่อง = 44 · สไปรต์กว้าง 64 หน่วย กึ่งกลาง = กลางช่อง
function svgImg(inner: string, defs = "") {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 -32 64 64" width="128" height="128"><defs>${defs}</defs>${inner}</svg>`);
  return img;
}
const flamePath = "M0 -24 Q8 -14 13 -2 Q16 14 0 16 Q-16 14 -13 -2 Q-10 -10 -4 -14 Q-3 -8 0 -8 Q-2 -16 0 -24Z";
const face = `<ellipse cx="-4.5" cy="2" rx="2" ry="2.6" fill="${INK}"/><ellipse cx="4.5" cy="2" rx="2" ry="2.6" fill="${INK}"/>
  <circle cx="-3.8" cy="1" r=".8" fill="#fff"/><circle cx="5.2" cy="1" r=".8" fill="#fff"/>
  <path d="M-2 7 Q0 9 2 7" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`;
const SPR = {
  player: svgImg(`<path d="${flamePath}" fill="url(#f)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M0 -14 Q5 -4 4 4 Q0 8 -4 4 Q-5 -4 0 -14Z" fill="#fff6c0" opacity=".55"/>${face}`,
    `<linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a2b"/><stop offset=".45" stop-color="#ffb13b"/><stop offset="1" stop-color="#fff6c0"/></linearGradient>`),
  ghost: COL.ghost.map(c => svgImg(`<path d="M-6 15 Q-14 21 -7 26 Q0 30 -5 31" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <path d="${flamePath}" fill="url(#s)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" opacity=".85"/>${face}`,
    `<linearGradient id="s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".15"/><stop offset=".5" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="#fbf9ff"/></linearGradient>`)),
  exit: svgImg(`<path d="M-15 20 V-6 Q-15 -20 0 -20 Q15 -20 15 -6 V20Z" fill="url(#g)" stroke="${INK}" stroke-width="2.5"/>
    <path d="M-11 20 V-5 Q-11 -16 0 -16 Q11 -16 11 -5 V20" fill="none" stroke="${COL.gold}" stroke-width="1.5" opacity=".9"/>
    <path d="M-19 20 H19" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M0 -8 l3 6 -3 6 -3 -6z" fill="#fff" opacity=".8"/>`,
    `<radialGradient id="g" cy=".6"><stop offset="0" stop-color="#fff0b8"/><stop offset=".6" stop-color="#ffc35a"/><stop offset="1" stop-color="#b8661f"/></radialGradient>`),
  emitter: svgImg(`<path d="M-16 -14 L8 -9 Q17 0 8 9 L-16 14Z" fill="#3a2e48" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M-8 -6 L4 -4 M-8 6 L4 4" stroke="${COL.gold}" stroke-width="1.5" opacity=".7"/>
    <ellipse cx="9" cy="0" rx="5" ry="3.6" fill="${COL.laser}" stroke="${INK}" stroke-width="1.8"/><ellipse cx="9" cy="0" rx="2" ry="1.5" fill="#fff"/>`),
  sw: {} as Record<string, { on: HTMLImageElement; off: HTMLImageElement }>,
  door: {} as Record<string, { open: HTMLImageElement; closed: HTMLImageElement }>,
};
for (const k of ["a", "b"]) {
  const c = keyCol(k), altar = `<path d="M-14 18 L-10 4 H10 L14 18Z" fill="#4a3c5c" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="-12" y="1" width="24" height="5" rx="2" fill="${c}" stroke="${INK}" stroke-width="1.8"/>
    <text x="0" y="15.5" text-anchor="middle" font-family="Prompt, sans-serif" font-weight="700" font-size="9" fill="${c}">${k.toUpperCase()}</text>`;
  SPR.sw[k] = {
    off: svgImg(altar + `<ellipse cx="0" cy="0" rx="6" ry="2" fill="#2a2134" stroke="${INK}" stroke-width="1.2"/>`),
    on: svgImg(altar + `<path d="M0 -20 Q7 -9 4 -3 Q0 0 -4 -3 Q-7 -9 0 -20Z" fill="url(#f)" stroke="${INK}" stroke-width="1.6"/>`,
      `<linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#fffbe8"/></linearGradient>`),
  };
  SPR.door[k] = {
    closed: svgImg(`<rect x="-20" y="-20" width="40" height="40" rx="3" fill="#4a3c5c" stroke="${INK}" stroke-width="2.5"/>
      <rect x="-16" y="-16" width="32" height="32" rx="2" fill="none" stroke="#5c4b70" stroke-width="1.5"/>
      <circle cx="0" cy="0" r="9" fill="none" stroke="${c}" stroke-width="2"/><path d="M0 -9 V9 M-9 0 H9" stroke="${c}" stroke-width="1.3" opacity=".75"/>
      <text x="0" y="-11" text-anchor="middle" font-family="Prompt, sans-serif" font-weight="700" font-size="7" fill="${c}">${k.toUpperCase()}</text>`),
    open: svgImg(`<rect x="-19" y="12" width="38" height="7" rx="2" fill="#4a3c5c" stroke="${INK}" stroke-width="2"/>
      <rect x="-19" y="-19" width="38" height="38" rx="3" fill="none" stroke="${c}" stroke-width="1.2" stroke-dasharray="3 4" opacity=".6"/>`),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createBoard(cv: HTMLCanvasElement, stage: HTMLElement) {
  const ctx = cv.getContext("2d")!;
  const floorCv = document.createElement("canvas"), fctx = floorCv.getContext("2d")!;
  const darkCv = document.createElement("canvas"), dctx = darkCv.getContext("2d")!;
  let TS = 40, dpr = 1, room: Room | null = null;

  const center = (p: Pos): [number, number] => [(p[1] + .5) * TS, (p[0] + .5) * TS];
  function sprite(img: HTMLImageElement, cx: number, cy: number, sx = 1, sy = 1, alpha = 1) {
    if (!img.complete || !img.naturalWidth) return;
    const s = TS * 64 / U;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(sx, sy);
    ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore();
  }
  function label(txt: string, x: number, y: number, color: string, size: number) {
    ctx.fillStyle = color; ctx.font = `700 ${Math.round(size)}px Prompt, system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, x, y);
  }
  let q: Quality = "high";
  function glow(x: number, y: number, r: number, color: string, a: number, always = false) {
    if (q === "low" && !always) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  function hole(x: number, y: number, r: number) {
    const g = dctx.createRadialGradient(x, y, r * .35, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    dctx.fillStyle = g; dctx.beginPath(); dctx.arc(x, y, r, 0, 7); dctx.fill();
  }

  function paintFloor() {
    if (!room) return;
    const g = fctx, R = room, isW = (r: number, c: number) => r < 0 || c < 0 || r >= R.rows || c >= R.cols || R.grid[r][c].t === "wall" || R.grid[r][c].t === "emit";
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, TS * R.cols, TS * R.rows);
    for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
      const x = c * TS, y = r * TS, h = ((r * 73856093) ^ (c * 19349663)) >>> 0;
      if (isW(r, c)) { g.fillStyle = COL.wall; g.fillRect(x, y, TS, TS); continue; }
      g.fillStyle = COL.stone[h % 3]; g.fillRect(x, y, TS, TS);
      g.strokeStyle = COL.stoneLine; g.lineWidth = 1.5; g.strokeRect(x + 2.5, y + 2.5, TS - 5, TS - 5);
      if (h % 4 === 0) { g.strokeStyle = COL.crack; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + TS * .25, y + TS * .28); g.lineTo(x + TS * .38, y + TS * .4); g.lineTo(x + TS * .33, y + TS * .55); g.lineTo(x + TS * .45, y + TS * .64); g.stroke(); }
    }
    g.strokeStyle = COL.gold; g.globalAlpha = .55; g.lineWidth = 2;
    for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) {
      if (!isW(r, c)) continue;
      const x = c * TS, y = r * TS; g.beginPath();
      if (!isW(r - 1, c)) { g.moveTo(x, y); g.lineTo(x + TS, y); }
      if (!isW(r + 1, c)) { g.moveTo(x, y + TS); g.lineTo(x + TS, y + TS); }
      if (!isW(r, c - 1)) { g.moveTo(x, y); g.lineTo(x, y + TS); }
      if (!isW(r, c + 1)) { g.moveTo(x + TS, y); g.lineTo(x + TS, y + TS); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function resize() {
    if (!room) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    TS = Math.max(16, Math.floor(Math.min(w / room.cols, h / room.rows)));
    dpr = Math.min(window.devicePixelRatio || 1, q === "low" ? 1.5 : 2);
    for (const c of [cv, floorCv, darkCv]) { c.width = TS * room.cols * dpr; c.height = TS * room.rows * dpr; }
    cv.style.width = TS * room.cols + "px"; cv.style.height = TS * room.rows + "px";
    paintFloor();
  }
  new ResizeObserver(resize).observe(stage);

  function cellAt(clientX: number, clientY: number): Pos | null {
    if (!room) return null;
    const rect = cv.getBoundingClientRect(), ts = rect.width / room.cols;
    const p: Pos = [Math.floor((clientY - rect.top) / ts), Math.floor((clientX - rect.left) / ts)];
    return p[0] < 0 || p[1] < 0 || p[0] >= room.rows || p[1] >= room.cols ? null : p;
  }

  function draw(now: number, v: View) {
    if (v.room !== room) { room = v.room; resize(); }
    if (v.quality !== q) { q = v.quality; resize(); }
    const R = v.room, r = v.r, a = v.a, Wd = TS * R.cols, Hd = TS * R.rows, fx = q === "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wd, Hd);
    ctx.drawImage(floorCv, 0, 0, Wd, Hd);

    const glPrev = ghostList(R, v.ghosts, r.gtPrev), gpos = ghostList(R, v.ghosts, r.gt).map((g, j) => {
      const [x0, y0] = center(glPrev[j].p), [x1, y1] = center(g.p);
      return { x: lerp(x0, x1, a), y: lerp(y0, y1, a), ci: g.ci, twin: g.twin };
    });
    const [px0, py0] = center(r.pPrev), [px1, py1] = center(r.p), px = lerp(px0, px1, a), py = lerp(py0, py1, a);
    const pulse = .75 + .25 * Math.sin(now / 420);

    for (let rr = 0; rr < R.rows; rr++) for (let c = 0; c < R.cols; c++) {
      const cell = R.grid[rr][c], [x, y] = center([rr, c]);
      if (cell.t === "exit") { glow(x, y, TS * 1.1, "rgba(255,177,59,.7)", pulse); sprite(SPR.exit, x, y); }
      else if (cell.t === "switch") { const on = cell.k in r.pressed; if (on) glow(x, y - TS * .1, TS * .8, keyCol(cell.k), .45 * pulse); sprite(SPR.sw[cell.k][on ? "on" : "off"], x, y); }
      else if (cell.t === "door") sprite(SPR.door[cell.k][r.open[cell.k] ? "open" : "closed"], x, y);
      else if (cell.t === "emit") {
        const off = cell.pulse !== undefined && pulseOff(r.gt, cell.pulse);
        sprite(SPR.emitter, x, y, cell.d[1] < 0 ? -1 : 1, 1, off ? .45 : 1);
        if (cell.pulse !== undefined) { ctx.strokeStyle = off ? "#5c4b70" : COL.laser; ctx.lineWidth = 2; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, TS * .42, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      }
    }

    // ความมืด: ห้องปกติมืดนิดหน่อย (ปิดที่ระดับต่ำ) · ห้องมืดมืดสนิทนอกวงแสงและทับลำแสงด้วย
    const dark = !!R.def.dark;
    const paintDark = (alpha: number, pr: number) => {
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.globalCompositeOperation = "source-over"; dctx.clearRect(0, 0, Wd, Hd);
      dctx.fillStyle = `rgba(6,4,10,${alpha})`; dctx.fillRect(0, 0, Wd, Hd);
      dctx.globalCompositeOperation = "destination-out";
      hole(px, py, TS * pr * (.96 + .04 * Math.sin(now / 90)));
      if (r.clone) hole(...center(r.clone.p), TS * pr * .7);
      hole(...center(R.exit), TS * 1.5);
      for (const g of gpos) hole(g.x, g.y, TS * 1.05);
      for (const p of r.lanterns) hole(...center(p), TS * 1.2);
      for (let rr = 0; rr < R.rows; rr++) for (let c = 0; c < R.cols; c++) { const cl = R.grid[rr][c]; if (cl.t === "switch" && cl.k in r.pressed) hole(...center([rr, c]), TS * 1.3); }
      ctx.drawImage(darkCv, 0, 0, Wd, Hd);
    };
    if (!dark && q !== "low") paintDark(.62, 2.8);

    ctx.lineCap = "round";
    v.ghosts.forEach((g, i) => {
      for (const mir of g.twin ? [false, true] : [false]) {
        ctx.strokeStyle = COL.ghost[i]; ctx.globalAlpha = mir ? .3 : .5; ctx.lineWidth = 3; ctx.setLineDash([1, 7]);
        ctx.beginPath(); g.rec.forEach((p, j) => { const [x, y] = center(mir ? [p[0], R.cols - 1 - p[1]] : p); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      }
    });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (r.path.length && v.phase === "run") {
      ctx.strokeStyle = COL.player; ctx.globalAlpha = .75; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(...center(r.p)); r.path.forEach(p => ctx.lineTo(...center(p))); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const [tx, ty] = center(r.path[r.path.length - 1]);
      ctx.strokeStyle = COL.player; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, TS * .14, 0, 7); ctx.stroke();
    }

    // ลำแสง: เรียวจากต้นทาง + แกนสว่าง + ประกายวิ่ง
    for (const sg of r.beamSegs) {
      const [ex, ey] = center(sg.from), [x2, y2] = center(sg.to), dx = Math.sign(x2 - ex), dy = Math.sign(y2 - ey);
      const x1 = ex + dx * TS * .3, y1 = ey + dy * TS * .3, ox = -dy, oy = dx, w0 = TS * .16, w1 = TS * .05;
      const endX = sg.blocked ? x2 - dx * TS * .32 : x2, endY = sg.blocked ? y2 - dy * TS * .32 : y2;
      ctx.globalAlpha = .28 * pulse + .1; ctx.fillStyle = COL.laser; ctx.beginPath();
      ctx.moveTo(x1 + ox * w0, y1 + oy * w0); ctx.lineTo(endX + ox * w1 * 2, endY + oy * w1 * 2); ctx.lineTo(endX - ox * w1 * 2, endY - oy * w1 * 2); ctx.lineTo(x1 - ox * w0, y1 - oy * w0); ctx.fill();
      ctx.globalAlpha = .9; ctx.fillStyle = "#ff5866"; ctx.beginPath();
      ctx.moveTo(x1 + ox * w0 * .4, y1 + oy * w0 * .4); ctx.lineTo(endX + ox * w1 * .6, endY + oy * w1 * .6); ctx.lineTo(endX - ox * w1 * .6, endY - oy * w1 * .6); ctx.lineTo(x1 - ox * w0 * .4, y1 - oy * w0 * .4); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ffe3e6"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(endX, endY); ctx.stroke();
      if (fx && Math.hypot(endX - x1, endY - y1) > TS * .3) {
        ctx.fillStyle = "#ffb3b9";
        for (let k = 0; k < 3; k++) { const f = ((now / 700) + k / 3) % 1, j = Math.sin(now / 60 + k * 2) * TS * .1;
          ctx.beginPath(); ctx.arc(x1 + (endX - x1) * f + ox * j, y1 + (endY - y1) * f + oy * j, 1.5, 0, 7); ctx.fill(); }
      }
      if (sg.blocked) glow(endX, endY, TS * .35, "rgba(255,90,102,.9)", .8);
    }

    if (dark) paintDark(.93, v.lightRadius);
    for (const { x, y, ci, twin } of gpos) {
      const bob = Math.sin(now / 380 + ci * 1.7 + (twin ? 1 : 0)) * TS * .05;
      if (q === "high") glow(x, y, TS * .55, COL.ghost[ci], twin ? .2 : .35);
      sprite(SPR.ghost[ci], x, y - TS * .05 + bob, twin ? -1 : 1, 1, twin ? .6 : .9);
      const bx = x + TS * .33, by = y - TS * .4 + bob;
      ctx.fillStyle = "#17111f"; ctx.strokeStyle = COL.ghost[ci]; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(bx, by, TS * .16, 0, 7); ctx.fill(); ctx.stroke();
      label(twin ? "⇋" : String(ci + 1), bx, by + 1, COL.ghost[ci], TS * .2);
      const g = v.ghosts[ci];
      if (!twin && g.delay && v.phase === "ready") label(`+${g.delay / 4}วิ`, x, y + TS * .42, COL.ghost[ci], TS * .18);
    }
    if (v.scrub != null) {
      for (const { p, ci } of ghostList(R, v.ghosts, Math.round(v.scrub * TICKS))) {
        const [x, y] = center(p); ctx.strokeStyle = COL.ghost[ci]; ctx.lineWidth = 2.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, TS * .38, 0, 7); ctx.stroke(); ctx.setLineDash([]); glow(x, y, TS * .5, COL.ghost[ci], .25);
      }
    }
    if (v.phase === "run" && r.path.length) {   // วงประ: เงาจะอยู่ตรงไหนตอนตัวจริงเดินไปถึงเป้าหมาย
      for (const { p, ci } of ghostList(R, v.ghosts, r.gt + Math.max(0, r.path.length - r.freeze))) {
        const [x, y] = center(p);
        ctx.strokeStyle = COL.ghost[ci]; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, TS * .42, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    glow(px, py, TS * .9, "rgba(255,177,59,.8)", .55);
    const fl = Math.sin(now / 110) * .04;
    if (r.dashFrom && a < 1) {
      const [dx0, dy0] = center(r.dashFrom);
      for (let j = 1; j <= 3; j++) sprite(SPR.player, lerp(dx0, px, j / 4), lerp(dy0, py, j / 4), 1, 1, .35 * (1 - a));
    }
    sprite(SPR.player, px, py - TS * .04, 1 - fl, 1 + fl);
    if (r.clone) {
      const [cx0, cy0] = center(r.clone.pPrev), [cx1, cy1] = center(r.clone.p), cx = lerp(cx0, cx1, a), cy = lerp(cy0, cy1, a);
      glow(cx, cy, TS * .8, "rgba(201,184,255,.85)", .5);
      sprite(SPR.player, cx, cy - TS * .04, 1 + fl, 1 - fl, .85);
      if (r.clone.path.length) {
        ctx.strokeStyle = "#c9b8ff"; ctx.globalAlpha = .7; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(...center(r.clone.p)); r.clone.path.forEach(p => ctx.lineTo(...center(p))); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      const [sx, sy] = r.ctrl === "clone" ? [cx, cy] : [px, py];
      ctx.strokeStyle = "#fff6c0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy + TS * .3, TS * .22, 0, Math.PI); ctx.stroke();
    }

    // โคม + วงนับถอยหลัง
    const lan: [Pos, number][] = [];
    if (r.lantern && r.t < r.lantern.t0 + LANTERN_TICKS) lan.push([r.lantern.p, 1 - (r.t + a - r.lantern.t0) / LANTERN_TICKS]);
    for (const g of v.ghosts) { const lt = r.gt - g.delay; if (g.lantern && lt >= g.lantern.t0 && lt < g.lantern.t0 + LANTERN_TICKS) lan.push([g.lantern.p, 1 - (lt - g.lantern.t0) / LANTERN_TICKS]); }
    for (const [p, left] of lan) {
      const [lx, ly] = center(p), w = TS * .28, h = TS * .34;
      glow(lx, ly, TS * .7, "rgba(143,227,208,.8)", .5);
      ctx.fillStyle = "#2a2134"; ctx.strokeStyle = "#8fe3d0"; ctx.lineWidth = 2;
      ctx.fillRect(lx - w / 2, ly - h * .9, w, h); ctx.strokeRect(lx - w / 2, ly - h * .9, w, h);
      ctx.fillStyle = "#ffd27a"; ctx.beginPath(); ctx.arc(lx, ly - h * .42, TS * .06, 0, 7); ctx.fill();
      ctx.strokeStyle = "#8fe3d0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(lx, ly, TS * .44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, left)); ctx.stroke();
    }
    if (r.freeze > 0 && v.phase === "run") {
      ctx.globalAlpha = .16; ctx.fillStyle = "#5fa8ff"; ctx.fillRect(0, 0, Wd, Hd); ctx.globalAlpha = 1;
      label("❚❚ หยุดเปลว", Wd - TS * 1.1, TS * .35, "#cfe4ff", TS * .24);
    }
    if (v.flash) {
      const k = 1 - (now - v.flash.at) / 600;
      if (k > 0) { ctx.globalAlpha = k * .35; ctx.fillStyle = v.flash.color; ctx.fillRect(0, 0, Wd, Hd); ctx.globalAlpha = 1; }
    }
  }

  return { draw, cellAt, resize };
}
