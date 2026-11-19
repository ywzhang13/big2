// 十三支名牌分數的時機（老闆 2026-11-19：一開始比牌名牌就跳成這局的結果，等於提前知道輸贏）：
//   P1 亮牌途中（頭墩剛翻、尾墩出完前）：名牌＝上一局結束時的累計（伺服器的 playerScores 已含這局，要減掉這局）
//   P2 本局結算出現後：名牌＝新的累計
//   P3 亮牌途中重新整理（重新掛上、起點照伺服器時間在過去）：一樣顯示上一局的累計，不提前顯示
//   P4 有底分的房：減掉的是伺服器乘好底分的 scores（不是墩數）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThGameView } from "../components/thirteen/useThirteenRoom";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const T = await import("../components/thirteen/revealTimeline");
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const ThReveal = (await import("../components/thirteen/ThReveal")).default;

const base = buildCase("gun")!;
const before = [1200, -300, -600, -300];                       // 上一局結束時的累計（底分 100）
const totals = base.result.totals;                              // 這一局的墩數
const scores = totals.map((x) => x * 100);                      // 伺服器乘好底分
const after = before.map((b, i) => b + scores[i]);              // 伺服器亮牌時給的累計（已含這局）
const rv = { ...base, scores, baseScore: 100, playerScores: after };
const view: ThGameView = {
  status: "playing", code: "1234", sv: 1, phase: "revealed", handNo: rv.handNo, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
  players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })),
  me: { seat: 0, hand: [], arrangement: null }, reveal: rv, playerScores: after,
};
const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const plates = (h: string) => [...h.matchAll(/data-gp-seat="[^"]*"[\s\S]*?class="gp-sc[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
const render = (startAgo: number, settleIn: number) => {
  const now = Date.now();
  return renderToStaticMarkup(createElement(ThReveal, { view, rv, startAt: now - startAgo, settleAt: now + settleIn, confirmBy: null, confirmed: false, onConfirm: () => {} })).replace(/<!-- -->/g, "");
};
const want = (arr: number[]) => arr.map(fmt);

{
  const mid = render(1500, 20_000);            // 剛開始比牌（頭墩翻開中），結算還沒出現
  ok(JSON.stringify(plates(mid)) === JSON.stringify(want(before)) && !/data-th-result="round"/.test(mid),
    `P1 亮牌途中：名牌是上一局的累計 ${plates(mid).join("、")}（伺服器的新累計 ${want(after).join("、")} 還不顯示）`);
  const done = render(40_000, -100);           // 結算面板已經出現
  ok(JSON.stringify(plates(done)) === JSON.stringify(want(after)) && /data-th-result="round"/.test(done),
    `P2 本局結算出現後：名牌換成新的累計 ${plates(done).join("、")}`);
  const reload = render(9_000, 6_000);         // 亮牌進行到一半時重新整理：重新掛上，起點照伺服器的 revealedAt 在 9 秒前
  ok(JSON.stringify(plates(reload)) === JSON.stringify(want(before)), `P3 亮牌途中重新整理：一樣顯示上一局的累計 ${plates(reload).join("、")}`);
  ok(T.plateScore(rv, 1, false) === before[1] && T.plateScore(rv, 1, true) === after[1] && T.plateScore({ result: rv.result, playerScores: [5, -5, 0, 0] }, 0, false) === 5 - rv.result.totals[0],
    `P4 有底分減掉乘好的 scores（${scores[1]}），舊房沒有 scores 減掉墩數 result.totals`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
