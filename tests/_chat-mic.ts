// 「按住說話」換場清理（lib/mahjong/chatMic.ts＋chatClient.ts 的 startRecording；審伯 2026-10-21 退回①）：
//   R  錄音中換場：MediaRecorder 停、麥克風 track 全停、10 秒計時器清掉，不上傳；之後放開也不會送
//   P  等麥克風權限時換場：權限回來後馬上停 track、不開始錄（或立刻取消）、不上傳；被拒也不顯示錯誤
//   N  沒換場：照常錄、放開送出；權限還沒回來就放開，回來後照放開的意思送出或取消
// 在 node 裡跑真的程式：getUserMedia、MediaRecorder、計時器換成假的。
export {};
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  document: { documentElement: { style: { setProperty: () => {} } } },
});

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

// ---- 假的麥克風：getUserMedia 由測試決定什麼時候回、回什麼 ----
type Track = { stopped: boolean; stop: () => void };
let streams: { tracks: Track[] }[] = [];
let asks: { resolve: () => void; reject: (name: string) => void }[] = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: () => new Promise((resolve, reject) => {
        asks.push({
          resolve: () => {
            const tracks: Track[] = [0, 1].map(() => { const t = { stopped: false, stop: () => { t.stopped = true; } }; return t; });
            streams.push({ tracks });
            resolve({ getTracks: () => tracks });
          },
          reject: (name) => reject(Object.assign(new Error(name), { name })),
        });
      }),
    },
  },
});
// ---- 假的 MediaRecorder ----
let recorders: FakeRec[] = [];
class FakeRec {
  static isTypeSupported = (m: string) => m === "audio/mp4";
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/mp4";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { recorders.push(this); }
  start() { this.state = "recording"; }
  stop() {
    if (this.state !== "recording") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["beep"], { type: "audio/mp4" }) });
    this.onstop?.();
  }
}
Object.assign(globalThis, { MediaRecorder: FakeRec });
// ---- 計時器：記下還沒清掉的 10 秒自動停止計時器 ----
const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
const live = new Set<unknown>();
Object.assign(globalThis, {
  setTimeout: (f: () => void, ms?: number) => { const id = realSet(() => { live.delete(id); f(); }, ms); if (ms === 10000) live.add(id); return id; },
  clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => { live.delete(id); realClear(id); },
});

const { startRecording } = await import("../lib/mahjong/chatClient");
const { createChatMic } = await import("../lib/mahjong/chatMic");
const flush = () => new Promise((r) => realSet(r, 0));

let sent: number[] = [];
let ended = 0;
const fresh = () => { streams = []; asks = []; recorders = []; sent = []; ended = 0; return createChatMic(startRecording, (_b, ms) => { sent.push(ms); }); };
const allStopped = () => streams.length > 0 && streams.every((s) => s.tracks.every((t) => t.stopped));

// ---------- R 錄音中換場 ----------
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  asks[0].resolve();
  const r = await d;
  ok(r === "ok" && recorders[0]?.state === "recording" && live.size === 1 && mic.busy(), "R1 權限回來、開始錄音（10 秒自動停止的計時器在跑）");
  mic.reset(); // 換帳號／房間／座位，或不能再發送
  await flush();
  ok(recorders[0].state === "inactive", "R2 錄音中換場：MediaRecorder 停了");
  ok(allStopped(), "R3 錄音中換場：麥克風的 track 全部停掉");
  ok(live.size === 0, "R4 錄音中換場：10 秒自動停止的計時器清掉");
  ok(sent.length === 0 && ended === 0, "R5 錄音中換場：不上傳，舊的 callback 不碰新一場的畫面");
  mic.up(false); // 換場後手指才放開
  await flush();
  ok(sent.length === 0 && !mic.busy(), "R6 換場後才放開：一樣不送");
}

// ---------- P 等麥克風權限時換場 ----------
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  ok(mic.busy() && recorders.length === 0, "P1 按下後還在等麥克風權限（還沒開始錄）");
  mic.up(false); // 權限還沒回來就放開（會記成「開好後送出」）
  mic.reset();
  ok(!mic.busy(), "P2 等權限時換場：新的一場馬上可以再按");
  asks[0].resolve();
  const r = await d;
  await flush();
  ok(r === "stale", "P3 權限晚回來：認得是舊的一場（stale），畫面不更新");
  ok(allStopped(), "P4 權限晚回來：麥克風的 track 馬上全部停掉");
  ok(recorders.every((x) => x.state === "inactive") && live.size === 0, "P5 錄音器沒有留在錄音中，計時器也清掉");
  ok(sent.length === 0 && ended === 0, "P6 不上傳（放開時記下的「送出」也作廢）");
}
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  mic.reset();
  asks[0].reject("NotAllowedError");
  const r = await d;
  ok(r === "stale", "P7 等權限時換場、之後權限被拒：回 stale，不在新的一場顯示「需要麥克風權限」");
}

// ---------- N 沒換場：照常 ----------
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  asks[0].resolve();
  await d;
  mic.up(false);
  await flush();
  ok(sent.length === 1 && ended === 1 && allStopped() && live.size === 0 && !mic.busy(), "N1 照常錄、放開：送出一次，track 和計時器都收乾淨");
}
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  mic.up(false);
  asks[0].resolve();
  await d;
  await flush();
  ok(sent.length === 1 && allStopped(), "N2 權限還沒回來就放開：開好後照放開的意思送出");
}
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  mic.up(true);
  asks[0].resolve();
  await d;
  await flush();
  ok(sent.length === 0 && ended === 1 && allStopped(), "N3 權限還沒回來就上滑取消：開好後取消、不送");
}
{
  const mic = fresh();
  const d = mic.down(() => { ended++; });
  asks[0].reject("NotAllowedError");
  ok((await d) === "denied" && !mic.busy(), "N4 沒換場、權限被拒：回 denied（畫面顯示「需要麥克風權限」）");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
