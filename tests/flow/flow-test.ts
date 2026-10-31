// 透過真的 route handler（DB／廣播換成記憶體 stub）走完加槓與搶槓流程，確認不會卡住
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 5000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const W_MID = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z1 z1 p4 p6";
const W_TWO = "m1 m2 m3 m4 m5 m6 s4 s5 s6 s7 s8 s9 z4 z4 p3 p4";
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 z2 z3";
const NOT_WAIT_PONG = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 p3 p4";

function setup(others: Record<number, string>) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(others[seat] ?? NOT_WAIT), revealed: [] as Meld[], flowers: [], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")),
    currentTurn: 2, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 8,
    hasDrawn: true, drawnTileId: 1, isFirstRound: false, isAfterKong: false, // 剛摸過牌（加槓要有 drawnTileId）
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[2].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5") }];
  s.players[2].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5");
  rooms.R = { id: "R", code: "T", game_state: s };
  sent.length = 0;
  return s.players[2].hand.find((x) => x.display === "p5")!.id;
}
const req = (body: object) => new Request("http://x", { method: "POST", headers: asSeat(body), body: JSON.stringify(body) });
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(req({ roomId: "R", ...body }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const evs = () => sent.map((e) => e.event);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// F1 沒人能搶
{
  const id = setup({});
  const r = await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  eq([r.status, r.body.robWindow, st().players[2].revealed[0].type, evs()], [200, false, "kong", ["mj_add_kong", "mj_draw", "mj_draw_tile"]], "F1a 沒人能搶：API 直接完成加槓，廣播 加槓＋補牌");
  const d = await call(discard, { playerId: "p2", tileId: st().players[2].hand.find((x) => x.display === "z6")!.id });
  eq([d.status, st().currentTurn], [200, 3], "F1b 加槓後可以正常打牌，輪到下一家");
}
// F2 一家能搶、pass
{
  const id = setup({ 1: W_MID, 3: NOT_WAIT_PONG });
  const r = await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  eq([r.status, r.body.robWindow, evs()], [200, true, ["mj_add_kong_pending", "mj_hand_update", "mj_available_actions"]], "F2a 有人能搶：開窗口，只私訊能胡的人");
  eq({ ...sent.find((e) => e.event === "mj_available_actions")!.payload, sv: undefined }, { playerId: "p1", actions: [{ type: "win", playerSeat: 1 }], robKong: true }, "F2b 給 seat1 的提示是 win＋robKong");
  eq((await call(discard, { playerId: "p2", tileId: st().players[2].hand[0].id })).status, 409, "F2c 窗口中加槓者不能打牌");
  eq((await call(action, { playerId: "p2", actionType: "pass" })).status, 409, "F2d 窗口中加槓者不能 pass");
  eq((await call(action, { playerId: "p3", actionType: "chi", tiles: st().players[3].hand.filter((x) => x.suit === "p").map((x) => x.id) })).status, 409, "F2e 窗口中別人不能吃這張");
  eq((await call(draw, { playerId: "p3" })).status, 400, "F2f 窗口中別人不能摸牌");
  sent.length = 0;
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq([p.status, st().pendingAddKong ?? null, st().pendingActions ?? null, st().players[2].revealed[0].type, st().currentTurn, evs()],
    [200, null, null, "kong", 2, ["mj_pass", "mj_add_kong", "mj_draw", "mj_draw_tile"]], "F2g seat1 pass：完成加槓、補牌，輪到加槓者");
  const d = await call(discard, { playerId: "p2", tileId: st().players[2].hand.find((x) => x.display === "z6")!.id });
  eq([d.status, st().currentTurn], [200, 3], "F2h 之後可以正常打牌");
}
// F3 一家能搶、胡
{
  const id = setup({ 1: W_MID });
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status, st().settlement?.deltas, st().pendingAddKong ?? null, st().winners?.[0].score.fans.map((f) => f.name)],
    [200, "finished", [0, 160, -160, 0], null, ["門清", "獨聽", "搶槓胡"]], "F3 seat1 搶槓胡：結束，加槓者付 160");
}
// F4 兩家能搶：一家胡、一家 pass
{
  const id = setup({ 1: W_MID, 3: W_TWO });
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.body.partial, st().status], [true, "playing"], "F4a seat1 先胡：等 seat3 決定");
  const p = await call(action, { playerId: "p3", actionType: "pass" });
  eq([p.body.finalized, st().status, st().settlement?.deltas], [true, "finished", [0, 160, -160, 0]], "F4b seat3 pass：只有 seat1 胡，結束");
}
// F5 兩家能搶：都胡（雙響只算下家 seat3）
{
  const id = setup({ 1: W_MID, 3: W_TWO });
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  await call(action, { playerId: "p1", actionType: "win" });
  await call(action, { playerId: "p3", actionType: "win" });
  eq([st().status, st().winners?.map((w) => w.seat), st().settlement?.deltas], ["finished", [3], [0, 0, -140, 140]], "F5 兩家都胡：雙響只算 seat3，加槓者付 140");
}
// F6 兩家能搶：都 pass
{
  const id = setup({ 1: W_MID, 3: W_TWO });
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [id] });
  await call(action, { playerId: "p3", actionType: "pass" });
  eq([st().pendingAddKong?.seat, st().players[2].revealed[0].type], [2, "pong"], "F6a 一家 pass：還在等另一家");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq([st().pendingAddKong ?? null, st().players[2].revealed[0].type, st().currentTurn, st().hasDrawn], [null, "kong", 2, true], "F6b 兩家都 pass：完成加槓，輪到加槓者打牌");
}
// F7 摸牌時回傳 addKongOptions
{
  setup({});
  const s = st(); s.currentTurn = 2; s.hasDrawn = false;
  s.players[2].hand = s.players[2].hand.filter((x) => x.display !== "p5");
  s.wall.unshift(t("p5"));
  rooms.R.game_state = s; sent.length = 0;
  const r = await call(draw, { playerId: "p2" });
  const priv = sent.find((e) => e.event === "mj_draw_tile")!.payload;
  eq([r.status, (r.body.addKongOptions as number[]).length, (priv.addKongOptions as number[]).length], [200, 1, 1], "F7 摸到第 4 張 5 筒：draw 回應和 mj_draw_tile 都帶 addKongOptions");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
