// จุดเข้า bundle ของ server: rolldown รวมไฟล์นี้กับ sim/levels/tower/solve เป็น functions/game.js (npm run sync)
// ใช้ตรรกะเดียวกับเกมเสมอ (เทสต์และ predeploy สร้างใหม่ทุกครั้ง จึงไม่มีทางเก่ากว่าเกม) · ห้าม import อะไรที่มี DOM
export { replayProof, proofKey, proofLevel, PROOF_MAX_INPUTS, PROOF_MAX_ROUNDS } from "./proof";
export { TICK_MS } from "./sim";
export { cleanName, nameLength } from "./name";
