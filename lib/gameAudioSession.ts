"use client";
// 牌桌頁的 iPhone 音訊模式（老馬 2026-11-22，老闆：加到主畫面沒聲音、戴耳機才有）。
//
// 原因：WebKit 只有 Web Audio 在出聲時，把音訊類別設成 AmbientSound（環境音）——跟著靜音開關走，靜音就不出聲，
//   戴耳機不受靜音開關影響，所以「戴耳機有、喇叭沒有」。十三支 thAudio、麻將 fx/engine 都是 Web Audio。
//   另外錄過語音（getUserMedia）之後類別變 PlayAndRecord（聽筒），之後只要還有聲音在播就一直留在 PlayAndRecord，
//   聲音從聽筒出來、喇叭聽起來像沒聲音（WebKit MediaSessionManagerCocoa::updateSessionState；bug 295889）。
// 做法：在牌桌頁把 navigator.audioSession.type 明確設成 "ambient"（Safari 16.4 起；有設定時 WebKit 直接用它決定類別，
//   不再因為錄過音就留在 PlayAndRecord），離開牌桌還原；錄音時暫時改 "play-and-record"、全部錄完改回 "ambient"（回到喇叭）。
//   2026-11-23 老闆決定「不要暫停背景音樂」：原本 6db428c 用 "playback"（不受靜音開關影響，但會暫停 Spotify 等），
//   改成 "ambient"：跟背景音樂一起播；代價（老闆接受）是靜音開關打開時牌桌沒聲音，跟一般網頁一樣。
//   同理拿掉舊版 iOS（沒有 audioSession）的無聲 <audio> 補法：媒體元素是 MediaPlayback，也會暫停背景音樂；舊版維持原本行為。
//   大廳和其他頁面不改。只在 iPhone、iPad 做，桌機和 Android 照舊。
//   切到背景、鎖屏回來：iPhone 會把 AudioContext 變成 interrupted／suspended，回到前景時叫醒登記過的音訊。
import { useEffect } from "react";

type SessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";
type AudioSessionLike = { type: SessionType };

type Env = {
  /** iPhone、iPad（iPadOS 報成 Mac，用觸控點數分）：只有這兩種要改；桌機 Chrome、Safari 照舊 */
  ios: () => boolean;
  session: () => AudioSessionLike | null;
  doc: () => Document | null;
};
const realEnv: Env = {
  ios: () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
  session: () => (typeof navigator !== "undefined" ? (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession ?? null : null),
  doc: () => (typeof document !== "undefined" ? document : null),
};
let env: Env = realEnv;

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
let unbind: (() => void) | null = null;

function bind() {
  const d = env.doc();
  if (!d || unbind) return;
  // iPhone 只有 touchend、click、按鍵算使用者操作（同 thAudio、useTableSounds）
  const onGesture = () => resumeAudioContexts();
  const onVisible = () => { if (d.visibilityState === "visible") resumeAudioContexts(); };
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

/** 進牌桌：音訊明確設成 ambient（跟背景音樂混音、從喇叭出聲，錄過音也不卡聽筒；靜音開關打開時沒聲音）。回傳離開時要呼叫的還原 */
export function enterGameAudio(): () => void {
  if (!env.ios()) return () => {}; // 桌機、Android 不動（Chrome 也沒有 audioSession）
  active++;
  if (active === 1) {
    const s = env.session();
    if (s) {
      prevType = s.type;
      try { s.type = captures > 0 ? "play-and-record" : "ambient"; } catch { /* 舊版不給設：當作沒有 */ }
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
    unbind?.();
  };
}

/** 錄音前後：牌桌模式下有錄音在進行就是 play-and-record（ambient 錄不到），全部錄完才改回 ambient（不會卡在聽筒）。
 *  不在房間（大廳）時不動：離開房間已還原成進房前的模式，晚到的舊回呼不能改它 */
function applyCapture() {
  const s = env.session();
  if (!s || !active) return;
  try { s.type = captures > 0 ? "play-and-record" : "ambient"; } catch { /* 同上 */ }
}

/** 包住開始錄音的函式：開麥克風前切到錄音模式，錄完（送出、取消、到時間、開不了麥克風）切回 ambient */
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

/** 測試用：換掉 navigator.audioSession、document，並回到初始狀態 */
export function __testGameAudio(fake: Partial<Env> | null): void {
  unbind?.();
  env = fake ? { ...realEnv, ...fake } : realEnv;
  contexts.clear(); active = 0; prevType = null; captures = 0; unbind = null;
}
