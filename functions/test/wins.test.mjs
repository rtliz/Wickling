// submitWin (wins.js) กับ Firestore emulator: เล่นซ้ำหลักฐานด้วย game.js (สร้างจาก src/core ตอน pretest) แล้วให้แต้ม
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createSeasons } from '../seasons.js';
import { createWins, WIN_POINTS_PER_DAY } from '../wins.js';
import { weekId, monthId } from '../season-rules.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('ต้องรันผ่าน Firestore emulator');
process.env.GCLOUD_PROJECT ??= 'demo-wickling';
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();
const seasons = createSeasons({ db });
const wins = createWins({ db, seasons, rate: { max: 1000, windowMs: 3_600_000 } });
const user = uid => ({ uid, token: { firebase: { identities: {} } } });
const NOW = Date.parse('2026-11-11T05:00:00Z');
const pts = async (board, uid, col = 'boards') => (await db.doc(`${col}/${board}/scores/${uid}`).get()).get('pts') ?? 0;
const err = p => p.then(() => null, e => e);

// ห้อง 1 "สวิตช์แรก": รอบแรกเงาไปยืนสวิตช์ รอบสองเดินออกประตู (เหมือนคำตอบใน scripts/check.ts)
const ROOM1 = { v: 1, sv: 1, kind: 'r', n: 0, eq: [null, null], rounds: [{ ops: [], inp: [[0, 'tap', 7, 1]] }, { ops: [], inp: [[0, 'tap', 1, 3]] }] };
// ห้อง 8 "เลเซอร์กะพริบ": ใช้สกิลหยุดเปลว
const ROOM8 = { v: 1, sv: 1, kind: 'r', n: 7, eq: ['t2', null], rounds: [{ ops: [], inp: [[0, 'tap', 5, 3], [2, 'sk', 't2'], [2, 'tap', 1, 3]] }] };
// ห้อง 11 "สวิตช์คู่": เงากระจก (สกิล s3 ปรับเงาก่อนรอบสอง)
const ROOM11 = { v: 1, sv: 1, kind: 'r', n: 10, eq: ['s3', null], rounds: [{ ops: [], inp: [[0, 'tap', 6, 1]] }, { ops: [['twin', 0]], inp: [[0, 'tap', 1, 3]] }] };

before(async () => {
  for (const c of ['boards', 'boards-dev', 'players', 'players-dev', 'rate', 'seasons', 'seasonClaims']) await db.recursiveDelete(db.collection(c));
});

test('หลักฐานจริง → +1 ทั้งกระดานถาวร สัปดาห์ เดือน (เวลา server ตามเวลาไทย)', async () => {
  const r = await wins.submit(user('a'), { proof: ROOM1, name: ' ภูติ  น้อย ' }, NOW);
  assert.deepEqual(r, { counted: true, pts: 1, name: 'ภูติ น้อย' });
  for (const b of ['all', weekId(NOW), monthId(NOW)]) assert.equal(await pts(b, 'a'), 1, b);
  assert.equal((await db.doc(`boards/all/scores/a`).get()).get('name'), 'ภูติ น้อย');
});

test('ส่งหลักฐานเดิม/ห้องเดิมซ้ำไม่ได้แต้ม', async () => {
  assert.deepEqual(await wins.submit(user('a'), { proof: ROOM1, name: 'ภูติ' }, NOW + 60_000), { counted: false, reason: 'already' });
  assert.equal(await pts('all', 'a'), 1);
});

test('สกิลและการปรับเงา: ต้องอยู่ในช่องติดตัว', async () => {
  assert.equal((await wins.submit(user('a'), { proof: ROOM8, name: 'ภูติ' }, NOW + 120_000)).counted, true);
  assert.equal((await wins.submit(user('a'), { proof: ROOM11, name: 'ภูติ' }, NOW + 180_000)).counted, true);
  assert.equal(await pts('all', 'a'), 3);
  const noSkill = await err(wins.submit(user('b'), { proof: { ...ROOM8, eq: [null, null] }, name: 'ภูติ' }, NOW));
  assert.equal(noSkill?.code, 'invalid-argument');
  const noTwin = await err(wins.submit(user('b'), { proof: { ...ROOM11, eq: ['t2', null] }, name: 'ภูติ' }, NOW));
  assert.equal(noTwin?.code, 'invalid-argument');
});

test('หลักฐานปลอม/ไม่ชนะ/ผิดรูปแบบ → invalid-argument และไม่มีแต้ม', async () => {
  const fakes = [
    { ...ROOM1, rounds: [ROOM1.rounds[1]] },                                     // ไม่มีเงายืนสวิตช์ ประตูไม่เปิด
    { ...ROOM1, rounds: [{ ops: [], inp: [[0, 'tap', 1, 3]] }, ROOM1.rounds[0]] }, // ชนะไม่ได้ในรอบสุดท้าย
    { ...ROOM1, rounds: [...ROOM1.rounds, { ops: [], inp: [[0, 'tap', 1, 3]] }] }, // มีรอบหลังชนะ
    { ...ROOM1, sv: 2 }, { ...ROOM1, rounds: [{ ops: [7], inp: 'x' }] }, { ...ROOM1, rounds: [{ ops: [], inp: [[0, 'tap']] }] },
    { ...ROOM1, rounds: [{ ops: [], inp: [[0, 'tap', 0, 0]] }, ROOM1.rounds[1]] },  // แตะกำแพง
    { ...ROOM1, n: 99 }, { ...ROOM1, kind: 't', n: 0 }, { ...ROOM1, v: 2 }, null, 'x',
    { ...ROOM1, rounds: [{ ops: [['undo']], inp: [[0, 'tap', 1, 3]] }] },          // ลบเงาที่ไม่มี
    { ...ROOM1, rounds: [{ ops: [], inp: [[0, 'tap', 7, 1], [99, 'end']] }, ROOM1.rounds[1]] },
  ];
  for (const proof of fakes) assert.equal((await err(wins.submit(user('c'), { proof, name: 'ภูติ' }, NOW)))?.code, 'invalid-argument', JSON.stringify(proof));
  assert.equal(await pts('all', 'c'), 0);
});

test('ไม่ล็อกอิน → unauthenticated', async () => {
  assert.equal((await err(wins.submit(null, { proof: ROOM1 }, NOW)))?.code, 'unauthenticated');
});

test(`เพดาน ${WIN_POINTS_PER_DAY} แต้มต่อวัน (เวลาไทย) แล้ววันใหม่ได้ต่อ`, async () => {
  await db.doc('players/d').set({ name: 'ภูติ', day: { d: '2026-11-11', n: WIN_POINTS_PER_DAY }, credit: 3_600_000, lastAt: NOW - 1000 });
  assert.deepEqual(await wins.submit(user('d'), { proof: ROOM1, name: 'ภูติ' }, NOW), { counted: false, reason: 'cap' });
  const nextDay = Date.parse('2026-11-11T17:00:00Z');   // เที่ยงคืนเวลาไทย
  assert.equal((await wins.submit(user('d'), { proof: ROOM1, name: 'ภูติ' }, nextDay)).counted, true);
});

test('เร็วกว่าเวลาเล่นจริงไม่ได้ (บอท) · รอให้เวลาผ่านแล้วได้', async () => {
  await db.doc('players/e').set({ name: 'ภูติ', credit: 0, lastAt: NOW });
  assert.deepEqual(await wins.submit(user('e'), { proof: ROOM1, name: 'ภูติ' }, NOW + 500), { counted: false, reason: 'too-fast' });
  assert.equal((await wins.submit(user('e'), { proof: ROOM1, name: 'ภูติ' }, NOW + 60_000)).counted, true);
});

test('จำกัดคำขอต่อชั่วโมง → resource-exhausted', async () => {
  const tight = createWins({ db, seasons, rate: { max: 2, windowMs: 3_600_000 } });
  await tight.submit(user('f'), { proof: ROOM1, name: 'ภูติ' }, NOW);
  await tight.submit(user('f'), { proof: ROOM1, name: 'ภูติ' }, NOW);
  assert.equal((await err(tight.submit(user('f'), { proof: ROOM1, name: 'ภูติ' }, NOW)))?.code, 'resource-exhausted');
});

test('เปลี่ยนชื่อบนกระดาน: ครั้งแรกได้เลย แล้วต้องเว้น 7 วัน (แบบ LumiFlip) · ชื่อแปลก (<>) ถูกตัด', async () => {
  await wins.submit(user('g'), { proof: ROOM1, name: 'ชื่อแรก' }, NOW);
  assert.equal((await wins.submit(user('g'), { proof: ROOM8, name: 'ชื่อสอง' }, NOW + 120_000)).name, 'ชื่อสอง');
  await db.doc('players/g/won/r10').delete().catch(() => {});
  assert.equal((await wins.submit(user('g'), { proof: ROOM11, name: 'ชื่อสาม' }, NOW + 240_000)).name, 'ชื่อสอง');
  await db.doc('players/g/won/r10').delete();
  assert.equal((await wins.submit(user('g'), { proof: ROOM11, name: '<b>ชื่อสี่</b>' }, NOW + 8 * 86400e3)).name, 'bชื่อสี่/b');
});

test('dev: แต้มไป boards-dev / players-dev ไม่ปนกระดานจริง', async () => {
  assert.equal((await wins.submit(user('h'), { proof: ROOM1, name: 'ภูติ', dev: true }, NOW)).counted, true);
  assert.equal(await pts('all', 'h', 'boards-dev'), 1);
  assert.equal(await pts('all', 'h'), 0);
});

test('แต้มจาก submitWin เข้ารางวัลรอบได้ (claimSeason)', async () => {
  const google = uid => ({ uid, token: { firebase: { identities: { 'google.com': ['1'] } } } });
  const r = await seasons.claim(google('a'), {}, NOW + 7 * 86400e3);
  assert.ok(r.rewards.some(w => w.id === weekId(NOW) && w.hearts > 0));
});

test('รุ่น sim ที่ server ไม่รู้จัก → บอกเหตุผลชัด (sim-version)', async () => {
  const e = await err(wins.submit(user('sv'), { proof: { ...ROOM1, sv: 2 }, name: 'ภูติ' }, NOW));
  assert.equal(e?.code, 'invalid-argument');
  assert.match(e.message, /sim-version/);
});
