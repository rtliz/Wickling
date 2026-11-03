// Firebase Analytics (เว็บ) · โหลดแบบ lazy หลังเกมเปิด เพื่อไม่ให้หน้าแรกช้า
// ทำงานเฉพาะ build จริงที่ไม่ได้เปิดจาก localhost · ส่ง event เฉพาะตอนผู้เล่นทำสิ่งที่มีความหมาย (ห้ามเรียกในลูปเกม)
import { firebaseApp } from "./firebase";

type Params = Record<string, string | number>;
let send: ((name: string, p: Params) => void) | null = null;
const queue: [string, Params][] = [];

const enabled = !import.meta.env.DEV && !/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);

export function initAnalytics() {
  if (!enabled) return;
  const start = async () => {
    try {
      const [app, { getAnalytics, isSupported, logEvent }] = await Promise.all([firebaseApp(), import("firebase/analytics")]);
      if (!(await isSupported())) return;
      const a = getAnalytics(app);
      send = (n, p) => logEvent(a, n, p);
      queue.splice(0).forEach(([n, p]) => send!(n, p));
    } catch { /* analytics พังต้องไม่ทำเกมพัง */ }
  };
  "requestIdleCallback" in window ? requestIdleCallback(() => start(), { timeout: 4000 }) : setTimeout(start, 2000);
}

export function track(name: string, p: Params = {}) {
  if (!enabled) return;
  try { send ? send(name, p) : queue.length < 20 && queue.push([name, p]); } catch { /* ignore */ }
}
