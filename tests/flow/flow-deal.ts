// ① 開局補花就八仙過海／七搶一：走真的 start、next-game、action、discard 路由，確認不會卡住
import { POST as start } from "../../app/api/mahjong/start/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { force } from "../support/forced-deal";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import { asSeat } from "../support/stub-auth";
import { seatRng } from "../../lib/mahjong/gameLogic";
seatRng.next = () => 0.999999; // 這支測試照入座順序寫：開局不打亂座位（打亂另見 flow-seats-wall）

async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const evs = () => sent.map((e) => e.event);
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
function lobby() {
  rooms.R = { id: "R", code: "T", status: "waiting", host_id: "p0",
    game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
  sent.length = 0;
}
const gameStartEvents = ["mj_game_start", "mj_deal_hand", "mj_deal_hand", "mj_deal_hand", "mj_deal_hand"];

// start：開局八仙
{
  lobby();
  force.flowers = { 2: [1, 2, 3, 4, 5, 6, 7, 8] };
  const r = await call(start, { playerId: "p0" });
  const s = st(); const dealer = s.dealerSeat;
  // 莊家胡：三家各付 100+(8+1)×20=280；閒家胡：莊家付 280、閒家付 260
  const expected = dealer === 2 ? [-280, -280, 840, -280] : [0, 1, 2, 3].map((i) => (i === 2 ? 800 : i === dealer ? -280 : -260));
  eq([r.status, s.status, rooms.R.status, s.winners?.[0].seat, s.winners?.[0].score.fans[0].name, evs()],
    [200, "finished", "finished", 2, "八仙過海", [...gameStartEvents, "mj_game_over"]],
    "①a 開房開局 seat2 就 8 張花：照常送開局事件，接著 mj_game_over；房間狀態 finished");
  eq(s.settlement?.deltas, expected, `①b 開局八仙的付款（這次莊家是 seat${dealer}）`);
  // 下一局不會卡住
  force.flowers = null; sent.length = 0;
  for (const k of [0, 1, 2, 3]) await call(nextGame, { playerId: "p" + k });
  eq([st().status, rooms.R.status, evs().filter((e) => e === "mj_game_start").length], ["playing", "playing", 1], "①c 開局八仙之後四家同意：正常開下一局");
}

// next-game：開局七搶一，不搶
function finishedRoom() {
  rooms.R.game_state.status = "finished"; rooms.R.status = "finished";
  rooms.R.game_state.winners = [{ seat: 0, score: { fans: [], totalFan: 1 } }]; rooms.R.game_state.winner = rooms.R.game_state.winners[0];
  rooms.R.game_state.nextGameReady = [];
  rooms.R.game_state.dealerSeat = 0; // 上一局莊家 seat0 胡 → 連莊，下一局莊家固定 seat0
  sent.length = 0;
}
{
  finishedRoom();
  force.flowers = { 3: [1, 2, 3, 4, 5, 6, 7], 1: [8] };
  for (const k of [0, 1, 2, 3]) await call(nextGame, { playerId: "p" + k });
  const s = st(); const dealer = s.dealerSeat;
  const av = sent.find((e) => e.event === "mj_available_actions");
  eq([s.status, s.pendingFlowerRob?.robberSeat, s.pendingFlowerRob?.fromSeat, evs().slice(-7), av?.payload.robFlower, av?.payload.playerId],
    ["playing", 3, 1, ["mj_game_start", ...gameStartEvents.slice(1), "mj_flower_rob_pending", "mj_available_actions"], true, "p3"],
    "①d 下一局開局 seat3 有 7 張、seat1 有第 8 張：照常開局，接著送 mj_flower_rob_pending＋給 seat3 的七搶一選項");
  const dealerTile = s.players[dealer].hand[0].id;
  eq((await call(discard, { playerId: "p" + dealer, tileId: dealerTile })).status, 409, "①e 等待中莊家不能先打牌");
  sent.length = 0;
  const p = await call(action, { playerId: "p3", actionType: "pass" });
  const pass = sent.find((e) => e.event === "mj_pass")!.payload;
  const dt = sent.find((e) => e.event === "mj_draw_tile")!.payload;
  eq([p.status, st().pendingFlowerRob ?? null, pass.currentTurn, dt.playerId], [200, null, dealer, "p" + dealer],
    "①f seat3 不搶：等待清掉，mj_pass 的 currentTurn 是莊家，重送莊家的 mj_draw_tile（天胡／暗槓選項）");
  eq((await call(discard, { playerId: "p" + dealer, tileId: dealerTile })).status, 200, "①g 之後莊家正常打出第一張");
}
// next-game：開局七搶一，搶
{
  finishedRoom();
  force.flowers = { 3: [1, 2, 3, 4, 5, 6, 7], 1: [8] };
  for (const k of [0, 1, 2, 3]) await call(nextGame, { playerId: "p" + k });
  sent.length = 0;
  const w = await call(action, { playerId: "p3", actionType: "win" });
  const s = st();
  eq([w.status, s.status, rooms.R.status, s.winners?.[0].seat, s.winners?.[0].score.fans[0].name, s.players[1].flowers.length, s.players[3].flowers.length, evs()],
    [200, "finished", "finished", 3, "七搶一", 0, 8, ["mj_game_over"]], "①h 開局七搶一搶了：seat3 胡，這局結束");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
