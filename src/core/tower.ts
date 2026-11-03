import { DIRS, type LevelDef } from "./sim";
import { autoSolve } from "./solve";

// หอคอย ∞: สุ่มห้องแบบ "สร้างจากคำตอบ" · สวิตช์ทุกตัวอยู่ใต้ประตูทั้งหมด · เลเซอร์ทุกเส้นมีช่องข้างปืนให้เงายืนบัง
// ห้องของแต่ละชั้นสุ่มจาก seed ของเลขชั้น จึงเหมือนเดิมทุกครั้ง · ⚠️ หลังปล่อยเกมห้ามแก้ตัวสุ่ม (ห้องของผู้เล่นจะเปลี่ยน)
// ทุกชั้นต้องผ่าน autoSolve (เล่นจริงด้วยกติกาเกม) ก่อนส่งให้ผู้เล่น · scripts/check.ts ตรวจซ้ำชั้น 1–200

export const TOWER_MAX_DIST = 26;   // จุดสำคัญต้องเดินถึงภายในกี่จังหวะ

function rng(seed: number) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function genTower(floor: number): LevelDef {
  for (let attempt = 0; attempt < 300; attempt++) {
    const R = rng(floor * 7919 + attempt * 104729 + 13), ri = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
    const pick = <T>(arr: T[]) => arr.splice(Math.floor(R() * arr.length), 1)[0];
    const elements = Math.min(4, 1 + Math.floor((floor - 1) / 2));
    let D = ri(0, Math.min(2, elements)), Lz = elements - D;
    if (Lz > 2) { D += Lz - 2; Lz = 2; }
    const g: string[][] = Array.from({ length: 9 }, (_, r) => Array.from({ length: 7 }, (_, c) => (r === 0 || r === 8 || c === 0 || c === 6) ? "#" : "."));
    const doorRows = D === 2 ? [4, 2] : D === 1 ? [ri(0, 1) ? 4 : 2] : [];   // ตัวแรก = ประตู A (ล่าง)
    const gaps: [number, number][] = [];
    doorRows.forEach((row, k) => { const gap = ri(1, 5); for (let c = 1; c < 6; c++) g[row][c] = "#"; g[row][gap] = "AB"[k]; gaps.push([row, gap]); });
    const laneCand = [2, 3, 4, 5, 6].filter(r => !doorRows.includes(r)), lanes: number[] = [];
    for (let k = 0; k < Lz && laneCand.length; k++) lanes.push(pick(laneCand));
    if (lanes.length < Lz) continue;
    const blockers: [number, number][] = [];
    for (const r of lanes) { if (ri(0, 1)) { g[r][0] = ">"; blockers.push([r, 1]); } else { g[r][6] = "<"; blockers.push([r, 5]); } }
    const start: [number, number] = [7, ri(1, 5)], exit: [number, number] = [1, ri(1, 5)];
    g[start[0]][start[1]] = "S"; g[exit[0]][exit[1]] = "E";
    const low = doorRows.length ? Math.max(...doorRows) : 0;
    const swCand: [number, number][] = [], sw: [number, number][] = [];
    for (let r = low + 1; r <= 7; r++) for (let c = 1; c <= 5; c++) if (!lanes.includes(r) && g[r][c] === ".") swCand.push([r, c]);
    if (swCand.length < D) continue;
    for (let k = 0; k < D; k++) { const p = pick(swCand); g[p[0]][p[1]] = "ab"[k]; sw.push(p); }
    // เสากลางห้อง: เพิ่มตามชั้น แต่ห้ามขวางเลนเลเซอร์ ช่องประตู หรือช่องข้างปืน
    // ช่องใต้จุดบังต้องเป็นทางเดิน เงาจะเดินขึ้นไปบังได้ตรง ๆ โดยไม่ต้องเดินเลียบลำแสง
    if (blockers.some(([br, bc]) => g[br + 1][bc] === "#")) continue;
    const near = (r: number, c: number) => gaps.some(([gr, gc]) => gc === c && Math.abs(gr - r) === 1) || blockers.some(([br, bc]) => (br === r || br + 1 === r) && bc === c);
    const pillCand: [number, number][] = [];
    for (let r = 1; r <= 7; r++) for (let c = 1; c <= 5; c++) if (g[r][c] === "." && !lanes.includes(r) && !near(r, c)) pillCand.push([r, c]);
    const P = Math.min(4, Math.floor((floor - 1) / 2));
    for (let k = 0; k < P && pillCand.length; k++) { const p = pick(pillCand); g[p[0]][p[1]] = "#"; }
    // ทุกจุดสำคัญต้องเดินถึงภายในเวลา (เปิดประตูทุกบาน)
    const dist = new Map<string, number>([[start.join(), 0]]), q: [number, number][] = [start];
    while (q.length) {
      const [r, c] = q.shift()!, d = dist.get(r + "," + c)!;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, ch = g[nr][nc];
        if (ch === "#" || ch in DIRS || dist.has(nr + "," + nc)) continue;
        dist.set(nr + "," + nc, d + 1); q.push([nr, nc]);
      }
    }
    if (![exit, ...sw, ...blockers].every(t => dist.has(t.join()) && dist.get(t.join())! <= TOWER_MAX_DIST)) continue;
    const parts: string[] = [];
    if (D) parts.push(`ประตู ${D} บาน`);
    if (Lz) parts.push(`เลเซอร์ ${Lz} เส้น`);
    const def: LevelDef = { name: `หอคอย ชั้น ${floor}`, par: D + Lz, tower: true,
      hint: `ห้องสุ่มชั้น ${floor} · ${parts.join(" · ")}`, tip: parts.join(" · "), map: g.map(r => r.join("")) };
    // เก็บเฉพาะห้องที่ตัวแก้อัตโนมัติเล่นผ่านจริงด้วยเงา ≤ par
    const res = autoSolve(def);
    if (!res.ok || res.ghosts > def.par) continue;
    return def;
  }
  throw new Error(`สุ่มห้องชั้น ${floor} ไม่สำเร็จ`);
}
