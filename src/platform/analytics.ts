// Firebase Analytics (เว็บ) · โหลดแบบ lazy หลังเกมเปิด เพื่อไม่ให้หน้าแรกช้า
// ทำงานเฉพาะ build จริงที่ไม่ได้เปิดจาก localhost · ส่ง event เฉพาะตอนผู้เล่นทำสิ่งที่มีความหมาย (ห้ามเรียกในลูปเกม)
// ค่า config ของเว็บแอปเป็นค่าสาธารณะ ไม่ใช่ความลับ
const firebaseConfig = {
  apiKey: "AIzaSyAGMtuhmM5AFhMrFQKmAxYGFzSADglrUPA",
  authDomain: "wickling-rtliz.firebaseapp.com",
  projectId: "wickling-rtliz",
  storageBucket: "wickling-rtliz.firebasestorage.app",
  messagingSenderId: "812461468465",
  appId: "1:812461468465:web:47b53054ebb1a7e44ede10",
  measurementId: "G-HNDE8DEH0J",
};

type Params = Record<string, string | number>;
let send: ((name: string, p: Params) => void) | null = null;
const queue: [string, Params][] = [];

const enabled = !import.meta.env.DEV && !/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);

export function initAnalytics() {
  if (!enabled) return;
  const start = async () => {
    try {
      const [{ initializeApp }, { getAnalytics, isSupported, logEvent }] = await Promise.all([
        import("firebase/app"), import("firebase/analytics"),
      ]);
      if (!(await isSupported())) return;
      const a = getAnalytics(initializeApp(firebaseConfig));
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
