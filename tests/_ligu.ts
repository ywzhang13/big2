// 嚦咕嚦咕（老闆 2026-10-29 定案）：7 對＋1 刻、門清（吃碰明槓暗槓都不算）、可自摸可胡別人、4 張一樣可當 2 對、8 台
// 另外：大牌清單（嚦咕嚦咕特效已做好，代號 ligu，排在五暗刻之後、大三元之前）；聽牌剩幾隻的共用計算（lib/mahjong/tingInfo.ts）
import { isWinningHand, isLiguHand, findWaitingTiles } from "../lib/mahjong/winCheck";
import { calculateScore } from "../lib/mahjong/scoring";
import { BIG_WIN_ORDER, pickBigWin } from "../lib/mahjong/bigWin";
import { discardTingOptions, seenTileCounts, waitsLeft, type TingView } from "../lib/mahjong/tingInfo";
import type { Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 1;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const LG16 = "m1 m1 m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9"; // 6 對＋1 刻＋單張 p9：聽 p9
const score = (hand16: string, win: string, o: { self?: boolean; revealed?: Meld[]; dealer?: boolean } = {}) => {
  const w = t(win);
  return calculateScore({
    concealed: [...tiles(hand16), w], revealed: o.revealed ?? [], winTile: w, isSelfDraw: !!o.self, isDealer: !!o.dealer,
    seatWind: 3, prevalentWind: 1, flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: false,
  });
};
const names = (r: { fans: { name: string; value: number }[] }) => r.fans.map((f) => `${f.name}${f.value}`).sort();

// ---- 判定 ----
eq(isWinningHand([...tiles(LG16), t("p9")]), true, "L1 7 對＋1 刻（17 張、門清）可以胡");
eq(findWaitingTiles(tiles(LG16)), ["p9"], "L2 聽牌判斷認得嚦咕嚦咕：6 對＋1 刻＋單張，聽那張單張");
eq(isWinningHand(tiles("m1 m1 m1 m1 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9 p9")), true, "L3 手上 4 張一樣（沒槓出）當 2 個對子");
eq(isWinningHand(tiles("m1 m1 m1 m1 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 s9 p9")), false, "L4 兩組 4 張＋其他對子但沒有刻子（4+4+2×4+單張）不算");
const eight = findWaitingTiles(tiles("m1 m1 m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 z5 z5"));
eq(["m1", "m5", "p3", "p7", "s2", "s9", "z2", "z5"].every((k) => eight.includes(k)), true, "L5 8 個對子：8 種都能湊成刻子，都聽");
eq([isLiguHand(tiles("m1 m1 m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9 p9"), 1), isWinningHand(tiles("m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9"), 1)],
  [false, false], "L6 有吃、碰或明槓（另外 1 組在桌上）：不算嚦咕嚦咕，剩下的 14 張也不是一般胡牌");
eq(isWinningHand(tiles("m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9"), 1), false, "L7 有暗槓（暗槓也算在 revealed 裡）：不算");
eq(isWinningHand(tiles("m1 m2 m3 m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9")), false, "L8 混有順子（1 順＋5 對＋1 刻＋單張）：不算");
eq(isLiguHand(tiles("m1 m1 m5 m5 p3 p3 p7 p7 s2 s2 s9 s9 s9 z7 z7 z7 p9")), false, "L9 兩個刻子（2 刻＋5 對＋單張）：不算");

// ---- 計分 ----
const ron = score(LG16, "p9");
eq(names(ron), ["嚦咕嚦咕8", "獨聽1"].sort(), "L10 胡別人打的：嚦咕嚦咕 8 台＋獨聽 1（只聽 p9）；不另算門清（嚦咕嚦咕本身要門清）");
const self = score(LG16, "p9", { self: true, dealer: true });
eq(names(self).filter((n) => !n.startsWith("獨聽")), ["嚦咕嚦咕8", "自摸1", "莊家1"].sort(), "L11 自摸＋莊家：嚦咕嚦咕 8＋自摸 1＋莊家 1（不算門清自摸 3）");
eq(names(score("z1 z1 z1 z1 z2 z2 z3 z3 z4 z4 z5 z5 z6 z6 z7 z7", "z7")), ["三元牌1", "嚦咕嚦咕8", "字一色16"].sort(), "L12 字一色＋嚦咕嚦咕＋三元牌刻子：16＋8＋1");
eq(names(score("m1 m1 m2 m2 m4 m4 m5 m5 m7 m7 m9 m9 m8 m8 m8 m3", "m3")).filter((n) => !n.startsWith("獨聽")), ["嚦咕嚦咕8", "清一色8"].sort(), "L13 清一色＋嚦咕嚦咕：8＋8，不算碰碰胡、暗刻");
eq(names(score("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6", "s7")), names(score("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6", "s7")).filter((n) => !n.includes("嚦咕")),
  "L14 一般牌型的台數沒有多出嚦咕嚦咕");
// 對子也拆得成順子的手（m1 m1 m2 m2 m3 m3 …）：兩種拆法取台數高的
const both = score("m1 m1 m2 m2 m3 m3 p4 p4 p5 p5 p6 p6 s7 s7 s7 z1", "z1");
eq(both.fans.some((f) => f.name === "嚦咕嚦咕"), true, "L15 也能拆成一般胡（4 順＋1 刻＋眼）的手：取台數高的，嚦咕嚦咕 8 比較高");

// ---- 大牌清單（2026-10-29 特效做好，從預留搬進 BIG_WIN_ORDER） ----
const at = BIG_WIN_ORDER.findIndex((d) => d.fan === "嚦咕嚦咕");
eq([BIG_WIN_ORDER[at].theme, BIG_WIN_ORDER[at].cele, BIG_WIN_ORDER[at - 1].fan, BIG_WIN_ORDER[at + 1].fan], ["ligu", true, "五暗刻", "大三元"], "L16 代號 ligu、接自摸／胡浮層，排在五暗刻之後、大三元之前");
eq([pickBigWin({ seat: 0, score: { fans: [{ name: "嚦咕嚦咕", value: 8 }] } })?.theme, pickBigWin({ seat: 0, score: { fans: [{ name: "嚦咕嚦咕", value: 8 }, { name: "清一色", value: 8 }] } })?.theme,
  pickBigWin({ seat: 0, score: { fans: [{ name: "嚦咕嚦咕", value: 8 }, { name: "五暗刻", value: 8 }] } })?.theme],
  ["ligu", "ligu", "wuanke"], "L17 只有嚦咕嚦咕播嚦咕；和清一色同台播嚦咕；和五暗刻同台播五暗刻");

// ---- 聽牌剩幾隻（tingInfo） ----
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 s1 s4 s7
const view = (o: Partial<TingView> = {}): TingView => ({
  hand: tiles(H16),
  players: [0, 1, 2, 3].map((seat) => ({ seat, revealed: [] as Meld[], discards: [] as Tile[] })),
  ...o,
});
{
  const v = view();
  v.players[2].discards = tiles("s7 s7");
  v.players[3].revealed = [{ type: "pong", tiles: tiles("s1 s1 s1") }, { type: "concealed_kong", tiles: tiles("s4 s4 s4 s4") }];
  eq(waitsLeft(v, 0), [{ key: "s1", left: 1 }, { key: "s4", left: 3 }, { key: "s7", left: 2 }],
    "T1 眼牌前：扣自己手牌（s4 一張）、海底（s7 兩張）、別家的碰（s1 三張）；別家的暗槓是蓋著的，不扣");
  v.opponentHands = [{ seat: 3, hand: tiles("s7"), revealed: v.players[3].revealed }];
  eq(waitsLeft(v, 0), [{ key: "s1", left: 1 }, { key: "s4", left: 0 }, { key: "s7", left: 1 }], "T2 眼牌後：再扣別家手牌（s7）和看得到的暗槓牌面（s4 四張，最少 0）");
  const mine = view({ hand: tiles(H16) });
  mine.players[0].revealed = [];
  eq(seenTileCounts(view({ players: [{ seat: 0, revealed: [{ type: "concealed_kong", tiles: tiles("z7 z7 z7 z7") }], discards: [] }] }), 0).get("z7"), 4, "T3 自己的暗槓算看得到");
}
{
  const v = view({ hand: tiles(H16 + " z1") });
  v.players[1].discards = tiles("z4");
  const opts = discardTingOptions(v, 0);
  const z1 = opts.find((o) => o.discard === "z1");
  eq([z1?.waits, z1?.total], [[{ key: "s1", left: 4 }, { key: "s4", left: 3 }, { key: "s7", left: 4 }], 11], "T4 打出 z1 後聽 s1/s4/s7，各剩 4/3/4，共 11 隻");
  eq(opts.some((o) => o.discard === "m1"), false, "T5 打了不會聽的牌不列出");
  const lg = discardTingOptions(view({ hand: tiles(LG16 + " z6") }), 0);
  eq(lg.find((o) => o.discard === "z6")?.waits, [{ key: "p9", left: 3 }], "T6 嚦咕嚦咕也算：打出 z6 後聽 p9，剩 3 隻");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
