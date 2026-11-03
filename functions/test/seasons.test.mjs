// รางวัลกระดานรายสัปดาห์/เดือน กับ Firestore emulator (ยกจาก LumiFlip · ดู README.md หัวข้อเทสต์)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createSeasons } from '../seasons.js';
import { readFileSync } from 'node:fs';
import { weekId, monthId, prevWeekId, prevMonthId, weekEndsAt, monthEndsAt, rewardFor } from '../season-rules.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('ต้องรันผ่าน Firestore emulator');
process.env.GCLOUD_PROJECT ??= 'demo-wickling';
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();
const guest = uid => ({ uid, token: { firebase: { identities: {} } } });
const google = uid => ({ uid, token: { firebase: { identities: { 'google.com': ['1'] } } } });
const seasons = createSeasons({ db, rate: { max: 1000, windowMs: 3_600_000 } });

const NOW = Date.parse('2026-11-11T05:00:00Z'); // พุธ 11 พ.ย. เวลาไทย
const NEXT_WEEK = NOW + 7 * 86400e3;
const NEXT_MONTH = Date.parse('2026-12-02T05:00:00Z');
const row = (board, uid, pts, atMs = NOW) => db.doc(`boards/${board}/scores/${uid}`).set({ uid, name: uid, pts, at: Timestamp.fromMillis(atMs) });

before(async () => {
  for (const c of ['boards', 'seasons', 'seasonClaims', 'rate']) await db.recursiveDelete(db.collection(c));
  const w = weekId(NOW), m = monthId(NOW);
  await row(w, 'a', 30); await row(w, 'b', 20, NOW); await row(w, 'c', 20, NOW + 1000);
  await row(m, 'a', 90);
});

test('รหัสรอบและเวลาสิ้นสุดตัดตามเวลาไทย', () => {
  assert.equal(weekId(Date.parse('2026-11-01T16:59:59Z')), 'W2026-10-26');
  assert.equal(weekId(Date.parse('2026-11-01T17:00:00Z')), 'W2026-11-02');
  assert.equal(monthId(Date.parse('2026-10-31T17:00:00Z')), 'M2026-11');
  assert.equal(prevWeekId(NOW), 'W2026-11-02');
  assert.equal(prevMonthId(Date.parse('2027-01-05T00:00:00Z')), 'M2026-12');
  assert.equal(weekEndsAt(NOW), Date.parse('2026-11-15T17:00:00Z'));
  assert.equal(monthEndsAt(NOW), Date.parse('2026-11-30T17:00:00Z'));
});

test('ตารางรางวัล', () => {
  assert.deepEqual([1, 3, 10, 50, 51].map(r => rewardFor('W2026-11-02', r)), [10, 6, 3, 1, 0]);
  assert.deepEqual([1, 3, 10, 50, 51].map(r => rewardFor('M2026-11', r)), [50, 30, 15, 5, 0]);
});

test('รอบที่ยังไม่จบรับไม่ได้', async () => {
  assert.deepEqual((await seasons.claim(google('a'), {}, NOW)).rewards, []);
});

test('รับรางวัลได้ครั้งเดียว · แต้มเท่ากันคนถึงก่อนอยู่สูงกว่า', async () => {
  const a = await seasons.claim(google('a'), {}, NEXT_WEEK);
  assert.deepEqual(a.rewards, [{ id: weekId(NOW), rank: 1, hearts: 10 }]);
  assert.equal(a.hearts, 10);
  assert.equal((await seasons.claim(google('a'), {}, NEXT_WEEK)).hearts, 0);
  assert.equal((await seasons.claim(google('b'), {}, NEXT_WEEK)).rewards[0].rank, 2);
  assert.equal((await seasons.claim(google('c'), {}, NEXT_WEEK)).rewards[0].rank, 3);
});

test('guest ต้องผูก Google ก่อน และยังรับภายหลังได้', async () => {
  await row(weekId(NEXT_WEEK), 'g', 5, NEXT_WEEK);
  const after = NEXT_WEEK + 7 * 86400e3;
  const r = await seasons.claim(guest('g'), {}, after);
  assert.equal(r.needGoogle, true);
  assert.equal(r.hearts, 10);
  assert.equal((await seasons.claim(google('g'), {}, after)).hearts, 10);
});

test('รางวัลเดือนแยกจากสัปดาห์ · ไม่ติดอันดับไม่ได้อะไร', async () => {
  const r = await seasons.claim(google('a'), {}, NEXT_MONTH);
  assert.ok(r.rewards.some(w => w.id === monthId(NOW) && w.hearts === 50));
  assert.deepEqual((await seasons.claim(google('nobody'), {}, NEXT_MONTH)).rewards, []);
  assert.equal((await seasons.claim(null, {}, NEXT_MONTH).catch(e => e)).code, 'unauthenticated');
});

test('season-rules ของ server ตรงกับของเกม (src/core/season-rules.ts)', () => {
  const strip = t => t.replace(/^\/\/.*$/gm, '').replace(/: (number|string)\b/g, '').replace(/: Record<string, \[number, number\]\[\]>/g, '').replace(/\s+/g, '');
  const game = readFileSync(new URL('../../src/core/season-rules.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../season-rules.js', import.meta.url), 'utf8');
  assert.equal(strip(game), strip(server));
});
