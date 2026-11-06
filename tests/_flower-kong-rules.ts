// 熱修兩個規則（老闆 2026-11-07）：
//   ① 補花補到的牌算槓上自摸，台數和槓上開花（1 台）相同；連續補花、槓後補到花再補，都要算；
//      打出一張牌後要正確清除，吃、碰、放槍、搶槓都不能誤算。
//   ② 牌牆剩 17 張摸最後一張（摸完剩 16）：這張如果是花，除非湊成七搶一／八仙過海，否則直接流局，
//      不再補牌，牌牆不能少於 16 張；槓後補牌補到最後一張是花，也照同樣規則處理。
//   U1 補花後自摸：槓上開花有、isAfterKong=true
//   U2 連續補花兩次才補到真牌：自摸一樣有槓上開花
//   U3 補花後沒胡、打出牌：isAfterKong 清掉
//   U4 打出的牌被碰：isAfterKong 仍是清掉的（碰完換人打牌）
//   U5 計分層：isAfterKong=true 但不是自摸（放槍／搶槓）：不算槓上開花
//   U6 明槓補牌是花、再補到真牌：自摸也算槓上開花（既有行為，鎖住不回歸）
//   W1 最後一張是花、沒湊成花胡：直接流局，牌牆停在 16
//   W2 連續補花途中撞到底牌邊界、最後一張沒湊成花胡：流局，牌牆停在 16
//   W3 最後一張是花、剛好湊成八仙過海：照常八仙過海
//   W4 最後一張是花、剛好湊成七搶一：照常七搶一
//   W5 暗槓補牌補到最後一張是花、沒湊成花胡：直接流局，牌牆停在 16
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import {
  declareWin, discardTile, drawTile, executeAction, executeConcealedKong,
} from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let nextId = 6000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const names = (fans: { name: string }[]) => fans.map((f) => f.name);

// 座位 1 單吊 p5（手上已有 1 張 p5，再摸到 1 張 p5 就胡）；座位 0、2、3 散牌
const WIN16 = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 s5 s6 s7 p5";
const JUNK16 = "z1 z2 z3 z4 z5 z6 z7 s9 p1 p9 m9 z1 z2 z3 z4 z5";

/**
 * wallLen：牌牆總張數。wallFront：從牌頭摸的牌（drawTile 用）。wallBack：從牌尾補花用，
 * 陣列最後一個元素最先被補到（和 lib/mahjong/gameLogic.ts 的 handleFlowers 從牌尾 splice 一致）。
 * flowers：每家這手之前已經有的花（給七搶一／八仙過海的場景用）。
 */
function game(wallLen: number, opts: {
  turn: number; hands?: string[]; flowers?: Record<number, string>; wallFront?: string[]; wallBack?: string[];
}): MahjongGameState {
  const hands = opts.hands ?? [JUNK16, WIN16, JUNK16, JUNK16];
  const front = (opts.wallFront ?? []).map(t);
  const back = (opts.wallBack ?? []).map(t);
  const fillerLen = wallLen - front.length - back.length;
  if (fillerLen < 0) throw new Error("wallLen 太小，裝不下 wallFront／wallBack");
  const wall = [...front, ...tiles(Array(fillerLen).fill("s9").join(" ")), ...back];
  return {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles(hands[seat]), revealed: [] as Meld[],
      flowers: tiles(opts.flowers?.[seat] ?? ""), discards: [] as Tile[], isDealer: seat === 0,
    })),
    wall, currentTurn: opts.turn, hasDrawn: false, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 20,
    isFirstRound: false, isAfterKong: false, roundInfo: { dealerConsecutive: 0 }, roomSettings: { basePoints: 100, fanPoints: 20, totalRounds: 1 },
  } as unknown as MahjongGameState;
}

// ---------------------------------------------------------------------------
// ① 補花算槓上自摸
// ---------------------------------------------------------------------------

// U1：摸到花 f1，從牌尾補到 p5 → 單吊 p5 自摸，算槓上開花
{
  const s = drawTile(game(40, { turn: 1, wallFront: ["f1"], wallBack: ["p5"] }));
  eq([s.isAfterKong, s.players[1].flowers.map((f) => f.display), s.wall.length], [true, ["f1"], 38], "U1a 摸到花先標 isAfterKong=true、補 1 張、牌牆少 2 張");
  const w = declareWin(s, 1, true).winners![0];
  eq(names(w.score.fans).includes("槓上開花"), true, "U1b 補花補到的牌自摸：算槓上開花");
}

// U2：連續補花兩次（f1 → f2 → p5）才補到真牌，自摸一樣算槓上開花
{
  const s = drawTile(game(40, { turn: 1, wallFront: ["f1"], wallBack: ["p5", "f2"] }));
  eq([s.isAfterKong, s.players[1].flowers.map((f) => f.display).sort(), s.wall.length], [true, ["f1", "f2"], 37], "U2a 連續補花兩次：isAfterKong 仍是 true、兩張花都進花牌、牌牆少 3 張");
  const w = declareWin(s, 1, true).winners![0];
  eq(names(w.score.fans).includes("槓上開花"), true, "U2b 連續補花後的真牌自摸：一樣算槓上開花");
}

// U3：補花後沒胡、打出牌：isAfterKong 清掉
{
  const s = drawTile(game(40, { turn: 1, wallFront: ["f1"], wallBack: ["m9"] }));
  const drawn = s.players[1].hand.find((x) => x.display === "m9")!;
  const d = discardTile(s, drawn.id);
  eq([s.isAfterKong, d.isAfterKong], [true, false], "U3 補花沒胡、打出補到的那張：isAfterKong 從 true 清成 false");
}

// U4：打出的牌被碰：isAfterKong 仍是清掉的（碰完換人打牌，不會把舊的補花狀態帶進來）
{
  const hands = [JUNK16, WIN16, "m9 m9 m1 m3 m4 m6 m7 m8 s1 s3 s5 s9 z1 z2 z3 z6", JUNK16];
  const s = drawTile(game(40, { turn: 1, hands, wallFront: ["f1"], wallBack: ["m9"] }));
  const drawn = s.players[1].hand.find((x) => x.display === "m9")!;
  const d = discardTile(s, drawn.id);
  const pongTiles = d.players[2].hand.filter((x) => x.display === "m9");
  const n = executeAction(d, { type: "pong", playerSeat: 2, tiles: pongTiles });
  eq([d.isAfterKong, n.isAfterKong, n.currentTurn], [false, false, 2], "U4 補花打出的牌被碰：isAfterKong 本來就是 false，碰完也還是 false");
}

// U5：計分層直接驗不混用——isAfterKong=true 但不是自摸（放槍／搶槓）不算槓上開花
{
  const base: ScoringContext = {
    concealed: tiles(WIN16 + " p5"), revealed: [], winTile: tiles(WIN16 + " p5")[16], isSelfDraw: true, isDealer: false,
    seatWind: 2, prevalentWind: 1, flowers: [], isLastTile: false, isAfterKong: true, isRobbingKong: false, isFirstDraw: false, isTing: false,
  };
  const fanNames = (o: Partial<ScoringContext>) => names(calculateScore({ ...base, ...o }).fans);
  eq([fanNames({}).includes("槓上開花"), fanNames({ isSelfDraw: false }).includes("槓上開花"), fanNames({ isSelfDraw: false, isRobbingKong: true }).includes("槓上開花")],
    [true, false, false], "U5 isAfterKong=true 時：自摸才算槓上開花，放槍、搶槓（isSelfDraw=false）都不算");
}

// U6：暗槓補牌是花，再補到真牌，自摸也算槓上開花（既有行為，鎖住不回歸）
{
  // 座位 0：暗槓 z2×4（算 1 組），剩 13 張＝4 組順子＋單吊 p5，補到第 2 張 p5 就胡（照 WIN16 同樣的單吊結構，少 1 組換成暗槓）
  const KONG13 = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 p5";
  const s = game(40, { turn: 0, hands: ["z2 z2 z2 z2 " + KONG13, JUNK16, JUNK16, JUNK16], wallBack: ["p5", "f1"] });
  s.hasDrawn = true; s.drawnTileId = s.players[0].hand[0].id;
  const n = executeConcealedKong(s, s.players[0].hand.filter((x) => x.display === "z2"));
  eq([n.isAfterKong, n.players[0].flowers.map((f) => f.display)], [true, ["f1"]], "U6a 暗槓補到花：isAfterKong=true、花進花牌");
  const w = declareWin(n, 0, true).winners![0];
  eq(names(w.score.fans).includes("槓上開花"), true, "U6b 暗槓補花再補到真牌（p5 單吊）自摸：照樣算槓上開花");
}

// ---------------------------------------------------------------------------
// ② 最後一張是花
// ---------------------------------------------------------------------------

// W1：牌牆 17 張，摸最後一張（摸完剩 16）是花，沒湊成花胡：直接流局，不再補牌
{
  const s = drawTile(game(17, { turn: 1, wallFront: ["f1"] }));
  eq([s.status, s.wall.length, s.players[1].flowers.map((f) => f.display), s.players[1].hand.length, s.winners ?? null],
    ["finished", 16, ["f1"], 16, null], "W1 最後一張是花、沒湊成花胡：直接流局，牌牆停在 16，手牌少補到的那張");
}

// W2：連續補花途中撞到底牌邊界（18 張起算），最後一張沒湊成花胡：流局，牌牆停在 16
{
  const s = drawTile(game(18, { turn: 1, wallFront: ["f1"], wallBack: ["f2"] }));
  eq([s.status, s.wall.length, s.players[1].flowers.map((f) => f.display).sort(), s.winners ?? null],
    ["finished", 16, ["f1", "f2"], null], "W2 連續補花中撞到底牌：第二張花補不到牌，直接流局，牌牆停在 16（不會到 15）");
}

// W3：最後一張是花、剛好湊成八仙過海：照常結束，不受流局規則影響
{
  const s = drawTile(game(17, { turn: 1, flowers: { 1: "f1 f2 f3 f4 f5 f6 f7" }, wallFront: ["f8"] }));
  eq([s.status, s.wall.length, s.players[1].flowers.length, names(s.winners![0].score.fans).includes("八仙過海")],
    ["finished", 16, 8, true], "W3 最後一張是花、湊成八仙過海（7→8）：照常八仙過海，牌牆也停在 16（本來就不用補牌）");
}

// W4：最後一張是花、剛好湊成七搶一：照常結束
{
  const s = drawTile(game(17, { turn: 1, flowers: { 1: "f1 f2 f3 f4 f5 f6", 2: "f7" }, wallFront: ["f8"] }));
  eq([s.status, s.wall.length, s.players[1].flowers.length, s.players[2].flowers.length, names(s.winners![0].score.fans).includes("七搶一")],
    ["finished", 16, 8, 0, true], "W4 最後一張是花、湊成七搶一（座位 1 第 7 張、座位 2 原有 1 張）：照常七搶一，座位 2 的那張花轉給座位 1（共 8 張）");
}

// W5：暗槓補牌補到最後一張是花，沒湊成花胡：直接流局，牌牆停在 16
{
  const s = game(17, { turn: 0, wallBack: ["f1"] });
  s.players[0].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5 p5 p5 p5");
  s.hasDrawn = true; s.drawnTileId = s.players[0].hand[0].id;
  const n = executeConcealedKong(s, s.players[0].hand.filter((x) => x.display === "p5"));
  eq([n.status, n.wall.length, n.players[0].flowers.map((f) => f.display), n.winners ?? null],
    ["finished", 16, ["f1"], null], "W5 暗槓補牌補到最後一張是花、沒湊成花胡：直接流局，牌牆停在 16");
}

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n通過 ${results.length - bad}、失敗 ${bad}`);
if (bad) process.exit(1);
