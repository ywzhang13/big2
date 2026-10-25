// 大牌胡牌特效的觸發判斷（老闆 2026-10-23 定案；lib/mahjong/bigWin.ts）：
//   B1 各牌型：用真的計分（calculateScore）算出台數明細，天胡、字一色、大四喜、大三元、小四喜、清一色、五暗刻、MIGI（地聽）都會播對的那一種；
//      八仙過海、七搶一（花牌胡，台數明細只有那一項）也會播。頂級／大牌、收尾接不接浮層都對
//   B2 多牌型：只播台數最高的；同台數照固定順序（天胡、字一色、大四喜、五暗刻、大三元、小四喜、清一色、八仙過海、七搶一、MIGI）
//   B3 地胡不播、一般胡牌不播、流局（seat -1）和沒有贏家不播
//   B4 一炮多響：照順位整理後 state.winner 是順位第一那家，只看它（順位第一是一般胡就不播，即使後面那家是大牌）
//   B5 重新整理／斷線重連不重播：同一手的識別相同、記下後判斷播過；不同局、不同贏家不算播過；只留最近 20 手
//   B6 老闆 2026-10-25 選 A（同台數優先順序）：字一色 > 大四喜；五暗刻排在清一色、大三元前面；同時成立只播最高台那一種；
//      隕石帳號天胡不接隕石（只播大牌段就結算）。台數明細都用真的計分算
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import { applyWinnerOrderRule } from "../lib/mahjong/gameLogic";
import { BIG_WIN_ORDER, bigWinKey, bigWinPlayed, markBigWinPlayed, pickBigWin } from "../lib/mahjong/bigWin";
import { planWinShow } from "../lib/mahjong/winShow";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string, note = "") {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}${note ? `\n   ${note}` : ""}`}`);
}
let nextId = 8000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
/** 真的計分：keys＝手上 17 張（含胡的那張），winKey＝胡的那張 */
function fansOf(keys: string, winKey: string, o: Partial<ScoringContext> = {}, revealed: Meld[] = []) {
  const concealed = keys.split(" ").filter(Boolean).map(t);
  const ctx: ScoringContext = { concealed, revealed, winTile: concealed.find((x) => x.suit + x.rank === winKey)!, isSelfDraw: false, isDealer: false,
    seatWind: 2, prevalentWind: 1, flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: false, isTing: false, ...o };
  return calculateScore(ctx).fans;
}
const winner = (fans: { name: string; value: number }[], seat = 1) => ({ seat, score: { fans } });
const pick = (fans: { name: string; value: number }[]) => {
  const p = pickBigWin(winner(fans));
  return p && [p.theme, p.title, p.tier, p.fan, p.cele];
};
const NORMAL = "m1 m2 m3 m4 m5 m6 p2 p3 p4 p7 p8 p9 s3 s4 s5 s9 s9";

// ---- B1 各牌型 ----
eq(pick(fansOf(NORMAL, "s5", { isSelfDraw: true, isDealer: true, isFirstDraw: true })), ["tianhu", "天胡", "top", 24, false], "B1 天胡：頂級、24 台、播完直接進結算（不接自摸浮層）");
eq(pick(fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z5 z5 z5 z6 z6 z6 z7 z7", "z7")), ["zi1se", "字一色", "top", 16, true], "B1 字一色：頂級、16 台、接浮層");
eq(pick(fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 p5 p5", "m3")), ["dasixi", "大四喜", "top", 16, true], "B1 大四喜：頂級、16 台、接浮層");
eq(pick(fansOf("z5 z5 z5 z6 z6 z6 z7 z7 z7 m1 m2 m3 p4 p5 p6 s9 s9", "p6")), ["dasanyuan", "大三元", "big", 8, true], "B1 大三元：大牌、8 台、接浮層");
eq(pick(fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 m1 m2 m3 p4 p5 p6", "p6")), ["xiaosixi", "小四喜", "big", 8, true], "B1 小四喜：大牌、8 台、接浮層");
eq(pick(fansOf("m1 m1 m1 m2 m3 m4 m4 m5 m6 m6 m7 m7 m8 m8 m9 m9 m9", "m9")), ["qing1se", "清一色", "big", 8, true], "B1 清一色：大牌、8 台、接浮層");
eq(pick(fansOf("m2 m2 m2 m5 m5 m5 p7 p7 p7 s3 s3 s3 z1 z1 z1 s8 s8", "s8", { isSelfDraw: true })), ["wuanke", "五暗刻", "big", 8, true], "B1 五暗刻：大牌、8 台、接浮層");
eq(pick(fansOf(NORMAL, "s5", { isFirstDraw: true, isTing: true })), ["migi", "MIGI", "big", 8, true], "B1 MIGI（計分名稱「地聽」）：主標寫 MIGI、大牌、8 台、接浮層");
eq(pick([{ name: "八仙過海", value: 8 }]), ["baxian", "八仙過海", "big", 8, false], "B1 八仙過海：大牌、8 台、播完直接進結算");
eq(pick([{ name: "七搶一", value: 8 }]), ["qiqiang1", "七搶一", "big", 8, false], "B1 七搶一：大牌、8 台、播完直接進結算");

// ---- B2 多牌型 ----
{
  const f = fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 z5 z5 z5 z7 z7", "z7");
  eq([f.some((x) => x.name === "字一色"), f.some((x) => x.name === "大四喜")], [true, true], "B2 前提：這手同時有字一色、大四喜（都是 16 台）", f.map((x) => x.name + x.value).join("+"));
  eq(pick(f)?.[0], "zi1se", "B2 同台數照順序：字一色＋大四喜 → 播字一色");
}
{
  const f = fansOf("m1 m1 m1 m3 m3 m3 m5 m5 m5 m7 m7 m7 m9 m9 m9 m2 m2", "m2", { isSelfDraw: true });
  eq([f.some((x) => x.name === "清一色"), f.some((x) => x.name === "五暗刻")], [true, true], "B2 前提：這手同時有清一色、五暗刻（都是 8 台）", f.map((x) => x.name + x.value).join("+"));
  eq(pick(f)?.[0], "wuanke", "B2 同台數照順序：清一色＋五暗刻 → 播五暗刻（老闆 2026-10-25 選 A）");
}
eq(pick([{ name: "大三元", value: 8 }, { name: "門清", value: 1 }, { name: "字一色", value: 16 }])?.[0], "zi1se", "B2 台數高的優先，和台數明細的先後無關：大三元 8＋字一色 16 → 播字一色");
eq(pick([{ name: "地聽", value: 8 }, { name: "清一色", value: 8 }])?.[0], "qing1se", "B2 同台數：清一色排在 MIGI 前面");
eq(pick([{ name: "七搶一", value: 8 }, { name: "八仙過海", value: 8 }])?.[0], "baxian", "B2 同台數：八仙過海排在七搶一前面");
eq(BIG_WIN_ORDER.map((d) => d.fan).join("、"), "天胡、字一色、大四喜、五暗刻、大三元、小四喜、清一色、八仙過海、七搶一、地聽", "B2 固定順序和定案一致（老闆 2026-10-25 選 A）");

// ---- B3 不播 ----
{
  const f = fansOf(NORMAL, "s5", { isFirstDraw: true });
  eq(f.some((x) => x.name === "地胡"), true, "B3 前提：閒家第一巡、沒宣告 MIGI 就胡＝地胡", f.map((x) => x.name + x.value).join("+"));
  eq(pickBigWin(winner(f)), null, "B3 地胡不播（維持一般胡牌畫面）");
}
eq(pickBigWin(winner(fansOf(NORMAL, "s5"))), null, "B3 一般胡牌不播");
eq(pickBigWin(winner(fansOf(NORMAL, "s5", { isSelfDraw: true }))), null, "B3 一般自摸不播");
eq(pickBigWin(winner(fansOf("z5 z5 z5 z6 z6 z6 z7 z7 m1 m2 m3 p4 p5 p6 s7 s8 s9", "s9"))), null, "B3 小三元（4 台）不播");
eq(pickBigWin({ seat: -1, score: { fans: [{ name: "大三元", value: 8 }] } }), null, "B3 流局（seat -1）不播");
eq(pickBigWin(undefined), null, "B3 沒有贏家不播");

// ---- B4 一炮多響 ----
{
  // 座位 0 放槍；1 號是順位第一（一般胡），2 號是大三元：先按的是 2 號
  const big = { seat: 2, score: { fans: [{ name: "大三元", value: 8 }], totalFan: 8 } };
  const normal = { seat: 1, score: { fans: [{ name: "門清", value: 1 }], totalFan: 1 } };
  const base = { lastDiscard: { tile: t("p5"), from: 0 }, winners: [big, normal], winner: big } as unknown as MahjongGameState;
  const s = applyWinnerOrderRule(base);
  eq([s.winner?.seat, pickBigWin(s.winner)], [1, null], "B4 雙響：順位第一（1 號，一般胡）→ 不播；後面那家的大三元不算");
  const s2 = applyWinnerOrderRule({ lastDiscard: { tile: t("p5"), from: 0 }, winners: [{ ...normal, seat: 3 }, { ...big, seat: 1 }, { ...normal, seat: 2 }] } as unknown as MahjongGameState);
  eq([s2.winners?.length, s2.winner?.seat, pickBigWin(s2.winner)?.theme], [3, 1, "dasanyuan"], "B4 三響：順位第一（1 號）是大三元 → 播大三元（只播這一家）");
}

// ---- B5 不重播 ----
{
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const w = { seat: 2, winTile: { id: 41 } };
  const k = bigWinKey("room-1", "1-3-0", w)!;
  eq([k, bigWinPlayed(k, kv)], ["room-1|1-3-0|2|41", false], "B5 第一次：還沒播過");
  markBigWinPlayed(k, kv);
  eq(bigWinPlayed(bigWinKey("room-1", "1-3-0", { seat: 2, winTile: { id: 41 } })!, kv), true, "B5 重新整理後同一手：判斷播過，不重播");
  eq([bigWinPlayed(bigWinKey("room-1", "1-4-0", w)!, kv), bigWinPlayed(bigWinKey("room-2", "1-3-0", w)!, kv), bigWinPlayed(bigWinKey("room-1", "1-3-0", { seat: 1, winTile: { id: 41 } })!, kv)],
    [false, false, false], "B5 下一局、別的房間、別的贏家：都不算播過");
  for (let i = 0; i < 25; i++) markBigWinPlayed(`k${i}`, kv);
  eq([bigWinPlayed(k, kv), bigWinPlayed("k24", kv), (JSON.parse(mem.get("mj.bigwin.played")!) as string[]).length], [false, true, 20], "B5 只留最近 20 手");
  eq([bigWinKey("", "1-3-0", w), bigWinKey("room-1", "1-3-0", { seat: -1 })], [null, null], "B5 沒有房間、流局：沒有識別（不播）");
  // 存不了 sessionStorage（無痕模式）：這次開著的頁面照樣記得播過，結算浮層才會在播完後出現
  eq(bigWinPlayed("mem-1", null), false, "B5 沒有 sessionStorage：還沒播過");
  markBigWinPlayed("mem-1", null);
  eq(bigWinPlayed("mem-1", null), true, "B5 沒有 sessionStorage：記在頁面裡，判斷播過");
  // 審伯 2026-10-23 必修 2：sessionStorage 寫不進去（容量滿、隱私模式 setItem 拋錯）或內容壞掉時，改記在頁面裡，照樣判斷播過（不然結算浮層會一直被擋住）
  const throwing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  markBigWinPlayed("quota-1", throwing);
  eq(bigWinPlayed("quota-1", throwing), true, "B5 setItem 拋錯：mark 之後 bigWinPlayed 是 true");
  const broken = { getItem: () => "{壞掉", setItem: () => {} };
  markBigWinPlayed("broken-1", broken);
  eq(bigWinPlayed("broken-1", broken), true, "B5 讀出來不是合法 JSON：mark 之後 bigWinPlayed 是 true");
}

// ---- B6 老闆 2026-10-25 選 A ----
{
  const has = (f: { name: string }[], names: string[]) => names.map((n) => f.some((x) => x.name === n));
  const fan = (f: { name: string; value: number }[]) => f.map((x) => x.name + x.value).join("+");
  // 字一色＋大四喜（都是 16 台）：東南西北四刻＋中刻＋白對
  const a = fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 z5 z5 z5 z7 z7", "z7");
  eq([has(a, ["字一色", "大四喜"]), pick(a)?.[0]], [[true, true], "zi1se"], "B6 字一色＋大四喜 → 只播字一色", fan(a));
  // 五暗刻＋清一色（都是 8 台）：自摸、全是萬子暗刻
  const b = fansOf("m1 m1 m1 m3 m3 m3 m5 m5 m5 m7 m7 m7 m9 m9 m9 m2 m2", "m2", { isSelfDraw: true });
  eq([has(b, ["五暗刻", "清一色"]), pick(b)?.[0]], [[true, true], "wuanke"], "B6 五暗刻＋清一色 → 只播五暗刻", fan(b));
  // 五暗刻＋大三元（都是 8 台）：自摸、中發白三刻＋兩組暗刻＋對
  const c = fansOf("z5 z5 z5 z6 z6 z6 z7 z7 z7 m2 m2 m2 p5 p5 p5 s9 s9", "s9", { isSelfDraw: true });
  eq([has(c, ["五暗刻", "大三元"]), pick(c)?.[0]], [[true, true], "wuanke"], "B6 五暗刻＋大三元 → 只播五暗刻", fan(c));
  // 天胡＋字一色＋大四喜＋五暗刻：莊家起手 17 張就胡（東南西北中五刻＋白對）
  const d = fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 z5 z5 z5 z7 z7", "z7", { isSelfDraw: true, isDealer: true, isFirstDraw: true });
  eq([has(d, ["天胡", "字一色", "大四喜", "五暗刻"]), pick(d)?.slice(0, 2)], [[true, true, true, true], ["tianhu", "天胡"]], "B6 天胡＋字一色＋大四喜＋五暗刻 → 只播天胡", fan(d));
  // 隕石帳號天胡：只播大牌段就結算，不接隕石（一般人天胡也一樣）
  eq([planWinShow({ pick: pickBigWin(winner(d)), zimo: true, winFx: "meteor" }), planWinShow({ pick: pickBigWin(winner(d)), zimo: true })], [["big"], ["big"]], "B6 隕石帳號天胡 → 只播天胡大牌段，不接隕石");
  // 對照：隕石帳號字一色、大四喜自摸照舊「大牌段 → 隕石」
  const e = fansOf("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 p5 p5", "p5", { isSelfDraw: true });
  eq([planWinShow({ pick: pickBigWin(winner(a)), zimo: true, winFx: "meteor" }), pick(e)?.[0], planWinShow({ pick: pickBigWin(winner(e)), zimo: true, winFx: "meteor" })],
    [["big", "meteor"], "dasixi", ["big", "meteor"]], "B6 隕石帳號字一色、大四喜自摸 → 大牌段 → 隕石", fan(e));
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
