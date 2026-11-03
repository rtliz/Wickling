// โฆษณา AdMob (ยกจาก LumiFlip/src/platform.js `Ads` แล้วแปลงเป็น TS)
// - Android (Capacitor): @capacitor-community/admob ของจริง
// - pnpm dev บนเบราว์เซอร์: โฆษณาจำลอง (main.ts ใส่ไว้ที่ Ads.mock) · เว็บที่ build แล้ว: ไม่มีโฆษณา (available = false)
import { Capacitor } from "@capacitor/core";
import {
  AdMob, BannerAdSize, BannerAdPosition, BannerAdPluginEvents, RewardAdPluginEvents, InterstitialAdPluginEvents,
  AdmobConsentStatus, type AdMobBannerSize,
} from "@capacitor-community/admob";

export const isNative = Capacitor.isNativePlatform();

// id จริงของแอป Wickling ใน AdMob (ใส่ 2026-11-03) · ห้ามใช้ id ของเกมอื่น · ห้ามกดโฆษณาจริงของตัวเอง
// testing = true: SDK ส่งโฆษณาทดสอบแม้ใช้ id จริง (ปลอดภัย กดได้) · TODO ก่อนปล่อยจริง: ตั้ง testing = false
export const AD_CONFIG = {
  testing: true,
  appId: "ca-app-pub-8745889359156577~9573034348",          // ต้องตรงกับ APPLICATION_ID ใน AndroidManifest.xml
  bannerId: "ca-app-pub-8745889359156577/1650100260",       // wickling_banner
  interstitialId: "ca-app-pub-8745889359156577/3677709836", // wickling_interstitial
  rewardedId: "ca-app-pub-8745889359156577/8259952676",     // wickling_rewarded
};

const setBannerHeight = (px: number) => document.documentElement.style.setProperty("--banner-h", `${px}px`);
type Handle = Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
const removeAll = (hs: Handle[]) => hs.forEach(h => Promise.resolve(h).then(x => x.remove()).catch(() => {}));

export interface AdMock { setBanner(on: boolean): void; play(rewarded: boolean): Promise<boolean> }

export const Ads = {
  // มีโฆษณาให้ดูไหม (ซ่อนปุ่ม "ดูโฆษณา" ถ้า false) · ตัวจำลองมีเฉพาะ pnpm dev
  available: isNative || import.meta.env.DEV,
  mock: { setBanner() {}, play: async () => true } as AdMock,
  canRequest: true,     // ผลขอความยินยอม (UMP) — ผู้เล่น EEA/UK ต้องตอบฟอร์มก่อนถึงจะโหลดโฆษณาได้
  busy: false,          // มีโฆษณาเต็มจอกำลังขึ้นอยู่ → คำขอซ้อนถูกปัดทิ้ง
  privacyRequired: false,
  onShowing: (_on: boolean) => {}, // main.ts หยุดลูปเกมระหว่างโฆษณาเต็มจอ

  async init() {
    if (!isNative) return;
    await AdMob.initialize({}).catch(() => {});
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (s: AdMobBannerSize) => setBannerHeight(s.height));
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) info = await AdMob.showConsentForm();
      this.canRequest = info.canRequestAds;
      this.privacyRequired = info.privacyOptionsRequirementStatus === "REQUIRED";
    } catch { /* ออฟไลน์: ปล่อยให้ SDK จำกัดตามความยินยอมเดิมเอง */ }
  },

  async showPrivacyOptions() {
    if (!isNative) return;
    await AdMob.showPrivacyOptionsForm().catch(() => {});
  },

  async showBanner() {
    if (!this.available) return;
    if (!isNative) return this.mock.setBanner(true);
    if (!this.canRequest) return;
    await AdMob.showBanner({
      adId: AD_CONFIG.bannerId, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0, isTesting: AD_CONFIG.testing,
    }).catch(() => {});
  },

  async hideBanner() {
    if (!this.available) return;
    if (!isNative) return this.mock.setBanner(false);
    await AdMob.removeBanner().catch(() => {});
    setBannerHeight(0);
  },

  // คืนเมื่อโฆษณาถูกปิด (โหลดไม่ได้ก็ปล่อยผ่าน ไม่ให้เกมค้าง)
  async interstitial() {
    if (this.busy || !this.available) return;
    this.busy = true; this.onShowing(true);
    try { await this.showInterstitial(); } finally { this.busy = false; this.onShowing(false); }
  },
  async showInterstitial() {
    if (!isNative) { await this.mock.play(false); return; }
    if (!this.canRequest) return;
    try { await AdMob.prepareInterstitial({ adId: AD_CONFIG.interstitialId, isTesting: AD_CONFIG.testing }); } catch { return; }
    await new Promise<void>(resolve => {
      const hs: Handle[] = [];
      const done = () => { removeAll(hs); resolve(); };
      hs.push(AdMob.addListener(InterstitialAdPluginEvents.Dismissed, done));
      hs.push(AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, done));
      AdMob.showInterstitial().catch(done);
    });
  },

  // คืน true เมื่อดูจนได้รางวัล
  async rewarded(): Promise<boolean> {
    if (this.busy || !this.available) return false;
    this.busy = true; this.onShowing(true);
    try { return await this.showRewarded(); } finally { this.busy = false; this.onShowing(false); }
  },
  async showRewarded(): Promise<boolean> {
    if (!isNative) return this.mock.play(true);
    if (!this.canRequest) return false;
    try { await AdMob.prepareRewardVideoAd({ adId: AD_CONFIG.rewardedId, isTesting: AD_CONFIG.testing }); } catch { return false; }
    return new Promise(resolve => {
      let earned = false;
      const hs: Handle[] = [];
      const done = () => { removeAll(hs); resolve(earned); };
      hs.push(AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; }));
      hs.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, done));
      hs.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, done));
      AdMob.showRewardVideoAd().catch(done);
    });
  },
};
