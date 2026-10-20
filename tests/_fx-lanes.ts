// 互動特效播放引擎：輕組（愛心、砸錢）同時播、疊在重組上；重組一次只播一個（老闆 2026-10-21 定案）。
//   L1 三則輕組同時進來：一起開始播、各自播完，互相不會清掉對方
//   L2 重組播到一半，輕組疊上去：兩則都完整播完（輕組先播完收尾時，不能清掉還在播的重組）
//   L3 兩則重組＋中間插輕組：重組照順序一則一則播，輕組不用排隊
//   L4 輕組、重組同時在播時中止：所有並行中的動畫都結束、特效層清空，之後照常能播
//   L5 圖片池夠用：4 則愛心同時播，每一張圖都是預先解碼好的；播完還回池子，再來 4 則一樣夠
// 用最小的假 DOM（tests/support/fake-dom.ts）在 node 裡跑真的 engine.ts。
import type { FxKind, FxRunLog } from "../lib/mahjong/fx/engine"; // 只拿型別（不會先載入 engine，假 DOM 要先裝好）
import { el, installFakeDom, liveAnims } from "./support/fake-dom";
installFakeDom();

const E = await import("../lib/mahjong/fx/engine");
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(20); } return true; }
const job = (kind: FxKind, from = 1, to = 0) => ({ kind, from, to, mySeat: 0, crack: true, muted: true });
const clean = (r: FxRunLog) => !r.dropped && !r.aborted && r.done === r.anims && r.left === 0 && r.notReady === 0;
const idle = () => until(() => !E.isFxBusy(), 8000);

ok(await E.preloadFx(), "假 DOM 上預載完成");
const layer = el();
E.setFxLayer(layer as unknown as HTMLElement);

// ---------- L1 三則輕組同時 ----------
{
  const n0 = E.fxLog.length;
  ok([E.enqueueFx(job("love", 1)), E.enqueueFx(job("cash", 2)), E.enqueueFx(job("love", 3))].every(Boolean), "L1 三家同時丟輕組：三則都收下");
  await sleep(150);
  ok(layer.children.length === 3, `L1 播放中特效層底下同時有 ${layer.children.length} 個子圖層（每則一個）`);
  await idle();
  const log = E.fxLog.slice(n0);
  const ats = log.map((r) => r.at), ends = log.map((r) => r.at + r.ms);
  ok(log.length === 3 && log.every(clean), `L1 三則都完整播完、圖片都先準備好、沒有殘留（${log.map((r) => `${r.kind} ${r.done}/${r.anims}`).join("、")}）`);
  ok(Math.max(...ats) - Math.min(...ats) < 50 && Math.min(...ends) > Math.max(...ats), `L1 三則同時開始（相差 ${Math.max(...ats) - Math.min(...ats)}ms）、播放時間重疊，沒有排隊`);
  ok(layer.children.length === 0 && liveAnims() === 0, "L1 播完特效層清空、沒有還在跑的動畫");
}

// ---------- L2 重組播到一半，輕組疊上去 ----------
{
  const n0 = E.fxLog.length;
  E.enqueueFx(job("egg", 1));
  await sleep(300);
  E.enqueueFx(job("love", 2));
  await sleep(100);
  ok(layer.children.length === 2, "L2 重組（雞蛋）還在播時，愛心馬上開始，兩個子圖層同時在");
  await idle();
  const log = E.fxLog.slice(n0);
  const egg = log.find((r) => r.kind === "egg")!, love = log.find((r) => r.kind === "love")!;
  ok(!!egg && !!love && love.at < egg.at + egg.ms && love.at + love.ms < egg.at + egg.ms, `L2 愛心疊在雞蛋上播，而且比雞蛋先播完（雞蛋 ${egg?.at}～${egg ? egg.at + egg.ms : 0}，愛心 ${love?.at}～${love ? love.at + love.ms : 0}）`);
  ok(clean(egg) && clean(love), `L2 愛心先收尾時沒有清掉還在播的雞蛋：兩則都完整播完（雞蛋 ${egg?.done}/${egg?.anims}、愛心 ${love?.done}/${love?.anims}）`);
}

// ---------- L3 兩則重組＋中間插輕組 ----------
{
  const n0 = E.fxLog.length;
  E.enqueueFx(job("punch", 1)); E.enqueueFx(job("water", 2));
  await sleep(200);
  E.enqueueFx(job("cash", 3));
  await idle();
  const log = E.fxLog.slice(n0);
  const p = log.find((r) => r.kind === "punch")!, w = log.find((r) => r.kind === "water")!, c = log.find((r) => r.kind === "cash")!;
  ok(log.length === 3 && log.every(clean), "L3 三則都完整播完");
  ok(w.at >= p.at + p.ms - 2, `L3 兩則重組照順序：拳擊播完（${p.at + p.ms}）潑水才開始（${w.at}）`);
  ok(c.at < p.at + p.ms, `L3 砸錢不用排隊，拳擊還在播就開始（${c.at}）`);
}

// ---------- L4 並行中中止 ----------
{
  E.enqueueFx(job("egg", 1)); E.enqueueFx(job("punch", 2)); // 一則播、一則排隊
  await sleep(250);
  E.enqueueFx(job("love", 1)); E.enqueueFx(job("cash", 2)); E.enqueueFx(job("love", 3));
  await sleep(150);
  const before = { layers: layer.children.length, anims: liveAnims() };
  const n0 = E.fxLog.length;
  E.abortFx();
  ok(await until(() => !E.isFxBusy(), 1000), `L4 重組 1＋輕組 3 同時在播（${before.layers} 個子圖層、${before.anims} 個動畫）時中止：1 秒內回到閒置`);
  ok(liveAnims() === 0 && layer.children.length === 0, "L4 所有並行中的動畫都結束、特效層清空");
  const log = E.fxLog.slice(n0);
  ok(log.length === 4 && log.every((r) => r.aborted), `L4 正在播的 4 則都記成中止，排隊的拳擊丟掉（${log.map((r) => r.kind).join("、")}）`);
  const n1 = E.fxLog.length;
  E.enqueueFx(job("punch", 1)); E.enqueueFx(job("love", 2));
  await idle();
  const after = E.fxLog.slice(n1);
  ok(after.length === 2 && after.every(clean), "L4 中止後再丟重組和輕組，兩則都照常播完");
}

// ---------- L5 圖片池 ----------
{
  for (const round of [1, 2]) {
    const n0 = E.fxLog.length;
    for (let i = 0; i < E.LIGHT_MAX; i++) E.enqueueFx(job(i % 2 ? "cash" : "love", 1 + (i % 3)));
    await idle();
    const log = E.fxLog.slice(n0);
    ok(log.length === E.LIGHT_MAX && log.every(clean), `L5 第 ${round} 輪 ${E.LIGHT_MAX} 則輕組同時播：每張圖都是預先解碼好的（沒準備好 ${log.reduce((a, r) => a + r.notReady, 0)} 張）、都播完`);
  }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
