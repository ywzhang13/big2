// 沒有等待窗口時送「過」：一律 409、狀態不變；打牌後窗口的「過」照常
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 30000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
function setup(mut?: (s: MahjongGameState) => void) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 5,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  mut?.(s);
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const snap = () => JSON.stringify(rooms.R.game_state);
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// P1 剛摸完牌（可自摸、可暗槓）送過
{
  setup((s) => {
    s.hasDrawn = true;
    s.players[1].hand = tiles("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6 s7"); // 可自摸
    s.drawnTileId = s.players[1].hand[16].id;
  });
  const before = snap();
  const r = await call(action, { playerId: "p1", actionType: "pass" });
  eq([r.status, r.body.error, snap() === before, sent.length], [409, "輪到你，請打出一張牌", true, 0], "P1 輪到自己、剛摸完牌送過：409，狀態完全不變、沒有廣播");
  const d = await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "s7")!.id });
  eq([d.status, st().players[1].discards.length], [200, 1], "P1b 之後這家照樣要打出一張牌");
}
// P2 輪到自己、還沒摸牌送過
{
  setup();
  const before = snap();
  const r = await call(action, { playerId: "p1", actionType: "pass" });
  eq([r.status, snap() === before], [409, true], "P2 輪到自己、還沒摸牌送過：409，不會跳過摸牌");
}
// P3 不是自己回合、也沒有窗口時送過（例如窗口關了才到的過）
{
  setup((s) => { s.currentTurn = 2; s.hasDrawn = true; s.drawnTileId = s.players[2].hand[0].id; });
  const before = snap();
  const r = await call(action, { playerId: "p3", actionType: "pass" });
  eq([r.status, r.body.error, snap() === before], [409, "現在沒有可以過的牌", true], "P3 沒有窗口時別人送過：409，不會跳過輪到的 seat2");
}
// P4 打牌後的窗口：「過」照常，全部過完輪到下一家
{
  setup((s) => {
    s.currentTurn = 0;
    s.players[2].hand = tiles("s7 s7 m1 m3 m4 m6 m8 m9 p1 p3 p5 z1 z2 z3 z5 z6");
    s.lastDiscard = { tile: t("s7"), from: 0 };
    s.pendingActions = { discardFrom: 0, potentialActors: [2], passedActors: [] };
  });
  const r = await call(action, { playerId: "p2", actionType: "pass" });
  eq([r.status, st().pendingActions ?? null, st().currentTurn, st().hasDrawn], [200, null, 1, false], "P4 打牌後窗口按過：200，輪到下一家 seat1 摸牌");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
