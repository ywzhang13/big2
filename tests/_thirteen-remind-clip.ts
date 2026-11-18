// 十三支理牌提醒的單聲（審伯 2026-11-18 必修）：剩 3、2、1 秒只播 turn-remind.mp3 的第一個短音（0～60ms），
//   要照「實際播放進度」在第二個短音（160ms）開始前停；不能從呼叫 play() 就開始算時間（起播延遲時會切掉第一聲）。
//   播放失敗、提前播完時，不留下截停計時器，也不留下還在播的 Audio。
//   用假的 Audio（可設定起播延遲、播放失敗、檔案長度）跑四種情境：立即起播、延遲 150ms 起播、播放失敗、提前結束
export {};
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
const wait = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));
const now = () => performance.now();

// 程式（sfx.ts）建立的計時器：還沒觸發、也沒被清掉的就是「還留著」
const live = new Set<unknown>();
const g = globalThis as unknown as Record<string, unknown>;
g.setTimeout = ((f: () => void, ms?: number) => { const h = realSetTimeout(() => { live.delete(h); f(); }, ms); live.add(h); return h; }) as typeof setTimeout;
g.clearTimeout = ((h: ReturnType<typeof setTimeout>) => { live.delete(h); realClearTimeout(h); }) as typeof clearTimeout;
g.setInterval = ((f: () => void, ms?: number) => { const h = realSetInterval(f, ms); live.add(h); return h; }) as typeof setInterval;
g.clearInterval = ((h: ReturnType<typeof setInterval>) => { live.delete(h); realClearInterval(h); }) as typeof clearInterval;

type Mode = { startDelay: number; fail?: boolean; duration: number };
let mode: Mode = { startDelay: 0, duration: 0.25 };
const made: FakeAudio[] = [];
class FakeAudio {
  src: string; preload = ""; volume = 1; cfg: Mode;
  startedAt: number | null = null; pausedAt: number | null = null; endedAt: number | null = null;
  pauses: { wall: number; pos: number }[] = [];
  private ls = new Map<string, Set<() => void>>();
  constructor(src: string, cfg: Mode = mode) { this.src = src; this.cfg = cfg; }
  cloneNode() { const a = new FakeAudio(this.src, mode); made.push(a); return a; }
  addEventListener(t: string, f: () => void) { (this.ls.get(t) ?? this.ls.set(t, new Set()).get(t)!).add(f); }
  removeEventListener(t: string, f: () => void) { this.ls.get(t)?.delete(f); }
  private emit(t: string) { for (const f of [...(this.ls.get(t) ?? [])]) f(); }
  get currentTime() {
    if (this.startedAt === null) return 0;
    const end = this.pausedAt ?? this.endedAt ?? now();
    return Math.min((end - this.startedAt) / 1000, this.cfg.duration);
  }
  get paused() { return this.startedAt === null || this.pausedAt !== null || this.endedAt !== null; }
  get ended() { return this.endedAt !== null; }
  play() {
    const t0 = now();
    return new Promise<void>((res, rej) => realSetTimeout(() => {
      if (this.cfg.fail) { this.emit("error"); rej(new Error("NotAllowedError")); return; }
      if (this.pausedAt !== null) { res(); return; } // 起播前就被暫停：瀏覽器照樣 resolve，但不會出聲
      this.startedAt = now();
      realSetTimeout(() => { if (this.pausedAt === null) { this.endedAt = now(); this.emit("ended"); } }, this.cfg.duration * 1000);
      void t0; res();
    }, this.cfg.startDelay));
  }
  pause() { this.pauses.push({ wall: now(), pos: this.currentTime }); if (this.pausedAt === null && this.endedAt === null) this.pausedAt = now(); this.emit("pause"); }
}
const store = new Map<string, string>();
g.window = globalThis;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
g.Audio = FakeAudio;
Object.defineProperty(globalThis, "navigator", { value: { vibrate: () => true }, configurable: true });

const S = await import("../components/thirteen/sfx");
S.setSfxOn(true);

async function run(m: Mode, checkAfterMs: number) {
  mode = m; made.length = 0; live.clear();
  const t0 = now();
  S.arrangeRemind(false);
  await wait(checkAfterMs);
  const liveAtCheck = live.size;
  await wait(500);
  const a = made[made.length - 1];
  return { a, t0, liveAtCheck, liveEnd: live.size };
}
const fmt = (a: FakeAudio) => a.pauses.map((p) => `${Math.round(p.pos * 1000)}ms`).join("、") || "沒有";

// R1 立即起播：第一聲（0～60ms）播完、在第二聲（160ms）前停
{
  const { a, liveEnd } = await run({ startDelay: 0, duration: 0.25 }, 0);
  const pos = a.pauses[0]?.pos ?? -1;
  ok(a.pauses.length >= 1 && pos >= 0.06 && pos < 0.16 && !a.ended && liveEnd === 0,
    `R1 立即起播：停在播放位置 ${fmt(a)}（要 ≥60ms、<160ms），沒播到第二聲，計時器 ${liveEnd} 個`);
}
// R2 延遲 150ms 才起播：還是照實際播放進度停，第一聲完整
{
  const { a, liveEnd } = await run({ startDelay: 150, duration: 0.25 }, 0);
  const started = a.startedAt !== null, pos = a.pauses.find((p) => p.pos > 0)?.pos ?? -1;
  ok(started && pos >= 0.06 && pos < 0.16 && !a.ended && liveEnd === 0,
    `R2 延遲 150ms 起播：${started ? "有起播" : "沒起播（被提早暫停，第一聲整個不見）"}，停在播放位置 ${fmt(a)}（要 ≥60ms、<160ms），${a.ended ? "播完了整個檔案（兩聲）" : "沒播到第二聲"}，計時器 ${liveEnd} 個`);
}
// R3 播放失敗（例如還沒點過畫面、瀏覽器擋自動播放）：不留計時器、也沒有在播的 Audio
{
  const { a, liveAtCheck, liveEnd } = await run({ startDelay: 20, fail: true, duration: 0.25 }, 40);
  ok(liveAtCheck === 0 && liveEnd === 0 && a.startedAt === null && a.pauses.filter((p) => p.wall > (a.pauses[0]?.wall ?? 0) + 1).length === 0,
    `R3 播放失敗：失敗後 20ms 還留著的計時器 ${liveAtCheck} 個（要 0）、最後 ${liveEnd} 個；沒有在播的 Audio`);
}
// R4 檔案比截停點短（50ms 就播完）：播完就把計時器清掉，不會再去暫停
{
  const { a, liveAtCheck, liveEnd } = await run({ startDelay: 0, duration: 0.05 }, 70);
  const lateClip = a.pauses.filter((p) => a.endedAt !== null && p.wall > a.endedAt + 1).length;
  ok(a.ended && liveAtCheck === 0 && liveEnd === 0 && lateClip === 0,
    `R4 提前結束：播完後 20ms 還留著的計時器 ${liveAtCheck} 個（要 0）；播完後又被暫停 ${lateClip} 次（要 0）`);
}
// R5 雙聲（剩 10 秒）照舊整個檔案播完，不截停
{
  mode = { startDelay: 0, duration: 0.25 }; made.length = 0; live.clear();
  S.arrangeRemind(true); await wait(400);
  const a = made[made.length - 1];
  ok(a.ended && a.pauses.length === 0 && live.size === 0, `R5 剩 10 秒「滴滴」：整個檔案播完（${a.ended ? "播完" : "沒播完"}），沒有截停，計時器 ${live.size} 個`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
