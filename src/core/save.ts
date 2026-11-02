import type { SkillId } from "./sim";
import { NODES } from "./skills";

// เซฟในเครื่อง · ⚠️ ห้ามเปลี่ยน SAVE_KEY หลังปล่อยเกม · เปลี่ยนรูปแบบเซฟ = ขึ้น SAVE_VERSION + เพิ่ม case ใน migrate()
// ตอนนี้เซฟมีแค่ดาว ชั้นหอคอย และสกิล (ไม่มีของมีมูลค่า) จึงยังไม่ลงลายเซ็น · ก่อนเพิ่ม IAP/สกุลเงินพรีเมียม
// ต้องเพิ่มลายเซ็น + Validator แบบ core/security/ ของเกม Wuxia (ดู .claude/rules/anti-hack.md ข้อ 5)

export const SAVE_KEY = "wickling.save.v1";
export const SAVE_BAD_KEY = "wickling.save.bad";   // เซฟที่อ่านไม่ได้ เก็บสำรองไว้ ห้ามลบทิ้ง
export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  best: Record<string, number>;               // ดาวสูงสุดของแต่ละห้อง (key = ลำดับห้อง)
  tower: { floor: number; best: number };
  skills: { owned: SkillId[]; eq: (SkillId | null)[]; spent: number };
  devBonus: number;                           // ดาวทดสอบ (ใช้ได้เฉพาะ pnpm dev)
}

const fresh = (): SaveData => ({ v: SAVE_VERSION, best: {}, tower: { floor: 1, best: 0 }, skills: { owned: ["root"], eq: [null, null], spent: 0 }, devBonus: 0 });

function migrate(raw: Record<string, unknown>): SaveData {
  const v = typeof raw.v === "number" ? raw.v : 0;
  switch (v) {
    case SAVE_VERSION: break;
    default: throw new Error(`ไม่รู้จักเซฟเวอร์ชัน ${v}`);
  }
  return raw as unknown as SaveData;
}

const VALID_IDS = new Set(NODES.map(n => n.id));
function validate(d: SaveData): SaveData {
  const out = fresh();
  for (const [k, s] of Object.entries(d.best ?? {})) if (/^\d+$/.test(k) && Number.isInteger(s) && s >= 1 && s <= 3) out.best[k] = s;
  if (d.tower && Number.isInteger(d.tower.floor) && d.tower.floor >= 1) out.tower.floor = Math.min(d.tower.floor, 100000);
  if (d.tower && Number.isInteger(d.tower.best) && d.tower.best >= 0) out.tower.best = Math.min(d.tower.best, out.tower.floor);
  const owned = (d.skills?.owned ?? []).filter(id => VALID_IDS.has(id));
  out.skills.owned = [...new Set<SkillId>(["root", ...owned])];
  out.skills.eq = [0, 1].map(i => { const id = d.skills?.eq?.[i] ?? null; return id && id !== "root" && out.skills.owned.includes(id) ? id : null; });
  if (Number.isInteger(d.skills?.spent) && d.skills.spent >= 0) out.skills.spent = d.skills.spent;
  if (import.meta.env?.DEV && Number.isInteger(d.devBonus)) out.devBonus = d.devBonus;
  return out;
}

export function loadSave(): SaveData {
  let text: string | null = null;
  try { text = localStorage.getItem(SAVE_KEY); } catch { return fresh(); }
  if (!text) return fresh();
  try { return validate(migrate(JSON.parse(text))); }
  catch (e) {
    try { localStorage.setItem(SAVE_BAD_KEY, text); } catch { /* เก็บสำรองไม่ได้ก็ปล่อย */ }
    console.warn("[save] อ่านเซฟไม่ได้ เก็บสำรองไว้ที่", SAVE_BAD_KEY, e);
    return fresh();
  }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...d, v: SAVE_VERSION })); } catch { /* โหมดส่วนตัว/พื้นที่เต็ม */ }
}

export const earnedStars = (d: SaveData) => Object.values(d.best).reduce((a, b) => a + b, 0) + d.tower.best;
export const starsLeft = (d: SaveData) => earnedStars(d) + d.devBonus - d.skills.spent;
