import type { SkillId } from "./sim";
import { NODES } from "./skills";
import { HEARTS, freshHearts, type HeartState } from "./hearts";
import { sealSave, openSealed } from "./saveguard";

// เซฟในเครื่อง · ⚠️ ห้ามเปลี่ยน SAVE_KEY หลังปล่อยเกม · เปลี่ยนรูปแบบเซฟ = ขึ้น SAVE_VERSION + เพิ่ม case ใน migrate()
// v1 = ดาว ชั้นหอคอย สกิล (JSON ไม่มีลายเซ็น) · v2 = + หัวใจ/ลบโฆษณา/หัวใจไม่จำกัด → ลงลายเซ็น (saveguard.ts) + validate()
// v3 = + lb (กระดานคะแนน: รอบที่ถามรางวัลแล้ว + ธงไม่ขึ้นกระดาน แบบ S.seasonChecked/S.flagged/S.debugUsed ของ LumiFlip)
// เซฟ v1 แบบไม่มีลายเซ็นรับได้ครั้งเดียวต่อเครื่อง (ก่อนมี SAVE_SIGNED_KEY) แล้วเซฟใหม่แบบมีลายเซ็นทันที

export const SAVE_KEY = "wickling.save.v1";
export const SAVE_BAD_KEY = "wickling.save.bad";   // เซฟที่อ่านไม่ได้ เก็บสำรองไว้ ห้ามลบทิ้ง
export const SAVE_SIGNED_KEY = "wickling.save.signed"; // มีแล้ว = เครื่องนี้เคยเซฟแบบมีลายเซ็น เซฟไม่มีลายเซ็นที่โผล่มาทีหลังคือของปลอม
export const SAVE_VERSION = 3;

export interface SaveData {
  v: number;
  best: Record<string, number>;               // ดาวสูงสุดของแต่ละห้อง (key = ลำดับห้อง)
  tower: { floor: number; best: number };
  skills: { owned: SkillId[]; eq: (SkillId | null)[]; spent: number };
  devBonus: number;                           // ดาวทดสอบ (ใช้ได้เฉพาะ pnpm dev)
  hearts: HeartState;                         // v2
  lb: BoardState;                             // v3
}

// กระดานคะแนน (v3) · แต้มอยู่ที่ server เท่านั้น (functions/wins.js เล่นซ้ำหลักฐานการชนะ) ในเซฟจึงไม่มีแต้ม
// checked = รอบที่ถามรางวัลแล้ว (uid:W:M) · flagged = validate พบค่าที่เกมไม่มีทางเขียนเอง · debug = เคยใช้ดาวทดสอบ (dev)
// flagged/debug → ไม่ส่งหลักฐานขึ้นกระดาน (กฎกันแฮกข้อ 5)
export interface BoardState { checked: string | null; flagged: boolean; debug: boolean }
const freshLb = (): BoardState => ({ checked: null, flagged: false, debug: false });

const fresh = (now = Date.now()): SaveData => ({ v: SAVE_VERSION, best: {}, tower: { floor: 1, best: 0 }, skills: { owned: ["root"], eq: [null, null], spent: 0 }, devBonus: 0, hearts: freshHearts(now), lb: freshLb() });

function migrate(raw: Record<string, unknown>, now: number): SaveData {
  const v = typeof raw.v === "number" ? raw.v : 0;
  if (v < 1 || v > SAVE_VERSION || !Number.isInteger(v)) throw new Error(`ไม่รู้จักเซฟเวอร์ชัน ${v}`);
  if (v < 2) raw = { ...raw, v: 2, hearts: freshHearts(now) };   // v1 → v2: เพิ่มหัวใจเต็มวัน
  if ((raw.v as number) < 3) raw = { ...raw, v: 3, lb: freshLb() };   // v2 → v3: เพิ่มสถานะกระดาน (แต้มเริ่มที่ server จากศูนย์)
  // เพิ่มเวอร์ชันถัดไป: if (raw.v < 4) raw = { ...raw, v: 4, ... }
  return raw as unknown as SaveData;
}

const VALID_IDS = new Set(NODES.map(n => n.id));
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

// ตัดค่าหัวใจที่ผิดรูปแบบ/เกินเพดาน · ไม่แตะ from ที่อยู่ในอนาคต (นั่นคือตัวกันย้อนนาฬิกา: unlimited() จะเป็น false เอง)
function validHearts(h: Partial<HeartState> | undefined, now: number): HeartState {
  const out = freshHearts(now);
  if (!h || typeof h !== "object") return out;
  if (isInt(h.n, 0, Number.MAX_SAFE_INTEGER)) out.n = Math.min(h.n, HEARTS.max);
  if (typeof h.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.day)) out.day = h.day;
  if (isInt(h.ad, 0, HEARTS.adPerDay)) out.ad = h.ad;
  out.noAds = h.noAds === true;
  if (isInt(h.from, 0, 8.64e15) && isInt(h.until, 0, 8.64e15) && h.until >= h.from && h.until - h.from <= HEARTS.unlimitedMaxSpanMs) {
    out.from = h.from; out.until = h.until;
  }
  if (Array.isArray(h.tx)) out.tx = h.tx.filter(t => typeof t === "string" && t.length > 0 && t.length <= 128).slice(-HEARTS.txKeep);
  if (typeof h.attempt === "string" && /^[rt]\d{1,6}$/.test(h.attempt)) out.attempt = h.attempt;
  return out;
}

function validLb(x: Partial<BoardState> | undefined, bad: boolean): BoardState {
  const l = x && typeof x === "object" ? x : {};
  return { checked: typeof l.checked === "string" && l.checked.length <= 200 ? l.checked : null, flagged: l.flagged === true || bad, debug: l.debug === true };
}

function validate(d: SaveData, now: number): SaveData {
  const out = fresh(now);
  let bad = false;   // ค่าที่เกม (ฝั่งเรา) ไม่มีทางเขียนเอง = เซฟถูกแก้ → ไม่ขึ้นกระดาน
  for (const [k, s] of Object.entries(d.best ?? {})) {
    if (/^\d+$/.test(k) && Number.isInteger(s) && s >= 1 && s <= 3) out.best[k] = s; else bad = true;
  }
  if (d.tower && Number.isInteger(d.tower.floor) && d.tower.floor >= 1) out.tower.floor = Math.min(d.tower.floor, 100000);
  if (d.tower && Number.isInteger(d.tower.best) && d.tower.best >= 0) out.tower.best = Math.min(d.tower.best, out.tower.floor);
  if (d.tower?.best > out.tower.floor) bad = true;
  const owned = (d.skills?.owned ?? []).filter(id => VALID_IDS.has(id));
  out.skills.owned = [...new Set<SkillId>(["root", ...owned])];
  out.skills.eq = [0, 1].map(i => { const id = d.skills?.eq?.[i] ?? null; return id && id !== "root" && out.skills.owned.includes(id) ? id : null; });
  if (Number.isInteger(d.skills?.spent) && d.skills.spent >= 0) out.skills.spent = d.skills.spent;
  if (import.meta.env?.DEV && Number.isInteger(d.devBonus)) out.devBonus = d.devBonus;
  out.hearts = validHearts(d.hearts, now);
  if (isInt(d.hearts?.n, 0, Number.MAX_SAFE_INTEGER) && d.hearts.n > HEARTS.max) bad = true;
  out.lb = validLb(d.lb, bad);
  if (d.devBonus) out.lb.debug = true;
  return out;
}

/**
 * แปลงข้อความเซฟเป็นข้อมูล (ไม่มี DOM · scripts/check.ts ใช้ทดสอบเซฟเก่า) · throw = เซฟใช้ไม่ได้ (ผู้เรียกเก็บสำรอง)
 * signedBefore = เครื่องนี้เคยเซฟแบบมีลายเซ็นแล้ว → JSON ไม่มีลายเซ็นถือว่าถูกแก้
 * เซฟไม่มีลายเซ็น (v1 ของผู้เล่นเดิม) ไม่มีทางมีหัวใจ/สิทธิ์ที่ซื้อโดยชอบ → ใช้หัวใจค่าเริ่มต้นเสมอ
 */
export function parseSave(text: string, signedBefore: boolean, now = Date.now()): SaveData {
  const sealed = openSealed(text);
  if (sealed && typeof sealed === "object") return validate(migrate(sealed as Record<string, unknown>, now), now);
  if (text.startsWith("{") && !signedBefore) {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const d = validate(migrate(raw, now), now);
    d.hearts = freshHearts(now);
    return d;
  }
  throw new Error("ลายเซ็นเซฟไม่ถูกต้อง");
}

export const serializeSave = (d: SaveData) => sealSave({ ...d, v: SAVE_VERSION });

export function loadSave(): SaveData {
  let text: string | null = null, signed = false;
  try { text = localStorage.getItem(SAVE_KEY); signed = !!localStorage.getItem(SAVE_SIGNED_KEY); } catch { return fresh(); }
  if (!text) return fresh();
  try {
    const d = parseSave(text, signed);
    if (!signed) writeSave(d);   // เซฟเก่า → เซฟใหม่แบบมีลายเซ็นทันที
    return d;
  } catch (e) {
    try { localStorage.setItem(SAVE_BAD_KEY, text); } catch { /* เก็บสำรองไม่ได้ก็ปล่อย */ }
    console.warn("[save] อ่านเซฟไม่ได้ เก็บสำรองไว้ที่", SAVE_BAD_KEY, e);
    return fresh();
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, serializeSave(d));
    localStorage.setItem(SAVE_SIGNED_KEY, "1");
  } catch { /* โหมดส่วนตัว/พื้นที่เต็ม */ }
}

export const earnedStars = (d: SaveData) => Object.values(d.best).reduce((a, b) => a + b, 0) + d.tower.best;
export const starsLeft = (d: SaveData) => earnedStars(d) + d.devBonus - d.skills.spent;
