// หลักฐานการชนะ (ไม่มี DOM) · เกมจดทุกการแตะ/สกิล/การปรับเงาของห้องนั้นไว้ แล้วส่งให้ Cloud Function `submitWin`
// server เล่นซ้ำด้วย sim.ts ตัวเดียวกัน (functions/game.js สร้างจากไฟล์นี้ด้วย rolldown ตอนเทสต์/deploy) ถ้าชนะจริงจึงให้แต้มกระดาน
// sim เดินเป็นจังหวะคงที่ จึงเล่นซ้ำได้ตรงทุกครั้ง: input ใส่ก่อน step ของจังหวะ r.t ที่จดไว้
//
// Proof = { v, sv: รุ่นกติกา sim, kind: "r" ห้อง | "t" หอคอย, n: ลำดับห้อง (0..) หรือเลขชั้น (1..), eq: สกิลที่ติดตัว 2 ช่อง, rounds }
// แต่ละรอบ = { ops: การปรับเงาก่อนเริ่มรอบ, inp: [จังหวะ, "tap", แถว, คอลัมน์] | [จังหวะ, "sk", สกิล] | [จังหวะ, "end"] }
// รอบที่ไม่ชนะ (หมดเวลา/โดนเลเซอร์/กดจบเอง) กลายเป็นเงา · เงาครบ 4 แล้วยังไม่ชนะ = ล้างเงาทั้งหมด (เหมือน endRound ใน main.ts)
import {
  parseRoom, newRound, step, tapCell, toGhost, useSkill, starsFor,
  ACTIVE_SKILLS, MAX_GHOSTS, TICKS, type Ghost, type LevelDef, type SkillId,
} from "./sim";
import { LEVELS } from "./levels";
import { genTower } from "./tower";

export type Input = [number, "tap", number, number] | [number, "sk", SkillId] | [number, "end"];
export type Op = ["undo"] | ["del", number] | ["delay", number] | ["twin", number];
export interface ProofRound { ops: Op[]; inp: Input[] }
export interface Proof { v: 1; sv: number; kind: "r" | "t"; n: number; eq: (SkillId | null)[]; rounds: ProofRound[] }

// รุ่นกติกาของ sim ที่หลักฐานนี้เล่นด้วย · ⚠️ หลังปล่อยเกม ถ้าแก้ sim.ts / levels.ts / tower.ts จนผลการเล่นเปลี่ยน
// ให้ขึ้น SIM_VERSION แล้วเก็บกติกาเดิมไว้ให้ server เล่นซ้ำหลักฐานรุ่นเก่า (ไม่งั้นแอปรุ่นเก่าส่งแต้มไม่ได้)
// server รับเฉพาะรุ่นที่อยู่ใน SIM_VERSIONS · รุ่นอื่นตอบ "sim-version"
export const SIM_VERSION = 1;
export const SIM_VERSIONS: readonly number[] = [1];
export interface ReplayResult { ok: boolean; why?: string; ghosts: number; stars: number; ticks: number }

// เพดานขนาดหลักฐาน (กันส่งข้อมูลใหญ่ให้ server เล่นนาน)
export const PROOF_MAX_ROUNDS = 60;
export const PROOF_MAX_INPUTS = 400;
export const TOWER_MAX_FLOOR = 100000;
const SKILL_IDS = new Set(["t1", "t2", "t3", "s1", "s2", "s3", "l1", "l2", "l3", "cap"]);

export const proofKey = (p: Pick<Proof, "kind" | "n">) => `${p.kind}${p.n}`;

/** ห้องตามหลักฐาน หรือ null ถ้าไม่มีห้องนี้ */
export function proofLevel(kind: unknown, n: unknown): LevelDef | null {
  if (!Number.isInteger(n)) return null;
  if (kind === "r") return (n as number) >= 0 && (n as number) < LEVELS.length ? LEVELS[n as number] : null;
  if (kind === "t") return (n as number) >= 1 && (n as number) <= TOWER_MAX_FLOOR ? genTower(n as number) : null;
  return null;
}

const bad = (why: string): ReplayResult => ({ ok: false, why, ghosts: 0, stars: 0, ticks: 0 });
const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** ตรวจรูปแบบ + เล่นซ้ำ · ใช้ทั้งในเกม (scripts/check.ts) และที่ server · ไม่ throw (ข้อมูลแปลกทุกแบบ = bad) */
export function replayProof(raw: unknown): ReplayResult {
  try { return replay(raw); } catch { return bad("format"); }
}

const OPS: Record<string, number> = { undo: 1, del: 2, delay: 2, twin: 2 };
const isOp = (op: unknown): op is Op => Array.isArray(op) && typeof op[0] === "string" && OPS[op[0]] === op.length && (op.length === 1 || Number.isInteger(op[1]));
const isInput = (ev: unknown): ev is Input => Array.isArray(ev) && Number.isInteger(ev[0]) && (
  (ev[1] === "tap" && ev.length === 4 && Number.isInteger(ev[2]) && Number.isInteger(ev[3]))
  || (ev[1] === "sk" && ev.length === 3 && typeof ev[2] === "string")
  || (ev[1] === "end" && ev.length === 2));

function replay(raw: unknown): ReplayResult {
  const p = raw as Proof;
  if (!p || typeof p !== "object" || Array.isArray(p) || p.v !== 1) return bad("format");
  if (!SIM_VERSIONS.includes(p.sv)) return bad("sim-version");
  const def = proofLevel(p.kind, p.n);
  if (!def) return bad("level");
  if (!Array.isArray(p.eq) || p.eq.length > 2 || !p.eq.every(id => id === null || SKILL_IDS.has(id as string))) return bad("skills");
  const eq = new Set(p.eq.filter(Boolean) as SkillId[]);
  if (!Array.isArray(p.rounds) || !p.rounds.length || p.rounds.length > PROOF_MAX_ROUNDS) return bad("rounds");
  let inputs = 0;
  for (const rd of p.rounds) {
    if (!rd || typeof rd !== "object" || !Array.isArray(rd.ops) || !Array.isArray(rd.inp) || rd.ops.length > 8) return bad("rounds");
    if (!rd.ops.every(isOp) || !rd.inp.every(isInput)) return bad("format");
    inputs += rd.inp.length;
  }
  if (inputs > PROOF_MAX_INPUTS) return bad("rounds");

  const room = parseRoom(def);
  let ghosts: Ghost[] = [], ticks = 0;
  for (let ri = 0; ri < p.rounds.length; ri++) {
    const { ops, inp } = p.rounds[ri];
    for (const op of ops) {
      const i = op[1] as number;
      if (op[0] === "undo") { if (!ghosts.length) return bad("op"); ghosts.pop(); continue; }
      if (!isInt(i, 0, ghosts.length - 1)) return bad("op");
      if (op[0] === "del") { if (i !== ghosts.length - 1 && !eq.has("s1")) return bad("op"); ghosts.splice(i, 1); }
      else if (op[0] === "delay") { if (!eq.has("s2")) return bad("op"); ghosts[i].delay = (ghosts[i].delay + 4) % 16; }
      else if (op[0] === "twin") { if (!eq.has("s3")) return bad("op"); ghosts[i].twin = !ghosts[i].twin; }
      else return bad("op");
    }
    const r = newRound(room, ghosts);
    let lastT = 0;
    for (const ev of inp) {
      if (!isInt(ev[0], 0, TICKS - 1) || ev[0] < lastT) return bad("input");
      lastT = ev[0];
      while (r.t < ev[0] && !r.outcome) step(room, ghosts, r);
      if (r.outcome) return bad("input-after-end");
      if (ev[1] === "tap") {
        if (!isInt(ev[2], 0, room.rows - 1) || !isInt(ev[3], 0, room.cols - 1) || !tapCell(room, r, [ev[2], ev[3]])) return bad("tap");
      } else if (ev[1] === "sk") {
        if (!ACTIVE_SKILLS.has(ev[2]) || !eq.has(ev[2]) || !useSkill(room, ghosts, r, ev[2])) return bad("skill");
      } else if (ev[1] === "end") {
        if (!inp.length || ev !== inp[inp.length - 1]) return bad("input");
        r.outcome = "timeout";
      } else return bad("input");
    }
    if (!inp.length) return bad("input");   // ไม่แตะเลย รอบไม่เริ่ม (เกมเริ่มรอบเมื่อแตะครั้งแรก)
    while (!r.outcome) step(room, ghosts, r);
    ticks += r.t;
    const last = ri === p.rounds.length - 1;
    if (r.outcome === "win") {
      if (!last) return bad("win-not-last");
      return { ok: true, ghosts: ghosts.length, stars: starsFor(ghosts.length, def.par), ticks };
    }
    if (last) return bad("no-win");
    if (ghosts.length >= MAX_GHOSTS) ghosts = [];
    else ghosts = [...ghosts, toGhost(r)];
  }
  return bad("no-win");
}
