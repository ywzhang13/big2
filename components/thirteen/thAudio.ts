"use client";
// 十三支的 Web Audio 播放（老闆 2026-11-18 甲案：改成和麻將一樣的播放方式，互動音效音量條同一格兩款一樣大聲）。
//   每個聲音：AudioBufferSource → 這個聲音自己的音量（例如中彈 0.6）→ 總音量（＝麻將 prefs 的 fxGain：互動音效 ÷ 70，靜音 0）→ 防爆音 → 喇叭。
//   和麻將 lib/mahjong/fx/engine.ts 同一個結構（總音量 → 保護 → 喇叭），不同的是保護那一段：
//   麻將用 DynamicsCompressor（-14dB），實測 Chrome 會自動補增益，十三支的檔案經過它大小聲會變 −5.5～+3.6dB（.tmp/prefs-v1/ev/rms*.raw），
//   不符合「70 和改之前一樣大」；所以這裡用 WaveShaper 軟限幅：0.9 以下完全不動（70 時檔案峰值都在 0.8 以下，大小聲 0 改變），超過才圓滑壓到 1 以內，
//   100（1.43 倍）或很多聲音疊在一起時不會爆音。
// 檔案先 fetch＋decode 成 AudioBuffer 快取；音訊還沒解鎖（手機要點過畫面）時，第一次點擊就叫醒
import { fxGain, getPrefs, onPrefsChange } from "@/lib/mahjong/prefs";
import { registerAudioContext } from "@/lib/gameAudioSession";

/** 軟限幅的起點（振幅）：以下原樣通過 */
export const LIMIT_KNEE = 0.9;
/** 請求後超過這麼久才載好就不播（時間軸上的聲音晚太多會和畫面對不上） */
export const LATE_MS = 250;
/** 音訊被暫停時叫醒最多等多久（同麻將 playTableSound） */
export const RESUME_WAIT_MS = 300;

/** 軟限幅曲線：|x| ≤ 0.9 輸出＝輸入；以上用 tanh 圓滑接近 ±1（WaveShaper 線性內插，直線段完全不失真） */
export function limiterCurve(n = 4097): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const room = 1 - LIMIT_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = a <= LIMIT_KNEE ? x : Math.sign(x) * (LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room));
  }
  return c;
}

/** 建一條「總音量 → 軟限幅 → 喇叭」（播放和離線量測共用同一個做法） */
export function buildChain(ctx: BaseAudioContext, gain: number): { master: GainNode; protect: AudioNode } {
  const master = ctx.createGain();
  master.gain.value = gain;
  const protect = ctx.createWaveShaper();
  protect.curve = limiterCurve();
  protect.oversample = "none";
  master.connect(protect);
  protect.connect(ctx.destination);
  return { master, protect };
}

/** 互動音效現在是不是沒聲音（靜音或音量 0）：沒聲音就完全不播（不建 source） */
export const fxSilent = (): boolean => fxGain(getPrefs()) === 0;

type Env = { makeCtx: () => AudioContext; fetch: (url: string) => Promise<ArrayBuffer>; now: () => number };
const realEnv: Env = {
  makeCtx: () => new AudioContext(),
  fetch: (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }),
  now: () => performance.now(),
};
let env: Env = realEnv;
let ctx: AudioContext | null = null, chain: { master: GainNode; protect: AudioNode } | null = null;
const bufs = new Map<string, Promise<AudioBuffer | null>>();
let unlockBound = false;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  try { ctx = env.makeCtx(); } catch { return null; }
  registerAudioContext(ctx); // 切背景、鎖屏回來時叫醒（lib/gameAudioSession.ts）
  chain = buildChain(ctx, fxGain(getPrefs()));
  onPrefsChange(() => { if (ctx && chain) chain.master.gain.setTargetAtTime(fxGain(getPrefs()), ctx.currentTime, 0.02); });
  if (!unlockBound && typeof document !== "undefined") {
    unlockBound = true;
    // iPhone Safari 只有 touchend、click（和按鍵）算使用者操作，pointerdown 叫不醒，所以幾種都聽（同麻將 useTableSounds）
    const unlock = () => { if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {}); };
    for (const e of ["pointerdown", "touchend", "click", "keydown"]) document.addEventListener(e, unlock, true);
  }
  return ctx;
}

/** 先載好一個檔（理牌、亮牌畫面一開就叫）；載不到就是 null，之後播不出聲但不擋遊戲 */
export function loadBuffer(src: string): Promise<AudioBuffer | null> {
  const c = ensureCtx();
  if (!c) return Promise.resolve(null);
  let p = bufs.get(src);
  if (!p) {
    p = env.fetch(src).then((ab) => c.decodeAudioData(ab)).catch(() => null);
    bufs.set(src, p);
  }
  return p;
}

export type PlayResult = "played" | "silent" | "no-audio" | "late" | "suspended";
/** 播一個檔：volume＝這個聲音自己的音量；duration＝只播前面幾秒（照檔案裡的位置切，起播晚也不會切到前面）；
 *  force＝測試頁試聽，不管靜音（直接接到防爆音那一段，音量 1） */
export async function playBuffer(src: string, opts: { volume?: number; duration?: number; force?: boolean } = {}): Promise<PlayResult> {
  if (!opts.force && fxSilent()) return "silent";
  const c = ensureCtx();
  if (!c || !chain) return "no-audio";
  const asked = env.now();
  const buf = await loadBuffer(src);
  if (!buf) return "no-audio";
  if (env.now() - asked > LATE_MS) return "late";
  if (c.state !== "running") {
    await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
    if ((c.state as AudioContextState) !== "running") return "suspended";
  }
  if (!opts.force && fxSilent()) return "silent"; // 等載入時剛好被關掉
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf;
  g.gain.value = opts.volume ?? 1;
  s.connect(g).connect(opts.force ? chain.protect : chain.master);
  if (opts.duration !== undefined) s.start(0, 0, opts.duration); else s.start();
  s.onended = () => { s.disconnect(); g.disconnect(); };
  return "played";
}

/** 測試用：換掉 AudioContext、fetch、時鐘，並清掉快取 */
export function __testAudio(fake: Partial<Env> | null): void {
  env = fake ? { ...realEnv, ...fake } : realEnv;
  ctx = null; chain = null; bufs.clear();
}
