// 嚦咕嚦咕（老闆 2026-10-29）的牌局流程：眼牌自動胡（自摸、別人打的）、手動胡；聽牌剩幾隻在眼牌前後的差別（眼牌前不能用到別人手牌）
// setup／call／playFrom 照 flow-eye.ts
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import { discardTingOptions, waitsLeft } from "../../lib/mahjong/tingInfo";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 80000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
/** firstRound=false：大家都打過牌（宣告眼牌不算地聽） */
function setup(firstRound = false) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: firstRound ? 0 : 8, hasDrawn: false, isFirstRound: firstRound, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  if (!firstRound) for (const p of s.players) p.discards = tiles("z7");
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
/** 輪到 seat 摸牌，牌牆第一張換成 key */
function turn(seat: number, key: string) {
  const s = st();
  s.currentTurn = seat; s.hasDrawn = false; s.lastDiscard = null; s.pendingActions = undefined; s.drawnTileId = undefined;
  s.wall[0] = t(key);
  sent.length = 0;
}
/** seat 拿 hand16＋extra（剛摸進）後打出 extra；eye=true 時同時宣告眼牌 */
async function playFrom(seat: number, hand16: string, extra: string, eye: boolean) {
  const s = st();
  s.players[seat].hand = tiles(hand16 + " " + extra);
  const tile = s.players[seat].hand[16];
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id, ...(eye ? { declareEye: true } : {}) });
}
/** seat 摸進 key 後馬上打出它（模擬別家打出這張） */
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const fanNames = (seat: number) => st().winners?.find((w) => w.seat === seat)?.score.fans.map((f) => f.name) ?? [];
const handIds = (seat: number) => st().players[seat].hand.map((x) => x.id);
/** 文字裡出現了哪些別人的手牌 id（「"id":12345」） */
const leakedIds = (text: string, seats: number[]) => seats.flatMap((x) => handIds(x)).filter((id) => text.includes(`"id":${id},`));


// ---- 嚦咕嚦咕：眼牌後自動自摸、自動胡別人打的、一般人手動胡 ----
const LG16 = "m1 m1 m5 m5 p3 p3 p7 p7 s2 s2 z2 z2 s9 s9 s9 p9"; // 聽 p9
{
  setup();
  await playFrom(1, LG16, "z6", true);
  turn(1, "p9");
  await call(draw, { playerId: "p1" });
  eq([st().status, st().winners?.[0]?.seat, st().winners?.[0]?.from ?? null, fanNames(1).includes("嚦咕嚦咕")], ["finished", 1, null, true], "G1 眼牌後摸到 p9：伺服器自動自摸嚦咕嚦咕");
}
{
  setup();
  await playFrom(1, LG16, "z6", true);
  await giveAndDiscard(2, "p9");
  eq([st().status, st().winners?.[0]?.seat, st().winners?.[0]?.from, fanNames(1).includes("嚦咕嚦咕")], ["finished", 1, 2, true], "G2 眼牌後別家打出 p9：自動胡嚦咕嚦咕（胡別人的牌也算）");
}
{
  setup();
  st().players[1].hand = tiles(LG16);
  await giveAndDiscard(0, "p9");
  const opts = sent.find((e) => e.event === "mj_available_actions" && JSON.stringify(e.payload).includes('"win"'));
  const r = await call(action, { playerId: "p1", actionType: "win" });
  eq([!!opts, r.status, st().winners?.[0]?.seat, fanNames(1).includes("嚦咕嚦咕")], [true, 200, 1, true], "G3 沒眼牌：上家打出 p9 有胡的選項，按胡成立嚦咕嚦咕");
}
// ---- 聽牌剩幾隻：眼牌前只用自己看得到的牌，眼牌後才扣別家手牌 ----
{
  setup();
  for (const x of [0, 2, 3]) st().players[x].hand = tiles("p9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9 m9"); // 別家手上各藏一張 p9
  st().players[1].hand = tiles(LG16 + " z6");
  st().currentTurn = 1; st().hasDrawn = true; st().drawnTileId = st().players[1].hand[16].id;
  const before = toPlayerGameState(st(), "p1");
  const optZ6 = discardTingOptions(before, 1).find((o) => o.discard === "z6");
  eq([optZ6?.waits, "opponentHands" in before, leakedIds(JSON.stringify(before), [0, 2, 3])], [[{ key: "p9", left: 3 }], false, []],
    "G4 眼牌前：打出 z6 聽 p9 剩 3 隻（只扣自己那張）；state 沒有 opponentHands、沒有別人手牌 id，三家藏的 p9 沒被扣");
  await call(discard, { playerId: "p1", tileId: st().drawnTileId, declareEye: true });
  const after = toPlayerGameState(st(), "p1");
  eq([waitsLeft(after, 1), "opponentHands" in toPlayerGameState(st(), "p2")], [[{ key: "p9", left: 0 }], false], "G5 眼牌後：扣掉三家手上的 p9，剩 0 隻；別家（沒眼牌）照樣拿不到 opponentHands");
}
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
