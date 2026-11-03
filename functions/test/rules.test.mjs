// firestore.rules กับ Firestore emulator: กระดานอ่านได้เมื่อล็อกอิน · client เขียนแต้ม/สถานะใด ๆ ไม่ได้ (แต้มมาจาก submitWin เท่านั้น)
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, orderBy, where, limit, serverTimestamp, increment, getCountFromServer } from 'firebase/firestore';
import { weekId, monthId } from '../season-rules.js';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '').split(':');
if (!host) throw new Error('ต้องรันผ่าน Firestore emulator');
const env = await initializeTestEnvironment({
  projectId: 'demo-wickling-rules',
  firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
});
const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seed = (path, data) => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), data));

test('firestore.rules กระดาน (server-only)', async ctx => {
  const t = (label, ok, fn) => ctx.test(label, () => (ok ? assertSucceeds(fn()) : assertFails(fn())));
  const w = weekId(), m = monthId();
  for (const b of ['all', w, m]) await seed(`boards/${b}/scores/a`, { uid: 'a', name: 'ภูติ', pts: 3, at: new Date() });
  await seed('players/a', { name: 'ภูติ', day: { d: '2026-11-03', n: 1 } });

  await t('อ่านกระดานถาวรเมื่อล็อกอิน (limit 50)', true, () => getDocs(query(collection(as('z'), 'boards/all/scores'), orderBy('pts', 'desc'), limit(50))));
  await t('อ่านกระดานสัปดาห์เมื่อล็อกอิน', true, () => getDoc(doc(as('z'), `boards/${w}/scores/a`)));
  await t('อ่าน boards-dev ไม่ได้ (ข้อมูลทดสอบมีแค่ใน emulator)', false, () => getDoc(doc(as('z'), `boards-dev/${w}/scores/a`)));
  await t('list ไม่มี limit ไม่ได้', false, () => getDocs(query(collection(as('z'), 'boards/all/scores'), orderBy('pts', 'desc'))));
  await t('list limit 51 ไม่ได้', false, () => getDocs(query(collection(as('z'), 'boards/all/scores'), orderBy('pts', 'desc'), limit(51))));
  await t('list เฉพาะ Google (g == true) limit 50 ได้', true, () => getDocs(query(collection(as('z'), `boards/${w}/scores`), where('g', '==', true), orderBy('pts', 'desc'), limit(50))));
  await t('นับอันดับ (count ไม่มี limit) ไม่ได้ → เกมแสดง 50+', false, () => getCountFromServer(query(collection(as('z'), 'boards/all/scores'), where('pts', '>', 1))));
  await t('ไม่ล็อกอิน list ไม่ได้', false, () => getDocs(query(collection(anon(), 'boards/all/scores'), limit(10))));
  await t('ไม่ล็อกอินอ่านกระดานไม่ได้', false, () => getDoc(doc(anon(), `boards/${w}/scores/a`)));
  await t('เขียนแถวตัวเองในสัปดาห์นี้ไม่ได้', false, () => setDoc(doc(as('a'), `boards/${w}/scores/a`), { uid: 'a', name: 'ภูติ', pts: 4, at: serverTimestamp() }));
  await t('เพิ่มแต้มตัวเองด้วย increment ไม่ได้', false, () => setDoc(doc(as('a'), `boards/all/scores/a`), { pts: increment(1) }, { merge: true }));
  await t('สร้างแถวใหม่ในกระดานถาวรไม่ได้', false, () => setDoc(doc(as('b'), 'boards/all/scores/b'), { uid: 'b', name: 'ภูติ', pts: 1, at: serverTimestamp() }));
  await t('เขียน boards-dev ไม่ได้', false, () => setDoc(doc(as('b'), `boards-dev/${w}/scores/b`), { uid: 'b', name: 'ภูติ', pts: 1, at: serverTimestamp() }));
  await t('ลบแถวตัวเองไม่ได้', false, () => deleteDoc(doc(as('a'), `boards/${w}/scores/a`)));
  await t('อ่านสถานะ players ของตัวเองไม่ได้', false, () => getDoc(doc(as('a'), 'players/a')));
  await t('เขียนสถานะ players ของตัวเองไม่ได้ (ล้างเพดานต่อวัน)', false, () => setDoc(doc(as('a'), 'players/a'), { day: null }, { merge: true }));
  await t('สร้าง won ของตัวเองไม่ได้', false, () => setDoc(doc(as('a'), 'players/a/won/r0'), { at: serverTimestamp() }));
  await t('อ่านผลที่ล็อกไม่ได้', false, () => getDoc(doc(as('a'), `seasons/${w}`)));
  await t('แก้รอบที่รับรางวัลแล้วไม่ได้', false, () => setDoc(doc(as('a'), 'seasonClaims/a'), { ids: [] }));
  await t('อ่าน purchases ไม่ได้', false, () => getDoc(doc(as('a'), 'purchases/x')));
  await t('เขียน collection อื่นไม่ได้', false, () => setDoc(doc(as('a'), 'news/x'), { a: 1 }));

  await env.cleanup();
});
