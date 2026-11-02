// pnpm check: ให้โปรแกรมเล่นผ่านห้องจริงตามกติกาเกม (src/core/sim.ts)
// 1) ห้องที่ออกแบบเอง: โครงสร้างถูกต้อง + เล่นตามคำตอบที่เขียนไว้แล้วต้องผ่าน (รวมสกิลทุกตัวที่มีห้องสอน)
// 2) หอคอย ∞: สุ่มชั้น 1–200 แล้วให้โปรแกรมเล่นผ่านทุกชั้นด้วยเงาไม่เกิน par
import { LEVELS } from "../src/core/levels";
import { genTower } from "../src/core/tower";
import { autoSolve } from "../src/core/solve";
import {
  parseRoom, newRound, step, tapCell, toGhost, useSkill, findPath, key, MAX_GHOSTS, TICKS,
  type Ghost, type Pos, type Room, type Round, type SkillId, type LevelDef,
} from "../src/core/sim";

let fails = 0;
const fail = (msg: string) => { fails++; console.log("  ✗ " + msg); };

type Act = { tap: Pos } | { skill: SkillId } | { end: true } | { twin: number } | { delay: [number, number] };
type Script = Record<number, Act[]>[];   // ทีละรอบ: { จังหวะ: [การกระทำ] }

function play(room: Room, script: Script): { outcome: string; ghosts: Ghost[]; r: Round } {
  const ghosts: Ghost[] = [];
  let r = newRound(room, ghosts);
  for (let i = 0; i < script.length; i++) {
    r = newRound(room, ghosts);
    for (let t = 0; t <= TICKS && !r.outcome; t++) {
      let ended = false;
      for (const a of script[i][t] ?? []) {
        if ("tap" in a) { if (!tapCell(room, r, a.tap)) throw new Error(`แตะ ${a.tap} ไม่ได้`); }
        else if ("skill" in a) { if (!useSkill(room, ghosts, r, a.skill)) throw new Error(`ใช้สกิล ${a.skill} ไม่ได้`); }
        else if ("end" in a) ended = true;
      }
      if (ended) { r.outcome = "timeout"; break; }
      step(room, ghosts, r);
    }
    if (r.outcome === "win") return { outcome: "win", ghosts, r };
    if (i < script.length - 1) {
      ghosts.push(toGhost(r));
      for (const a of Object.values(script[i + 1]).flat()) {
        if ("twin" in a) ghosts[a.twin].twin = true;
        if ("delay" in a) ghosts[a.delay[0]].delay = a.delay[1];
      }
    }
  }
  return { outcome: r.outcome ?? "none", ghosts, r };
}

function structure(def: LevelDef, label: string) {
  const room = parseRoom(def);
  const flat = def.map.join("");
  if (def.map.some(row => row.length !== def.map[0].length)) fail(`${label}: แถวยาวไม่เท่ากัน`);
  if ((flat.match(/S/g) ?? []).length !== 1 || (flat.match(/E/g) ?? []).length !== 1) fail(`${label}: ต้องมี S และ E อย่างละ 1`);
  for (const d of new Set(flat.match(/[ABCD]/g) ?? [])) if (!flat.includes(d.toLowerCase())) fail(`${label}: ประตู ${d} ไม่มีสวิตช์`);
  if (!findPath(room, room.start, room.exit)) fail(`${label}: เดินจากจุดเริ่มไปทางออกไม่ได้`);
  return room;
}

// ---------- 1) ห้องที่ออกแบบเอง ----------
console.log("ห้องที่ออกแบบเอง");
const W = (t: number, ...a: Act[]) => ({ [t]: a });
const merge = (...o: Record<number, Act[]>[]) => Object.assign({}, ...o);
const SOLUTIONS: Record<string, { script: Script; ghosts: number; also?: (room: Room) => void }> = {
  "สวิตช์แรก": { ghosts: 1, script: [W(0, { tap: [7, 1] }), W(0, { tap: [1, 3] })] },
  "ห้องมืด": { ghosts: 2, script: [W(0, { tap: [5, 1] }), W(10, { tap: [3, 5] }), W(14, { tap: [1, 3] })] },
  "ข้ามลำแสง": { ghosts: 0, script: [merge(W(0, { tap: [5, 3] }), W(3, { skill: "l2" }, { tap: [3, 3] }), W(4, { tap: [1, 3] }))] },
  "เลเซอร์กะพริบ": { ghosts: 0, script: [merge(W(0, { tap: [5, 3] }), W(2, { skill: "t2" }, { tap: [1, 3] }))] },
  "โคมเฝ้าสวิตช์": { ghosts: 0, script: [merge(W(0, { tap: [7, 1] }), W(4, { skill: "l3" }, { tap: [1, 3] }))] },
  "สวิตช์คู่": { ghosts: 1, script: [W(0, { tap: [6, 1] }), W(0, { twin: 0 }, { tap: [1, 3] })] },
  "ทางแยก": { ghosts: 0, script: [W(5, { tap: [1, 1] })],
    also: room => {   // แตะเร็วเกินไปต้องโดนเลเซอร์กะพริบ · ย้อนเปลวต้องพากลับจุดเริ่ม
      if (play(room, [W(0, { tap: [1, 1] })]).outcome !== "zap") fail("ทางแยก: แตะตอนเริ่มควรโดนเลเซอร์");
      const g: Ghost[] = [], r = newRound(room, g); tapCell(room, r, [1, 1]); step(room, g, r); step(room, g, r);
      useSkill(room, g, r, "t3");
      if (key(r.p) !== key(room.start)) fail("ทางแยก: ย้อนเปลวไม่กลับจุดเริ่ม");
    } },
  "สองดวงพร้อมกัน": { ghosts: 0, script: [W(0, { skill: "cap" }, { tap: [7, 5] }, { skill: "cap" }, { tap: [1, 3] })] },
};
LEVELS.forEach((def, i) => {
  const label = `ห้อง ${i + 1} ${def.name}`;
  const room = structure(def, label);
  const sol = SOLUTIONS[def.name];
  if (!sol) {   // ห้องที่ไม่มีคำตอบเขียนไว้: ให้ตัวแก้อัตโนมัติเล่น (ใช้แค่เงา) ต้องผ่านด้วยเงาไม่เกิน par + 1
    const res = autoSolve(room);
    if (!res.ok) fail(`${label}: ตัวแก้อัตโนมัติไม่ผ่าน (${res.why})`);
    else if (res.ghosts > def.par + 1) fail(`${label}: ตัวแก้ใช้เงา ${res.ghosts} ตัว มากกว่า par ${def.par} + 1`);
    else console.log(`  ✓ ${label}: ตัวแก้อัตโนมัติผ่านด้วยเงา ${res.ghosts} ตัว (par ${def.par}${res.ghosts > def.par ? " ต้องใช้จังหวะเพื่อได้ 3 ดาว" : ""})`);
    return;
  }
  const res = play(room, sol.script);
  if (res.outcome !== "win") fail(`${label}: เล่นตามคำตอบแล้วไม่ผ่าน (${res.outcome})`);
  else if (res.ghosts.length !== sol.ghosts) fail(`${label}: ผ่านแต่ใช้เงา ${res.ghosts.length} ตัว (คาด ${sol.ghosts})`);
  else console.log(`  ✓ ${label}: ผ่านด้วยเงา ${res.ghosts.length} ตัว`);
  sol.also?.(room);
});

// ---------- 2) หอคอย ∞ ----------
const FLOORS = 200;
console.log(`หอคอย ∞ ชั้น 1–${FLOORS}`);
let towerOk = 0;
const used: number[] = [];
for (let f = 1; f <= FLOORS; f++) {
  let def: LevelDef;
  try { def = genTower(f); } catch (e) { fail(`ชั้น ${f}: ${(e as Error).message}`); continue; }
  structure(def, `ชั้น ${f}`);
  const res = autoSolve(def);
  if (res.ok && res.ghosts <= Math.min(def.par, MAX_GHOSTS)) { towerOk++; used.push(res.ghosts); }
  else fail(`ชั้น ${f}: ${res.why ?? `ใช้เงา ${res.ghosts} > par ${def.par}`}`);
}
const dist = [0, 1, 2, 3, 4].map(n => used.filter(x => x === n).length);
console.log(`  ${towerOk}/${FLOORS} ชั้นเล่นผ่านอัตโนมัติ · จำนวนเงาที่ใช้ 0–4 ตัว: ${dist.join(" / ")}`);

if (fails) { console.log(`\nไม่ผ่าน ${fails} ข้อ`); process.exit(1); }
console.log("\nผ่านทั้งหมด");
