"use client";
// 牌桌頁的 iPhone 音訊模式（老馬 2026-11-22，老闆：加到主畫面沒聲音、戴耳機才有）。
//
// 原因：WebKit 只有 Web Audio 在出聲時，把音訊類別設成 AmbientSound（環境音）——跟著靜音開關走，靜音就不出聲，
//   戴耳機不受靜音開關影響，所以「戴耳機有、喇叭沒有」。十三支 thAudio、麻將 fx/engine 都是 Web Audio。
//   另外錄過語音（getUserMedia）之後類別變 PlayAndRecord（聽筒），之後只要還有聲音在播就一直留在 PlayAndRecord，
//   聲音從聽筒出來、喇叭聽起來像沒聲音（WebKit MediaSessionManagerCocoa::updateSessionState；bug 295889）。
// 做法：在牌桌頁把 navigator.audioSession.type 設成 "playback"（Safari 16.4 起；WebKit 用它直接決定類別，
//   不再看 Web Audio／錄音），離開牌桌還原；錄音時暫時改 "play-and-record"、錄完改回 "playback"（回到喇叭）。
//   沒有 audioSession 的舊版 iOS：第一次點畫面時播一段循環的無聲 <audio>（媒體元素的類別是 MediaPlayback，
//   Web Audio 跟著不受靜音開關影響），離開牌桌、切到背景就停。
//   代價（老闆同意）：進牌桌會暫停背景音樂（Spotify 等）；大廳和其他頁面不改。只在 iPhone、iPad 做，桌機和 Android 照舊。
//   切到背景、鎖屏回來：iPhone 會把 AudioContext 變成 interrupted／suspended，回到前景時叫醒登記過的音訊。
import { useEffect } from "react";

type SessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";
type AudioSessionLike = { type: SessionType };

type Env = {
  /** iPhone、iPad（iPadOS 報成 Mac，用觸控點數分）：只有這兩種要改；桌機 Chrome、Safari 照舊 */
  ios: () => boolean;
  session: () => AudioSessionLike | null;
  doc: () => Document | null;
  makeSilent: () => HTMLAudioElement | null;
};
const realEnv: Env = {
  ios: () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
  session: () => (typeof navigator !== "undefined" ? (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession ?? null : null),
  doc: () => (typeof document !== "undefined" ? document : null),
  makeSilent: () => {
    if (typeof Audio === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null;
    const a = new Audio(URL.createObjectURL(silentWav()));
    a.loop = true;
    a.setAttribute("playsinline", "");
    return a;
  },
};
let env: Env = realEnv;

/** 0.5 秒無聲的 WAV（8kHz、8 位元、單聲道；8 位元的無聲是 128） */
function silentWav(): Blob {
  const n = 4000, b = new DataView(new ArrayBuffer(44 + n));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); b.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 8000, true);
  b.setUint16(32, 1, true); b.setUint16(34, 8, true); str(36, "data"); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return new Blob([b.buffer], { type: "audio/wav" });
}

const contexts = new Set<AudioContext>();
/** 音訊模組建好 AudioContext 就登記：回到前景、點畫面時一起叫醒 */
export function registerAudioContext(ctx: AudioContext): void { contexts.add(ctx); }

/** 叫醒所有被暫停（suspended）或被系統中斷（interrupted，iPhone 切背景、來電、鎖屏）的音訊 */
export function resumeAudioContexts(): void {
  for (const c of contexts) if (c.state !== "running" && c.state !== "closed") void c.resume().catch(() => {});
}

let active = 0; // 掛著的牌桌數（同一頁可能有兩個牌桌元件同時掛著）
let prevType: SessionType | null = null;
let captures = 0; // 還在進行的錄音筆數（每筆各自持有、只能釋放一次；審伯 R1：舊錄音晚到的回呼不能切掉新錄音的模式）
let silent: HTMLAudioElement | null = null;
let unbind: (() => void) | null = null;

function startSilent() {
  if (env.session() || !active) return; // 有 audioSession 就不用無聲音軌
  silent ??= env.makeSilent();
  if (silent && silent.paused) void silent.play().catch(() => {});
}
function stopSilent() { if (silent && !silent.paused) silent.pause(); }

function bind() {
  const d = env.doc();
  if (!d || unbind) return;
  // iPhone 只有 touchend、click、按鍵算使用者操作（同 thAudio、useTableSounds）
  const onGesture = () => { startSilent(); resumeAudioContexts(); };
  const onVisible = () => { if (d.visibilityState === "visible") resumeAudioContexts(); else stopSilent(); };
  const onShow = () => resumeAudioContexts();
  const evs = ["touchend", "click", "keydown"] as const;
  evs.forEach((e) => d.addEventListener(e, onGesture, true));
  d.addEventListener("visibilitychange", onVisible);
  d.defaultView?.addEventListener("pageshow", onShow);
  d.defaultView?.addEventListener("focus", onShow);
  unbind = () => {
    evs.forEach((e) => d.removeEventListener(e, onGesture, true));
    d.removeEventListener("visibilitychange", onVisible);
    d.defaultView?.removeEventListener("pageshow", onShow);
    d.defaultView?.removeEventListener("focus", onShow);
    unbind = null;
  };
}

/** 進牌桌：音訊改成遊戲播放模式（不受靜音開關影響、從喇叭出聲）。回傳離開時要呼叫的還原 */
export function enterGameAudio(): () => void {
  if (!env.ios()) return () => {}; // 桌機、Android 不動（沒有靜音開關的問題；Chrome 也沒有 audioSession，不能讓它去播無聲音軌）
  active++;
  if (active === 1) {
    const s = env.session();
    if (s) {
      prevType = s.type;
      try { s.type = captures > 0 ? "play-and-record" : "playback"; } catch { /* 舊版不給設：當作沒有 */ }
    }
    bind();
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active--;
    if (active > 0) return;
    const s = env.session();
    if (s && prevType) { try { s.type = prevType; } catch { /* 同上 */ } }
    prevType = null;
    stopSilent();
    unbind?.();
  };
}

/** 錄音前後：牌桌模式下有錄音在進行就是 play-and-record（playback 錄不到），全部錄完才改回 playback（不會卡在聽筒）。
 *  不在房間（大廳）時不動：離開房間已還原成進房前的模式，晚到的舊回呼不能改它 */
function applyCapture() {
  const s = env.session();
  if (!s || !active) return;
  try { s.type = captures > 0 ? "play-and-record" : "playback"; } catch { /* 同上 */ }
}

/** 包住開始錄音的函式：開麥克風前切到錄音模式，錄完（送出、取消、到時間、開不了麥克風）切回遊戲播放模式 */
export function withCaptureSession<A extends unknown[], R>(
  start: (onDone: (...a: A) => void) => Promise<R>,
): (onDone: (...a: A) => void) => Promise<R> {
  return async (onDone) => {
    captures++;
    applyCapture();
    let ended = false; // 這一筆只釋放一次：重複的完成、取消、出錯不會多減
    const end = () => { if (!ended) { ended = true; captures--; applyCapture(); } };
    try {
      const r = await start((...a) => { end(); onDone(...a); });
      if (typeof r === "string") end(); // 開不了麥克風（denied、unsupported、failed）
      return r;
    } catch (e) { end(); throw e; }
  };
}

/** 牌桌頁用：on＝這一刻在房間裡（等人、牌桌、結算、觀戰）；大廳傳 false */
export function useGameAudioSession(on: boolean): void {
  useEffect(() => (on ? enterGameAudio() : undefined), [on]);
}

/** 測試用：換掉 navigator.audioSession、document、無聲音軌，並回到初始狀態 */
export function __testGameAudio(fake: Partial<Env> | null): void {
  unbind?.();
  env = fake ? { ...realEnv, ...fake } : realEnv;
  contexts.clear(); active = 0; prevType = null; captures = 0; silent = null; unbind = null;
}
