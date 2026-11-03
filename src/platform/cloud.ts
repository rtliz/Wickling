// เรียก Cloud Functions แบบ callable ผ่าน fetch (ไม่ต้องโหลด firebase/functions) · ใช้ร่วมกันโดย billing.ts และ account.ts
// เรียกเฉพาะตอนผู้เล่นทำสิ่งที่มีความหมาย (ซื้อ กู้คืน ลบบัญชี) · ลองใหม่มี backoff และจำนวนครั้งสูงสุด (กฎ firebase-cost.md)
const FUNCTIONS_REGION = "asia-southeast1";     // ต้องตรงกับ REGION ใน functions/index.js
const FIREBASE_PROJECT = "wickling-rtliz";
const FN_TIMEOUT_MS = 20_000;
const FN_RETRY_MS = [1500, 5000];               // ลองใหม่ไม่เกิน 2 ครั้ง (รวม 3) · RESOURCE_EXHAUSTED ไม่ลองซ้ำทันที
const FN_RETRYABLE = new Set(["NETWORK", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "UNKNOWN"]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fnError = (status: string, message?: string) => Object.assign(new Error(message || status), { status });

type TokenFn = () => Promise<string | null>;

async function callOnce(name: string, data: unknown, token: TokenFn) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = await token().catch(() => null);
  if (t) headers.Authorization = `Bearer ${t}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FN_TIMEOUT_MS);
  let res: Response, body: { error?: { status?: string; message?: string }; result?: unknown };
  try {
    res = await fetch(`https://${FUNCTIONS_REGION}-${FIREBASE_PROJECT}.cloudfunctions.net/${name}`, {
      method: "POST", headers, body: JSON.stringify({ data }), signal: ctl.signal,
    });
    body = await res.json().catch(() => ({}));
  } catch { throw fnError("NETWORK"); }
  finally { clearTimeout(timer); }
  if (body?.error) throw fnError(body.error.status ?? "UNKNOWN", body.error.message);
  if (!res.ok) throw fnError(res.status >= 500 || res.status === 429 ? "UNAVAILABLE" : "FAILED");
  return body.result;
}

export async function callFunction(name: string, data: unknown, token: TokenFn): Promise<any> {
  for (let i = 0; ; i++) {
    try { return await callOnce(name, data, token); }
    catch (err) {
      if (!FN_RETRYABLE.has((err as { status?: string }).status ?? "") || i >= FN_RETRY_MS.length) throw err;
      await sleep(FN_RETRY_MS[i]);
    }
  }
}
