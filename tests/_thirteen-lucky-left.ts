// 十三支本局結算左欄「彩金分」一行（老馬 2026-11-20；伺服器 stats.luckyPoints，老柯 v5）：
//   一、v5 房有人拿到彩金分：左欄多「彩金分」一行（拿到的 +3、被收的 −1），沒有彩金分就不列這一行
//   二、左欄各行加起來＝伺服器的本局分數（隨機 3000 局，含打槍、全壘打）
//   三、v4 房畫面不變：不會出現「彩金分」；舊局存的 stats 沒有 luckyPoints 欄位也不會壞
//   四、老闆 2026-11-20：「彩金分」放最上面（各墩牌型加分之前）；左欄不寫「彩金衝三」，一律寫「衝三」（隨機局裡有彩金衝三的座位也要照這樣）
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { autoArrange, deal, scoreRound } = await import("../lib/thirteen");
const { handStats } = await import("../lib/thirteen/flow");
const { breakdown } = await import("../components/thirteen/revealTimeline");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
let seed = 23;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

let firstBad = 0, lucky3Seats = 0, lucky3Bad = 0, hands = 0, withLucky = 0, sumBad = 0, labelBad = 0, valueBad = 0, v4Lucky = 0, v4SumBad = 0, plus3 = 0, minus1 = 0;
for (let i = 0; i < 3000; i++) {
  const { hands: hs, rest } = deal(rnd), lucky = rest[0].rank;
  const a = hs.map((h) => autoArrange(h, { lucky }));
  const r5 = scoreRound(a, "v5", lucky), st5 = handStats(r5, "v5");
  hands++;
  for (let s = 0; s < 4; s++) {
    const items = breakdown(st5[s]);
    const row = items.find((x) => x.label === "彩金分");
    const lp = r5.luckyPoints[s];
    if (items.reduce((n, x) => n + x.pts, 0) !== r5.totals[s]) sumBad++;
    if (!!row !== (lp !== 0)) labelBad++;
    if (row && row.pts !== lp) valueBad++;
    if (lp !== 0 && items[0].label !== "彩金分") firstBad++; // 彩金分一定是第一行
    if (st5[s].bonuses.some((b) => b.name === "彩金衝三")) { lucky3Seats++; if (!items.some((x) => x.label === "衝三" || x.label === "被衝三")) lucky3Bad++; } // 被打到的人寫「被衝三」
    if (items.some((x) => x.label.includes("彩金衝三"))) lucky3Bad++;
    if (lp === 3) plus3++;
    if (lp === -1) minus1++;
    if (lp !== 0) withLucky++;
  }
  const r4 = scoreRound(a, "v4", lucky), st4 = handStats(r4, "v4");
  for (let s = 0; s < 4; s++) {
    const items = breakdown(st4[s]);
    if (items.some((x) => x.label === "彩金分")) v4Lucky++;
    if (items.reduce((n, x) => n + x.pts, 0) !== r4.totals[s]) v4SumBad++;
  }
}
ok(withLucky > 0 && plus3 > 0 && minus1 > 0, `隨機 ${hands} 局 v5 房裡有 ${withLucky} 個座位有彩金分（拿到 +3 的 ${plus3} 個、被收 −1 的 ${minus1} 個），測得到`);
ok(sumBad === 0, `v5 左欄各行加起來＝伺服器的本局分數（不符 ${sumBad}）`);
ok(labelBad === 0, `有彩金分才列「彩金分」一行、沒有就不列（不符 ${labelBad}）`);
ok(valueBad === 0, `「彩金分」那一行的數字＝伺服器給的 luckyPoints，前端不自己算（不符 ${valueBad}）`);
ok(v4Lucky === 0 && v4SumBad === 0, `同樣的牌在 v4 房：左欄沒有「彩金分」、加總照舊對得上（出現 ${v4Lucky}、不符 ${v4SumBad}）`);

ok(firstBad === 0, `有彩金分的座位，左欄第一行就是「彩金分」（不符 ${firstBad}）`);
ok(lucky3Seats > 0 && lucky3Bad === 0, `左欄沒有任何一行寫「彩金衝三」，伺服器給「彩金衝三」的 ${lucky3Seats} 個座位都顯示「衝三」（不符 ${lucky3Bad}）`);
// 舊局存下來的 stats 沒有 luckyPoints 欄位
{
  const { hands: hs, rest } = deal(rnd), lucky = rest[0].rank;
  const a = hs.map((h) => autoArrange(h, { lucky }));
  const r = scoreRound(a, "v4", lucky);
  const old = handStats(r, "v4").map((st) => { const c = { ...st } as Record<string, unknown>; delete c.luckyPoints; return c; });
  let bad = 0;
  for (let s = 0; s < 4; s++) {
    const items = breakdown(old[s] as unknown as Parameters<typeof breakdown>[0]);
    if (items.some((x) => x.label === "彩金分") || items.reduce((n, x) => n + x.pts, 0) !== r.totals[s]) bad++;
  }
  ok(bad === 0, `舊局的 stats 沒有 luckyPoints 欄位：不列「彩金分」、加總照舊對得上（不符 ${bad}）`);
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
