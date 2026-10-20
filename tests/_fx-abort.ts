// 互動特效播放引擎：播放途中中止（切到背景、結算畫面出現）之後，佇列要能繼續播下一則（審伯 2026-10-21）。
// 以前中止時只 clearTimeout，run.wait()／run.later()／雞蛋 Lottie 保險計時器的 Promise 永遠不會結束，
// pump() 卡在等它們，isFxBusy() 一直是 true，之後收到的特效全部不播。
// 這裡用最小的假 DOM（tests/support/fake-dom.ts）在 node 裡跑真的 engine.ts。
import type { FxKind } from "../lib/mahjong/fx/engine"; // 只拿型別（不會先載入 engine，假 DOM 要先裝好）

import { el, installFakeDom } from "./support/fake-dom";
installFakeDom();

const E = await import("../lib/mahjong/fx/engine");
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(20); } return true; }

ok(await E.preloadFx(), "假 DOM 上預載完成");
E.setFxLayer(el() as unknown as HTMLElement);
const job = (kind: FxKind, to = 1) => ({ kind, from: 0, to, mySeat: 0, crack: true, muted: true });

// 每一種特效都在播放途中中止，再排下一則，下一則要真的播完（播放紀錄多一筆、沒有被中止、引擎回到閒置）
const cases: [FxKind, number, string][] = [
  ["cash", 150, "砸錢（run.wait 的間隔計時器）"],
  ["love", 150, "愛心（run.wait 的間隔計時器）"],
  ["egg", 700, "丟雞蛋（Lottie 保險計時器）"],
  ["punch", 600, "拳擊（run.later 的名牌發光計時器）"],
  ["water", 300, "潑水（run.wait）"],
];
for (const [kind, at, label] of cases) {
  ok(E.enqueueFx(job(kind)), `${label}：排進去`);
  await sleep(at);
  ok(E.isFxBusy(), `${label}：${at}ms 時還在播`);
  E.abortFx();
  const n0 = E.fxLog.length;
  ok(await until(() => !E.isFxBusy(), 1000), `${label}：中止後 1 秒內引擎回到閒置`);
  ok(E.fxLog.length === n0 + 1 && E.fxLog.at(-1)!.aborted, `${label}：被中止的那則有記一筆、標成中止`);
  const n1 = E.fxLog.length;
  ok(E.enqueueFx(job("love")), `${label}：中止後再排一則愛心`);
  const played = await until(() => E.fxLog.length === n1 + 1 && !E.isFxBusy(), 4500);
  const last = E.fxLog.at(-1)!;
  ok(played && last.kind === "love" && !last.aborted && last.done === last.anims, `${label}：下一則愛心完整播完（${played ? `動畫 ${last.done}/${last.anims}` : "沒有播"}）`);
}

// 排隊中的也要丟掉，之後照常能播
E.enqueueFx(job("punch")); E.enqueueFx(job("egg")); E.enqueueFx(job("cash"));
await sleep(200);
E.abortFx();
ok(await until(() => !E.isFxBusy(), 1000), "排了 3 則時中止：正在播的收掉、排隊的丟掉，引擎回到閒置");
const n2 = E.fxLog.length;
E.enqueueFx(job("cash"));
ok(await until(() => E.fxLog.length === n2 + 1 && !E.isFxBusy(), 4500) && !E.fxLog.at(-1)!.aborted, "之後再排的砸錢照常播完");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
