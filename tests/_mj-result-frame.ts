// 麻將結算換成三款共用的 GameResultFrame（小宜〈麻將換共用元件 v1〉§4，2026-11-21）：
//   F  共用外框補的三樣（plain 明細＋單位、第二顆按鈕、蓋在四家列上的展開區）和胡牌那一列、灰字標題；不給就跟原本一樣（十三支不變）
//   M  麻將八種畫面：胡（放槍）、自摸（MIGI、聽牌張）、一炮多響、流局、八仙過海、七搶一、總積分榜、觀戰者
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MjPlayer, MjWinner, MjHandReveal } from "../hooks/useMahjong";
import type { Tile } from "../lib/mahjong/tiles";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const GameResultFrame = (await import("../components/gameResult/GameResultFrame")).default;
const MjResultMobile = (await import("../components/mahjong/MjResultMobile")).default;
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

// ---- F 共用外框 ----
{
  const base = { title: "本局結算", rows: [{ key: 0, name: "甲", delta: 3 }], primary: { label: "確認", onClick: () => {} } };
  const plain = clean(renderToStaticMarkup(createElement(GameResultFrame, { ...base, items: [{ label: "頭墩", value: 2 }], total: { label: "合計", value: -1 } })));
  ok(!/ghost|gr-overlay|v plain|gr-row win|gr-title draw/.test(plain) && /<b class="v up">\+2<\/b>/.test(plain) && /<b class="v down">−1<\/b>/.test(plain) && count(plain, /class="gr-btn/g) === 1,
    "F1 不給新參數：跟原本一樣（明細 +N／−N、只有一顆按鈕、沒有展開區、沒有胡牌列樣式）——十三支不受影響");
  const h = clean(renderToStaticMarkup(createElement(GameResultFrame, {
    ...base, titleTone: "draw", subs: ["第一行", "第二行"], items: [{ label: "門清", value: 1, format: "plain", unit: " 台" }], total: { label: "共", value: 8, format: "plain", unit: " 台" },
    rows: [{ key: 0, name: "甲", delta: 3, tone: "win" }], overlay: createElement("i", { id: "ov" }), secondary: { label: "離開", onClick: () => {} },
  })));
  ok(/<b class="v plain">1 台<\/b>/.test(h) && /<b class="v plain">8 台<\/b>/.test(h), "F2 明細 plain：不帶正負號、後面接單位（「1 台」「8 台」）");
  ok(/class="gr-btn ghost"[^>]*>離開<\/button><button type="button" class="gr-btn"[^>]*>確認/.test(h), "F3 第二顆按鈕在主要按鈕左邊、ghost 樣式");
  ok(/class="gr-rows">.*<div class="gr-overlay"><i id="ov"><\/i><\/div><\/div><div class="gr-next"/.test(h), "F4 展開區蓋在四家列那一塊裡（gr-rows 裡最後），不在按鈕那一列");
  ok(/class="gr-row win"/.test(h) && /class="gr-title draw"/.test(h) && count(h, /class="gr-sub">第.行</g) === 2, "F5 胡牌那一列、灰字標題、標題下多行小區塊");
}

// ---- M 麻將八種畫面 ----
const t = (id: number, suit: Tile["suit"], rank: number): Tile => ({ id, suit, rank, display: `${rank}` });
const names = ["阿美", "阿德", "老王", "小林"];
const players: MjPlayer[] = names.map((name, seat) => ({ id: `p${seat}`, name, seat, tileCount: 16, flowers: [], discards: [], revealed: [], isDealer: seat === 0 }));
const hands: MjHandReveal[] = names.map((name, seat) => ({ seat, name, hand: [t(seat * 10 + 1, "m", 1), t(seat * 10 + 2, "m", 2)], revealed: [], flowers: [] }));
const win = (seat: number, fans: [string, number][], extra: Partial<MjWinner> = {}): MjWinner & { allHands: MjHandReveal[] } => ({
  seat, name: names[seat], score: { fans: fans.map(([name, value]) => ({ name, value })), totalFan: fans.reduce((a, [, v]) => a + v, 0) } as MjWinner["score"], allHands: hands, ...extra,
});
const wall = Array.from({ length: 16 }, (_, i) => t(900 + i, "p", (i % 9) + 1));
const common = { players, mySeat: 0, myId: "p0", hasRounds: true, onNextGame: async () => null, onLeave: () => {}, dice: [1, 2, 3] as [number, number, number], dealerSeat: 0, dealerConsecutive: 2, remainingWall: wall, nextGameReady: ["p1"], playerScores: [12, -4, -8, 0] };
const R = (p: Record<string, unknown>) => clean(renderToStaticMarkup(createElement(MjResultMobile, { ...common, ...p } as Parameters<typeof MjResultMobile>[0])));
const seatRow = (h: string, seat: number) => h.slice(h.indexOf(`data-mj-result-seat="${seat}"`), h.indexOf(`data-mj-result-seat="${seat + 1}"`) >>> 0 || undefined);

{
  const h = R({ winner: win(0, [["門清", 1], ["莊家", 1], ["連 2 拉 2", 4], ["花牌", 2]]), isZimo: false, fromName: "阿德", settlement: { deltas: [8, -8, 0, 0], reason: "win", fanTotal: 8, paymentPerPlayer: 8 } });
  ok(/class="gr-title">胡</.test(h) && /mj-gr-who"[^>]*>.*阿美.* 胡牌/.test(h) && /mj-gr-from">阿德 放槍</.test(h) && count(h, /class="mj-gr-dice"/g) === 1, "M1a 胡（放槍）：標題「胡」、誰胡牌、誰放槍（紅）、骰子");
  ok(/<b class="v plain">4 台<\/b>/.test(h) && /<span class="n">共<\/span><b class="v plain">8 台<\/b>/.test(h) && !/\+4|\+8 台/.test(h.slice(h.indexOf("gr-items"), h.indexOf("gr-r"))), "M1b 台數表寫「4 台」「共 8 台」，不帶正負號");
  ok(/class="gr-row me win" data-mj-result-seat="0"/.test(h) && /gr-mark hu">胡</.test(seatRow(h, 0)) && /gr-mark dl">莊2</.test(seatRow(h, 0)) && !/gr-mark hu/.test(seatRow(h, 1)), "M1c 胡牌那一列金框、名字下「胡」「莊2」膠囊，別家沒有");
  ok(!/（你）/.test(h) && !/class="wind/.test(h) && !/>胡<\/span><\/div><div class="gr-body"><div class="mj-gr-body"><div class="ln">胡</.test(h), "M1d 拿掉「（你）」、四家列的風位小方塊、「胡」那一行的字");
  ok(/class="gr-btn ghost" data-mj-result-leave="">離開<\/button><button type="button" class="gr-btn" data-mj-result-next="">下一局/.test(h) && /同意 1\/4/.test(h) && /還在等 你、老王、小林 按下一局/.test(h), "M1e 按鈕「離開」「下一局」；同意 1/4；還在等誰");
  ok(/看牌庫（16）/.test(h) && /data-wall-toggle=""/.test(h) && !/data-wall=""/.test(h), "M1f 看牌庫（16）；沒打開時沒有牌庫區");
  ok(/<b class="up">\+8<\/b><small>累計 \+12<\/small>/.test(h) && /<b class="down">−8<\/b>/.test(h), "M1g 輸贏＋累計");
}
{
  const h = R({ winner: win(2, [["自摸", 1], ["地聽", 8]], { waits: [{ suit: "p", rank: 3, display: "3筒" }, { suit: "p", rank: 6, display: "6筒" }] }), isZimo: true, tingSeats: [2], eyeSeats: [2], settlement: { deltas: [-13, -13, 39, -13], reason: "self_draw", fanTotal: 9, paymentPerPlayer: 13 } });
  ok(/class="gr-title">自摸</.test(h) && /老王<span class="mjm-tag migi"[^>]*>MIGI<\/span><\/span> 胡牌/.test(h) && !/放槍/.test(h), "M2a 自摸：名字後面接 MIGI 旗，沒有放槍那行");
  ok(/>聽<\/span>/.test(seatRow(h, 2)), "M2b 聽牌張在胡的那一列");
}
{
  const h = R({ winner: win(1, [["門清", 1], ["花牌", 1], ["莊家", 1]]), winners: [win(1, [["門清", 1], ["花牌", 1], ["莊家", 1]]), win(3, [["門清", 1], ["平胡", 1]])], isZimo: false, fromName: "老王", settlement: { deltas: [0, 3, -5, 2], reason: "win", fanTotal: 3, paymentPerPlayer: 3 } });
  ok(!/gr-items/.test(h) && /阿德.*、.*小林.* 胡牌/.test(h) && /mj-gr-from">老王 放槍</.test(h), "M3a 一炮多響：沒有台數表；「阿德、小林 胡牌」「老王 放槍」");
  ok(/class="ln">胡 3 台：門清、花牌、莊家</.test(seatRow(h, 1)) && /class="ln">胡 2 台：門清、平胡</.test(seatRow(h, 3)) && count(h, /class="gr-row win"/g) === 2, "M3b 胡的兩家各自第一行寫台數，兩列都是胡牌列");
}
{
  const h = R({ winner: { seat: -1, name: "", score: { fans: [], totalFan: 0 }, allHands: hands }, isZimo: false, settlement: { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 } });
  ok(/class="gr-title draw">流局</.test(h) && !/gr-items/.test(h) && !/胡牌/.test(h) && count(h, /<b class="zero">0<\/b>/g) === 4 && /看牌庫（16）/.test(h), "M4 流局：灰字、沒有台數表、四家 0、看牌庫");
}
{
  const h = R({ winner: win(2, [["八仙過海", 8]]), isZimo: true, settlement: { deltas: [-8, -8, 24, -8], reason: "self_draw", fanTotal: 8, paymentPerPlayer: 8 } });
  ok(/class="gr-title">八仙過海</.test(h) && /<span class="n">八仙過海<\/span><b class="v plain">8 台<\/b>/.test(h) && !/放槍/.test(h), "M5 八仙過海：標題、「八仙過海 8 台」");
}
{
  const h = R({ winner: win(1, [["七搶一", 8]]), isZimo: false, fromName: "阿美", settlement: { deltas: [-8, 8, 0, 0], reason: "win", fanTotal: 8, paymentPerPlayer: 8 } });
  ok(/class="gr-title">七搶一</.test(h) && /<span class="n">七搶一<\/span><b class="v plain">8 台<\/b>/.test(h), "M6 七搶一：標題、「七搶一 8 台」");
}
{
  const h = R({ winner: win(0, [["門清", 1]]), isZimo: false, gameOver: true, roomLine: "4 圈・底 100 台 20", handStats: { wins: [3, 1, 1, 0], dealIns: [0, 1, 2, 1], selfDraws: [1, 0, 1, 0] }, settlement: { deltas: [1, -1, 0, 0], reason: "win", fanTotal: 1, paymentPerPlayer: 1 } });
  ok(/class="gr-title">總積分榜</.test(h) && /gr-sub">4 圈・底 100 台 20</.test(h) && /gr-rank r0">1<\/span><span class="gr-fname">阿美/.test(h) && /gr-rank r3">4<\/span><span class="gr-fname">老王/.test(h),
    "M7a 總積分榜：「4 圈・底 100 台 20」、照總分排名");
  ok(count(h, /class="gr-btn/g) === 1 && /data-mj-result-leave="">回大廳/.test(h) && !/同意|還在等|看牌庫/.test(h) && /data-hand-stat="0">胡<b>2<\/b>/.test(h), "M7b 只有「回大廳」，沒有同意、還在等、看牌庫；胡／放槍／自摸（胡 3 次裡 1 次是自摸 → 胡顯示 2，老闆 2026-11-22 自摸不算進胡）");
}
{
  const h = R({ winner: win(0, [["門清", 1]]), isZimo: false, fromName: "阿德", spectator: true, myId: "", settlement: { deltas: [1, -1, 0, 0], reason: "win", fanTotal: 1, paymentPerPlayer: 1 } });
  ok(count(h, /class="gr-btn/g) === 1 && /data-mj-result-leave="">離開觀戰/.test(h) && !/gr-chip|同意|還在等|下一局/.test(h) && !/gr-row me/.test(h), "M8 觀戰者：只有「離開觀戰」，沒有同意小牌子、還在等、下一局，沒有自己那一列");
}

// M7c 老闆 2026-11-22：總積分榜的「胡」只算別人放槍給他的胡，自摸另外算、不重複；一炮多響每個胡的人各算 1 次胡。
// 用伺服器真的 tallyHandStats 累積一場：阿美（座位 0）自摸 1、放槍胡 2（其中 1 次是一炮三響），再給總積分榜顯示
{
  const { tallyHandStats } = await import("../lib/mahjong/gameLogic");
  type St = Parameters<typeof tallyHandStats>[0];
  const W = (seat: number, from: number | null) => ({ seat, from, score: { total: 1, items: [] } });
  const s = {} as St;
  const hand = (winners: ReturnType<typeof W>[]) => { (s as { winners?: unknown; winner?: unknown }).winners = winners; (s as { winner?: unknown }).winner = winners[0]; tallyHandStats(s); };
  hand([W(0, null)]);                     // 阿美自摸
  hand([W(0, 2)]);                        // 阿美胡、座位 2 放槍
  hand([W(0, 3), W(1, 3), W(2, 3)]);      // 一炮三響：座位 3 放槍，0、1、2 都胡
  const hs = s.handStats!;
  const h = R({ winner: win(0, [["門清", 1]]), isZimo: false, gameOver: true, handStats: hs, settlement: { deltas: [1, -1, 0, 0], reason: "win", fanTotal: 1, paymentPerPlayer: 1 } });
  const rowOf = (seat: number) => { const a = h.indexOf(`data-mj-result-seat="${seat}"`), b = h.indexOf("data-mj-result-seat=", a + 1); return h.slice(a, b < 0 ? undefined : b); }; // 總積分榜照總分排，不是照座位
  const cell = (seat: number, label: string) => (rowOf(seat).match(new RegExp(`>${label}<b>(\\d+)</b>`)) ?? [])[1];
  ok(cell(0, "胡") === "2" && cell(0, "自摸") === "1" && cell(1, "胡") === "1" && cell(2, "胡") === "1" && cell(3, "放槍") === "1" && cell(2, "放槍") === "1",
    `M7c 一場裡阿美自摸 1、放槍胡 2 → 總積分榜阿美「胡 2、自摸 1」；一炮三響的另外兩家各胡 1；放槍照舊（實際：${[0, 1, 2, 3].map((x) => `座位${x} 胡${cell(x, "胡")} 放槍${cell(x, "放槍")} 自摸${cell(x, "自摸")}`).join("、")}）`);
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
