// 2026-10-19 老闆反映「上家打的牌自己還是可以槓」：
// 上家打的牌不能明槓（3ddf20d），但吃、碰完還沒摸牌時，伺服器只看 hasDrawn（吃碰後也是 true），
// 所以硬送加槓（把剛碰的那組升成槓）或暗槓會被接受，等於繞過「上家的牌不能槓」。
// 規則：加槓、暗槓只能在自己剛摸進（或補進）一張牌之後（drawnTileId 有值），和畫面給按鈕的條件（ownTurnActions）一致。
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { executeConcealedKong, ownTurnActions, startAddKong } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 98000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const OTHER = "p1 p3 p5 p7 p9 s1 s3 s5 s7 s9 z1 z2 z3 z4 z5 z6";
function setup(meHand: string) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(OTHER), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("s8").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[1].hand = tiles(meHand);
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state as MahjongGameState;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const handIds = (seat: number, key: string, n = 9) => st().players[seat].hand.filter((x) => x.display === key).slice(0, n).map((x) => x.id);
const melds = () => st().players[1].revealed.map((m) => m.type + ":" + m.tiles.map((x) => x.display).join(""));
const throwsMsg = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return (e as Error).message; } };

// ===== 上家（座位 0）打五筒，我（座位 1）手上三張：只能碰；碰完不能馬上加槓 =====
{
  setup("p5 p5 p5 z7 z7 m5 m7 m9 p2 p4 s2 s4 s6 s8 z1 z2");
  await giveAndDiscard(0, "p5");
  const opts = (st().pendingActions?.potentialActors ?? []).includes(1);
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "p5", 3) });
  eq([opts, k.status, k.body.error], [true, 400, "上家打的牌不能明槓，可以碰"], "A1 上家打五筒：明槓 400（3ddf20d 照常）");
  const p = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "p5", 2) });
  eq([p.status, melds()], [200, ["pong:p5p5p5"]], "A2 改碰：成功，手上還留一張五筒");
  eq(ownTurnActions(st(), 1).map((a) => a.type), [], "A3 碰完還沒摸牌：畫面不給加槓按鈕");
  const ak = await call(action, { playerId: "p1", actionType: "add_kong", tiles: handIds(1, "p5", 1) });
  eq([ak.status, ak.body.error, melds(), st().wall.length], [400, "吃碰後要先打牌，摸牌後才能槓", ["pong:p5p5p5"], 40], "A4 碰完馬上硬送加槓五筒：400，那組碰沒有變成槓、沒有補牌");
  const s = st();
  eq(throwsMsg(() => startAddKong(s, s.players[1].hand.find((x) => x.display === "p5")!)), "現在不能加槓", "A5 startAddKong 也擋下");
}

// ===== 碰完還沒摸牌：手上原有的四張也不能暗槓 =====
{
  setup("z7 z7 z1 z1 z1 z1 m5 m7 m9 p2 p4 s2 s4 s6 s8 z2");
  await giveAndDiscard(0, "z7");
  await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "z7", 2) });
  const ck = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "z1", 4) });
  eq([ck.status, ck.body.error, melds(), st().wall.length], [400, "吃碰後要先打牌，摸牌後才能槓", ["pong:z7z7z7"], 40], "B1 碰完馬上硬送暗槓：400，沒有暗槓、沒有補牌");
  const s = st();
  eq(throwsMsg(() => executeConcealedKong(s, s.players[1].hand.filter((x) => x.display === "z1"))), "現在不能暗槓", "B2 executeConcealedKong 也擋下");
  // 打出一張、輪一圈後自己摸牌：照常可以暗槓
  await call(discard, { playerId: "p1", tileId: handIds(1, "z2", 1)[0] });
  const s2 = st();
  s2.currentTurn = 1; s2.hasDrawn = false; s2.lastDiscard = null; s2.pendingActions = undefined; s2.drawnTileId = undefined;
  s2.wall[0] = t("m1");
  const d = await call(draw, { playerId: "p1" });
  const ck2 = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "z1", 4) });
  eq([d.status, ck2.status, melds()], [200, 200, ["pong:z7z7z7", "concealed_kong:z1z1z1z1"]], "B3 自己摸牌後：暗槓照常可以");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
