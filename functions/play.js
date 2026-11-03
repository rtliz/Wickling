// คุยกับ Google Play Developer API (androidpublisher v3) ด้วย service account ของ Cloud Functions เอง
// ไม่มีไฟล์ key: ต้องเพิ่มอีเมล service account นี้ใน Play Console > Users and permissions ก่อน (ดู README.md)
// ใช้ google-auth-library ตรง ๆ แทน googleapis (เล็กกว่ามาก เปิด Function เย็นได้เร็วกว่า)
import { GoogleAuth } from 'google-auth-library';

export const PACKAGE_NAME = 'com.wickling.puzzle'; // ต้องตรงกับ appId ใน capacitor.config.json
const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products`;

// kind: invalid = Google บอกว่าใบเสร็จนี้ไม่มี/ไม่ตรงสินค้า · config = สิทธิ์ service account ยังไม่ได้ตั้ง · transient = ลองใหม่ได้
export class PlayError extends Error {
  constructor(kind, status, message) {
    super(message || `play ${kind} ${status ?? ''}`.trim());
    this.kind = kind;
    this.status = status;
  }
}

const kindOf = status => ([400, 404, 410].includes(status) ? 'invalid' : [401, 403].includes(status) ? 'config' : 'transient');

let client;
async function request(method, url, data) {
  client ??= await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
  try {
    return (await client.request({ method, url, data, timeout: 15_000 })).data;
  } catch (err) {
    const status = err.response?.status ?? err.status;
    throw new PlayError(kindOf(status), status, err.message);
  }
}

const tokenUrl = (productId, token) => `${BASE}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;

export const play = {
  // ProductPurchase: purchaseState (0 จ่ายแล้ว 1 ยกเลิก 2 รอจ่าย), consumptionState, acknowledgementState,
  // orderId, purchaseType (0 = license tester), obfuscatedExternalAccountId (md5 ของ uid ที่แอปส่งตอนซื้อ)
  get: (productId, token) => request('GET', tokenUrl(productId, token)),
  // ยืนยันว่าส่งของแล้ว (ไม่ยืนยันภายใน 3 วัน Google คืนเงินอัตโนมัติ) · consume ทำฝั่งแอปหลังเกมให้ของและเซฟแล้ว
  acknowledge: (productId, token) => request('POST', `${tokenUrl(productId, token)}:acknowledge`, {}),
  // ใช้ใบเสร็จ consumable ให้หมดจากฝั่ง server (เมื่อส่งของครบเพดานแล้ว ไม่ให้ใบค้างจนผู้เล่นซื้อซ้ำไม่ได้)
  consume: (productId, token) => request('POST', `${tokenUrl(productId, token)}:consume`, {}),
};
