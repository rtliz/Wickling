// Firebase เว็บแอปของ Wickling (ค่า config เป็นค่าสาธารณะ ไม่ใช่ความลับ) · โหลดแบบ lazy ไม่ให้หน้าแรกช้า
// ใช้ร่วมกันโดย analytics.ts และ billing.ts (บัญชี guest แบบ anonymous สำหรับส่งใบเสร็จให้ server ตรวจ)
export const firebaseConfig = {
  apiKey: "AIzaSyAGMtuhmM5AFhMrFQKmAxYGFzSADglrUPA",
  authDomain: "wickling-rtliz.firebaseapp.com",
  projectId: "wickling-rtliz",
  storageBucket: "wickling-rtliz.firebasestorage.app",
  messagingSenderId: "812461468465",
  appId: "1:812461468465:web:47b53054ebb1a7e44ede10",
  measurementId: "G-HNDE8DEH0J",
};

let app: Promise<import("firebase/app").FirebaseApp> | null = null;
export const firebaseApp = () => (app ??= import("firebase/app").then(({ initializeApp }) => initializeApp(firebaseConfig)));
