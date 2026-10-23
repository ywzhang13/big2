// 三元、四喜改台（老闆 2026-10-23）：
//   H1 小三元：只算小三元 4 台，兩組三元牌刻子不再各加 1 台
//   H2 大三元：只算大三元 8 台，三組三元牌刻子不再加台
//   H3 小四喜、圈風是刻子：門風不算，圈風照算 1 台
//   H4 小四喜、圈風是眼：不算風牌台
//   H5 小四喜、門風等於圈風（刻子）：只加 1 台
//   H6 大四喜：維持不加任何風牌台
//   H7 其他牌型的三元牌、風牌照舊：單一三元刻 1 台、兩組三元刻但眼不是三元牌各 1 台、門風＝圈風的刻子照舊 2 台
//   H8 槓也一樣（審伯 2026-10-23）：小四喜的圈風是明槓、暗槓照算 1 台；大三元其中一組是明槓也不另加三元牌
import type { Meld } from "../lib/mahjong/gameState";
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string, note = "") {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}${note ? `\n   ${note}` : ""}`}`);
}
let nextId = 7000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
/** 閒家、胡別人打的牌、沒有花：只留牌型相關的台。winKey 是最後那張（從手牌裡挑） */
function score(keys: string, winKey: string, seatWind: number, prevalentWind: number, revealed: Meld[] = []) {
  const concealed = keys.split(" ").filter(Boolean).map(t);
  const ctx: ScoringContext = { concealed, revealed, winTile: concealed.find((x) => x.suit + x.rank === winKey)!, isSelfDraw: false, isDealer: false,
    seatWind, prevalentWind, flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: false, isTing: false };
  const r = calculateScore(ctx);
  const of = (name: string) => r.fans.filter((f) => f.name === name).reduce((n, f) => n + f.value, 0);
  return { r, of, str: r.fans.map((f) => f.name + f.value).join("+") };
}

// H1 小三元：中、發刻＋白眼
{
  const s = score("z5 z5 z5 z6 z6 z6 z7 z7 m1 m2 m3 p4 p5 p6 s7 s8 s9", "s9", 2, 3);
  eq([s.of("小三元"), s.of("三元牌"), s.of("小三元") + s.of("三元牌")], [4, 0, 4], "H1 小三元：三元相關剛好 4 台（小三元 4，中、發刻不另加三元牌）", s.str);
}
// H2 大三元
{
  const s = score("z5 z5 z5 z6 z6 z6 z7 z7 z7 m1 m2 m3 p4 p5 p6 s9 s9", "p6", 2, 3);
  eq([s.of("大三元"), s.of("三元牌"), s.of("大三元") + s.of("三元牌")], [8, 0, 8], "H2 大三元：三元相關剛好 8 台（三組刻子不另加三元牌）", s.str);
}
// 小四喜：東南西刻＋北眼
const XSX = "z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 m1 m2 m3 p4 p5 p6";
{
  const s = score(XSX, "p6", 2, 1); // 南門、東風圈：圈風東是刻子
  eq([s.of("小四喜"), s.of("風牌")], [8, 1], "H3 小四喜、圈風(東)是刻子、門風(南)也是刻子：只加圈風 1 台，門風不算", s.str);
}
{
  const s = score(XSX, "p6", 1, 4); // 東門、北風圈：圈風北是眼
  eq([s.of("小四喜"), s.of("風牌")], [8, 0], "H4 小四喜、圈風(北)是眼：不加風牌台（門風東是刻子也不算）", s.str);
}
{
  const s = score(XSX, "p6", 1, 1); // 東門、東風圈
  eq([s.of("小四喜"), s.of("風牌")], [8, 1], "H5 小四喜、門風＝圈風(東)是刻子：只加 1 台（不是 2 台）", s.str);
}
// H6 大四喜
{
  const s = score("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 p5 p5", "m3", 1, 1);
  eq([s.of("大四喜"), s.of("風牌")], [16, 0], "H6 大四喜（東門、東風圈）：照舊不加任何風牌台", s.str);
}
// H7 其他牌型照舊
{
  const one = score("z5 z5 z5 m1 m2 m3 m4 m5 m6 p1 p2 p3 p7 p8 p9 s5 s5", "p9", 2, 3);
  eq(one.of("三元牌"), 1, "H7a 一組中刻（沒有大小三元）：三元牌 1 台照算", one.str);
  const two = score("z5 z5 z5 z6 z6 z6 m1 m2 m3 p1 p2 p3 p7 p8 p9 s5 s5", "p9", 2, 3);
  eq([two.of("三元牌"), two.of("小三元")], [2, 0], "H7b 中、發刻但眼不是三元牌（不成小三元）：三元牌 2 台照算", two.str);
  const wind = score("z1 z1 z1 m1 m2 m3 m4 m5 m6 p1 p2 p3 p7 p8 p9 s5 s5", "p9", 1, 1);
  eq(wind.of("風牌"), 2, "H7c 東門、東風圈的東刻（不是四喜）：門風 1＋圈風 1＝2 台照舊", wind.str);
  const both = score("z2 z2 z2 z3 z3 z3 m1 m2 m3 m4 m5 m6 p7 p8 p9 s5 s5", "p9", 2, 3);
  eq(both.of("風牌"), 2, "H7d 南門的南刻＋西風圈的西刻（不是四喜）：各 1 台＝2 台照舊", both.str);
}

// H8 槓：小四喜的圈風是槓、大三元其中一組是槓
const kong = (type: "kong" | "concealed_kong", k: string): Meld => ({ type, tiles: [k, k, k, k].map(t) });
{
  const ming = score("z2 z2 z2 z3 z3 z3 z4 z4 m1 m2 m3 p4 p5 p6", "p6", 2, 1, [kong("kong", "z1")]); // 南門、東風圈，東明槓
  eq([ming.of("風牌"), ming.of("小四喜")], [1, 8], "H8a 小四喜（南門、東風圈），圈風東是明槓：圈風照算 1 台，小四喜 8 台", ming.str);
  const an = score("z2 z2 z2 z3 z3 z3 z4 z4 m1 m2 m3 p4 p5 p6", "p6", 2, 1, [kong("concealed_kong", "z1")]);
  eq(an.of("風牌"), 1, "H8b 同一手，東改成暗槓：圈風照算 1 台", an.str);
  const big = score("z6 z6 z6 z7 z7 z7 m1 m2 m3 p4 p5 p6 s9 s9", "p6", 2, 3, [kong("kong", "z5")]); // 中明槓
  eq([big.of("大三元"), big.of("三元牌")], [8, 0], "H8c 大三元、中是明槓：大三元 8 台，三元牌 0（槓也不另加）", big.str);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
