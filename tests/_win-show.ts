// 胡牌後播放順序（老闆 2026-10-25；lib/mahjong/winShow.ts）：
//   W1 一般胡牌（沒有大牌、沒有專屬特效）：只播原本的浮層
//   W2 大牌順序對調：一般人大牌自摸／放槍胡＝浮層 → 大牌專屬段
//   W3 帳號專屬「隕石」：自摸＝隕石取代浮層；大牌自摸＝隕石 → 大牌專屬段；放槍胡不播隕石
//   W4 天胡、八仙過海、七搶一照舊：只播大牌專屬段（有隕石代號也一樣）
//   W5 不認得的代號當作沒有；浮層接大牌段的時間點＝淡出開始（自摸 2975ms、胡 1700ms）
import { planWinShow, celeHandoffMs } from "../lib/mahjong/winShow";
import { pickBigWin } from "../lib/mahjong/bigWin";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const pk = (fan: string, value: number) => pickBigWin({ seat: 1, score: { fans: [{ name: fan, value }] } });
const DSY = pk("大三元", 8), TIAN = pk("天胡", 24), BAXIAN = pk("八仙過海", 8), QQ1 = pk("七搶一", 8), ZI1 = pk("字一色", 16);

eq(planWinShow({ pick: null, zimo: true }), ["cele"], "W1 一般自摸：只播浮層");
eq(planWinShow({ pick: null, zimo: false }), ["cele"], "W1 一般放槍胡：只播浮層");
eq(planWinShow({ pick: DSY, zimo: true }), ["cele", "big"], "W2 一般人大三元自摸：浮層 → 大牌段");
eq(planWinShow({ pick: DSY, zimo: false }), ["cele", "big"], "W2 一般人大三元胡：浮層 → 大牌段");
eq(planWinShow({ pick: ZI1, zimo: true }), ["cele", "big"], "W2 頂級（字一色）也一樣先浮層");
eq(planWinShow({ pick: null, zimo: true, winFx: "meteor" }), ["meteor"], "W3 隕石帳號一般自摸：隕石取代浮層");
eq(planWinShow({ pick: DSY, zimo: true, winFx: "meteor" }), ["meteor", "big"], "W3 隕石帳號大三元自摸：隕石 → 大牌段");
eq(planWinShow({ pick: null, zimo: false, winFx: "meteor" }), ["cele"], "W3 隕石帳號放槍胡：不播隕石，照一般浮層");
eq(planWinShow({ pick: DSY, zimo: false, winFx: "meteor" }), ["cele", "big"], "W3 隕石帳號大三元放槍胡：浮層 → 大牌段");
eq(planWinShow({ pick: TIAN, zimo: true, winFx: "meteor" }), ["big"], "W4 天胡（隕石帳號）：只播大牌段");
eq(planWinShow({ pick: TIAN, zimo: true }), ["big"], "W4 天胡：只播大牌段");
eq(planWinShow({ pick: BAXIAN, zimo: false }), ["big"], "W4 八仙過海：只播大牌段");
eq(planWinShow({ pick: QQ1, zimo: false }), ["big"], "W4 七搶一：只播大牌段");
eq(planWinShow({ pick: null, zimo: true, winFx: "rainbow" }), ["cele"], "W5 不認得的代號：當作沒有");
eq([celeHandoffMs("zimo"), celeHandoffMs("ron")], [2975, 1700], "W5 浮層淡出開始就接大牌段（自摸 2975ms、胡 1700ms）");

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
