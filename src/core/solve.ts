import { parseRoom, newRound, step, toGhost, key, TICKS, type Ghost, type LevelDef, type Pos, type Room } from "./sim";

// ตัวแก้ปริศนาอัตโนมัติ (ใช้แค่เงา ไม่ใช้สกิล) สำหรับห้องแบบหอคอย:
// ส่งเงาไปยืนสวิตช์/จุดบังเลเซอร์ทีละตัว โดยเลือกเป้าหมายที่เดินไปได้โดยไม่ผ่านลำแสงที่ยังไม่ถูกบัง
// แต่ละรอบรอให้เงาเก่าเข้าที่ครบก่อนออกเดิน แล้วรอบสุดท้ายเดินไปทางออก · เล่นด้วยกติกาจริง (sim.ts)

export interface SolveResult { ok: boolean; ghosts: number; why?: string; plan?: Pos[] }

function targetsOf(room: Room) {
  const out: { p: Pos; kind: "switch" | "block"; k: string; lane?: number }[] = [];
  room.grid.forEach((row, r) => row.forEach((c, cc) => { if (c.t === "switch") out.push({ p: [r, cc], kind: "switch", k: c.k }); }));
  room.emitters.forEach((e, i) => { if (e.pulse === undefined) out.push({ p: [e.r + e.d[0], e.c + e.d[1]], kind: "block", k: "L" + i, lane: i }); });
  return out;
}

/** ช่องที่ลำแสงของปืน i ผ่าน (ถ้าไม่มีใครบัง) */
function laneCells(room: Room, i: number): Set<string> {
  const e = room.emitters[i], s = new Set<string>();
  let r = e.r + e.d[0], c = e.c + e.d[1];
  while (r >= 0 && c >= 0 && r < room.rows && c < room.cols) {
    const cell = room.grid[r][c];
    if (cell.t === "wall" || cell.t === "emit" || cell.t === "door") break;
    s.add(r + "," + c); r += e.d[0]; c += e.d[1];
  }
  return s;
}

function safePath(room: Room, from: Pos, to: Pos, held: Set<string>): Pos[] | null {
  const bad = new Set<string>();
  room.emitters.forEach((e, i) => { if (e.pulse === undefined && !held.has("L" + i)) laneCells(room, i).forEach(k => bad.add(k)); });
  bad.delete(key(to));
  const prev = new Map<string, Pos | null>([[key(from), null]]), q: Pos[] = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (key(cur) === key(to)) break;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n: Pos = [cur[0] + dr, cur[1] + dc], k = key(n);
      if (n[0] < 0 || n[1] < 0 || n[0] >= room.rows || n[1] >= room.cols || prev.has(k) || bad.has(k)) continue;
      const cell = room.grid[n[0]][n[1]];
      if (cell.t === "wall" || cell.t === "emit" || (cell.t === "door" && !held.has(cell.k))) continue;
      prev.set(k, cur); q.push(n);
    }
  }
  if (!prev.has(key(to))) return null;
  const path: Pos[] = []; let k: Pos | null = to;
  while (k && key(k) !== key(from)) { path.unshift(k); k = prev.get(key(k)) ?? null; }
  return path;
}

export function autoSolve(def: LevelDef | Room): SolveResult {
  const room = "grid" in def ? def : parseRoom(def);
  const ghosts: Ghost[] = [], held = new Set<string>(), plan: Pos[] = [];
  let ready = 0;
  const run = (path: Pos[]) => {
    const r = newRound(room, ghosts);
    for (let t = 0; t < TICKS && !r.outcome; t++) { if (t === ready) r.path = path.map(p => [...p] as Pos); step(room, ghosts, r); }
    return r;
  };
  const left = targetsOf(room).sort((a, b) => b.p[0] - a.p[0]);
  while (left.length) {
    let done = false;
    for (let i = 0; i < left.length && !done; i++) {
      const tg = left[i], path = safePath(room, room.start, tg.p, held);
      if (!path || ready + path.length >= TICKS) continue;
      const r = run(path), end = r.rec[r.rec.length - 1];
      if (key(end) !== key(tg.p)) continue;
      ready = Math.max(ready, r.rec.findIndex(p => key(p) === key(tg.p)));
      ghosts.push(toGhost(r)); held.add(tg.k); plan.push(tg.p); left.splice(i, 1); done = true;
    }
    if (!done) return { ok: false, ghosts: ghosts.length, why: `ส่งเงาไปเป้าหมายที่เหลือไม่ได้ (${left.map(t => t.p.join(",")).join(" ")})` };
  }
  const path = safePath(room, room.start, room.exit, held);
  if (!path) return { ok: false, ghosts: ghosts.length, why: "ไม่มีทางไปทางออก" };
  const r = run(path);
  if (r.outcome !== "win") return { ok: false, ghosts: ghosts.length, why: `รอบสุดท้ายไม่ผ่าน (${r.outcome})` };
  return { ok: true, ghosts: ghosts.length, plan };
}
