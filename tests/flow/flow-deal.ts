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

// next-game：開局七搶一（2026-10-22 改：立刻成立，不再詢問）
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
  const s = st();
  eq([s.status, rooms.R.status, s.pendingFlowerRob ?? null, s.winners?.[0].seat, s.winners?.[0].from, s.winners?.[0].score.fans.map((f) => f.name), s.players[1].flowers.length, s.players[3].flowers.length,
    evs().includes("mj_flower_rob_pending"), evs().at(-1), s.settlement?.deltas],
    ["finished", "finished", null, 3, 1, ["七搶一"], 0, 8, false, "mj_game_over", [0, -260, 0, 260]],
    "①d 下一局開局 seat3 有 7 張、seat1 有 1 張：立刻七搶一、這局結束（沒有等待、沒有 mj_flower_rob_pending）；只有 seat1 付 260");
  const w = await call(action, { playerId: "p3", actionType: "win" });
  eq(w.status !== 200, true, "①e 結束後 seat3 再送 win：不會重複胡");
  force.flowers = null; sent.length = 0;
  for (const k of [0, 1, 2, 3]) await call(nextGame, { playerId: "p" + k });
  eq([st().status, rooms.R.status], ["playing", "playing"], "①f 開局七搶一之後四家同意：正常開下一局，不會卡住");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
