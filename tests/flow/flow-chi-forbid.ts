// 食替（老闆 2026-10-21）的 API：吃 → 牌局狀態／mj_hand_update／吃的回應帶 chiForbidden（只給本人）→ 打禁打的牌 400 chi_forbidden、狀態不變
//   A1 吃的回應、mj_hand_update（座位頻道，只給吃的人）帶 chiForbidden ["s5","s8"]
//   A2 牌局狀態：吃的人 chiForbidden ["s5","s8"]；別家是空陣列
//   A3 打八條：400、reason chi_forbidden，狀態完全不變、沒有廣播；打別的牌 200
//   A4 打完之後 chiForbidden 回到空陣列
//   A5 吃完沒有能打的牌的吃法：不在選項裡；硬送 400 chi_not_allowed、狀態不變
//   A6 碰：回應和狀態的 chiForbidden 都是空陣列
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 41000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const OTHER = "m1 m1 m4 m4 p2 p2 p7 p7 s2 s2 z5 z5 z6 z6 z7 z7";
/** 座位 0 剛打出 disc；座位 1（下家）手上是 hand，可以吃 */
function setup(hand: string, disc: string, revealed: Meld[] = []) {
  const d = t(disc);
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === 1 ? hand : OTHER), revealed: seat === 1 ? revealed : [] as Meld[], flowers: [] as Tile[],
      discards: seat === 0 ? [d] : [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: 0, lastDiscard: { tile: d, from: 0 }, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 5,
    pendingActions: { discardFrom: 0, potentialActors: [1], passedActors: [] },
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
async function state(pid: string) {
  const r = await stateGet(new Request(`http://x/api/mahjong/state?roomId=R&playerId=${pid}`, { headers: asSeat({ playerId: pid }) }));
  return (await r.json()).gameState; // 回應是 { roomId, code, gameState }
}
const st = () => rooms.R.game_state as MahjongGameState;
const snap = () => JSON.stringify(rooms.R.game_state);
const idOf = (seat: number, k: string) => st().players[seat].hand.find((x) => x.display === k)!.id;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// A1～A4：手上五六七八條＋雜牌，用六七條吃五條
{
  setup("s5 s6 s7 s8 m3 m5 m7 p1 p3 p5 z1 z2 z3 z4 z5 z6", "s5");
  const r = await call(action, { playerId: "p1", actionType: "chi", tiles: [idOf(1, "s6"), idOf(1, "s7")] });
  const hu = sent.find((e) => e.event === "mj_hand_update");
  eq([r.status, r.body.chiForbidden, hu?.payload.chiForbidden, hu?.payload.playerId, hu?.channel?.includes("-p-") ?? null], [200, ["s5", "s8"], ["s5", "s8"], "p1", true],
    "A1 六七條吃五條：吃的回應、mj_hand_update（只送吃的人的座位頻道）都帶 chiForbidden [s5, s8]");
  const mine = await state("p1"), other = await state("p2");
  eq([mine.chiForbidden, other.chiForbidden], [["s5", "s8"], []], "A2 牌局狀態：吃的人看到 chiForbidden [s5, s8]，別家是空陣列（看不到別人的）");
  for (const k of ["s8", "s5"]) {
    const before = snap(); sent.length = 0;
    const d = await call(discard, { playerId: "p1", tileId: idOf(1, k) });
    eq([d.status, d.body.reason, snap() === before, sent.length], [400, "chi_forbidden", true, 0], `A3 打${k === "s8" ? "八" : "五"}條：400 chi_forbidden，狀態完全不變、沒有廣播`);
  }
  const ok = await call(discard, { playerId: "p1", tileId: idOf(1, "z1") });
  eq([ok.status, (await state("p1")).chiForbidden, st().chiForbid ?? null], [200, [], null], "A4 打出東風：200；打完 chiForbidden 回到空陣列");
}
// A5：吃完只剩禁打的牌
{
  const melds: Meld[] = [0, 1, 2].map(() => ({ type: "pong", tiles: tiles("z1 z1 z1"), from: 2 }));
  setup("s6 s7 s8 s8", "s5", melds);
  const before = snap();
  const r = await call(action, { playerId: "p1", actionType: "chi", tiles: [idOf(1, "s6"), idOf(1, "s7")] });
  const offered = ((await state("p1")).myAvailableActions ?? []).map((a: { type: string }) => a.type);
  eq([r.status, r.body.reason, snap() === before, offered.includes("chi")], [400, "chi_not_allowed", true, false],
    "A5 六七條吃五條後只剩兩張八條：選項裡沒有吃；硬送 400 chi_not_allowed，狀態不變");
}
// A6：碰
{
  setup("s5 s5 s6 s7 s8 m3 m5 m7 p1 p3 p5 z1 z2 z3 z4 z5", "s5");
  const r = await call(action, { playerId: "p1", actionType: "pong", tiles: [st().players[1].hand[0].id, st().players[1].hand[1].id] });
  eq([r.status, r.body.chiForbidden, (await state("p1")).chiForbidden, (await call(discard, { playerId: "p1", tileId: idOf(1, "s8") })).status], [200, [], [], 200],
    "A6 碰五條：chiForbidden 都是空陣列，八條照打");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
