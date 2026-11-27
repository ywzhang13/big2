// 自動摸牌重試的伺服器這一半（老闆 2026-11-04）：前端失敗會重送（tests/_auto-draw.ts），這裡確認重送不會多摸
//   R1 回應遺失後重送：回 400「已經摸過牌了」，手牌和牌牆都不變
//   R2 兩個摸牌請求同時到：只有一個摸到
//   R3 重送時已經換人：回 400「還沒輪到你」，不發牌
//   R4 還有人在決定吃碰：回 400「等待其他玩家動作中」，不發牌
//   R5 重送的人打完牌後狀態正確，牌局能繼續
import { POST as create } from "../../app/api/mahjong/create/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { POST as start } from "../support/mj-start-all"; // 開始＋三家同意（2026-11-20 起四家同意才發牌）
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { rooms } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const U = [1, 2, 3, 4].map((n) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`);
const P = ["p0", "p1", "p2", "p3"];
U.forEach((id, i) => (tokens[`tok${i}`] = { id, displayName: `LINE${i}`, pictureUrl: null, isGuest: false }));

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: tok ? { authorization: `Bearer ${tok}` } : {}, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}

(async () => {
  const c = await post(create, { hostId: "p0", totalRounds: 1, basePoints: 100, fanPoints: 20 }, "tok0");
  const { code, roomId } = c.body;
  for (let i = 0; i < 4; i++) await post(join, { code, name: `玩家${i}`, playerId: P[i] }, `tok${i}`);
  await post(start, { roomId, playerId: "p0" }, "tok0");
  const st = () => rooms[roomId].game_state as MahjongGameState;
  const tok = (seat: number) => `tok${P.indexOf(st().players[seat].id)}`;
  // 莊家先打一張（莊家開局有 17 張，不用摸），輪到下一家摸
  const toNext = async () => {
    const s = st(); const seat = s.currentTurn;
    const tile = s.players[seat].hand.at(-1)!;
    await post(discard, { roomId, playerId: s.players[seat].id, tileId: tile.id }, tok(seat));
  };
  const clearPending = () => { const s = st(); if (s.pendingActions) { s.pendingActions.passedActors = [...s.pendingActions.potentialActors]; } };

  await toNext(); clearPending();
  let s = st(); const dSeat = s.lastDiscard!.from; const next = (dSeat + 1) % 4;
  s.currentTurn = next; s.hasDrawn = false; s.pendingActions = undefined;

  // R1
  const hand0 = st().players[next].hand.length, wall0 = st().wall.length;
  const a = await post(draw, { roomId, playerId: st().players[next].id }, tok(next));
  eq([a.status, st().players[next].hand.length >= hand0 + 1, st().hasDrawn], [200, true, true], "R1a 第一次摸到");
  const hand1 = st().players[next].hand.length, wall1 = st().wall.length;
  const b = await post(draw, { roomId, playerId: st().players[next].id }, tok(next));
  eq([b.status, b.body.error, st().players[next].hand.length, st().wall.length], [400, "已經摸過牌了", hand1, wall1], "R1b 重送：回已經摸過，手牌牌牆不變");
  eq(wall0 > wall1, true, "R1c 牌牆確實少了");

  // R5 接著打牌，進下一家
  await toNext(); clearPending();
  s = st(); const seat2 = (s.lastDiscard!.from + 1) % 4;
  s.currentTurn = seat2; s.hasDrawn = false; s.pendingActions = undefined;

  // R3 上一家重送
  const stale = st().players[next];
  const hand3 = stale.hand.length, wall3 = st().wall.length;
  const r3 = await post(draw, { roomId, playerId: stale.id }, tok(next));
  eq([r3.status, r3.body.error, stale.hand.length, st().wall.length], [400, "還沒輪到你", hand3, wall3], "R3 已經換人：不發牌");

  // R4 窗口中
  st().pendingActions = { potentialActors: [(seat2 + 1) % 4], passedActors: [] } as unknown as MahjongGameState["pendingActions"];
  const wall4 = st().wall.length;
  const r4 = await post(draw, { roomId, playerId: st().players[seat2].id }, tok(seat2));
  eq([r4.status, r4.body.error, st().wall.length, st().hasDrawn], [400, "等待其他玩家動作中", wall4, false], "R4 有人在決定吃碰：不發牌");
  st().pendingActions = undefined;

  // R2 同時兩個
  const hand2 = st().players[seat2].hand.length, wall2 = st().wall.length;
  const [x, y] = await Promise.all([
    post(draw, { roomId, playerId: st().players[seat2].id }, tok(seat2)),
    post(draw, { roomId, playerId: st().players[seat2].id }, tok(seat2)),
  ]);
  eq([x.status, y.status].sort(), [200, 400], "R2a 同時兩個：一個成功、一個 400");
  const added = st().players[seat2].hand.length - hand2, used = wall2 - st().wall.length;
  eq(added <= used && added === 1, true, "R2b 手牌只多一張");

  // R5
  const r5 = st().players[seat2].hand.at(-1)!;
  const d5 = await post(discard, { roomId, playerId: st().players[seat2].id, tileId: r5.id }, tok(seat2));
  eq([d5.status, st().hasDrawn], [200, false], "R5 重試之後照常打牌");

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("❌"))) process.exit(1);
})();
