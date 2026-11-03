// สร้างไอคอนแอป + หน้าเปิด (splash) ของ Android จาก docs/ui-mockup/store/art.html ด้วย Chrome headless + sips (macOS)
// รัน: node scripts/android-art.mjs   แล้ว pnpm android:sync
// ภาพมาจาก SVG ชุดเดียวกับไอคอนบน Play Store · หน้าเปิดพื้น #0c0911 ต้องตรงกับ #splash ใน index.html และ capacitor.config.json
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ART = 'file://' + resolve('docs/ui-mockup/store/art.html');
const RES = resolve('android/app/src/main/res');
const tmp = mkdtempSync(join(tmpdir(), 'wk-art-'));

function shot(query, w, h, out) {
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${w},${h}`, `--screenshot=${out}`, `${ART}?${query}`], { stdio: 'ignore' });
}
function resize(src, w, h, out) {
  execFileSync('sips', ['-z', String(h), String(w), src, '--out', out], { stdio: 'ignore' });
}

// ไอคอน: วาดใหญ่ครั้งเดียวแล้วย่อทุกความหนาแน่น
const big = { icon: join(tmp, 'icon.png'), round: join(tmp, 'round.png'), fg: join(tmp, 'fg.png'), bg: join(tmp, 'bg.png') };
shot('v=icon', 512, 512, big.icon);
shot('v=round', 512, 512, big.round);
shot('v=fg&s=432', 432, 432, big.fg);
shot('v=bg&s=432', 432, 432, big.bg);
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = join(RES, `mipmap-${d}`), L = Math.round(48 * k), A = Math.round(108 * k);
  resize(big.icon, L, L, join(dir, 'ic_launcher.png'));
  resize(big.round, L, L, join(dir, 'ic_launcher_round.png'));
  resize(big.fg, A, A, join(dir, 'ic_launcher_foreground.png'));
  resize(big.bg, A, A, join(dir, 'ic_launcher_background.png'));
}

// หน้าเปิด: ขนาดเดียวกับที่ Capacitor สร้างไว้
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  shot(`v=splash&w=${w}&h=${h}`, w, h, join(RES, `drawable-port-${d}`, 'splash.png'));
  shot(`v=splash&w=${h}&h=${w}`, h, w, join(RES, `drawable-land-${d}`, 'splash.png'));
}
copyFileSync(join(RES, 'drawable-land-mdpi', 'splash.png'), join(RES, 'drawable', 'splash.png'));
console.log('สร้างไอคอนและหน้าเปิดแล้ว →', RES);
