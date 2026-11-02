import type { SkillId } from "./sim";

// ต้นไม้สกิล "ต้นไม้เปลวไฟ" · สกิลคือท่าใหม่ ไม่ใช่ค่าพลัง · x,y เป็น % ของพื้นที่ต้นไม้
// ⚠️ หลังปล่อยเกม ห้ามเปลี่ยน id (เซฟอ้างด้วย id)
export interface SkillNode {
  id: SkillId; room: string; br: string; x: number; y: number; cost: number; icon: string;
  name: string; kind: string; desc: string; req: SkillId[]; cap?: boolean;
}
const INK = "#1b1430";
export const ICON: Record<string, string> = {
  flame:`<path d="M12 2.5 Q16 7 18 11 Q20 18 12 21 Q4 18 6 11 Q7.5 8 10 6.5 Q10 10 12 10 Q11 6 12 2.5Z" fill="#ffb13b" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="15" r="1.1" fill="${INK}"/><circle cx="14" cy="15" r="1.1" fill="${INK}"/>`,
  eye:`<path d="M2.5 12 Q12 3 21.5 12 Q12 21 2.5 12Z" fill="#2a2134" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9.5 V12 L13.8 13.2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  pause:`<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="8.3" y="7.5" width="2.6" height="9" rx="1" fill="currentColor"/><rect x="13.1" y="7.5" width="2.6" height="9" rx="1" fill="currentColor"/>`,
  rewind:`<path d="M19 12 A7 7 0 1 1 12 5 H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 2 L17.5 5 L14 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="matrix(-1 0 0 1 29 0)"/>`,
  recall:`<path d="M6 18 Q3 12 8 8 Q13 4 17 8 Q20 12 16 15 Q13 17 11 14 Q10 11 13 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 19 H21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  hourglass:`<path d="M7 3 H17 M7 21 H17 M8 3 Q8 9 12 12 Q16 9 16 3 M8 21 Q8 15 12 12 Q16 15 16 21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 19 Q12 16 14 19Z" fill="currentColor"/>`,
  mirror:`<path d="M12 3 V21" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2"/><path d="M10 7 L4 12 L10 17Z" fill="currentColor" opacity=".9"/><path d="M14 7 L20 12 L14 17Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  radiate:`<circle cx="12" cy="12" r="3.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.3 5.3 L7.4 7.4 M16.6 16.6 L18.7 18.7 M5.3 18.7 L7.4 16.6 M16.6 7.4 L18.7 5.3"/></g>`,
  dash:`<path d="M4 6 L10 12 L4 18 M11 6 L17 12 L11 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="12" r="1.8" fill="currentColor"/>`,
  lantern:`<path d="M9 4 H15 M12 2 V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="5" width="10" height="13" rx="3" fill="#2a2134" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5 Q14 11 13 13.5 Q12 15 11 13.5 Q10 11 12 8.5Z" fill="currentColor"/><path d="M8 20.5 H16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  split:`<path d="M8 4 Q11 8 11.5 11 Q12 16 7.5 17 Q3 16 4 11 Q5 8 8 4Z" fill="#ffb13b" stroke="${INK}" stroke-width="1.4"/><path d="M16 6 Q19 10 19.5 13 Q20 18 15.5 19 Q11 18 12 13 Q13 10 16 6Z" fill="#c9b8ff" stroke="${INK}" stroke-width="1.4"/>`,
};
export const BR: Record<string, { n: string; c: string }> = { root:{ n:"ราก", c:"#ffb13b" }, time:{ n:"เปลวแห่งเวลา", c:"#ffb13b" }, smoke:{ n:"ควันวิญญาณ", c:"#c9b8ff" }, light:{ n:"แสงนำทาง", c:"#8fe3d0" }, cap:{ n:"ยอดต้นไม้", c:"#ffd27a" } };
// x,y เป็น % ของพื้นที่ต้นไม้ · kind: active = กดใช้ในด่าน 1 ครั้งต่อรอบ, passive = ทำงานเอง
export const NODES: SkillNode[] = [
  { id:"root", room:"ห้อง 1–5: สวิตช์ ประตู เลเซอร์ ปริศนาพื้นฐานที่ใช้แค่เงา", br:"root", x:50, y:91, cost:0, icon:"flame", name:"ดวงไฟน้อย", kind:"ติดตัวเสมอ", desc:"ร่างแรกของภูติตะเกียง เดินได้ 10 วินาทีต่อรอบ และทิ้งควันไว้เป็นเงา", req:[] },
  { id:"t1", room:"ห้องที่มีเงาหลายตัว เช่น ห้อง 4–5 และหอคอยชั้นสูง ๆ", br:"time", x:18, y:72, cost:2, icon:"eye", name:"ส่องอนาคต", kind:"ทำงานเอง", desc:"กดค้างที่หลอดเทียนแล้วลาก ดูได้ว่าเงาทุกตัวจะอยู่ตรงไหนในช่วงเวลานั้น", req:["root"] },
  { id:"t2", room:"ห้อง 8 “เลเซอร์กะพริบ”: หยุดเวลาตอนลำแสงสองเส้นดับพร้อมกัน", br:"time", x:18, y:50, cost:4, icon:"pause", name:"หยุดเปลว", kind:"กดใช้ 1 ครั้งต่อรอบ", desc:"หยุดเวลาทั้งห้อง 1 วินาที ตัวจริงยังเดินได้ เงาและเลเซอร์หยุดนิ่ง", req:["t1"] },
  { id:"t3", room:"ห้อง 12 “ทางแยก”: เลเซอร์กะพริบพาดทางเดิน ก้าวผิดจังหวะแล้วย้อนกลับมาลองใหม่", br:"time", x:18, y:28, cost:6, icon:"rewind", name:"ย้อนเปลว", kind:"กดใช้ 1 ครั้งต่อรอบ", desc:"ย้อนตัวจริงกลับไปจุดที่อยู่เมื่อ 2 วินาทีก่อน (เงาไม่ย้อนตาม)", req:["t2"] },
  { id:"s1", room:"ห้องที่ต้องลองหลายแผน เช่น ห้อง 5 ลบเงาตัวที่วางผิดได้โดยไม่ต้องเริ่มใหม่", br:"smoke", x:50, y:66, cost:2, icon:"recall", name:"เรียกควันกลับ", kind:"ทำงานเอง", desc:"แตะจุดสีของเงาที่มุมขวาบน เพื่อลบเงาตัวไหนก็ได้ ไม่ต้องลบจากตัวล่าสุด", req:["root"] },
  { id:"s2", room:"ห้อง 10 “ส่งไม้ต่อ”: เงาตัวเดียวต้องย้ายจากสวิตช์ a ไป b ให้ทันจังหวะ", br:"smoke", x:50, y:44, cost:4, icon:"hourglass", name:"ควันหน่วงเวลา", kind:"ทำงานเอง", desc:"แตะจุดสีของเงาที่มุมขวาบน ตั้งให้เงาตัวนั้นออกตัวช้าลง 0–3 วินาที", req:["s1"] },
  { id:"s3", room:"ห้อง 11 “สวิตช์คู่”: สวิตช์ซ้าย-ขวาอยู่ตรงข้ามกันพอดี", br:"smoke", x:50, y:24, cost:6, icon:"mirror", name:"ควันกระจก", kind:"ทำงานเอง", desc:"เปิดเงากระจกให้เงาตัวไหนก็ได้ เงากระจกเดินกลับซ้าย-ขวา ไม่นับเป็นเงาเพิ่ม (แตะจุดสีของเงาที่มุมขวาบน)", req:["s2"] },
  { id:"l1", room:"ห้อง 6 “ห้องมืด”: ปืนเลเซอร์ซ่อนอยู่ในความมืด", br:"light", x:82, y:72, cost:2, icon:"radiate", name:"ส่องไกล", kind:"ทำงานเอง", desc:"ในห้องมืด วงแสงกว้างขึ้นสองเท่า เห็นปืนเลเซอร์ที่ซ่อนอยู่", req:["root"] },
  { id:"l2", room:"ห้อง 7 “ข้ามลำแสง”: พุ่งข้ามลำแสงโดยไม่ต้องใช้เงา", br:"light", x:82, y:50, cost:4, icon:"dash", name:"เปลวพุ่ง", kind:"กดใช้ 1 ครั้งต่อรอบ", desc:"พุ่งไปข้างหน้า 2 ช่องในจังหวะเดียว ทันเงาที่กำลังจะลุกจากสวิตช์", req:["l1"] },
  { id:"l3", room:"ห้อง 9 “โคมเฝ้าสวิตช์”: วางโคมแล้ววิ่งไปประตูภายใน 3 วินาที", br:"light", x:82, y:28, cost:6, icon:"lantern", name:"โคมค้างไว้", kind:"กดใช้ 1 ครั้งต่อรอบ", desc:"วางโคมไว้บนช่องที่ยืน โคมกดสวิตช์ค้างไว้ 3 วินาที", req:["l2"] },
  { id:"cap", room:"ห้อง 13 “สองดวงพร้อมกัน”: ดวงหนึ่งเฝ้าสวิตช์ อีกดวงออกประตู", br:"cap", x:50, y:7, cost:10, icon:"split", name:"แยกเปลว", kind:"กดใช้ 1 ครั้งต่อรอบ", desc:"แยกเป็นดวงไฟสองดวง 3 วินาที กดปุ่มซ้ำเพื่อสลับดวงที่บังคับ ดวงไหนถึงทางออกก่อนก็ผ่าน", req:["t3","s3","l3"], cap:true },
];

export const nodeById = (id: string) => NODES.find(n => n.id === id);
