// 十三支 v15（小宜 2026-11-19，老闆確認）：金卡、彩金牌放哪、中央看板、結算照麻將重排（共用外框 GameResultFrame）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync } from "node:fs";
import type { ThGameView } from "../components/thirteen/useThirteenRoom";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const { parseCards, buildDeck, CAT } = await import("../lib/thirteen");
const { cardSrc, isGold } = await import("../components/thirteen/cardArt");
const T = await import("../components/thirteen/revealTimeline");
const ThTable = (await import("../components/thirteen/ThTable")).default;
const ThArrange = (await import("../components/thirteen/ThArrange")).default;
const { ThRoundResult, ThFinalResult } = await import("../components/thirteen/ThResult");
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const clean = (h: string) => h.replace(/<!-- -->/g, "");

// ---- G 金卡 ----
{
  const [n9, h9, k] = parseCards("9S 9H KS");
  ok(cardSrc(n9, 9).endsWith("card-front-spade-9.gold.v1.webp") && cardSrc(h9, 9).includes(".gold.v1.") && cardSrc(k, 9).endsWith(".v4.webp") && cardSrc(n9, null).endsWith(".v4.webp") && isGold(h9, 9) && !isGold(k, 9),
    "G1 點數和彩金牌一樣的牌用金卡圖（只看點數不看花色）；沒有彩金牌照舊白牌");
  ok(buildDeck().every((c) => existsSync(`public${cardSrc(c, c.rank)}`)), "G2 52 種金卡圖都在");
}

// ---- A 理牌：三墩左邊的彩金牌、手牌金卡 ----
{
  const hand = parseCards("9S 9H 9D 2C 3C 4C 5C 6C 7H 8H TH JH QH KD AD 2D");
  const h = clean(renderToStaticMarkup(createElement(ThArrange, { cards: hand, deadline: Date.now() + 60_000, onSubmit: () => {}, lucky: parseCards("9C")[0], rule: { lucky: 9 } })));
  ok(/class="th-arr-lucky" data-th-lucky="C91"><b>彩金<\/b><img[^>]*gold\.v1/.test(h) && (h.match(/th-card th-card-hand[^"]*is-gold/g) ?? []).length === 3,
    "A1 理牌：三墩左邊「彩金」小標＋金卡；手牌裡 3 張 9 是金卡");
  const none = clean(renderToStaticMarkup(createElement(ThArrange, { cards: hand, deadline: Date.now() + 60_000, onSubmit: () => {} })));
  ok(!/th-arr-lucky/.test(none) && !/is-gold/.test(none), "A2 舊房（沒有彩金牌）：不顯示彩金牌、沒有金卡");
}

// ---- B 中央看板 ----
{
  const rv = { ...buildCase("normal")!, luckyCard: parseCards("9H")[0] };
  const view: ThGameView = { status: "playing", code: "1", sv: 1, phase: "revealed", handNo: 1, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: null }, reveal: rv };
  const tl = T.buildTimeline(rv), w = T.scoreWindows(tl)[0];
  const h = clean(renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, w.from + 10) } })));
  ok(/class="th-board-lucky" data-th-board-lucky="H91"[^>]*gold\.v1/.test(h) && !/th-board-hub/.test(h) && !/data-th-board-sc/.test(h) && (h.match(/data-th-board-pt="/g) ?? []).length === 4,
    "B1 看板正中間是彩金牌（金卡、旁邊不寫字），取代墩名；四家牌型名；不顯示每墩加分");
  const old = clean(renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv: { ...rv, luckyCard: null }, frame: T.frameAt(tl, w.from + 10) } })));
  ok(/th-board-hub">頭墩</.test(old), "B2 舊房沒有彩金牌：中間照舊寫墩名");
}

// ---- R 結算 ----
{
  const base = buildCase("normal")!;
  const lucky = parseCards("9H")[0];
  const values = base.result.values.map((v, s) => (s === 1 ? { ...v, front: { cat: CAT.LUCKY_THREE, keys: [9] } } : v));
  const rv = { ...base, luckyCard: lucky, result: { ...base.result, values }, unusedCards: [0, 1, 2, 3].map(() => parseCards("2C 3C 9D")) };
  const ready = [0, 1, 2, 3].map((seat) => ({ seat, name: ["老闆", "小明", "阿明", "小華"][seat], ok: seat !== 2 }));
  const h = clean(renderToStaticMarkup(createElement(ThRoundResult, { rv, names: ["老闆", "小明", "阿明", "小華"], mySeat: 0, secondsLeft: 21, confirmed: false, onConfirm: () => {}, ready })));
  const left = h.slice(h.indexOf('class="gr-l"'), h.indexOf('class="gr-r"')), right = h.slice(h.indexOf('class="gr-r"'));
  const order = ["gr-title", "data-th-res-lucky", "data-th-peek", "gr-items"].map((k) => left.indexOf(k));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `R1 左欄由上到下：大標題、彩金牌、「查看牌桌」、明細（位置 ${order.join("、")}）`);
  const rOrder = ["gr-rows", "gr-next", "gr-ready", "data-th-confirm"].map((k) => right.indexOf(k));
  ok(rOrder.every((x, i) => x > 0 && (i === 0 || x > rOrder[i - 1])) && /還在等 阿明/.test(right) && /確認 3\/4/.test(right) && /確認（21）/.test(right),
    "R2 右欄：四家 → 「還在等 阿明」→「確認 3/4」小牌子 → 右下角「確認（21）」");
  ok((h.match(/class="th-res-grp th-res-unused"/g) ?? []).length === 4 && /th-res-type is-jp" data-th-res-type="彩金衝三"/.test(h) && [...h.matchAll(/th-res-unused" data-th-unused="3">(.*?)<\/div>/g)].every((m) => (m[1].match(/<img class="is-gold"[^>]*9\.gold\.v1/g) ?? []).length === 1),
    "R3 四家都有沒用到的 3 張（線隔開）；彩金牌型小標金底；沒用到的 9 也是金卡");
  const fin = clean(renderToStaticMarkup(createElement(ThFinalResult, { players: [0, 1, 2, 3].map((seat) => ({ seat, playerName: `P${seat}`, totalScore: seat * 100 })), mySeat: 0, hands: 8, baseScore: 100,
    stats: [0, 1, 2, 3].map(() => ({ guns: 1, gunned: 2, homeRuns: 0, homeRunned: 0, total: 0 })), onLobby: () => {} })));
  ok(/8 局・底分 100/.test(fin) && /gr-rank r0">1</.test(fin) && /data-th-fin-seat="3"/.test(fin.slice(0, fin.indexOf('data-th-fin-seat="2"'))) && /data-th-back-lobby="">回大廳/.test(fin),
    "R4 總結算：同一個外框；「8 局・底分 100」；照總分排名（名次圓點）；右下角「回大廳」");
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
