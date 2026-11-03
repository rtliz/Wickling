// กติกาเกมทั้งหมด (ไม่มี DOM ไม่มีภาพ) · ทำงานเป็นจังหวะคงที่ จึงเล่นซ้ำได้ตรงทุกครั้ง และทดสอบได้ด้วย scripts/check.ts
// เวลา 2 แบบ: t = จังหวะของตัวจริง (นับ 10 วินาทีต่อรอบ) · gt = เวลาของโลก/เงา (หยุดได้ด้วยสกิลหยุดเปลว)

export type Pos = [number, number];
export type SkillId = "root" | "t1" | "t2" | "t3" | "s1" | "s2" | "s3" | "l1" | "l2" | "l3" | "cap";

export const TICK_MS = 250;
export const TICKS = 40;            // 40 จังหวะ × 0.25 วิ = 10 วินาทีต่อรอบ
export const MAX_GHOSTS = 4;
export const LANTERN_TICKS = 12;    // โคมกดสวิตช์ค้าง 3 วิ
export const FREEZE_TICKS = 4;      // หยุดเปลว 1 วิ
export const REWIND_TICKS = 8;      // ย้อนเปลว 2 วิ
export const CLONE_TICKS = 12;      // แยกเปลว 3 วิ
export const ACTIVE_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>(["t2", "t3", "l2", "l3", "cap"]);

export interface LevelDef {
  name: string;
  par: number;          // ใช้เงาไม่เกินนี้ได้ 3 ดาว
  hint: string;         // คำอธิบายเต็ม (เปิดดูด้วยปุ่ม ? ในเกม)
  tip?: string;         // คำใบ้บรรทัดเดียว ≤ ~40 ตัวอักษร ขึ้นครั้งแรกที่เปิดห้อง
  map: string[];        // # กำแพง . พื้น S เริ่ม E ทางออก a/b สวิตช์ A/B ประตู > < ปืนเลเซอร์ } { เลเซอร์กะพริบ
  skill?: SkillId;      // สกิลที่ห้องนี้ออกแบบให้ใช้ (ห้องสอน)
  dark?: boolean;
  tower?: boolean;
}

export type Cell =
  | { t: "wall" } | { t: "floor" } | { t: "exit" }
  | { t: "switch"; k: string } | { t: "door"; k: string }
  | { t: "emit"; d: Pos; pulse?: number };

export interface Emitter { r: number; c: number; d: Pos; pulse?: number }
export interface Room { def: LevelDef; rows: number; cols: number; grid: Cell[][]; emitters: Emitter[]; start: Pos; exit: Pos }

export const DIRS: Record<string, Pos> = { ">": [0, 1], "<": [0, -1], "^": [-1, 0], "v": [1, 0], "}": [0, 1], "{": [0, -1] };
const PULSE: Record<string, number> = { "}": 0, "{": 1 };
/** เลเซอร์กะพริบ: ดับ 3 จังหวะ ทุก 8 จังหวะ (นับตามเวลาโลก) */
export const pulseOff = (gt: number, ph: number) => ((gt - ph) % 8 + 8) % 8 < 3;

export function parseRoom(def: LevelDef): Room {
  const rows = def.map.length, cols = def.map[0].length, grid: Cell[][] = [], emitters: Emitter[] = [];
  let start: Pos | null = null, exit: Pos | null = null;
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const ch = def.map[r][c];
      if (ch === "#") row.push({ t: "wall" });
      else if (DIRS[ch]) { const e: Emitter = { r, c, d: DIRS[ch], pulse: PULSE[ch] }; emitters.push(e); row.push({ t: "emit", d: e.d, pulse: e.pulse }); }
      else if (ch === "S") { start = [r, c]; row.push({ t: "floor" }); }
      else if (ch === "E") { exit = [r, c]; row.push({ t: "exit" }); }
      else if (/[a-z]/.test(ch)) row.push({ t: "switch", k: ch });
      else if (/[A-Z]/.test(ch)) row.push({ t: "door", k: ch.toLowerCase() });
      else row.push({ t: "floor" });
    }
    grid.push(row);
  }
  if (!start || !exit) throw new Error(`ห้อง "${def.name}" ไม่มีจุดเริ่มหรือทางออก`);
  return { def, rows, cols, grid, emitters, start, exit };
}

export interface Ghost { rec: Pos[]; lantern: { p: Pos; t0: number } | null; delay: number; twin: boolean }
export interface Clone { p: Pos; pPrev: Pos; path: Pos[]; until: number }
export interface BeamSeg { from: Pos; to: Pos; blocked: boolean }
export type Outcome = null | "win" | "zap" | "timeout";

export interface Round {
  t: number; gt: number; gtPrev: number;
  p: Pos; pPrev: Pos; path: Pos[]; rec: Pos[];
  freeze: number; used: Partial<Record<SkillId, boolean>>;
  lantern: { p: Pos; t0: number } | null;
  dashArmed: boolean; dashFrom: Pos | null;
  clone: Clone | null; ctrl: "main" | "clone";
  pressed: Record<string, number | "p">; open: Record<string, boolean>;
  beam: Set<string>; beamSegs: BeamSeg[]; lanterns: Pos[];
  outcome: Outcome;
}

export const key = (p: Pos) => p[0] + "," + p[1];
const cellOf = (room: Room, p: Pos) => room.grid[p[0]][p[1]];
const isSolid = (c: Cell) => c.t === "wall" || c.t === "emit";

export function newRound(room: Room, ghosts: Ghost[]): Round {
  const r: Round = {
    t: 0, gt: 0, gtPrev: 0, p: [...room.start], pPrev: [...room.start], path: [], rec: [[...room.start]],
    freeze: 0, used: {}, lantern: null, dashArmed: false, dashFrom: null, clone: null, ctrl: "main",
    pressed: {}, open: {}, beam: new Set(), beamSegs: [], lanterns: [], outcome: null,
  };
  evaluate(room, ghosts, r);
  return r;
}

/** ตำแหน่งเงาทุกตัว ณ เวลาโลก gt (รวมการหน่วงเวลาและเงากระจก) · ci = ลำดับเงาสำหรับสี */
export function ghostList(room: Room, ghosts: Ghost[], gt: number): { p: Pos; ci: number; twin: boolean }[] {
  const out: { p: Pos; ci: number; twin: boolean }[] = [];
  ghosts.forEach((g, i) => {
    const p = g.rec[Math.max(0, Math.min(gt - g.delay, g.rec.length - 1))];
    out.push({ p, ci: i, twin: false });
    if (g.twin) out.push({ p: [p[0], room.cols - 1 - p[1]], ci: i, twin: true });
  });
  return out;
}

/** สวิตช์ → ประตู → เลเซอร์ จากตำแหน่งทุกตัวในจังหวะนี้ · คืนสวิตช์ที่เพิ่งถูกกด (ไว้เล่นเสียง) */
export function evaluate(room: Room, ghosts: Ghost[], r: Round): (number | "p")[] {
  const gl = ghostList(room, ghosts, r.gt), gp = gl.map(x => x.p);
  const bodies: Pos[] = r.clone ? [r.p, r.clone.p] : [r.p];
  const all = gp.concat(bodies);
  const lan: Pos[] = [];
  if (r.lantern && r.t >= r.lantern.t0 && r.t < r.lantern.t0 + LANTERN_TICKS) lan.push(r.lantern.p);
  for (const g of ghosts) { const lt = r.gt - g.delay; if (g.lantern && lt >= g.lantern.t0 && lt < g.lantern.t0 + LANTERN_TICKS) lan.push(g.lantern.p); }
  const pressed: Record<string, number | "p"> = {}, open: Record<string, boolean> = {};
  all.forEach((p, idx) => { const c = cellOf(room, p); if (c.t === "switch" && !(c.k in pressed)) pressed[c.k] = idx < gp.length ? gl[idx].ci : "p"; });
  for (const p of lan) { const c = cellOf(room, p); if (c.t === "switch" && !(c.k in pressed)) pressed[c.k] = "p"; }
  const fresh = Object.keys(pressed).filter(k => !(k in r.pressed)).map(k => pressed[k]);
  for (const k of "abcdefghijklmnopqrstuvwxyz") if (k in pressed) open[k] = true;
  for (const p of all) { const c = cellOf(room, p); if (c.t === "door") open[c.k] = true; }   // ประตูปิดทับคนไม่ได้
  const ghostSet = new Set(gp.map(key)), bodySet = new Set(bodies.map(key));
  const beam = new Set<string>(), segs: BeamSeg[] = [];
  for (const e of room.emitters) {
    if (e.pulse !== undefined && pulseOff(r.gt, e.pulse)) continue;
    let rr = e.r + e.d[0], cc = e.c + e.d[1], end: Pos | null = null;
    while (rr >= 0 && cc >= 0 && rr < room.rows && cc < room.cols) {
      const cell = room.grid[rr][cc], k = rr + "," + cc;
      if (isSolid(cell) || (cell.t === "door" && !open[cell.k])) break;
      if (ghostSet.has(k)) { end = [rr, cc]; break; }
      beam.add(k); end = [rr, cc];
      if (bodySet.has(k)) break;
      rr += e.d[0]; cc += e.d[1];
    }
    if (end) segs.push({ from: [e.r, e.c], to: end, blocked: ghostSet.has(key(end)) });
  }
  Object.assign(r, { pressed, open, beam, beamSegs: segs, lanterns: lan });
  return fresh;
}

export function passable(room: Room, r: Round, p: Pos): boolean {
  const c = cellOf(room, p);
  if (isSolid(c)) return false;
  if (c.t === "door") return !!r.open[c.k];
  return true;
}

/** ทางสั้นที่สุด (มองประตูเป็นทางเดิน ถ้าประตูปิดตัวละครจะยืนรอหน้าประตู) */
export function findPath(room: Room, from: Pos, to: Pos): Pos[] | null {
  if (to[0] < 0 || to[1] < 0 || to[0] >= room.rows || to[1] >= room.cols || isSolid(cellOf(room, to))) return null;
  const prev = new Map<string, Pos | null>([[key(from), null]]), q: Pos[] = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (key(cur) === key(to)) break;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n: Pos = [cur[0] + dr, cur[1] + dc];
      if (n[0] < 0 || n[1] < 0 || n[0] >= room.rows || n[1] >= room.cols || isSolid(cellOf(room, n)) || prev.has(key(n))) continue;
      prev.set(key(n), cur); q.push(n);
    }
  }
  if (!prev.has(key(to))) return null;
  const path: Pos[] = []; let k: Pos | null = to;
  while (k && key(k) !== key(from)) { path.unshift(k); k = prev.get(key(k)) ?? null; }
  return path;
}

/** แตะช่อง: สั่งดวงที่กำลังบังคับให้เดินไป · คืน false ถ้าไปไม่ได้ */
export function tapCell(room: Room, r: Round, p: Pos): boolean {
  const who = r.ctrl === "clone" && r.clone ? r.clone : r;
  const path = key(p) === key(who.p) ? [] : findPath(room, who.p, p);
  if (!path) return false;
  who.path = path;
  return true;
}

export interface StepEvents { fresh: (number | "p")[]; cloneLost: boolean; cloneExpired: boolean }

/** เดิน 1 จังหวะ */
export function step(room: Room, ghosts: Ghost[], r: Round): StepEvents {
  const ev: StepEvents = { fresh: [], cloneLost: false, cloneExpired: false };
  if (r.outcome) return ev;
  r.t++;
  r.gtPrev = r.gt;
  if (r.freeze > 0) r.freeze--; else r.gt++;
  r.pPrev = [...r.p];
  const steps = r.dashArmed && r.path.length ? 2 : 1;
  let moved = 0;
  for (let k = 0; k < steps; k++) if (r.path.length && passable(room, r, r.path[0])) { r.p = r.path.shift()!; moved++; }
  r.dashFrom = null;
  if (steps === 2) { r.dashArmed = false; if (moved) r.dashFrom = r.pPrev; }
  if (r.clone) {
    r.clone.pPrev = [...r.clone.p];
    if (r.t >= r.clone.until) { r.clone = null; r.ctrl = "main"; ev.cloneExpired = true; }
    else if (r.clone.path.length && passable(room, r, r.clone.path[0])) r.clone.p = r.clone.path.shift()!;
  }
  ev.fresh = evaluate(room, ghosts, r);
  r.rec.push([...r.p]);
  if (r.clone && r.beam.has(key(r.clone.p))) { r.clone = null; r.ctrl = "main"; ev.cloneLost = true; }
  if (r.beam.has(key(r.p))) r.outcome = "zap";
  else if (key(r.p) === key(room.exit) || (r.clone && key(r.clone.p) === key(room.exit))) r.outcome = "win";
  else if (r.t >= TICKS) r.outcome = "timeout";
  return ev;
}

/** รอบนี้กลายเป็นเงา (โคมในรอบนี้เล่นซ้ำพร้อมเงาด้วย) */
export function toGhost(r: Round): Ghost {
  return { rec: r.rec, lantern: r.lantern ? { p: r.lantern.p, t0: r.lantern.t0 } : null, delay: 0, twin: false };
}

/** ใช้สกิลแบบกด · คืนข้อความบอกผู้เล่น หรือ null ถ้าใช้ไม่ได้ */
export function useSkill(room: Room, ghosts: Ghost[], r: Round, id: SkillId): string | null {
  if (r.outcome) return null;
  if (id === "cap" && r.clone) { r.ctrl = r.ctrl === "clone" ? "main" : "clone"; return r.ctrl === "clone" ? "คุมดวงที่ 2" : "คุมดวงที่ 1"; }
  if (r.used[id] || !ACTIVE_SKILLS.has(id)) return null;
  r.used[id] = true;
  switch (id) {
    case "t2": r.freeze = FREEZE_TICKS; return "หยุดเปลว! โลกหยุด 1 วิ";
    case "l3": r.lantern = { p: [...r.p], t0: r.t }; evaluate(room, ghosts, r); return "วางโคม · ค้าง 3 วิ";
    case "t3": {
      const back = r.rec[Math.max(0, r.rec.length - 1 - REWIND_TICKS)];
      r.p = [...back]; r.pPrev = [...back]; r.path = []; evaluate(room, ghosts, r);
      return "ย้อนเปลว! กลับ 2 วิ";
    }
    case "l2": r.dashArmed = true; return "แตะช่องที่จะพุ่งไป";
    case "cap": r.clone = { p: [...r.p], pPrev: [...r.p], path: [], until: r.t + CLONE_TICKS }; r.ctrl = "clone";
      return "แยกเปลว! คุมดวงที่ 2";
  }
  return null;
}

export function starsFor(ghostsUsed: number, par: number): 1 | 2 | 3 {
  return ghostsUsed <= par ? 3 : ghostsUsed === par + 1 ? 2 : 1;
}
