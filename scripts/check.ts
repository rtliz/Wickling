// pnpm check: ให้โปรแกรมเล่นผ่านห้องจริงตามกติกาเกม (src/core/sim.ts)
// 1) ห้องที่ออกแบบเอง: โครงสร้างถูกต้อง + เล่นตามคำตอบที่เขียนไว้แล้วต้องผ่าน (รวมสกิลทุกตัวที่มีห้องสอน)
// 2) หอคอย ∞: สุ่มชั้น 1–200 แล้วให้โปรแกรมเล่นผ่านทุกชั้นด้วยเงาไม่เกิน par
// 1b) หลักฐานการชนะ: เล่นซ้ำแบบ server ผ่าน · ปลอมไม่ผ่าน
// 3) เซฟ: เซฟ v1 ของผู้เล่นเดิม migrate เป็น v2 → v3 ได้ · ลายเซ็นกันแก้ · validate ตัดค่าหัวใจ · กติกาหัวใจ
import { LEVELS } from "../src/core/levels";
import { genTower } from "../src/core/tower";
import { autoSolve } from "../src/core/solve";
import { parseSave, serializeSave, SAVE_VERSION } from "../src/core/save";
import { sealSave } from "../src/core/saveguard";
import { replayProof, SIM_VERSION, type Proof, type ProofRound, type Input, type Op } from "../src/core/proof";
import { HEARTS, payToPlay, refreshDay, unlimited, addUnlimited, freshHearts, dayKey } from "../src/core/hearts";
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

// ---------- 1b) หลักฐานการชนะ (src/core/proof.ts = ตัวเดียวกับที่ server ใช้ใน functions/wins.js) ----------
console.log("หลักฐานการชนะ (เล่นซ้ำแบบ server)");
// แปลงคำตอบด้านบนเป็นหลักฐานแบบที่เกมจด: input ที่จังหวะ t ใส่ก่อน step · twin/delay = การปรับเงาก่อนเริ่มรอบ
function toProof(n: number, script: Script): Proof {
  const eq = new Set<SkillId>();
  const rounds: ProofRound[] = script.map(sc => {
    const ops: Op[] = [], inp: Input[] = [];
    for (const [t, acts] of Object.entries(sc).sort((x, y) => Number(x[0]) - Number(y[0]))) for (const a of acts) {
      if ("tap" in a) inp.push([Number(t), "tap", a.tap[0], a.tap[1]]);
      else if ("skill" in a) { inp.push([Number(t), "sk", a.skill]); eq.add(a.skill); }
      else if ("end" in a) inp.push([Number(t), "end"]);
      else if ("twin" in a) { ops.push(["twin", a.twin]); eq.add("s3"); }
      else if ("delay" in a) { for (let k = 0; k < a.delay[1] / 4; k++) ops.push(["delay", a.delay[0]]); eq.add("s2"); }
    }
    return { ops, inp };
  });
  return { v: 1, sv: SIM_VERSION, kind: "r", n, eq: [...eq, null, null].slice(0, 2) as (SkillId | null)[], rounds };
}
LEVELS.forEach((def, i) => {
  const sol = SOLUTIONS[def.name];
  if (!sol) return;
  const proof = toProof(i, sol.script), res = replayProof(proof);
  if (!res.ok || res.ghosts !== sol.ghosts) { fail(`ห้อง ${i + 1}: หลักฐานจากคำตอบเล่นซ้ำไม่ผ่าน (${res.why ?? res.ghosts})`); return; }
  // ปลอม: ตัดรอบแรก / เอาสกิลออกจากช่องติดตัว → ต้องไม่ผ่าน
  if (proof.rounds.length > 1 && replayProof({ ...proof, rounds: proof.rounds.slice(1) }).ok) fail(`ห้อง ${i + 1}: ตัดรอบเงาออกแล้วยังผ่าน`);
  if (proof.eq.some(Boolean) && replayProof({ ...proof, eq: [null, null] }).ok) fail(`ห้อง ${i + 1}: ไม่มีสกิลในช่องแต่ยังผ่าน`);
});
console.log(`  ✓ หลักฐานจากคำตอบ ${Object.keys(SOLUTIONS).length} ห้องเล่นซ้ำผ่าน · ตัดเงา/ถอดสกิลแล้วไม่ผ่าน`);
{
  const r1 = toProof(0, SOLUTIONS["สวิตช์แรก"].script);
  const bads: unknown[] = [null, {}, { ...r1, v: 2 }, { ...r1, n: 99 }, { ...r1, kind: "t", n: 0 },
    { ...r1, rounds: [{ ops: [], inp: [[0, "tap", 0, 0]] }] }, { ...r1, rounds: [{ ops: [["undo"]], inp: [[0, "tap", 1, 3]] }] },
    { ...r1, rounds: Array.from({ length: 61 }, () => r1.rounds[0]) }, { ...r1, sv: 99 }, { ...r1, sv: undefined },
    // รูปแบบแปลก ๆ ต้องไม่ throw
    { ...r1, rounds: [{ ops: [null], inp: [] }] }, { ...r1, rounds: [{ ops: [["del"]], inp: [[0, "tap", 7, 1]] }] }, { ...r1, rounds: [{ ops: [], inp: [5] }] },
    { ...r1, rounds: [{ ops: [], inp: [[0, "tap", "7", 1]] }] }, { ...r1, eq: "t2" }, { ...r1, rounds: [null] }, [], 42];
  let threw = false;
  const passed = bads.filter(b => { try { return replayProof(b).ok; } catch { threw = true; return false; } });
  if (passed.length || threw) fail("หลักฐานผิดรูปแบบผ่านได้หรือทำให้ throw"); else console.log("  ✓ หลักฐานผิดรูปแบบ/ห้องไม่มีจริง/เกินขนาด/รุ่น sim ไม่รู้จัก ไม่ผ่าน และไม่ throw");
  if (replayProof({ ...r1, sv: 99 }).why !== "sim-version") fail("รุ่น sim ที่ไม่รู้จักต้องตอบ sim-version");
}

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

// ---------- 3) เซฟและหัวใจ ----------
console.log("เซฟ v1 → v2 → v3 และหัวใจ");
{
  const now = new Date(2026, 10, 3, 15, 0).getTime();
  const expect = (ok: boolean, msg: string) => { if (ok) console.log("  ✓ " + msg); else fail(msg); };
  // เซฟจริงแบบที่ v1 เขียน (JSON ไม่มีลายเซ็น)
  const v1 = JSON.stringify({ v: 1, best: { 0: 3, 1: 2, 4: 1 }, tower: { floor: 7, best: 6 }, skills: { owned: ["root", "t1", "t2"], eq: ["t2", null], spent: 6 }, devBonus: 0 });
  const a = parseSave(v1, false, now);
  expect(a.v === SAVE_VERSION && a.best[0] === 3 && a.best[4] === 1 && a.tower.floor === 7 && a.tower.best === 6
    && a.skills.owned.includes("t2") && a.skills.eq[0] === "t2" && a.skills.spent === 6, "เซฟ v1 ย้ายเป็น v2 ดาว/หอคอย/สกิลครบ");
  expect(a.hearts.n === HEARTS.perDay && !a.hearts.noAds && a.hearts.until === 0 && a.hearts.day === dayKey(new Date(now)), "เซฟ v1 ได้หัวใจเริ่มต้น 5 ดวง ไม่มีสิทธิ์ซื้อ");
  // JSON ไม่มีลายเซ็นปลอมหัวใจ/ลบโฆษณามา → ไม่ได้
  const forged = JSON.stringify({ ...JSON.parse(v1), v: 2, hearts: { ...freshHearts(now), n: 99, noAds: true, from: now, until: now + 9e6 } });
  const f = parseSave(forged, false, now);
  expect(f.hearts.n === HEARTS.perDay && !f.hearts.noAds && f.hearts.until === 0, "JSON ไม่มีลายเซ็นตั้งหัวใจ/ลบโฆษณาเองไม่ได้");
  let threw = false; try { parseSave(v1, true, now); } catch { threw = true; }
  expect(threw, "เครื่องที่เคยเซฟแบบมีลายเซ็นแล้ว ไม่รับ JSON ไม่มีลายเซ็น");
  // วนเซฟ/โหลด v2
  a.hearts.n = 2; a.hearts.noAds = true; a.hearts.tx = ["p1"];
  const sealed = serializeSave(a), b = parseSave(sealed, true, now);
  expect(b.hearts.n === 2 && b.hearts.noAds && b.hearts.tx[0] === "p1" && b.best[1] === 2, "เซฟ v2 มีลายเซ็นโหลดกลับได้ครบ");
  threw = false; try { parseSave(sealed.slice(0, -3) + "zzz", true, now); } catch { threw = true; }
  expect(threw, "แก้เซฟที่มีลายเซ็นแล้วโหลดไม่ผ่าน");
  // validate ตัดค่าเกินเพดาน
  const big = parseSave(serializeSave({ ...a, hearts: { ...a.hearts, n: 500, ad: 99, from: now, until: now + 1e12, attempt: "<x>" } }), true, now);
  expect(big.hearts.n === HEARTS.max && big.hearts.ad === 0 && big.hearts.until === 0 && big.hearts.attempt === null, `validate ตัดหัวใจ ≤ ${HEARTS.max} และเวลาไม่จำกัดที่ผิดปกติ`);
  expect(big.lb.flagged, "เซฟที่ถูกแก้หัวใจเกินเพดาน = flagged (ไม่ขึ้นกระดาน)");
  // รางวัลอันดับเก็บเกิน 8 ได้ (เซฟ v3 รูปแบบเดิม ไม่ต้องขึ้นเวอร์ชัน)
  const v3 = sealSave({ ...a, v: 3, lb: { checked: null, flagged: false, debug: false }, hearts: { ...a.hearts, n: 12, day: dayKey(new Date(now)) } });
  const rich = parseSave(v3, true, now);
  expect(rich.hearts.n === 12 && !rich.lb.flagged, "เซฟ v3 หัวใจ 12 (รางวัลอันดับ) โหลดได้ครบ ไม่ถูกตัด ไม่ flagged");
  expect(!refreshDay(rich.hearts, now) && refreshDay(rich.hearts, now + 86_400_000) && rich.hearts.n === 12, "เติมเที่ยงคืนไม่ลบหัวใจส่วนเกิน");
  rich.hearts.n = 12; const pp = { best: {} as Record<string, number>, tower: { floor: 1, best: 0 } };
  expect(payToPlay(rich.hearts, pp, 5, now + 86_400_000) === "paid" && rich.hearts.n === 11, "ใช้หัวใจส่วนเกินได้ตามปกติ (12 → 11)");
  // v2 → v3 (กระดาน): เซฟ v2 จริงแบบมีลายเซ็น (sealSave ตรงแบบที่เวอร์ชันก่อนเขียน)
  const v2 = sealSave({ v: 2, best: { 0: 3, 1: 2, 4: 1 }, tower: { floor: 7, best: 6 }, skills: { owned: ["root", "t1"], eq: [null, null], spent: 2 }, devBonus: 0,
    hearts: { ...freshHearts(now), n: 3, noAds: true, tx: ["gpa.1"] } });
  const c = parseSave(v2, true, now);
  expect(c.v === SAVE_VERSION && !c.lb.flagged && !c.lb.debug && c.lb.checked === null && c.hearts.n === 3 && c.hearts.noAds && c.hearts.tx[0] === "gpa.1"
    && c.best[4] === 1 && c.tower.best === 6 && c.skills.owned.includes("t1"), "เซฟ v2 → v3: หัวใจ/สิทธิ์ซื้อ/ดาว/หอคอย/สกิลเดิมครบ + สถานะกระดานเริ่มต้น");
  c.lb.checked = "u:W:M";
  const d = parseSave(serializeSave(c), true, now);
  expect(d.lb.checked === "u:W:M" && !d.lb.flagged, "เซฟ v3 วนเซฟ/โหลดสถานะกระดานครบ");
  const dbg = parseSave(serializeSave({ ...c, devBonus: 20 }), true, now);
  expect(dbg.lb.debug || !import.meta.env?.DEV, "ดาวทดสอบ (dev) = debug ไม่ขึ้นกระดาน");
  // กติกาหัวใจ
  const p = { best: { 0: 1 } as Record<string, number>, tower: { floor: 3, best: 2 } };
  const h = freshHearts(now);
  expect(payToPlay(h, p, 0, now) === "ok" && payToPlay(h, p, 1, now) === "ok" && h.n === 5, "ห้องที่ผ่านแล้ว/ห้อง 1–2 ไม่ใช้หัวใจ");
  expect(payToPlay(h, p, 5, now) === "paid" && h.n === 4 && payToPlay(h, p, 5, now) === "ok" && h.n === 4, "ห้องใหม่ใช้ 1 ดวง เล่นรอบต่อไปในห้องเดิมไม่เสียเพิ่ม");
  h.attempt = null;
  expect(payToPlay(h, p, 5, now) === "paid" && h.n === 3, "เริ่มห้องใหม่ (ล้างเงา) ใช้อีก 1 ดวง");
  expect(payToPlay(h, p, -1, now) === "paid" && h.attempt === "t3", "หอคอยชั้นที่ยังไม่ผ่านใช้หัวใจ");
  h.n = 0; h.attempt = null;
  expect(payToPlay(h, p, 6, now) === "empty", "หัวใจหมด → เล่นห้องใหม่ไม่ได้");
  addUnlimited(h, HEARTS.unlimitedMs, now);
  expect(unlimited(h, now) && payToPlay(h, p, 6, now) === "ok" && h.n === 0, "หัวใจไม่จำกัดเล่นได้ไม่หัก");
  expect(!unlimited(h, now - 60_000), "ย้อนนาฬิกาไปก่อนเวลาซื้อ = หมดสิทธิ์ไม่จำกัด");
  expect(!unlimited(h, now + HEARTS.unlimitedMs), "ครบ 2 ชม. แล้วหมด");
  expect(!refreshDay(h, now) && h.n === 0, "วันเดิมไม่เติม");
  expect(!refreshDay(h, now - 86_400_000) && h.n === 0, "ย้อนนาฬิกาไปเมื่อวานไม่เติม");
  expect(refreshDay(h, now + 86_400_000) && h.n === HEARTS.perDay, "ขึ้นวันใหม่เติมเป็น 5");
  h.noAds = true; h.n = 6;
  expect(refreshDay(h, now + 2 * 86_400_000) && h.n === HEARTS.perDayNoAds, "ลบโฆษณาแล้ววันใหม่เติมเป็น 8");
}

if (fails) { console.log(`\nไม่ผ่าน ${fails} ข้อ`); process.exit(1); }
console.log("\nผ่านทั้งหมด");
