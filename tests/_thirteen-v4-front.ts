// 十三支 v4 前端（老馬 2026-11-19，接老柯 feat/thirteen-score-v4）：
//   D 排序：A、2…K；只有 10 J Q K A 的順子／同花順 A 放最後（老闆「TJQKA 順序」）
//   L 新牌型標籤：頭墩彩金衝三、其他墩彩金三條／彩金葫蘆／彩金鐵支／黑桃同花順／同花順
//   F 大字特效與大牌：和伺服器 revealDurationMs 同一個條件（bonusOf > 0）；黑桃同花順用同花順、彩金鐵支用鐵支、彩金衝三用衝三；彩金葫蘆沒有大字
//   V 配音：彩金 3 段＋沿用（黑桃同花順→同花順、中尾墩彩金三條→三條）；沒有大字的大牌在牌落定時唸
//   A 理牌帶這一局的規則：隨機 3000 局，推薦排法送出被伺服器判倒水 0 局
import { existsSync } from "node:fs";
import type { Arrangement, HandValue } from "../lib/thirteen";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const L = await import("../lib/thirteen");
const { CAT, parseCards, deal, validateSubmission, evalRow, scoreRound, revealOrder } = L;
const S = await import("../components/thirteen/arrangeState");
const T = await import("../components/thirteen/revealTimeline");
const { voiceSrc, sfxEvents } = await import("../components/thirteen/sfx");
const { findCombos } = await import("../components/thirteen/shortcuts");
const { revealDurationMs } = await import("../lib/thirteen/flow");

const rk = (cs: { rank: number }[]) => cs.map((c) => ({ 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" } as Record<number, string>)[c.rank] ?? String(c.rank)).join(" ");
const hv = (cat: number): HandValue => ({ cat: cat as HandValue["cat"], keys: [] });

// ---- D 排序 ----
{
  const top = rk(S.rowDisplayOrder(parseCards("AS KH QD JC TS"))), topSf = rk(S.rowDisplayOrder(parseCards("KD AD QD JD TD")));
  const wheel = rk(S.rowDisplayOrder(parseCards("5S AS 4S 3S 2S"))), fh = rk(S.rowDisplayOrder(parseCards("QS 5H QD 5C QH")));
  const notStraight = rk(S.rowDisplayOrder(parseCards("AS KH QD JC 9S")));
  ok(top === "T J Q K A" && topSf === "T J Q K A", `D1 10 J Q K A 的順子、同花順顯示成 10 J Q K A（${top}／${topSf}）`);
  ok(wheel === "A 2 3 4 5", `D2 A 2 3 4 5 顯示成 A 2 3 4 5（${wheel}）`);
  ok(fh === "5 5 Q Q Q" && notStraight === "A 9 J Q K", `D3 葫蘆照 A→K（${fh}）；不是順子的 A K Q J 9 照 A→K（${notStraight}）`);
  const s0 = S.initArrange(parseCards("KS QH AD 2C TS JD 9H 3S 4D 5C 6H 7S 8D AH KH 2D"));
  const ids = (t: string) => parseCards(t).map((c) => c.id);
  const placed = { ...s0, rows: { front: [], middle: [], back: ids("AD KS QH JD TS") } };
  const v = S.derive(placed);
  ok(rk(v.arrangement.back) === "T J Q K A" && rk(v.hand) === "A 2 2 3 4 5 6 7 8 9 K", `D4 理牌：尾墩放 10 J Q K A 顯示 ${rk(v.arrangement.back)}；手牌照 A→K（${rk(v.hand)}）`);
}

// ---- L 標籤 ----
{
  const got = [
    T.badgeOf("front", hv(CAT.LUCKY_THREE)).label, T.badgeOf("front", hv(CAT.THREE_KIND)).label, T.badgeOf("middle", hv(CAT.LUCKY_THREE)).label,
    T.badgeOf("middle", hv(CAT.LUCKY_FULL_HOUSE)).label, T.badgeOf("back", hv(CAT.LUCKY_FOUR)).label, T.badgeOf("middle", hv(CAT.SPADE_STRAIGHT_FLUSH)).label,
    T.badgeOf("back", hv(CAT.STRAIGHT_FLUSH)).label,
  ].join("／");
  ok(got === "彩金衝三／衝三／彩金三條／彩金葫蘆／彩金鐵支／黑桃同花順／同花順", `L1 亮牌、結算的牌型名（${got}）`);
  const rule = { lucky: 5 };
  const lab = [S.rowLabel("front", parseCards("5S 5H 5D"), rule), S.rowLabel("front", parseCards("6S 6H 6D"), rule), S.rowLabel("middle", parseCards("2S 3S 4S 5S 6S"), rule),
    S.rowLabel("back", parseCards("5S 5H 5D 5C 2H"), rule), S.rowLabel("back", parseCards("5S 5H 5D 2C 2H"), rule), S.rowLabel("back", parseCards("5S 5H 5D 2C 2H"), "legacy")].join("／");
  ok(lab === "彩金衝三 +2／衝三 +1／黑桃同花順 +2／彩金鐵支 +3／彩金葫蘆／葫蘆", `L2 理牌的墩標籤照這一局的規則（彩金 5；舊房 legacy）：${lab}`);
}

// ---- F 大字與大牌 ----
{
  const fx = [T.patternFx("front", hv(CAT.LUCKY_THREE)), T.patternFx("middle", hv(CAT.SPADE_STRAIGHT_FLUSH)), T.patternFx("back", hv(CAT.STRAIGHT_FLUSH)),
    T.patternFx("middle", hv(CAT.LUCKY_FOUR)), T.patternFx("middle", hv(CAT.LUCKY_FULL_HOUSE)), T.patternFx("middle", hv(CAT.LUCKY_THREE))].join("／");
  ok(fx === "jpchongsan／tonghuashun／tonghuashun／jptiezhi／jphulu／", `F1 大字（老闆 2026-11-20 新圖）：彩金衝三、彩金鐵支、彩金葫蘆各有自己的字；黑桃同花順和同花順共用同花順；中墩彩金三條沒有（${fx}）`);
  ok(T.isBigPattern("middle", hv(CAT.LUCKY_FULL_HOUSE)) && !T.isBigPattern("back", hv(CAT.LUCKY_FULL_HOUSE)) && !T.isBigPattern("middle", hv(CAT.LUCKY_THREE)) && T.isBigPattern("back", hv(CAT.SPADE_STRAIGHT_FLUSH)),
    "F2 大牌＝伺服器的 bonusOf > 0：中墩彩金葫蘆（+1）是、尾墩彩金葫蘆（0）和中墩彩金三條不是、尾墩黑桃同花順是");
  // 舊前端只認 cat 3／9／10／11：同樣的 3000 局，量舊判斷會有幾局長度對不上（證明這次改的地方就是 33% 的原因）
  const oldFx = (row: string, cat: number) => (row === "front" ? cat === 3 : cat === 9 || cat === 10 || cat === 11);
  let seed = 11, oldBad = 0, newBad = 0, lucky14 = 0, spade = 0, lucky13 = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 3000; i++) {
    const { hands, rest } = deal(rnd), lucky = rest[0].rank;
    const a = hands.map((h) => L.autoArrange(h, { lucky })), result = scoreRound(a, "v4", lucky);
    const server = revealDurationMs(result);
    if (T.buildTimeline({ order: revealOrder(a, "v4", lucky), result }).end !== server) newBad++;
    const specials = result.values.reduce((n, v) => n + T.ROWS.filter((r) => oldFx(r, v[r].cat)).length, 0);
    if (T.revealDurationV8(specials, result.pairs.filter((p) => p.gunner !== null).length, result.homeRun !== null) !== server) oldBad++;
    for (const v of result.values) { if (v.middle.cat === CAT.LUCKY_FULL_HOUSE) lucky14++; if (T.ROWS.some((r) => v[r].cat === CAT.SPADE_STRAIGHT_FLUSH)) spade++; if (v.front.cat === CAT.LUCKY_THREE) lucky13++; }
  }
  ok(newBad === 0 && oldBad > 0, `F3 v4 隨機 3000 局：前端時間軸長度≠伺服器 ${newBad} 局（舊判斷 ${oldBad} 局＝${(oldBad / 30).toFixed(1)}%）；樣本裡頭墩彩金衝三 ${lucky13}、中墩彩金葫蘆 ${lucky14}、黑桃同花順 ${spade} 家次`);
}

// ---- V 配音 ----
{
  const v = [voiceSrc("front", hv(CAT.LUCKY_THREE)), voiceSrc("middle", hv(CAT.LUCKY_FULL_HOUSE)), voiceSrc("back", hv(CAT.LUCKY_FOUR)),
    voiceSrc("middle", hv(CAT.SPADE_STRAIGHT_FLUSH)), voiceSrc("middle", hv(CAT.LUCKY_THREE)), voiceSrc("front", hv(CAT.THREE_KIND))].map((s) => s.split("/").pop());
  ok(v.join("／") === "th-voice-luckychongsan.v1.mp3／th-voice-cat14.v1.mp3／th-voice-cat15.v1.mp3／th-voice-cat10.v1.mp3／th-voice-cat3.v1.mp3／th-voice-chongsan.v1.mp3"
    && [CAT.LUCKY_THREE, CAT.LUCKY_FULL_HOUSE, CAT.LUCKY_FOUR, CAT.SPADE_STRAIGHT_FLUSH].every((c) => (["front", "middle", "back"] as const).every((r) => existsSync(`public${voiceSrc(r, hv(c))}`))),
    `V1 配音檔：${v.join("、")}（檔案都在）`);
  // 中墩彩金葫蘆（大牌、沒有大字）：牌落定時出牌聲＋唸「彩金葫蘆」；尾墩彩金鐵支（有大字）：大字出現時唸
  const flips = [
    { kind: "flip" as const, t0: 0, dur: 1500, row: "front" as const, seats: [2], big: false, fx: false },
    { kind: "flip" as const, t0: 1500, dur: 1800, row: "middle" as const, seats: [0], big: true, fx: false },
    { kind: "flip" as const, t0: 3300, dur: 1800, row: "back" as const, seats: [1], big: true, fx: true },
    { kind: "fx" as const, t0: 3800, dur: 1500, row: "back" as const, seat: 1, fx: "tiezhi" as const },
  ];
  const values = [0, 1, 2, 3].map(() => ({ front: hv(0), middle: hv(CAT.LUCKY_FULL_HOUSE), back: hv(CAT.LUCKY_FOUR) }));
  const ev = sfxEvents(flips, 0, null, values).filter((e) => e.k === "voice" || e.k === "play").map((e) => `${e.t}:${e.k}:${(e.src ?? "").split("/").pop()}`);
  ok(ev.join(" ") === "350:play: 350:voice:th-voice-cat0.v1.mp3 1850:play: 1850:voice:th-voice-cat14.v1.mp3 3800:voice:th-voice-cat15.v1.mp3",
    `V2 配音時間：中墩彩金葫蘆（大牌、沒有大字）牌落定時出牌聲＋配音；尾墩彩金鐵支大字出現時唸（${ev.join(" ")}）`);
}

// ---- A 理牌帶規則 ----
{
  let seed = 23, hit = 0, badNew = 0, badOld = 0, n = 0, comboBad = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const luckyCat = new Set<number>([CAT.LUCKY_THREE, CAT.LUCKY_FULL_HOUSE, CAT.LUCKY_FOUR]);
  const sent = (s: ReturnType<typeof S.initArrange>) => S.arrangeReducer(S.arrangeReducer(s, { type: "recommend" }), { type: "submit" }).submitted;
  const idsOf = (a: Arrangement) => ({ front: a.front.map((c) => c.id), middle: a.middle.map((c) => c.id), back: a.back.map((c) => c.id) });
  while (hit < 3000 && n < 200000) {
    n++;
    const { hands, rest } = deal(rnd), rule = { lucky: rest[0].rank };
    const h = hands[0];
    const best = L.autoArrange(h, rule);
    if (![best.front, best.middle, best.back].some((r) => luckyCat.has(evalRow(r, rule).cat)) && !h.some((c) => c.rank === rule.lucky)) continue; // 只算手上有彩金點數的局
    hit++;
    const a = sent(S.initArrange(h, rule));
    if (!a || !validateSubmission(h, idsOf(a), rule).ok) badNew++;
    const b = sent(S.initArrange(h));                      // 改之前：理牌沒帶這一局的彩金牌
    if (!b || !validateSubmission(h, idsOf(b), rule).ok) badOld++;
    if (hit <= 300) for (const k of ["fourKind", "fullHouse", "threeKind"] as const) for (const c of findCombos(h, k, rule)) {
      const cat = (c.length === 3 ? L.evalThree(c, rule) : L.evalFive(c, rule)).cat;
      if (!({ fourKind: [CAT.FOUR_KIND, CAT.LUCKY_FOUR], fullHouse: [CAT.FULL_HOUSE, CAT.LUCKY_FULL_HOUSE], threeKind: [CAT.THREE_KIND, CAT.LUCKY_THREE] }[k] as number[]).includes(cat)) comboBad++;
    }
  }
  ok(hit === 3000 && badNew === 0, `A1 手上有彩金點數的 ${hit} 局：推薦排法送出被伺服器（validateSubmission 帶這一局的彩金牌）判不合法 ${badNew} 局（理牌沒帶規則的舊寫法 ${badOld} 局）`);
  ok(comboBad === 0, `A2 快捷鈕（鐵支、葫蘆、三條）帶彩金規則，彩金牌型也找得到、不會選錯牌型（${comboBad}）`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
