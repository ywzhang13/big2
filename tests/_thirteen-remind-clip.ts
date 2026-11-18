// 十三支聲音改成 Web Audio 之後（components/thirteen/thAudio.ts，老闆甲案）：理牌提醒、靜音、震動開關、總音量、防爆音曲線。
//   用假的 AudioContext 跑：立即起播、音訊被暫停 150ms 才叫醒、解碼失敗、載太久、雙聲／單聲、靜音、震動關閉、不支援震動、
//   互動音效 70／100 的總音量、軟限幅曲線 0.9 以下不動
export {};
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.document = { documentElement: { style: { setProperty() {} } }, addEventListener() {} }; // 麻將 prefs 會把顏色寫在 <html>；thAudio 會掛解鎖監聽
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const vib: unknown[] = [];
const setNavigator = (v: object) => Object.defineProperty(globalThis, "navigator", { value: v, configurable: true });
setNavigator({ vibrate: (p: unknown) => { vib.push(p); return true; } });

type Start = { src: string; args: number[]; at: number; volume: number };
const starts: Start[] = [];
let resumeDelay = 0, startState: AudioContextState = "running", failSrc = "", fetchDelay = 0, ctxMade = 0;
let masterValue: number | null = null;
class FakeCtx {
  state: AudioContextState = startState; currentTime = 0; destination = {};
  constructor() { ctxMade++; }
  resume() { return new Promise<void>((r) => setTimeout(() => { this.state = "running"; r(); }, resumeDelay)); }
  decodeAudioData(ab: ArrayBuffer & { src?: string }) { return ab.src === failSrc ? Promise.reject(new Error("decode")) : Promise.resolve({ duration: 0.25, src: ab.src }); }
  createGain() {
    const node = { gain: { value: 1, setTargetAtTime: (v: number) => { node.gain.value = v; masterValue = v; } }, connect: (n: unknown) => n, disconnect() {} };
    return node;
  }
  createWaveShaper() { return { curve: null as Float32Array | null, oversample: "", connect: (n: unknown) => n, disconnect() {} }; }
  createBufferSource() {
    const s = { buffer: null as { src: string } | null, onended: null, out: null as { gain: { value: number } } | null,
      connect: (n: { gain: { value: number } }) => { s.out = n; return n; }, disconnect() {},
      start: (...args: number[]) => { starts.push({ src: s.buffer!.src, args, at: performance.now(), volume: s.out?.gain.value ?? -1 }); } };
    return s;
  }
}
const A = await import("../components/thirteen/thAudio");
const S = await import("../components/thirteen/sfx");
const P = await import("../lib/mahjong/prefs");
const V = await import("../components/gamePrefs/vibrate");
const fakeIO = { get: async () => null, put: async () => {} };
function reset(opts: { state?: AudioContextState; resume?: number; fail?: string; fetch?: number } = {}) {
  startState = opts.state ?? "running"; resumeDelay = opts.resume ?? 0; failSrc = opts.fail ?? ""; fetchDelay = opts.fetch ?? 0;
  starts.length = 0; vib.length = 0;
  A.__testAudio({ makeCtx: () => new FakeCtx() as unknown as AudioContext, fetch: (url) => new Promise((r) => setTimeout(() => r(Object.assign(new ArrayBuffer(8), { src: url })), fetchDelay)) });
}
P.__testPrefs(fakeIO);

// R1 剩 3、2、1 秒的單聲：Web Audio 只播檔案的前 0.09 秒（start(0, 0, 0.09)：從檔案開頭算，起播晚也不會切到第一聲）＋震 200ms
reset(); S.arrangeRemind(false); await wait(30);
ok(starts.length === 1 && starts[0].src === S.REMIND_SRC && JSON.stringify(starts[0].args) === "[0,0,0.09]" && JSON.stringify(vib) === "[200]",
  `R1 單聲：播麻將的 turn-remind.mp3 一次，start(${starts[0]?.args.join(", ")})＝只播檔案 0～90ms（第一個短音 0～60ms 完整、第二個 160ms 起不播）；震動 ${JSON.stringify(vib)}`);
// R2 音訊被暫停（手機還沒解鎖），150ms 後才叫醒：叫醒後照樣從檔案開頭播 90ms
{
  reset({ state: "suspended", resume: 150 }); const t0 = performance.now(); S.arrangeRemind(false); await wait(220);
  const late = starts[0] ? starts[0].at - t0 : -1;
  ok(starts.length === 1 && JSON.stringify(starts[0].args) === "[0,0,0.09]" && late >= 140,
    `R2 延遲 150ms 才起播：${Math.round(late)}ms 後才 start，參數仍是 (0, 0, 0.09)，第一聲完整`);
}
// R3 音訊叫不醒（超過 300ms）：不播，也不會晚一大截才突然響
reset({ state: "suspended", resume: 600 }); S.arrangeRemind(false); await wait(700);
ok(starts.length === 0, `R3 音訊 300ms 內叫不醒：不播（播了 ${starts.length} 次）`);
// R4 解碼失敗：不播、不擋遊戲（震動照常）
reset({ fail: S.REMIND_SRC }); S.arrangeRemind(false); await wait(30);
ok(starts.length === 0 && vib.length === 1, `R4 檔案解碼失敗：不播（${starts.length} 次）、震動照常（${vib.length} 次）`);
// R5 載太久（>250ms）：時間軸上的聲音晚太多就不播
reset({ fetch: 300 }); S.playSrc(S.voiceSrc("back", { cat: 8 } as never)); await wait(350);
ok(starts.length === 0, `R5 載了 300ms 才好（上限 ${A.LATE_MS}ms）：不播（${starts.length} 次）`);
// R6 剩 10 秒的雙聲：整個檔案播一次（start() 不帶長度＝「滴滴」）
reset(); S.arrangeRemind(true); await wait(30);
ok(starts.length === 1 && starts[0].args.length === 0, `R6 剩 10 秒「滴滴」：整個檔案播一次（start 參數 ${JSON.stringify(starts[0]?.args)}）`);
// R7 互動音效靜音：提醒聲、配音都 0 次，震動照常（震動有自己的開關）
reset(); P.setPrefs({ fxMuted: true }); S.arrangeRemind(false); S.playSrc(S.voiceSrc("back", { cat: 9 } as never)); await wait(30);
ok(starts.length === 0 && vib.length === 1, `R7 互動音效靜音：提醒聲＋配音播了 ${starts.length} 次（要 0）；震動 ${vib.length} 次`);
P.setPrefs({ fxMuted: false });
// R8 互動音效音量 0 也算沒聲音：完全不建 source
reset(); P.setPrefs({ fxVol: 0 }); S.arrangeRemind(true); await wait(30);
ok(starts.length === 0, `R8 互動音效 0%：播了 ${starts.length} 次`);
P.setPrefs({ fxVol: 70 });
// R9 震動開關關掉：vibrate 0 次、聲音照播；打開回來又會震
reset(); V.setVibrateOn(false); S.arrangeRemind(false); await wait(30);
const offVib = vib.length, offSound = starts.length, offKey = store.get(V.VIBRATE_KEY);
V.setVibrateOn(true); S.arrangeRemind(false); await wait(30);
ok(offVib === 0 && offSound === 1 && offKey === "0" && vib.length === 1 && !store.has(V.VIBRATE_KEY),
  `R9 震動關：vibrate ${offVib} 次（要 0）、聲音 ${offSound} 次；存成 gp.vibrate="${offKey}"；打開後刪掉 key、又震 ${vib.length} 次`);
// R10 不支援震動（iPhone 瀏覽器）：只有聲音
reset(); setNavigator({}); S.arrangeRemind(false); await wait(30);
ok(starts.length === 1 && !V.canVibrate() && V.gameVibrate(200) === false, `R10 沒有 navigator.vibrate：聲音 ${starts.length} 次、不震`);
setNavigator({ vibrate: (p: unknown) => { vib.push(p); return true; } });
// R11 總音量＝麻將的 fxGain：70 → 1（原本大小）、100 → 1.43、靜音 → 0；每個聲音自己的音量（中彈 0.6）乘在前面
{
  reset(); S.playSrc("/x.mp3", { volume: 0.6 }); await wait(30); // 建 AudioContext
  P.setPrefs({ fxVol: 100 }); const at100 = masterValue as number | null; P.setPrefs({ fxVol: 70 }); const at70 = masterValue as number | null; P.setPrefs({ fxMuted: true }); const muted = masterValue as number | null; P.setPrefs({ fxMuted: false });
  ok(at70 === 1 && Math.abs((at100 ?? 0) - 100 / 70) < 1e-9 && muted === 0 && starts[0]?.volume === 0.6,
    `R11 總音量跟著互動音效：70→${at70}、100→${at100?.toFixed(4)}（1.43 倍）、靜音→${muted}；這個聲音自己的音量 ${starts[0]?.volume}`);
}
// R12 防爆音曲線：|x| ≤ 0.9 完全不動、最大不超過 1、單調
{
  const c = A.limiterCurve(), n = c.length;
  let flat = 0, mono = true, max = 0;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; if (Math.abs(x) <= A.LIMIT_KNEE) flat = Math.max(flat, Math.abs(c[i] - x)); if (i && c[i] < c[i - 1]) mono = false; max = Math.max(max, Math.abs(c[i])); }
  ok(flat < 1e-6 && mono && max <= 1, `R12 軟限幅：0.9 以下誤差 ${flat.toExponential(1)}（不改大小聲）、單調、最大 ${max.toFixed(4)} ≤ 1`);
}
ok(ctxMade >= 1, `R13 共建了 ${ctxMade} 個 AudioContext（每次 reset 一個）`);

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
