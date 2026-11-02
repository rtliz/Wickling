# CLAUDE.md · Wickling (ภูติตะเกียง)

เกมปริศนามือถือ: ดวงไฟเดินได้รอบละ 10 วินาที ทุกรอบที่จบกลายเป็น "เงา" ที่เดินซ้ำแบบเดิม ใช้เงาหลายตัวช่วยกันกดสวิตช์และบังเลเซอร์ ไปให้ถึงทางออก · ใบสรุปเกม: [GAME_BRIEF.md](GAME_BRIEF.md)

เจ้าของเกมเขียนภาษาไทยและไม่ใช่โปรแกรมเมอร์: ตอบภาษาไทย ให้คำสั่งทีละขั้น · ทำตาม [CLAUDE.md ของสตูดิโอ](../CLAUDE.md) และกฎ 5 ข้อใน `../.claude/rules/`

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `pnpm install` | ติดตั้งครั้งแรก |
| `pnpm dev` | เปิดเกมที่ http://localhost:5173 (มีปุ่ม "+20 ★ ทดสอบ" ในต้นไม้สกิล เฉพาะโหมดนี้) |
| `pnpm check` | **คำสั่งตรวจหลัก**: typecheck + ให้โปรแกรมเล่นผ่านทุกห้องจริงตามกติกา + หอคอยชั้น 1–200 · ต้องผ่านก่อน commit |
| `pnpm build` | build ไป `dist/` |

## โครงสร้าง

| ที่อยู่ | คืออะไร |
|---|---|
| `src/core/sim.ts` | กติกาเกมทั้งหมด (ไม่มี DOM) เป็นจังหวะคงที่ 0.25 วิ · `t` = เวลาตัวจริง, `gt` = เวลาโลก/เงา (หยุดได้ด้วยหยุดเปลว) |
| `src/core/levels.ts` | ห้องที่ออกแบบเอง 13 ห้อง (1–5 พื้นฐาน, 6–13 ห้องสอนสกิล) |
| `src/core/tower.ts` | หอคอย ∞ สุ่มจาก seed ของเลขชั้น · เก็บเฉพาะห้องที่ `autoSolve` เล่นผ่าน |
| `src/core/solve.ts` | ตัวแก้ปริศนาอัตโนมัติ (ใช้แค่เงา) ใช้ทั้งในตัวสุ่มและใน `pnpm check` |
| `src/core/skills.ts` | ต้นไม้สกิล 11 สกิล + ไอคอน SVG |
| `src/core/save.ts` | เซฟในเครื่อง + migrate + validate |
| `src/render/board.ts` | วาดกระดานด้วย Canvas 2D (สไปรต์ SVG ในโค้ด) · 3 ระดับกราฟิก |
| `src/ui/tree.ts` | หน้าต้นไม้สกิล + วิดีโอตัวอย่างสกิล (ยกจากต้นแบบ ยังเป็น `@ts-nocheck`) |
| `src/main.ts` | ตัวควบคุมเกม HUD ปุ่ม เสียง ลูปหลัก |
| `src/platform/analytics.ts` | Firebase Analytics (config เว็บแอป ไม่ใช่ความลับ) · lazy load, ปิดใน dev/localhost · event: `level_complete` ตอนผ่านห้องเท่านั้น |
| `scripts/check.ts` | คำตอบที่เขียนไว้ของห้องสอน + ตรวจหอคอย |
| `prototypes/echo-me/` | ต้นแบบ HTML ไฟล์เดียว + mock แนวภาพ/ต้นไม้สกิล (ห้าม import เข้าโค้ดจริง) |

**แก้ห้อง:** เพิ่มห้องใน `levels.ts` แล้วเพิ่มคำตอบใน `SOLUTIONS` ของ `scripts/check.ts` (ห้องที่ใช้แค่เงา `autoSolve` ตรวจให้เอง) แล้วรัน `pnpm check`
**แก้กติกา:** แก้ใน `sim.ts` เท่านั้น แล้วรัน `pnpm check` (หอคอย 200 ชั้นจะบอกถ้ากติกาใหม่ทำให้ห้องผ่านไม่ได้)

## ค่าที่ล็อกไว้ (ห้ามเปลี่ยนหลังปล่อย ดู ../.claude/rules/player-data.md)

| ค่า | ใช้ | สถานะ |
|---|---|---|
| package id | `com.wickling.puzzle` | ล็อก: สร้างแอปใน Play Console แล้ว (2026-11-02, app id `4973122480503751933`) · ยังไม่ได้ลง Capacitor |
| Firebase | `wickling-rtliz` (`.firebaserc`) · region `asia-southeast1` เมื่อสร้าง Firestore/Functions | สร้างแล้ว · ใช้ Analytics (เว็บ, `G-HNDE8DEH0J`) · แผน Spark พอ (ยังไม่ใช้ Firestore) · ตอนทำ Android ต้องกรอก Data safety ว่าเก็บข้อมูลการใช้งาน · ก่อนอัป Blaze ต้องตั้ง budget alert |
| key เซฟ | `wickling.save.v1` · สำรองเซฟเสีย `wickling.save.bad` · `SAVE_VERSION = 1` | ล็อก |
| ลำดับห้องใน `LEVELS` | ดาวในเซฟอ้างด้วยลำดับ → เพิ่มต่อท้ายเท่านั้น | ล็อกหลังปล่อย |
| ตัวสุ่มหอคอย (`genTower`, seed) | ห้องของแต่ละชั้นต้องเหมือนเดิม | ล็อกหลังปล่อย |
| id สกิล (`root t1 t2 t3 s1 s2 s3 l1 l2 l3 cap`) | เซฟอ้างด้วย id | ล็อก |
| product id IAP | `wickling_starter_pack`, `wickling_hints_10`, `wickling_remove_ads` | เสนอ · ยังไม่สร้างใน Play Console |
| ระดับกราฟิก | อัตโนมัติ / สูง / กลาง / ต่ำ (`wickling.settings`) | ทำแล้ว |
| id ใน studio-cms | `wickling` | ยังไม่ได้เพิ่มใน `studio-cms/src/games.ts` |

## กันแฮก

ทำตาม [../.claude/rules/anti-hack.md](../.claude/rules/anti-hack.md) · **โมเดลที่เลือก: เซฟลายเซ็น + Validator (แบบเกม Wuxia)** เมื่อมีของมีมูลค่า
- ตอนนี้: เซฟมีแค่ดาว ชั้นหอคอย สกิล (ไม่มีเงิน/ของซื้อ) จึงยังไม่ลงลายเซ็น · `validate()` ใน `save.ts` ตัดค่าที่ผิดรูปแบบ · ดาวทดสอบมีเฉพาะ `import.meta.env.DEV`
- Firestore ปิดทุกอย่าง (`firestore.rules` default-deny)
- **ก่อนเพิ่ม IAP / สกุลเงินพรีเมียม / กระดานคะแนน:** ต้องลงลายเซ็นเซฟ + Validator + ตรวจใบเสร็จที่ server (ยก `Idle-Wuxia-RPG/functions/` `verifyPurchase`) และกระดานต้องมีเพดานตามอายุบัญชี · บันทึกสถานะใน `../.claude/skills/game-security/SKILL.md`

## กฎของสตูดิโอ

[anti-hack](../.claude/rules/anti-hack.md) · [player-data](../.claude/rules/player-data.md) · [firebase-cost](../.claude/rules/firebase-cost.md) · [git-deploy](../.claude/rules/git-deploy.md) · [performance](../.claude/rules/performance.md)

## ค้างอยู่

- ทดสอบกับผู้เล่นที่ไม่รู้กติกา 2–3 คน (ยังไม่ได้ทำ)
- หอคอยตั้งแต่ชั้น ~7 ใช้เงา 4 ตัวแทบทุกชั้น ความยากหยุดเพิ่ม · ต้องเพิ่มของใหม่ในหอคอย (เลเซอร์กะพริบ, ห้องมืด, "ห้องสกิล" ทุก 5 ชั้น)
- ราคาสกิลตอนนี้ 2/4/6/10 ★ (ดาวทั้งเกม 39 + หอคอย) · ปรับเมื่อมีห้องครบ 30
- `src/ui/tree.ts` ยังเป็น `@ts-nocheck`
- Android (Capacitor), AdMob, IAP ยังไม่ได้ทำ · ไอคอน/ภาพหน้าร้านอยู่ `docs/store/` (ต้นฉบับ `docs/ui-mockup/store/art.html`)
- Play Console (app id `4973122480503751933`) กรอกแล้ว ยกเว้นการจัดประเภทเนื้อหา (IARC) · **ประกาศว่าไม่มีโฆษณา ไม่ใช้รหัสโฆษณา ไม่มีบัญชี เก็บแค่ข้อมูลการใช้งาน/รหัสอุปกรณ์เพื่อวิเคราะห์** · เพิ่ม AdMob/IAP เมื่อไรต้องแก้ฟอร์มโฆษณา รหัสโฆษณา ความปลอดภัยของข้อมูล และ https://rtliz-studio.web.app/privacy/wickling/ ก่อนปล่อย
