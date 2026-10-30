// 胡牌後播放順序（老闆 2026-10-25；lib/mahjong/winShow.ts）：
//   W1 一般胡牌（沒有大牌、沒有專屬特效）：只播原本的浮層
//   W2 大牌先播（2026-10-25 八台大牌新版一起改）：一般人大牌自摸／放槍胡＝大牌專屬段 → 浮層；頂級（字一色、大四喜）也一樣
//   W3 帳號專屬「隕石」：自摸＝隕石取代浮層；大牌自摸＝大牌專屬段 → 隕石；放槍胡不播隕石
//   W4 天胡、八仙過海、七搶一照舊：只播大牌專屬段（有隕石代號也一樣）
//   W5 不認得的代號當作沒有
//   W7 自摸特效庫 5 種新特效（老闆 2026-10-31）：自摸＝特效 → 浮層；大牌自摸＝大牌段 → 特效 → 浮層；放槍胡不播；天胡只播大牌段；烈焰已移除＝不認得
//      完整版（雷霆、冰封）比照隕石：自帶專屬「自摸」大字，不接浮層——自摸＝特效；大牌自摸＝大牌段 → 特效
//   W6 10 種大牌逐一：用 pickBigWin 挑出來的結果排順序（自摸、放槍、隕石帳號自摸），大牌段永遠排第一
import { planWinShow } from "../lib/mahjong/winShow";
import { BIG_WIN_ORDER, pickBigWin } from "../lib/mahjong/bigWin";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const pk = (fan: string, value: number) => pickBigWin({ seat: 1, score: { fans: [{ name: fan, value }] } });
const DSY = pk("大三元", 8), TIAN = pk("天胡", 24), BAXIAN = pk("八仙過海", 8), QQ1 = pk("七搶一", 8), ZI1 = pk("字一色", 16);

eq(planWinShow({ pick: null, zimo: true }), ["cele"], "W1 一般自摸：只播浮層");
eq(planWinShow({ pick: null, zimo: false }), ["cele"], "W1 一般放槍胡：只播浮層");
eq(planWinShow({ pick: DSY, zimo: true }), ["big", "cele"], "W2 一般人大三元自摸：大牌段 → 浮層");
eq(planWinShow({ pick: DSY, zimo: false }), ["big", "cele"], "W2 一般人大三元胡：大牌段 → 浮層");
eq(planWinShow({ pick: ZI1, zimo: true }), ["big", "cele"], "W2 頂級（字一色）也一樣大牌段先播");
eq(planWinShow({ pick: null, zimo: true, winFx: "meteor" }), ["meteor"], "W3 隕石帳號一般自摸：隕石取代浮層");
eq(planWinShow({ pick: DSY, zimo: true, winFx: "meteor" }), ["big", "meteor"], "W3 隕石帳號大三元自摸：大牌段 → 隕石");
eq(planWinShow({ pick: null, zimo: false, winFx: "meteor" }), ["cele"], "W3 隕石帳號放槍胡：不播隕石，照一般浮層");
eq(planWinShow({ pick: DSY, zimo: false, winFx: "meteor" }), ["big", "cele"], "W3 隕石帳號大三元放槍胡：大牌段 → 浮層");
eq(planWinShow({ pick: TIAN, zimo: true, winFx: "meteor" }), ["big"], "W4 天胡（隕石帳號）：只播大牌段");
eq(planWinShow({ pick: TIAN, zimo: true }), ["big"], "W4 天胡：只播大牌段");
eq(planWinShow({ pick: BAXIAN, zimo: false }), ["big"], "W4 八仙過海：只播大牌段");
eq(planWinShow({ pick: QQ1, zimo: false }), ["big"], "W4 七搶一：只播大牌段");
eq(planWinShow({ pick: null, zimo: true, winFx: "rainbow" }), ["cele"], "W5 不認得的代號：當作沒有");

for (const fx of ["thunder", "storm", "frost", "blackhole", "sakura"]) {
  eq([planWinShow({ pick: null, zimo: true, winFx: fx }), planWinShow({ pick: DSY, zimo: true, winFx: fx }), planWinShow({ pick: null, zimo: false, winFx: fx }),
    planWinShow({ pick: DSY, zimo: false, winFx: fx }), planWinShow({ pick: TIAN, zimo: true, winFx: fx })],
    [["zfx"], ["big", "zfx"], ["cele"], ["big", "cele"], ["big"]], `W7 ${fx} 完整版：自摸＝特效（自帶大字、不接浮層）／大三元自摸＝大牌段 → 特效／放槍照一般／天胡只播大牌段`);
}
eq(planWinShow({ pick: null, zimo: true, winFx: "flame" }), ["cele"], "W7 烈焰已移除：當作沒有");

// W6：10 種逐一（八仙過海、七搶一是花胡：沒有自摸／放槍，也不接隕石）
const FLOWER = new Set(["八仙過海", "七搶一"]);
for (const def of BIG_WIN_ORDER) {
  const p = pk(def.fan, def.tier === "top" ? 16 : 8);
  const noCele = def.fan === "天胡" || FLOWER.has(def.fan);
  eq([planWinShow({ pick: p, zimo: true }), planWinShow({ pick: p, zimo: false }), planWinShow({ pick: p, zimo: true, winFx: "meteor" })],
    noCele ? [["big"], ["big"], ["big"]] : [["big", "cele"], ["big", "cele"], ["big", "meteor"]],
    `W6 ${def.title}：自摸／放槍／隕石帳號自摸＝${noCele ? "只播大牌段" : "大牌段 → 浮層／浮層／隕石"}`);
}

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
