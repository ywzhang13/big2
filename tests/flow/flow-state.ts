// ⑥ /api/mahjong/state 用的 toPlayerGameState：摸牌後重新整理要拿回自摸胡／暗槓／加槓（不連資料庫）
import { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";
import { drawTile, executeAction } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
let id = 40000;
const t = (k: string): Tile => ({ id: id++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
function base(): MahjongGameState {
  return {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false,
  } as MahjongGameState;
}
const out: string[] = [];
const eq = (a: unknown, e: unknown, m: string) => out.push(`${JSON.stringify(a) === JSON.stringify(e) ? "✅" : "❌"} ${m}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
// 眼牌的出牌選項（declare_eye）不是按鈕，這裡只看按鈕
const types = (v: { myAvailableActions?: { type: string; tiles?: Tile[] }[] }) =>
  (v.myAvailableActions ?? []).filter((a) => a.type !== "declare_eye").map((a) => a.type + (a.tiles ? ":" + a.tiles.map((x) => x.display).join(",") : ""));

// 摸到 7 筒：可自摸、手上 5 筒可加槓
let s = base();
s.players[1].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5") }];
s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 z2 z2 z2 p5 p6 z6 z6");
s.wall[0] = t("p7");
s = drawTile(s);
const me = toPlayerGameState(s, "p1");
eq([types(me), me.myDrawnTileId === s.players[1].hand[s.players[1].hand.length - 1].id], [["win", "add_kong:p5"], true],
  "⑥a 摸牌後重新整理：myAvailableActions 有 win、add_kong（帶那張 5 筒），myDrawnTileId 是剛摸的牌");
eq([toPlayerGameState(s, "p2").myAvailableActions ?? null, toPlayerGameState(s, "p2").myDrawnTileId ?? null], [null, null], "⑥b 其他玩家：沒有動作、拿不到 myDrawnTileId");
eq("drawnTileId" in toPublicGameState(s), false, "⑥c 公開狀態不含 drawnTileId（不洩漏摸到哪張）");

// 暗槓
let k = base();
k.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 z6 z6");
k.wall[0] = t("p5");
k = drawTile(k);
eq(types(toPlayerGameState(k, "p1")), ["kong:p5,p5,p5,p5"], "⑥d 摸到第 4 張：重新整理後有暗槓");

// 碰完要打牌：不給自摸／槓
let p = base();
p.currentTurn = 0;
p.players[2].hand = tiles("p5 p5 m1 m2 m3 s1 s2 s3 z2 z2 z2 z6 z6 p6 p7 m9");
p.lastDiscard = { tile: t("p5"), from: 0 };
p = executeAction(p, { type: "pong", playerSeat: 2, tiles: p.players[2].hand.filter((x) => x.display === "p5") });
eq([types(toPlayerGameState(p, "p2")), toPlayerGameState(p, "p2").myAvailableActions?.map((a) => a.type)], [[], ["declare_eye"]],
  "⑥e 碰完輪到自己打牌：不會出現自摸／槓按鈕（只有眼牌的出牌選項）");

// 七搶一：2026-10-22 起摸到就立刻成立，不會再進入等待
let f = base();
f.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
f.wall[0] = t("f8");
f = drawTile(f);
eq([f.status, f.pendingFlowerRob ?? null, toPlayerGameState(f, "p3").pendingFlowerRob ?? null], ["finished", null, null], "⑥f 七搶一立刻成立：狀態直接 finished，沒有 pendingFlowerRob");
// 上線那一刻還在舊版「七搶一等待中」的牌局：重新整理照樣恢復 win（舊流程留著收尾）
const legacy = base();
legacy.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
legacy.players[1].flowers = tiles("f8");
legacy.pendingFlowerRob = { robberSeat: 3, fromSeat: 1, tile: legacy.players[1].flowers[0] };
eq([types(toPlayerGameState(legacy, "p3")), toPlayerGameState(legacy, "p1").myAvailableActions ?? null],
  [["win"], null], "⑥f' 上線前就在等待中的舊牌局：seat3 重新整理拿回 win，摸牌的人沒有動作");
console.log(out.join("\n"));
if (out.some((l) => l.startsWith("❌"))) process.exit(1);
