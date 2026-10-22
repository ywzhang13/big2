// 第 6 種互動特效「拍手」（老闆 2026-10-22 定案預覽站的「D-五下」）：
//   C1 歸輕組：和愛心、砸錢共用 5 秒冷卻，可以同時播、可以疊在重組上
//   C2 一則拍手完整播完：動畫都結束、沒有殘留、圖片都是預先解碼好的，4 秒保險之前收完
//   C3 5 聲對齊 5 次拍合（336／756／1176／1596／2016ms，間隔都是 420ms），音量 0.6／0.55／0.62／0.42／0.24，音高各不相同
//   C4 互動音效靜音（音量 0）：拍手一聲都不播，動畫照播；調成一半時 5 聲跟著變小
//   C5 拍手疊在重組（雞蛋）上播，兩則都完整播完；4 則拍手同時播，圖片池夠用
//   C6 播到一半中止（切到背景、結算）：馬上回到閒置，之後照常能播
//   C7 動圖已開始、第 4／5 聲還沒到點時中止（換局、結算、背景共用的 abortFx）：之後不再響任何拍手聲；
//      只停這次播放自己排的聲音，不關音訊、不改總音量，下一則照常 5 聲都響（審伯 2026-10-22 退回）
// 用最小的假 DOM（tests/support/fake-dom.ts）和假的 AudioContext 在 node 裡跑真的 engine.ts。
import type { FxKind, FxRunLog } from "../lib/mahjong/fx/engine";
import { el, installFakeDom, liveAnims } from "./support/fake-dom";

// 假的 fetch：音效檔回傳帶檔名的 ArrayBuffer，解碼後的 AudioBuffer 就知道是哪一個音效
const nameOf = new WeakMap<ArrayBuffer, string>();
installFakeDom({
  fetch: async (url: string) => ({
    ok: true,
    blob: async () => new Blob(["x"]),
    text: async () => JSON.stringify({ w: 700, h: 525, fr: 30, op: 121 }),
    arrayBuffer: async () => { const ab = new ArrayBuffer(8); nameOf.set(ab, String(url).replace(/^.*\/s\/|\.mp3$/g, "")); return ab; },
  }),
});
// 假的 AudioContext：時鐘跟著真實時間走，記下每一聲排在幾毫秒後（at）、音量、音高；
// stop() 記下停止的時間，「真的響了」＝開始時間已經到了、而且在被停止之前就到點（heard）
type Played = { name: string; at: number; vol: number; rate: number; when: number; stoppedAt: number | null };
let played: Played[] = [];
const T0 = performance.now();
const acNow = () => (performance.now() - T0) / 1000;
const heard = (p: Played, now = acNow()) => p.when <= now && (p.stoppedAt === null || p.when < p.stoppedAt);
const param = (value = 0) => ({ value, setTargetAtTime(v: number) { this.value = v; } });
const node = () => ({ connect: (x: unknown) => x });
class FakeAC {
  get currentTime() { return acNow(); }
  state = "running"; destination = node();
  resume() { return Promise.resolve(); }
  createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  createGain() { return { ...node(), gain: param(1) }; }
  async decodeAudioData(ab: ArrayBuffer) { return { name: nameOf.get(ab) ?? "?" }; }
  createBufferSource() {
    let rec: Played | null = null;
    const s = { buffer: null as { name: string } | null, playbackRate: param(1), g: null as null | { gain: { value: number } },
      connect(g: { gain: { value: number } }) { s.g = g; return g; },
      start(when: number) { rec = { name: s.buffer?.name ?? "?", at: Math.round((when - acNow()) * 1000), vol: +(s.g?.gain.value ?? 0).toFixed(3), rate: s.playbackRate.value, when, stoppedAt: null }; played.push(rec); },
      stop() { if (!rec) throw new Error("InvalidStateError"); rec.stoppedAt ??= acNow(); } };
    return s;
  }
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAC;

const E = await import("../lib/mahjong/fx/engine");
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(20); } return true; }
const job = (kind: FxKind, from = 1, to = 0) => ({ kind, from, to, mySeat: 0, crack: true, muted: false });
const clean = (r: FxRunLog) => !r.dropped && !r.aborted && r.done === r.anims && r.left === 0 && r.notReady === 0;
const idle = () => until(() => !E.isFxBusy(), 8000);
const claps = () => played.filter((p) => p.name.startsWith("clap-hit-"));

ok(await E.preloadFx(), "假 DOM 上預載完成（含拍手動圖和 5 聲拍手音效）");
const layer = el();
E.setFxLayer(layer as unknown as HTMLElement);

// ---------- C1 ----------
ok(E.FX_KINDS.length === 6 && E.FX_KINDS.at(-1) === "clap" && E.FX_LABEL.clap === "拍手", "C1 特效有 6 種，第 6 種是「拍手」");
ok(E.isLightFx("clap") && E.FX_COOLDOWN.clap === E.FX_COOLDOWN.love && E.FX_COOLDOWN.clap === 5000, "C1 拍手歸輕組，冷卻 5 秒（和愛心、砸錢共用）");

// ---------- C2、C3 ----------
{
  played = [];
  const n0 = E.fxLog.length;
  ok(E.enqueueFx(job("clap")), "C2 對家丟我拍手：收下");
  await idle();
  const r = E.fxLog.slice(n0)[0];
  ok(!!r && r.lane === "light" && clean(r), `C2 走輕組、完整播完、沒有殘留（動畫 ${r?.done}/${r?.anims}、殘留 ${r?.left}、沒準備好的圖 ${r?.notReady}）`);
  ok(!!r && r.ms >= 2900 && r.ms < 4000, `C2 飛過去 0.52 秒＋拍 5 下、往上飄淡出到 2.516 秒，整段 ${r?.ms}ms（4 秒保險之前收完）`);
  ok(layer.children.length === 0 && liveAnims() === 0, "C2 播完特效層清空、沒有還在跑的動畫");
  const c = claps(), at = c.map((p) => p.at), gaps = at.slice(1).map((t, i) => t - at[i]);
  ok(c.map((p) => p.name).join() === "clap-hit-1,clap-hit-2,clap-hit-3,clap-hit-4,clap-hit-5", `C3 一拍一聲，共 5 聲（${c.map((p) => p.name).join("、")}）`);
  ok(at.join() === E.CLAP_HITS.join() && E.CLAP_HITS.join() === "336,756,1176,1596,2016", `C3 5 聲排在拍合那一刻：${at.join("、")}ms`);
  ok(gaps.every((g) => g === 420), `C3 間隔都是 420ms（${gaps.join("、")}）`);
  ok(c.map((p) => p.vol).join() === "0.6,0.55,0.62,0.42,0.24", `C3 音量 ${c.map((p) => p.vol).join("、")}（第 4、5 下漸弱）`);
  ok(new Set(c.map((p) => p.rate)).size === 5, `C3 5 聲音高各不相同（${c.map((p) => p.rate).join("、")}）`);
}

// ---------- C4 ----------
{
  E.setFxVolume(0);
  played = [];
  const n0 = E.fxLog.length;
  E.enqueueFx(job("clap"));
  await idle();
  const r = E.fxLog.slice(n0)[0];
  ok(claps().length === 0 && played.length === 0 && !!r && clean(r) && r.gain === 0, `C4 互動音效靜音：一聲都不播（${played.length} 聲），動畫照播完（${r?.done}/${r?.anims}）`);
  E.setFxVolume(0.5);
  played = [];
  E.enqueueFx(job("clap"));
  await idle();
  ok(claps().length === 5 && E.getFxVolume() === 0.5, "C4 音量調成一半：5 聲照播，經過互動音效總音量（0.5）出聲");
  E.setFxVolume(1);
}

// ---------- C5 ----------
{
  const n0 = E.fxLog.length;
  E.enqueueFx(job("egg", 2));
  await sleep(300);
  E.enqueueFx(job("clap", 3));
  await sleep(100);
  ok(layer.children.length === 2, "C5 雞蛋（重組）還在播時，拍手馬上開始，兩個子圖層同時在");
  await idle();
  const log = E.fxLog.slice(n0);
  const egg = log.find((r) => r.kind === "egg")!, cl = log.find((r) => r.kind === "clap")!;
  ok(!!egg && !!cl && cl.at < egg.at + egg.ms && clean(egg) && clean(cl), `C5 拍手疊在雞蛋上播，兩則都完整播完（雞蛋 ${egg?.done}/${egg?.anims}、拍手 ${cl?.done}/${cl?.anims}）`);
  for (const round of [1, 2]) {
    const m0 = E.fxLog.length;
    for (let i = 0; i < E.LIGHT_MAX; i++) E.enqueueFx(job("clap", 1 + (i % 3)));
    await idle();
    const l = E.fxLog.slice(m0);
    ok(l.length === E.LIGHT_MAX && l.every(clean), `C5 第 ${round} 輪 ${E.LIGHT_MAX} 則拍手同時播：飛過去的靜態圖都是預先解碼好的（沒準備好 ${l.reduce((a, r) => a + r.notReady, 0)} 張）、都播完`);
  }
}

// ---------- C6 ----------
{
  for (const at of [200, 1500]) {
    played = [];
    E.enqueueFx(job("clap"));
    await sleep(at);
    ok(E.isFxBusy(), `C6 ${at}ms 時拍手還在播`);
    const n0 = E.fxLog.length;
    E.abortFx();
    ok(await until(() => !E.isFxBusy(), 1000) && E.fxLog.length === n0 + 1 && E.fxLog.at(-1)!.aborted, `C6 ${at}ms 時中止：1 秒內回到閒置，記成中止`);
    ok(liveAnims() === 0 && layer.children.length === 0, `C6 ${at}ms 時中止：動畫都結束、特效層清空`);
    const n1 = E.fxLog.length;
    E.enqueueFx(job("love"));
    ok(await until(() => E.fxLog.length === n1 + 1 && !E.isFxBusy(), 4500) && clean(E.fxLog.at(-1)!), `C6 ${at}ms 時中止後，下一則愛心照常播完`);
  }
}

// ---------- C7 中止後不再響已排程的拍手聲（審伯 2026-10-22） ----------
{
  // 先播一則愛心（另一次播放），它排的聲音是它自己的，下面中止拍手時不能被停到
  played = [];
  E.enqueueFx(job("love", 2));
  await idle();
  const loveSrcs = played.slice();
  played = [];
  const vol0 = E.getFxVolume();
  E.enqueueFx(job("clap"));
  // 飛過去 520ms、換成動圖後才排 5 聲；等到第 3 聲已響、第 4 聲（動圖開始後 1596ms）還沒到點
  ok(await until(() => claps().length === 5, 2000), "C7 動圖已開始，5 聲都排好了");
  const firstAt = Math.min(...claps().map((p) => p.when));
  ok(await until(() => acNow() >= firstAt + (1176 - 336 + 60) / 1000, 3000), "C7 等到第 3 聲已經響過");
  const c = claps(), now = acNow();
  ok(c.slice(0, 3).every((p) => heard(p, now)) && c.slice(3).every((p) => !heard(p, now)), `C7 中止前：第 1～3 聲已響、第 4、5 聲還沒到點（${c.map((p) => (heard(p, now) ? "響" : "未")).join("、")}）`);
  E.abortFx(); // 換局、結算、切到背景都走這裡
  await sleep(1400); // 原本第 4、5 聲早就該響了
  const after = claps();
  ok(after.slice(3).every((p) => !heard(p)), `C7 中止後第 4、5 聲不會響（${after.slice(3).map((p) => `${p.name}${heard(p) ? " 響了" : " 沒響"}`).join("、")}）`);
  ok(after.length === 5 && after.every((p, i) => (i < 3 ? heard(p) : !heard(p))), "C7 中止後也沒有多排任何拍手聲，已經響過的前 3 聲不受影響");
  ok(E.getFxVolume() === vol0 && !E.isFxBusy(), "C7 中止只停這次播放的聲音：互動音效總音量沒被改、引擎回到閒置");
  ok(loveSrcs.length > 0 && loveSrcs.every((p) => p.stoppedAt === null), `C7 別的播放（先前那則愛心的 ${loveSrcs.length} 聲）一個都沒被停`);
  played = [];
  E.enqueueFx(job("clap"));
  await idle();
  await sleep(100);
  ok(claps().length === 5 && claps().every((p) => heard(p) && p.stoppedAt === null), `C7 中止後再丟一則拍手：5 聲都照常響（${claps().length} 聲）`);
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
