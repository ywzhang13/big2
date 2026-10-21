// 海底撈月、河底撈魚（2026-10-21 老闆）：牌牆剩 16 張就流局，所以「最後一張可摸的牌」是牌牆從 17 張摸到 16 張那張。
//   H1 摸到最後一張可摸的牌自摸 → 海底撈月 1 台（原本判斷 wall.length === 0，永遠不會成立）
//   H2 最後一張之前（牌牆還有可摸的牌）自摸 → 沒有海底撈月
//   H3 最後一張摸完、打出的牌別人可以胡（getAvailableActions 有 win）；胡了 → 河底撈魚 1 台、沒有海底撈月；結算照放槍，只有放槍的人付
//   H4 最後一張之前打出的牌被胡 → 沒有河底撈魚
//   H5 自摸不算河底撈魚、放槍不算海底撈月（不互相混用）；搶槓不算河底撈魚
//   H6 最後一張是花、補花後自摸 → 照樣海底撈月；之後下一家摸牌就流局（不會出現第二次海底）
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import { calculateSettlement, declareWin, discardTile, drawTile, getAvailableActions, advanceTurn } from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let nextId = 5000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const names = (w: { score: { fans: { name: string }[] } }) => w.score.fans.map((f) => f.name);

// 座位 0 莊家；座位 1 聽 p5（胡 m1-9 順＋刻子＋單吊 p5）；座位 2、3 散牌。輪到 currentTurn 摸牌
const WIN16 = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 s5 s6 s7 p5"; // 16 張，聽 p5
const JUNK16 = "z1 z2 z3 z4 z5 z6 z7 s9 p1 p9 m9 z1 z2 z3 z4 z5";
function game(wallLen: number, opts: { turn: number; hands?: string[]; wallFront?: string; wallBack?: string }): MahjongGameState {
  const hands = opts.hands ?? [JUNK16, WIN16, JUNK16, JUNK16];
  const wall = tiles(Array(wallLen).fill("s9").join(" "));
  if (opts.wallFront) wall[0] = t(opts.wallFront);
  if (opts.wallBack) wall[wall.length - 1] = t(opts.wallBack);
  return {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(hands[seat]), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall, currentTurn: opts.turn, hasDrawn: false, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 20,
    isFirstRound: false, isAfterKong: false, roundInfo: { dealerConsecutive: 0 }, roomSettings: { basePoints: 100, fanPoints: 20, totalRounds: 1 },
  } as unknown as MahjongGameState;
}

// H1／H2：座位 1 摸 p5 自摸
for (const [label, wallLen, expect] of [["H1 牌牆 17 張摸最後一張（摸完剩 16）自摸", 17, true], ["H2 牌牆 18 張（摸完還有 1 張可摸）自摸", 18, false]] as const) {
  const s = drawTile(game(wallLen, { turn: 1, wallFront: "p5" }));
  const w = declareWin(s, 1, true).winners![0];
  eq([s.wall.length, names(w).includes("海底撈月"), names(w).includes("河底撈魚")], [wallLen - 1, expect, false], `${label}：海底撈月 ${expect ? "有" : "沒有"}、沒有河底撈魚`);
}

// H3：座位 0 摸最後一張（17→16）打出 p5，座位 1 胡
{
  const s0 = drawTile(game(17, { turn: 0, wallFront: "p5" }));
  const p5 = s0.players[0].hand.find((x) => x.suit === "p" && x.rank === 5)!;
  const s1 = discardTile(s0, p5.id);
  const acts = getAvailableActions(s1).filter((a) => a.playerSeat === 1).map((a) => a.type);
  const r = declareWin(s1, 1, false);
  const w = r.winners![0];
  const set = calculateSettlement(r);
  const pay = 100 + w.score.totalFan * 20;
  eq([s1.wall.length, acts.includes("win"), names(w).includes("河底撈魚"), names(w).includes("海底撈月"), w.from],
    [16, true, true, false, 0], "H3 最後一張摸完（剩 16）打出的牌：別人還能胡；胡了算河底撈魚、沒有海底撈月，放槍的是座位 0");
  eq([set.reason, set.deltas], [set.reason === "self_draw" ? "不該是自摸" : set.reason, [-pay, pay, 0, 0]],
    `H3b 結算照放槍（${set.reason}）：只有放槍的座位 0 付 底 100＋${w.score.totalFan} 台×20＝${pay}，其他兩家 0`);
  // 沒人胡：下一家摸牌就流局
  const next = drawTile(advanceTurn(s1));
  eq([next.status, next.winners?.length ?? 0], ["finished", 0], "H3d 這張沒人胡：下一家摸牌直接流局（最後一張之後不能再摸）");
}

// H4：牌牆 18 張，座位 0 摸（剩 17）打出 p5，座位 1 胡 → 不是河底
{
  const s0 = drawTile(game(18, { turn: 0, wallFront: "p5" }));
  const s1 = discardTile(s0, s0.players[0].hand.find((x) => x.suit === "p" && x.rank === 5)!.id);
  const w = declareWin(s1, 1, false).winners![0];
  eq([s1.wall.length, names(w).includes("河底撈魚"), names(w).includes("海底撈月")], [17, false, false], "H4 最後一張之前打出的牌被胡：沒有河底撈魚、沒有海底撈月");
}

// H5：計分層直接驗不混用
{
  const c = tiles(WIN16 + " p5");
  const base: ScoringContext = { concealed: c, revealed: [], winTile: c[16], isSelfDraw: true, isDealer: false, seatWind: 2, prevalentWind: 1,
    flowers: [], isLastTile: true, isAfterKong: false, isRobbingKong: false, isFirstDraw: false, isTing: false };
  const f = (o: Partial<ScoringContext>) => calculateScore({ ...base, ...o }).fans.map((x) => x.name).filter((n) => n === "海底撈月" || n === "河底撈魚");
  eq([f({}), f({ isSelfDraw: false }), f({ isSelfDraw: false, isRobbingKong: true }), f({ isLastTile: false }), f({ isLastTile: false, isSelfDraw: false })],
    [["海底撈月"], ["河底撈魚"], [], [], []], "H5 自摸只算海底撈月、放槍只算河底撈魚、搶槓不算河底撈魚、不是最後一張都不算；各 1 台");
  const one = calculateScore({ ...base, isSelfDraw: false }).fans.find((x) => x.name === "河底撈魚")?.value;
  eq(one, 1, "H5b 河底撈魚是 1 台");
}

// H6：最後一張摸到花 → 從牌尾補花（剩 15）再自摸 p5 → 海底撈月
{
  const s = drawTile(game(17, { turn: 1, wallFront: "f1", wallBack: "p5" }));
  const w = declareWin(s, 1, true).winners![0];
  eq([s.wall.length, s.players[1].flowers.length, names(w).includes("海底撈月")], [15, 1, true], "H6 最後一張是花、補花後自摸：照樣海底撈月");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
