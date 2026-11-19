// 十三支計分引擎：規則書的 14 個範例（lib/thirteen）。
// 範例牌面取自〈十三支-四人加一色-規則書-定案版v2-2026-11-13.md〉第 6 節；
// 分數照老闆 2026-11-13 修改的打槍規則重算（被打槍多付 1 分，v2 原為 3 分）：
//   受打槍影響的範例 2、3、4、8、10、11、12、13 已改成新分數，其他範例分數和 v2 相同。
// 待阿妍〈定案版 v3〉交出後再和她的「舊分數→新分數」對照表核對一次。
// 2026-11-19 甲案（老闆定案，老柯改）：特殊牌型那一道只算表上的墩數、不再加那一道基本的 1。
//   有特殊牌型的範例 3、4、8、9、11、12、13 改成甲案分數，說明寫「改之前」的數字；沒有特殊牌型的範例分數不變。
import { parseCards } from "../lib/thirteen/cards";
import { checkArrangement, type Arrangement } from "../lib/thirteen/arrange";
import { CAT, CAT_NAME, evalFive } from "../lib/thirteen/hand";
import { scoreRound, revealOrder, SCORING } from "../lib/thirteen/score";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}

/** 一個範例裡所有玩家共用一個 used：同一張黑桃出現第二次就是第 2 副 */
function players(rows: [string, string, string][]): Arrangement[] {
  const used = new Set<string>();
  return rows.map(([f, m, b]) => ({ front: parseCards(f, used), middle: parseCards(m, used), back: parseCards(b, used) }));
}
function duel(a: [string, string, string], b: [string, string, string]): number {
  const [pa, pb] = players([a, b]);
  return scoreRoundPair(pa, pb);
}
/** 兩人範例用四人結算算：座位 2、3 放和 0、1 一樣的牌（0 對 2、1 對 3 全平手、不會全壘打），只取 0 對 1 那一組 */
function scoreRoundPair(a: Arrangement, b: Arrangement): number {
  const r = scoreRound([a, b, a, b]);
  return r.pairs.find((p) => p.a === 0 && p.b === 1)!.points;
}

eq(SCORING.GUN_PENALTY, 1, "打槍罰分常數＝1（老闆 2026-11-13 修改；改規則只改 SCORING 一處）");

// 範例 1～10：兩人之間，「A 從 B 拿到幾分」
eq(duel(["2C 7D 9H", "3H 3D 8C 8S KD", "4C 5D 6H 7S 8D"], ["5H 5C 2D", "TD TC 2H 4S 9C", "JS JH JC 3C 6D"]), 1, "範例 1 三道互有輸贏：A +1");
eq(duel(["QH QD 3C", "8H 8D 4C 4D 2S", "5C 6D 7H 8S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"]), 4, "範例 2 打槍沒加分：3＋打槍 1 ＝ A +4（v2 為 +6）");
eq(duel(["QH QD QC", "8H 8D 8C 4D 4H", "5C 5D 5H 5S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"]), 6, "範例 3 打槍＋衝三＋尾道鐵支：衝三 2＋中道 1＋尾道鐵支 2＋打槍 1 ＝ A +6（甲案；改之前 +8，v2 為 +10）");
eq(duel(["2C 2D 9H", "7H 7D 7C 7S 3D", "AS AH AD AC 4H"], ["6H 6D 3C", "4S 5S 6S 7S 8S", "9D TD JD QD KD"]), -11, "範例 4 鐵支被同花順壓：B 打槍 頭道 1＋中道同花順 6＋尾道同花順 3＋打槍 1 ＝ B +11（甲案；改之前 +13，v2 為 +15）");
eq(duel(["AS AH KD", "3H 3D 3C 7S 8D", "4H 5D 6C 7H 8C"], ["AS AD KC", "2H 2D 2C 9S TD", "8S 9H TH JH QH"]), 0, "範例 5 完全同點平手、不比花色：0 分");
eq(duel(["AS AH KD", "3H 3D 3C 7S 8D", "9C TC JC QD KH"], ["AS AD KC", "2H 2D 2C 9S TD", "8S 9H TH JH QH"]), 2, "範例 6 兩贏一平不算打槍：A +2");
eq(duel(["2D 3D 5C", "9C 9D 4H 4C JD", "KS KS 9S 5S 2S"], ["2H 4D 6C", "TC TD 3S 3C QD", "AH QH JH 8H 3H"]), -1, "範例 7 加一色同花一對贏同花：B +1");
eq(duel(["KH KD 2C", "QH QD QC 3H 3D", "AS AS AH AD AC"], ["JH JD 4C", "TS TH TD 5H 5D", "5S 6S 7S 8S 9S"]), 7, "範例 8 尾道五龍贏同花順：A 打槍 頭道 1＋中道 1＋尾道五龍 4＋打槍 1 ＝ A +7（甲案；改之前 +8，v2 為 +10）");
eq(duel(["2H 3D 7C", "9S 9S 9H 9D 9C", "TS TS TH TD TC"], ["QH QD 5C", "JH JD JC 6H 6D", "AS AH AD AC 8H"]), 11, "範例 9 中道五龍（頭道輸、不打槍）：−1＋中道五龍 8＋尾道五龍 4 ＝ A +11（甲案；改之前 +13）");
eq(duel(["2C 3D 7H", "8H 8D 9C 9D KH", "AS 2S 3H 4D 5C"], ["4H 9H JC", "TC TD QC QD KD", "2H 3S 4S 5S 6C"]), -4, "範例 10 A-2-3-4-5 最小順子：B 打槍 3＋1 ＝ B +4（v2 為 +6）");

// 範例 11～13：四人
function four(rows: [string, string, string][]) {
  const r = scoreRound(players(rows));
  return { totals: r.totals, homeRun: r.homeRun, pairs: r.pairs.map((p) => [p.a, p.b, p.points, p.gunner]) };
}
eq(four([
  ["QH QD QS", "8H 8D 8S 4D 4H", "5C 5D 5H 5S 9C"],
  ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S AC"],
  ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"],
  ["6H 7H 8C", "AH AD 3S 4S KH", "TH TS QS QC 7S"],
]), { totals: [27, -11, -9, -7], homeRun: 0, pairs: [[0, 1, 6, 0], [0, 2, 6, 0], [0, 3, 6, 0], [1, 2, -1, null], [1, 3, -1, null], [2, 3, -1, null]] },
"範例 11 全壘打：每家 衝三 2＋中道 1＋尾道鐵支 2＋打槍 1＝6，再各付全壘打 3 → +27／−11／−9／−7，合計 0（甲案；改之前 +33／−13／−11／−9，v2 為 +39）");
eq(four([
  ["KH KD 2C", "QH QD QC 3H 3D", "AS AH AD AC 4C"],
  ["2H 2D 9C", "TS TH TD TC JH", "5S 6S 7S 8S 9S"],
  ["3C 4D 6H", "JS JC 8D 8H 5C", "6S 6C 6D 7H 7D"],
  ["4H 5D 7C", "KS KC 9D 9H 2S", "8C 9S TS JD QS"],
]), { totals: [4, 24, -15, -13], homeRun: null, pairs: [[0, 1, -6, null], [0, 2, 5, 0], [0, 3, 5, 0], [1, 2, 9, 1], [1, 3, 9, 1], [2, 3, -1, null]] },
"範例 12 一般局（沒有全壘打）：0 對 1＝頭道 +1、被中道鐵支 −4、被尾道同花順 −3＝−6 … → +4／+24／−15／−13，合計 0（甲案；改之前 +4／+30／−18／−16，v2 為 +8／+34）");
eq(four([
  ["QH QD QS", "8H 8D 8C 8S 4D", "AS AS AH AD AC"],
  ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S QC"],
  ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"],
  ["6H 7H 5C", "KH KS 3S 4S 5D", "TH TS 7S 7S 9C"],
]), { totals: [42, -16, -14, -12], homeRun: 0, pairs: [[0, 1, 11, 0], [0, 2, 11, 0], [0, 3, 11, 0], [1, 2, -1, null], [1, 3, -1, null], [2, 3, -1, null]] },
"範例 13 打槍＋全壘打＋五龍：每家 衝三 2＋中道鐵支 4＋尾道五龍 4＋打槍 1＝11，再加全壘打 3 → +42／−16／−14／−12，合計 0（甲案；改之前 +51，v2 為 +57）");

// 範例 14：倒水邊界
const [ok14] = players([["AH AD KC", "AS AC KD QH JS", "2H 2D 2C 2S 5D"]]);
const [bad14] = players([["AH AD KC", "AS AC QD JH 9S", "2H 2D 2C 2S 5D"]]);
const c1 = checkArrangement(ok14), c2 = checkArrangement(bad14);
eq([c1.ok, c2.ok, c2.ok ? null : c2.error], [true, false, "foul_front_middle"], "範例 14 倒水邊界：AA+K 對 AA+K+… 相等可以送出；AA+K 對 AA+Q… 頭道較大，倒水 foul_front_middle");

// 牌型判斷補充
const t = (s: string) => CAT_NAME[evalFive(parseCards(s)).cat];
eq([t("AS AS AH AD AC"), t("5S 6S 7S 8S 9S"), t("KS KS 9S 5S 2S"), t("KS KS 9S 9S 2S"), t("AS 2S 3H 4D 5C"), t("QH KD AC 2S 3H")],
  ["五龍", "同花順", "同花一對", "同花兩對", "順子", "烏龍"], "牌型：五龍、同花順、同花一對（重複黑桃）、同花兩對、A2345 順子、Q-K-A-2-3 不能繞圈");
eq(evalFive(parseCards("AS AS KS QS JS")).cat, CAT.FLUSH_PAIR, "♠A ♠A ♠K ♠Q ♠J 是同花一對，不是同花順");
const mb = players([["2H 3D 7C", "9C TD JS QS KD", "AH KH QH JH TH"]])[0];
eq(checkArrangement({ ...mb, middle: mb.back, back: mb.middle }).ok ? "ok" : (checkArrangement({ ...mb, middle: mb.back, back: mb.middle }) as { error: string }).error, "foul_middle_back", "中道同花順、尾道順子 → 倒水 foul_middle_back");

// 亮牌順序（範例 12）
const r12 = players([
  ["KH KD 2C", "QH QD QC 3H 3D", "AS AH AD AC 4C"],
  ["2H 2D 9C", "TS TH TD TC JH", "5S 6S 7S 8S 9S"],
  ["3C 4D 6H", "JS JC 8D 8H 5C", "6S 6C 6D 7H 7D"],
  ["4H 5D 7C", "KS KC 9D 9H 2S", "8C 9S TS JD QS"],
]);
eq(revealOrder(r12), { front: [[2], [3], [1], [0]], middle: [[2], [3], [0], [1]], back: [[3], [2], [0], [1]] }, "亮牌順序（範例 12）：每道從小到大（頭道 6 高＜7 高＜對 2＜對 K；中道 JJ88＜KK99＜葫蘆＜鐵支；尾道 順子＜葫蘆＜鐵支＜同花順）");
const r5 = players([["AS AH KD", "3H 3D 3C 7S 8D", "4H 5D 6C 7H 8C"], ["AS AD KC", "2H 2D 2C 9S TD", "8S 9H TH JH QH"]]);
eq(revealOrder([r5[0], r5[1], r5[0], r5[1]]).front, [[0, 1, 2, 3]], "亮牌順序：一樣大（範例 5 頭道 AA+K）放同一組一起亮");

// 打槍罰分只是一個常數：改成 3 分時，範例 2、3、4、8、10、11、12、13 每被打一槍多付 2 分（甲案下的分數；
// 2026-11-19 前這裡對照的是規則書 v2 的原始分數，v2 的特殊牌型會再加那一道的 1，甲案之後已經不會相等）
SCORING.GUN_PENALTY = 3;
eq([
  duel(["QH QD 3C", "8H 8D 4C 4D 2S", "5C 6D 7H 8S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"]),
  duel(["QH QD QC", "8H 8D 8C 4D 4H", "5C 5D 5H 5S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"]),
  duel(["2C 2D 9H", "7H 7D 7C 7S 3D", "AS AH AD AC 4H"], ["6H 6D 3C", "4S 5S 6S 7S 8S", "9D TD JD QD KD"]),
  duel(["KH KD 2C", "QH QD QC 3H 3D", "AS AS AH AD AC"], ["JH JD 4C", "TS TH TD 5H 5D", "5S 6S 7S 8S 9S"]),
  duel(["2C 3D 7H", "8H 8D 9C 9D KH", "AS 2S 3H 4D 5C"], ["4H 9H JC", "TC TD QC QD KD", "2H 3S 4S 5S 6C"]),
  four([["QH QD QS", "8H 8D 8S 4D 4H", "5C 5D 5H 5S 9C"], ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S AC"], ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"], ["6H 7H 8C", "AH AD 3S 4S KH", "TH TS QS QC 7S"]]).totals,
  four([["KH KD 2C", "QH QD QC 3H 3D", "AS AH AD AC 4C"], ["2H 2D 9C", "TS TH TD TC JH", "5S 6S 7S 8S 9S"], ["3C 4D 6H", "JS JC 8D 8H 5C", "6S 6C 6D 7H 7D"], ["4H 5D 7C", "KS KC 9D 9H 2S", "8C 9S TS JD QS"]]).totals,
  four([["QH QD QS", "8H 8D 8C 8S 4D", "AS AS AH AD AC"], ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S QC"], ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"], ["6H 7H 5C", "KH KS 3S 4S 5D", "TH TS 7S 7S 9C"]]).totals,
], [6, 8, -13, 9, -6, [33, -13, -11, -9], [8, 28, -19, -17], [48, -18, -16, -14]],
"打槍改成 3 分時：範例 2、3、4、8、10、11、12、13 都是甲案分數再加「每一槍多 2 分」（只改 SCORING.GUN_PENALTY 一處）");
SCORING.GUN_PENALTY = 1;

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
