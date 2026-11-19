// 十三支「開始比牌」與換局（2026-11-19 老闆回報「開始比牌動畫好像有時候只有 0.幾秒」）：
//   K1 起點還沒到（伺服器把起點排在決定亮牌後 1.2 秒，收到時 t＜0）：不掛特效層，大字不會比開頭音效早出現
//   K2 起點到了：特效層掛上（大字、開頭音效都從 t＝0 開始）
//   K3 換局：下一局亮牌進來的那一刻就換成新的一局（syncShow），不會先用上一局畫一次——上一局的本局結算面板出現 0 次
//   K4 同一局只更新「是不是最後一局」，起點不重設；沒有亮牌時照舊
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThGameView } from "../components/thirteen/useThirteenRoom";
import type { ThReveal as Reveal } from "../components/thirteen/revealTimeline";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const ThReveal = (await import("../components/thirteen/ThReveal")).default;
const { syncShow } = await import("../components/thirteen/roomScreen");
const { REVEAL_TIMING } = await import("../lib/thirteen/flow");

const base = buildCase("normal")!;
const view = (rv: Reveal, phase: "arranging" | "revealed"): ThGameView => ({
  status: "playing", code: "1234", sv: 1, phase, handNo: rv.handNo, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
  players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })),
  me: { seat: 0, hand: [], arrangement: null }, reveal: phase === "revealed" ? rv : null,
});
const draw = (rv: Reveal, startAt: number, settleAt: number) =>
  renderToStaticMarkup(createElement(ThReveal, { view: view(rv, "revealed"), rv, startAt, settleAt, confirmBy: null, confirmed: false, onConfirm: () => {} }));

{
  const now = Date.now();
  const before = draw(base, now + 500, now + 30_000);   // 收到時起點還在 0.5 秒後
  const after = draw(base, now - 50, now + 30_000);
  ok(REVEAL_TIMING.LEAD_MS === 1200, `K0 伺服器亮牌起點＝決定亮牌後 ${REVEAL_TIMING.LEAD_MS} 毫秒（老柯 LEAD_MS）`);
  ok(!/th-fx-layer/.test(before) && !/data-th-result="round"/.test(before), "K1 起點還沒到（t＝−0.5 秒）：沒有特效層（大字不會提早播），也沒有結算面板");
  ok(/th-fx-layer/.test(after), "K2 起點到了（t＝0.05 秒）：特效層掛上，大字和開頭音效一起從 t＝0 開始");
}

{
  // 實際的順序：第 1 局亮牌 → 結算 → 第 2 局理牌（沒有亮牌）→ 第 2 局亮牌（伺服器時間：起點在 1.2 秒後）
  const now = Date.now();
  const rv1: Reveal = { ...base, handNo: 1, revealedAt: now - 60_000, settleAt: now - 35_000 };
  const rv2: Reveal = { ...base, handNo: 2, revealedAt: now + 1_200, settleAt: now + 31_000 };
  const states: (Reveal | null)[] = [rv1, rv1, null, null, rv2, rv2];
  const panelsOfOld = (lag: boolean) => {
    let show = null as ReturnType<typeof syncShow<Reveal>>, shownOld = 0, prevShow = show;
    for (const rv of states) {
      const next = syncShow(show, "room1", rv, false, now);
      const drawn = lag ? prevShow ?? next : next;      // lag＝舊寫法：這個畫面先用上一次的（useEffect 之後才換）
      if (rv && drawn && drawn.rv.handNo !== rv.handNo) {
        const h = draw(drawn.rv, drawn.rv.revealedAt!, drawn.rv.settleAt!);
        if (/data-th-result="round"/.test(h)) shownOld++;
      }
      prevShow = next; show = next;
    }
    return shownOld;
  };
  const fixed = panelsOfOld(false), old = panelsOfOld(true);
  ok(fixed === 0 && old === 1, `K3 第 2 局亮牌進來：上一局的本局結算面板出現 ${fixed} 次（舊寫法晚一個畫面才換局：${old} 次）`);
  const s1 = syncShow(null, "room1", rv1, false, 111)!;
  const same = syncShow(s1, "room1", { ...rv1 }, false, 999);
  const fin = syncShow(s1, "room1", { ...rv1, over: true }, false, 999)!;
  ok(same === s1 && fin.key === s1.key && fin.final && fin.startAt === 111 && syncShow(s1, "room1", null, false, 999) === s1 && syncShow(s1, null, rv2, false, 999) === s1,
    "K4 同一局：沒變就回同一個（不重畫）、變成最後一局只改 final、起點不重設；沒有亮牌或沒有房間：照舊");
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
