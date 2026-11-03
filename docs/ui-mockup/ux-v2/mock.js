/* mockup เท่านั้น: ประกอบจอตัวอย่างจากข้อมูลจำลอง · ข้อความไทยทั้งหมด · ไอคอนอ้างจาก <symbol> ใน index.html */
const I = (n, c = "") => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
const SK = (n, c = "") => `<svg class="ic ${c}"><use href="#sk-${n}"/></svg>`;
const stars = (n, c = "") => [0, 1, 2].map(i => I(i < n ? "star" : "star0", c)).join("");
const go = (id, inner, cls = "", tag = "a") => `<${tag} class="${cls}" href="#${id}" data-go="${id}">${inner}</${tag}>`;

/* ข้อมูลจำลอง */
const ME = { room: 8, hearts: 5, star: 21, floor: 24, name: "แสงตะเกียง" };
const ROOMS = { 1:"ก้าวแรก",2:"สวิตช์",3:"ประตูคู่",4:"เงาช่วยเงา",5:"ลบเงา",6:"ห้องมืด",7:"ข้ามลำแสง",8:"เลเซอร์กะพริบ",9:"โคมเฝ้าสวิตช์",10:"ส่งไม้ต่อ",11:"สวิตช์คู่",12:"ทางแยก",13:"สองดวงพร้อมกัน" };
const ROOM_STARS = { 1:3,2:3,3:3,4:2,5:3,6:3,7:2,8:0 };
const ROOM_SKILL = { 6:"radiate",7:"dash",8:"pause",9:"lantern",10:"hourglass",11:"mirror",12:"rewind",13:"split" };

/* ชิ้นส่วนที่ใช้ซ้ำ */
const topBar = (opt = {}) => `<div class="top">
  ${go("profile", `<svg viewBox="-20 -30 40 50" width="34" height="42" style="margin-top:6px"><use href="#hero"/></svg>`, "avatar")}
  ${go("shop", `${I("heart")}<span>${ME.hearts}</span><span class="plus">${I("plus", "s")}</span>`, "chip")}
  <div class="chip" aria-label="ดาว">${I("star")}<span>${ME.star}</span></div>
  <span class="sp"></span>
  ${go("shop", I("bag"), "ibtn")}${go("settings", I("gear"), "ibtn")}</div>`;
const nav = on => `<div class="nav">
  ${go("home", I("home") + "หน้าแรก", on === "home" ? "on" : "")}
  ${go("map", I("map") + "แผนที่", on === "map" ? "on" : "")}
  ${go("skills", I("tree") + "ต้นไม้", on === "skills" ? "on" : "")}
  ${go("rank", I("trophy-l") + "อันดับ", on === "rank" ? "on" : "")}</div>`;
const ad = `<div class="ad">พื้นที่แบนเนอร์โฆษณา · <b>&nbsp;จำลอง</b></div>`;
const sheetHead = (title, icon, back = "home") => `<div class="sh-head"><h2>${icon}${title}</h2>${go(back, I("close"), "ibtn")}</div>`;

/* ===== 1 หน้าแรก ===== */
function home() {
  return `${topBar()}<div class="body">
  <div class="stage"><div class="halo"></div>
    <svg class="mascot" viewBox="-170 -120 340 240"><use href="#ghost0" transform="translate(-112 12) scale(2.8)"/><use href="#ghost1" transform="translate(112 12) scale(2.8)"/><use href="#hero" transform="translate(0 6) scale(5.4)"/></svg></div>
  <div class="logo"><b>Wickling</b><span>ภูติตะเกียง</span></div>
  ${go("play", `<span class="t">${I("play", "l")}เล่นต่อ</span><span class="s">ห้อง ${ME.room} · ${ROOMS[ME.room]}</span>`, "btn primary playbig")}
  <div class="modes">
    ${go("map", `<span class="ico">${I("map", "l")}</span><b>เส้นทาง</b><small>${I("check", "s")}${ME.room - 1}/13</small>`, "mode")}
    ${go("play", `<span class="ico">${I("tower", "l")}</span><b>หอคอย ∞</b><small>ชั้น ${ME.floor}</small>`, "mode")}
    ${go("skills", `<span class="ico">${I("tree", "l")}</span><b>ต้นไม้</b><small>${I("star", "s")}${ME.star}</small><i class="dot"></i>`, "mode")}
  </div>
  <div class="duo">
    ${go("rank", `${I("trophy", "l")}<span>อันดับ<small>ที่ 12 สัปดาห์นี้</small></span>`, "wide")}
    ${go("home", `${I("news", "l")}<span>ข่าว<small>อัปเดตใหม่ 1</small></span>`, "wide")}
  </div></div>${nav("home")}${ad}`;
}

/* ===== 2 แผนที่ ===== */
const XS = [206, 112, 300, 150, 270, 206, 112, 300, 206, 112, 300, 150, 260];
function map() {
  const pts = []; // [roomNo, x, y]
  const y2 = { 13: 330, 12: 430, 11: 520, 10: 610, 9: 700, 8: 790, 7: 880, 6: 970 };
  const y1 = { 5: 1170, 4: 1260, 3: 1350, 2: 1440, 1: 1530 };
  const x = { 13: 206, 12: 120, 11: 292, 10: 140, 9: 276, 8: 160, 7: 270, 6: 130, 5: 206, 4: 290, 3: 130, 2: 280, 1: 206 };
  for (const [n, y] of Object.entries({ ...y2, ...y1 })) pts.push([+n, x[n], y]);
  pts.sort((a, b) => b[0] - a[0]);
  let d = `M ${pts[0][1]} ${pts[0][2]}`;
  for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i], my = (p[2] + q[2]) / 2; d += ` C ${p[1]} ${my}, ${q[1]} ${my}, ${q[1]} ${q[2]}`; }
  const nodes = pts.map(([n, px, py]) => {
    const st = ROOM_STARS[n], lock = n > ME.room, cur = n === ME.room, fin = n === 13 || n === 5;
    const stars3 = !lock && !cur ? `<span class="stars">${stars(st)}</span>` : "";
    const badge = ROOM_SKILL[n] ? `<span class="badge">${SK(ROOM_SKILL[n])}</span>` : "";
    const inner = lock ? I("lock") : n;
    const you = cur ? `<svg class="you" viewBox="-20 -30 40 50"><use href="#hero"/></svg>` : "";
    return `<a href="#play" data-go="play" class="node ${lock ? "lock" : ""} ${cur ? "cur" : ""} ${fin ? "fin" : ""}" style="left:${px}px;top:${py}px">${inner}${badge}${stars3}${you}</a>`;
  }).join("");
  return `${topBar()}<div class="body">
  <div class="map-scroll"><div class="map-inner" style="--sy:-430px">
    <svg class="path" viewBox="0 0 412 1640" width="412" height="1640">
      <path d="${d}" fill="none" stroke="#1b1430" stroke-width="12" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="#7c6ea6" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 13" opacity=".7"/>
      <path d="M 206 1530 C 206 1485, 112 1485, 112 1440" fill="none" stroke="#ffb13b" stroke-width="0"/>
    </svg>
    <div class="chap soon" style="top:56px">${I("fog", "l")}บทที่ 3<small>เร็ว ๆ นี้</small></div>
    <div class="chap" style="top:200px">${SK("flame", "l")}บทที่ 2 · สกิล<small>${I("star", "s")}12/24</small></div>
    <div class="chap" style="top:1040px">${I("gate", "l")}บทที่ 1 · พื้นฐาน<small>${I("star", "s")}14/15</small></div>
    ${nodes}
    <svg class="ic xl" style="position:absolute;left:236px;top:1130px;width:40px;height:40px"><use href="#i-chest"/></svg>
    <div class="fog"></div>
  </div></div></div>${nav("map")}${ad}`;
}

/* ===== 3 หน้าเล่น ===== */
function board() {
  const C = 62, cols = 5, rows = 7, W = C * cols, H = C * rows;
  let g = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    g += `<rect x="${c * C + 1.5}" y="${r * C + 1.5}" width="${C - 3}" height="${C - 3}" rx="5" fill="${(r + c) % 2 ? "#241b33" : "#2a2038"}" stroke="#3d3150" stroke-width="1.5"/>`;
  const cx = c => c * C + C / 2, cy = r => r * C + C / 2;
  return `<svg viewBox="-16 -16 ${W + 32} ${H + 32}" style="width:100%;height:100%;overflow:visible">
  <rect x="-6" y="-6" width="${W + 12}" height="${H + 12}" rx="10" fill="none" stroke="#e6bd5c" stroke-opacity=".5" stroke-width="2"/>${g}
  <g transform="translate(${cx(2)} ${cy(0) + 4}) scale(2.3)"><path d="M-9 12 V-2 Q-9 -12 0 -12 Q9 -12 9 -2 V12Z" fill="#ffb13b" stroke="#1b1430" stroke-width="1.6"/><path d="M-5 12 V-1 Q-5 -7 0 -7 Q5 -7 5 -1 V12Z" fill="#fff6c0" opacity=".85"/></g>
  <circle cx="${cx(2)}" cy="${cy(0)}" r="46" fill="#ffb13b" opacity=".12"/>
  <!-- เลเซอร์ -->
  <path d="M${W - 8} ${cy(3)} H${cx(0) - 20}" stroke="#ff3b2b" stroke-width="12" opacity=".28" stroke-linecap="round"/><path d="M${W - 8} ${cy(3)} H${cx(0) - 20}" stroke="#ffd6cf" stroke-width="3.5" stroke-linecap="round"/>
  <g transform="translate(${W + 4} ${cy(3)})"><circle r="19" fill="#2a2134" stroke="#ff3b2b" stroke-width="2" stroke-dasharray="4 3"/><circle r="5" fill="#ff3b2b"/></g>
  <g transform="translate(-4 ${cy(5) - 2})" opacity=".55"><circle r="19" fill="#2a2134" stroke="#7c6ea6" stroke-width="2" stroke-dasharray="4 3"/><circle r="5" fill="#5e4f86"/></g>
  <!-- สวิตช์ -->
  <ellipse cx="${cx(4)}" cy="${cy(5)}" rx="20" ry="9" fill="#2a2134" stroke="#8fe3d0" stroke-width="2.5"/><ellipse cx="${cx(4)}" cy="${cy(5) - 2}" rx="12" ry="5" fill="#8fe3d0" opacity=".7"/>
  <use href="#ghost0" transform="translate(${cx(1)} ${cy(4)}) scale(1.35)" opacity=".9"/>
  <use href="#hero" transform="translate(${cx(2)} ${cy(6) - 2}) scale(1.6)"/></svg>`;
}
function play(over = "") {
  return `<div class="hud">
    ${go("map", I("back"), "ibtn")}
    <div class="title"><b>ห้อง ${ME.room}</b><small>${ROOMS[ME.room]}</small></div>
    <div class="chip">${I("heart")}<span>${ME.hearts}</span></div>
    ${go("settings", I("gear"), "ibtn")}</div>
  <div class="strip"><span class="goal">${I("star")}${I("star")}${I("star")}<span>&nbsp;ใช้เงา ≤ 0</span></span>
    <span class="gdots" aria-label="เงา 1 จาก 4">${I("ghost", "s")}<i class="a"></i><i></i><i></i><i></i></span></div>
  <div class="board">${board()}</div>
  <div class="timer"><div class="wax"></div><div class="fl"></div></div>
  <div class="tip"><span style="display:flex;align-items:center;gap:8px">${SK("pause", "s")}<span><b>หยุดเปลว</b> ตอนเลเซอร์ดับพร้อมกัน</span></span>${go("play", I("help"), "ibtn")}</div>
  <div class="dock">
    <button class="slot">${SK("pause")}หยุดเปลว</button>
    <button class="slot empty">${I("plus")}ช่อง 2</button>
    <div class="acts">
      <button class="act off">${I("ghost")}ใช้เงา</button>
      <button class="act off">${I("undo")}ลบเงา</button>
      <button class="act">${I("replay")}เริ่มใหม่</button></div></div>
  <div class="play-bottom"></div>${ad}${over}`;
}

/* ===== 4 ผล ===== */
function resultRoom() {
  const sheet = `<div class="dim"></div><div class="sheet pop win">
    <svg class="rays" viewBox="-100 -100 200 200"><g fill="#ffd36b">${[0,30,60,90,120,150,180,210,240,270,300,330].map(a => `<path transform="rotate(${a})" d="M-7 0L0 -98L7 0z"/>`).join("")}</g></svg>
    <div class="winstars">${stars(3)}</div>
    <h2>ผ่านแล้ว</h2><p class="sub">ห้อง ${ME.room} · ${ROOMS[ME.room]}</p>
    <div class="reward"><div class="chip">${I("star")}<span>+3</span></div><div class="chip">${I("ghost", "s")}<span>0 เงา</span></div></div>
    ${go("play", `<span>ด่านต่อไป</span>${I("play")}`, "btn primary lg")}
    <div class="row2">${go("play", `${I("replay")}เล่นใหม่`, "btn")}${go("map", `${I("map")}แผนที่`, "btn")}</div></div>`;
  return play(sheet);
}
function resultTower() {
  const sheet = `<div class="dim"></div><div class="sheet pop win">
    <svg class="rays" viewBox="-100 -100 200 200"><g fill="#ffd36b">${[0,30,60,90,120,150,180,210,240,270,300,330].map(a => `<path transform="rotate(${a})" d="M-7 0L0 -98L7 0z"/>`).join("")}</g></svg>
    <div class="winstars" style="height:96px;margin-top:-56px">${I("tower", "xl")}</div>
    <h2>ชั้น ${ME.floor + 1} สำเร็จ</h2>
    <div class="newbest">${I("trophy", "s")}สูงสุดใหม่ของคุณ</div>
    <div class="reward"><div class="chip">${I("star")}<span>+1</span></div><div class="chip">${I("trophy-l", "s")}<span>อันดับ 12 → 9</span></div></div>
    ${go("play", `<span>ขึ้นชั้นต่อไป</span>${I("play")}`, "btn primary lg")}
    <div class="row2">${go("play", `${I("replay")}เล่นใหม่`, "btn")}${go("home", `${I("home")}หน้าแรก`, "btn")}</div></div>`;
  return play(sheet).replace(`<b>ห้อง ${ME.room}</b><small>${ROOMS[ME.room]}</small>`, `<b>ชั้น ${ME.floor + 1}</b><small>หอคอย ∞</small>`).replace("ใช้เงา ≤ 0", "ใช้เงา ≤ 2");
}

/* ===== 5 อันดับ ===== */
const LB = [["ไฟกลางพายุ", 58], ["ภูติหมอก", 55], ["ดวงเทียนน้อย", 51], ["แสงสุดท้าย", 47], ["ควันม่วง", 44], ["เปลวร้อน", 41], ["โคมลอย", 39]];
function rank() {
  const rows = LB.map((r, i) => {
    const k = i < 3 ? ["g", "s", "b"][i] : "";
    return `<li class="${i < 3 ? "t" + (i + 1) : ""}">${i < 3 ? `<span class="medal ${k}">${i + 1}</span>` : `<span class="rk">${i + 1}</span>`}<span class="nm">${r[0]}</span><span class="sc">${I("tower")}${r[1]}</span></li>`;
  }).join("");
  const sheet = `<div class="sheet cover">${sheetHead("อันดับ", I("trophy", "l"), "home")}
    <div class="sh-body">
      <div class="seg"><button class="on">สัปดาห์</button><button>เดือน</button><button>ทั้งหมด</button></div>
      <div class="lb-meta"><span>${I("tower", "s")}ชั้นสูงสุดของหอคอย</span><span>${I("clock", "s")}เหลือ 2 วัน</span></div>
      <ul class="lb-list">${rows}</ul>
      <div class="gap3">· · ·</div>
      <div class="mine"><span class="rk">12</span><span class="nm">${ME.name} (คุณ)</span><span class="sc">${I("tower")}${ME.floor}</span></div>
    </div></div>`;
  return `${topBar()}<div class="body"></div>${nav("rank")}${ad}${sheet}`;
}

/* ===== 6 โปรไฟล์ / ร้าน / ตั้งค่า ===== */
function profile() {
  return `<div class="sheet full">${sheetHead("โปรไฟล์", I("user", "l"))}<div class="sh-body">
    <div class="panel corners" style="display:flex;align-items:center;gap:14px;padding:16px">
      <div class="avatar" style="width:72px;height:72px;border-width:3px"><svg viewBox="-20 -30 40 50" width="52" height="64" style="margin-top:8px"><use href="#hero"/></svg></div>
      <div style="flex:1;min-width:0"><div class="nm" style="font-size:20px;font-weight:800">${ME.name}</div>
        <div class="pill" style="margin-top:6px;width:fit-content">${I("link", "s")}ผูก Google แล้ว</div></div>
      <button class="ibtn">${I("pencil")}</button></div>
    <div class="stats">
      <div class="stat">${I("gate", "l")}<div><b>${ME.room - 1}/13</b><small>ห้องที่ผ่าน</small></div></div>
      <div class="stat">${I("star", "l")}<div><b>${ME.star}/39</b><small>ดาวสะสม</small></div></div>
      <div class="stat">${I("tower", "l")}<div><b>ชั้น ${ME.floor}</b><small>หอคอยสูงสุด</small></div></div>
      <div class="stat">${I("trophy", "l")}<div><b>#12</b><small>อันดับสัปดาห์</small></div></div></div>
    <div class="row">${I("link")}<div class="grow">ผูกบัญชี Google<small>เก็บความคืบหน้าข้ามเครื่อง</small></div><span class="pill">แล้ว</span></div>
    <div class="row">${I("out")}<div class="grow">ออกจากระบบ</div></div>
    <div class="row" style="color:#ff9a8a">${I("trash")}<div class="grow">ลบบัญชี<small>ลบถาวร ต้องยืนยัน 2 ครั้ง</small></div></div>
  </div></div>${ad}`;
}
function shop() {
  return `<div class="sheet full">${sheetHead("หัวใจและร้าน", I("heart", "l"))}<div class="sh-body">
    <div class="panel corners"><div class="hearts5">${[0, 1, 2].map(() => I("heart")).join("")}${[3, 4].map(() => I("heart", "off")).join("")}</div>
      <div style="text-align:center;color:var(--muted);font-size:14px;padding:0 12px 14px;display:flex;justify-content:center;align-items:center;gap:6px">${I("clock", "s")}เติมเต็มตอนเที่ยงคืน</div></div>
    <div class="offer"><span class="ico">${I("video", "l")}</span><div class="tx">ดูโฆษณา รับ 1 หัวใจ<small>วันนี้เหลือ 3 ครั้ง</small></div><button class="btn primary">${I("heart", "s")}+1</button></div>
    <div class="offer" style="position:relative"><span class="tagbest">คุ้มสุด</span><span class="ico">${I("heart", "l")}</span><div class="tx">หัวใจไม่จำกัด 2 ชม.<small>ซื้อซ้ำได้</small></div><button class="btn primary">฿19</button></div>
    <div class="offer"><span class="ico">${I("noad", "l")}</span><div class="tx">ลบโฆษณา<small>ซื้อครั้งเดียว · หัวใจ 8/วัน</small></div><button class="btn primary">฿35</button></div>
    <button class="btn ghosty" style="min-height:48px;font-size:15px">กู้คืนการซื้อ</button>
  </div></div>${ad}`;
}
function settings() {
  const seg = `<div class="seg sm" style="margin-top:8px"><button>อัตโนมัติ</button><button>สูง</button><button class="on">กลาง</button><button>ต่ำ</button></div>`;
  return `<div class="sheet full">${sheetHead("ตั้งค่า", I("gear", "l"))}<div class="sh-body">
    <div class="row">${I("sound")}<div class="grow">เสียง</div><span class="tgl on"></span></div>
    <div class="row" style="flex-direction:column;align-items:stretch;padding:12px 14px"><div style="display:flex;align-items:center;gap:12px">${I("gfx")}<div class="grow">คุณภาพภาพ<small>ต่ำ = ลื่นขึ้นบนเครื่องเก่า</small></div></div>${seg}</div>
    <div class="row">${I("globe")}<div class="grow">ภาษา</div><span class="pill">ไทย</span></div>
    <div class="row">${I("help")}<div class="grow">วิธีเล่น</div>${I("back", "s")}</div>
    <div class="row">${I("news")}<div class="grow">ข่าวและอัปเดต</div>${I("back", "s")}</div>
    <div class="row">${I("lock")}<div class="grow">นโยบายความเป็นส่วนตัว</div>${I("back", "s")}</div>
    <div style="text-align:center;color:var(--dim);font-size:13px;margin-top:auto">Wickling · ภูติตะเกียง v0.9</div>
  </div></div>${ad}`;
}

/* ===== 9 ต้นไม้สกิล ===== */
const NODES = [["root", "flame", 50, 91, 0, "own"], ["t1", "eye", 18, 72, 2, "own"], ["t2", "pause", 18, 50, 4, "own"], ["t3", "rewind", 18, 28, 6, "lk"],
  ["s1", "recall", 50, 66, 2, "own"], ["s2", "hourglass", 50, 44, 4, "lk"], ["s3", "mirror", 50, 24, 6, "lk"], ["l1", "radiate", 82, 72, 2, "own"], ["l2", "dash", 82, 50, 4, "sel"], ["l3", "lantern", 82, 28, 6, "lk"], ["cap", "split", 50, 7, 10, "lk"]];
const EDGES = [["root", "t1"], ["t1", "t2"], ["t2", "t3"], ["root", "s1"], ["s1", "s2"], ["s2", "s3"], ["root", "l1"], ["l1", "l2"], ["l2", "l3"], ["t3", "cap"], ["s3", "cap"], ["l3", "cap"]];
function skills() {
  const pos = id => NODES.find(n => n[0] === id);
  const lines = EDGES.map(([a, b]) => { const p = pos(a), q = pos(b), on = p[5] !== "lk" && q[5] !== "lk"; return `<line x1="${p[2]}" y1="${p[3]}" x2="${q[2]}" y2="${q[3]}" stroke="${on ? "#e6bd5c" : "#4a3d6a"}" stroke-width="${on ? 3 : 2.5}" ${on ? "" : 'stroke-dasharray="4 5"'} vector-effect="non-scaling-stroke"/>`; }).join("");
  const nodes = NODES.map(([id, ic, x, y, c, st]) => `<div class="tn ${st === "own" ? "own" : st === "lk" ? "lk" : st === "sel" ? "sel" : ""}" style="left:${x}%;top:${y}%">${SK(ic)}${c ? `<span class="cost">${I("star")}${c}</span>` : ""}${id === "t2" || id === "s1" ? `<span class="eq">${I("check")}</span>` : ""}</div>`).join("");
  return `${topBar()}<div class="body">
    <div class="tree"><svg class="ln" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>${nodes}</div>
    <div class="panel detail"><span class="ico">${SK("dash", "l")}</span><div class="tx">เปลวพุ่ง<small>พุ่งไปข้างหน้า 2 ช่องในจังหวะเดียว</small></div><button class="btn primary">${I("star", "s")}4</button></div>
    <div class="eqrow"><button class="slot">${SK("pause")}หยุดเปลว</button><button class="slot">${SK("recall")}เรียกกลับ</button><div class="lbl">ช่องสกิลในด่าน<br>แตะเพื่อเปลี่ยน</div></div>
  </div>${nav("skills")}${ad}`;
}

/* ===== ประกอบหน้า ===== */
const FRAMES = [
  ["home", "1 · หน้าแรก", "", home], ["map", "2 · แผนที่", "เส้นทาง", map], ["play", "3 · หน้าเล่น", "", () => play()],
  ["result-room", "4a · ผ่านห้อง", "", resultRoom], ["result-tower", "4b · ผ่านชั้นหอคอย", "", resultTower],
  ["rank", "5 · อันดับ", "", rank], ["profile", "6a · โปรไฟล์", "", profile], ["shop", "6b · หัวใจและร้าน", "", shop],
  ["settings", "6c · ตั้งค่า", "", settings], ["skills", "7 · ต้นไม้สกิล", "", skills]];
document.getElementById("ov").innerHTML = FRAMES.map(([id, label, , fn]) =>
  `<div class="fwrap frame" id="${id}"><div class="flabel">${label} <small>#${id}</small></div><div class="phone">${fn()}</div></div>`).join("");
if (new URLSearchParams(location.search).has("solo")) {
  document.body.classList.add("solo");
  if (!location.hash) location.hash = "#home";
  document.addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); location.hash = "#" + a.dataset.go; } });
}
