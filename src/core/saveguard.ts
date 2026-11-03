// ลายเซ็นเซฟในเครื่อง (ยกจาก LumiFlip/src/saveguard.js ซึ่งยกจาก Idle-Wuxia-RPG/src/core/security/hash.ts)
// กันการแก้ localStorage ตรง ๆ ได้ แต่ key อยู่ใน client จึงขุดออกได้เสมอ (ช่องโหว่ที่รู้อยู่ ดู game-security)
// ⚠️ ห้ามเปลี่ยน SECRET หรือ PREFIX หลังปล่อย: เซฟของผู้เล่นทุกคนจะตรวจไม่ผ่าน

export const PREFIX = "WK2.";

// ประกอบจากหลายชิ้น ไม่ให้ค้นเจอเป็นข้อความเดียวในไฟล์ build
const SECRET = ["wi", "ck", "#l!", "ng", "8r", "Tq", "-lm", "p4"].map((s, i) => (i % 2 ? s : [...s].reverse().join(""))).join("~");

function cyrb53(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const sign = (text: string) => [
  cyrb53(`${SECRET}|${text}|${SECRET}`, 0x51ed),
  cyrb53(`${text}#${SECRET}`, 0x2f9a),
  cyrb53(`${SECRET}${text.length}${text}`, 0x7c31),
].map(n => n.toString(36)).join("-");

// XOR + base64 ให้เปิดอ่าน/แก้ด้วยมือไม่ได้
function obfuscate(text: string) {
  const bytes = new TextEncoder().encode(text);
  const k = new TextEncoder().encode(SECRET);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= k[i % k.length] ^ ((i * 31) & 0xff);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function deobfuscate(encoded: string) {
  const bin = atob(encoded);
  const bytes = new Uint8Array(bin.length);
  const k = new TextEncoder().encode(SECRET);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ k[i % k.length] ^ ((i * 31) & 0xff);
  return new TextDecoder().decode(bytes);
}

export const sealSave = (state: unknown) => {
  const body = obfuscate(JSON.stringify(state));
  return `${PREFIX}${body}.${sign(body)}`;
};

// คืนข้อมูลที่ลายเซ็นถูก · null = ลายเซ็นผิด/ถูกแก้
export function openSealed(raw: string): unknown | null {
  if (!raw.startsWith(PREFIX)) return null;
  const [body, sig] = raw.slice(PREFIX.length).split(".");
  if (!sig || sig !== sign(body)) return null;
  try { return JSON.parse(deobfuscate(body)); } catch { return null; }
}
