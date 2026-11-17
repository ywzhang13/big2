// 碰牌後這一輪不能打同種牌（老闆 2026-11-18 BUG：碰八筒完當下不能打八筒，比照吃牌）的 API：
//   B1 碰的回應、mj_hand_update（只送碰的人的座位頻道）帶 chiForbidden ["p8"]、chiForbiddenBy "pong"
//   B2 牌局狀態：碰的人 chiForbidden ["p8"]、chiForbiddenBy "pong"；別家空陣列、null
//   B3 打八筒：400、訊息「剛碰的牌，這輪不能打」、reason pong_forbidden，狀態完全不變、沒有廣播
//   B4 打別的牌 200；打完限制清掉
//   B5 下一輪（自己摸牌後）八筒照打 200
//   B6 觀戰看到的狀態：有被觀戰者的手牌，但沒有 chiForbid／chiForbidden（限制只給本人）；公開狀態也沒有
//   B7 回放：被擋下的那一次不留紀錄；回放事件依序是碰、打出東風、摸牌、打出八筒
//   B8 吃牌照舊：回應 chiForbiddenBy "chi"，打禁打的牌照舊 reason chi_forbidden、訊息不變
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPublicGameState, toSpectatorGameState } from "../../lib/mahjong/db";
import { stepReplay } from "../../lib/mahjong/replay/log";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 0;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const OTHER = "m1 m1 m4 m4 p2 p2 p7 p7 s2 s2 z5 z5 z6 z6 z7 z7";
/** 座位 from 剛打出 disc；座位 1 手上是 hand */
function setup(hand: string, disc: string, from: number) {
  nextId = 0;
  const d = t(disc);
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === 1 ? hand : OTHER), revealed: [], flowers: [] as Tile[],
      discards: seat === from ? [d] : [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: from, lastDiscard: { tile: d, from }, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 5,
    pendingActions: { discardFrom: from, potentialActors: [1], passedActors: [] },
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 }, startedAt: new Date().toISOString(),
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  // 回放：這個測試的牌局是打到一半造出來的，回放只從「剛發完牌」開始記——先把打出的那張拿掉讓它開始記，再放回去
  const seaFloor = s.players[from].discards; s.players[from].discards = [];
  stepReplay(s);
  s.players[from].discards = seaFloor;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
async function state(pid: string) {
  const r = await stateGet(new Request(`http://x/api/mahjong/state?roomId=R&playerId=${pid}`, { headers: asSeat({ playerId: pid }) }));
  return (await r.json()).gameState;
}
const st = () => rooms.R.game_state as MahjongGameState;
const snap = () => JSON.stringify(rooms.R.game_state);
const idOf = (seat: number, k: string) => st().players[seat].hand.find((x) => x.display === k)?.id ?? -1; // 找不到（修正前那張已經被打掉）給 -1，讓測試照常跑出 ❌
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// B1～B7：座位 3 打八筒，座位 1 手上三張八筒＋雜牌，碰
{
  setup("p8 p8 p8 m3 m5 m7 s1 s4 z1 z2 z3 z4 m9 s9 p1 p5", "p8", 3);
  const r = await call(action, { playerId: "p1", actionType: "pong", tiles: [idOf(1, "p8"), st().players[1].hand.filter((x) => x.display === "p8")[1].id] });
  const hu = sent.find((e) => e.event === "mj_hand_update");
  eq([r.status, r.body.chiForbidden, r.body.chiForbiddenBy, hu?.payload.chiForbidden, hu?.payload.chiForbiddenBy, hu?.channel?.includes("-p-") ?? null],
    [200, ["p8"], "pong", ["p8"], "pong", true], "B1 碰八筒：碰的回應、mj_hand_update（只送碰的人的座位頻道）帶 chiForbidden [p8]、chiForbiddenBy pong");
  const mine = await state("p1"), other = await state("p2");
  eq([mine.chiForbidden, mine.chiForbiddenBy, other.chiForbidden, other.chiForbiddenBy], [["p8"], "pong", [], null],
    "B2 牌局狀態：碰的人看到 chiForbidden [p8]、來源 pong；別家空陣列、null（看不到別人的）");
  const before = snap(); sent.length = 0;
  const bad = await call(discard, { playerId: "p1", tileId: idOf(1, "p8") });
  eq([bad.status, bad.body.error, bad.body.reason, snap() === before, sent.length], [400, "剛碰的牌，這輪不能打", "pong_forbidden", true, 0],
    "B3 碰完打手上剩的那張八筒：400「剛碰的牌，這輪不能打」（reason pong_forbidden），狀態完全不變、沒有廣播");

  const watchSeat1 = toSpectatorGameState(st(), "p1") as unknown as Record<string, unknown>;
  const pub = toPublicGameState(st()) as unknown as Record<string, unknown>;
  eq([(watchSeat1.hand as Tile[]).some((x) => x.display === "p8"), "chiForbid" in watchSeat1, "chiForbidden" in watchSeat1, "chiForbid" in pub, "chiForbidden" in pub],
    [true, false, false, false, false], "B6 觀戰看到被觀戰者的手牌（含那張八筒），但沒有打牌限制欄位；公開狀態也沒有（限制只給本人）");

  const ok = await call(discard, { playerId: "p1", tileId: idOf(1, "z1") });
  const after = await state("p1");
  eq([ok.status, after.chiForbidden, after.chiForbiddenBy, st().chiForbid ?? null], [200, [], null, null], "B4 打出東風：200；打完限制清掉");

  // 下一輪：其他人都過、輪回座位 1 自己摸牌
  Object.assign(st(), { currentTurn: 1, hasDrawn: false, lastDiscard: null, pendingActions: undefined });
  const dr = await call(draw, { playerId: "p1" });
  const again = await call(discard, { playerId: "p1", tileId: idOf(1, "p8") });
  eq([dr.status, again.status], [200, 200], "B5 下一輪自己摸牌後：八筒照打 200");

  const ev = (st().replayLog as unknown as { ev?: unknown[][] } | undefined)?.ev ?? []; // 精簡格式：[時間, 輪到誰, 牌牆, "tag+tag", ...]
  // 第一步是「座位 3 打出八筒＋座位 1 碰」（上面為了讓回放開始記，先把打出的那張拿掉，所以兩件事記在同一步）
  eq(ev.map((e) => e[3]), ["pong+discard", "discard", "draw", "discard"], "B7 回放：被擋下的那次沒有留下任何事件；依序是碰、打出東風、摸牌、打出八筒");
}
// B8：吃牌照舊
{
  setup("s5 s6 s7 s8 m3 m5 m7 p1 p3 p5 z1 z2 z3 z4 z5 z6", "s5", 0);
  const r = await call(action, { playerId: "p1", actionType: "chi", tiles: [idOf(1, "s6"), idOf(1, "s7")] });
  const d = await call(discard, { playerId: "p1", tileId: idOf(1, "s8") });
  eq([r.body.chiForbidden, r.body.chiForbiddenBy, (await state("p1")).chiForbiddenBy, d.status, d.body.reason, d.body.error],
    [["s5", "s8"], "chi", "chi", 400, "chi_forbidden", "吃完這輪不能打出和吃的那兩張湊成順子的牌"], "B8 吃牌照舊：來源 chi，打禁打的牌 400 chi_forbidden、訊息不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
