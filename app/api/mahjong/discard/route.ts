import {
  loadRoom,
  saveGameStateIfUnchanged,
  findSeatByPlayerId,
  retryOnConflict,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { discardTile, declareEyeAndDiscard, eyeDiscardOptions, isLocked } from "@/lib/mahjong/gameLogic";
import { discardEvents, eyeAutoplay, eyeViewEvents, type MjEvent } from "@/lib/mahjong/events";
import { closeMahjongIfOver } from "@/lib/records/close";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleDiscard(request, body, fresh));
}

async function handleDiscard(request: Request, body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId, tileId, declareTing, declareEye } = body as {
    roomId?: string;
    playerId?: string;
    tileId?: number;
    declareTing?: boolean; // 已拿掉：地聽改成在第一輪宣告眼牌時自動算
    declareEye?: boolean; // 打出這張的同時宣告眼牌（第一輪宣告同時算地聽）
  };

  if (!roomId || !playerId || tileId === undefined) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  // Load room and state
  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }
  // 確認是這個座位的本人（一律要登入）
  const denied = await seatOwnerError(request, room.game_state, playerId);
  if (denied) return denied;

  const state = room.game_state as MahjongGameState;
  if (state.status !== "playing") {
    return Response.json({ error: "遊戲未在進行中" }, { status: 400 });
  }

  // Verify turn
  const seat = findSeatByPlayerId(state, playerId);
  if (seat === -1) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }
  if (state.currentTurn !== seat) {
    return Response.json({ error: "還沒輪到你" }, { status: 400 });
  }
  if (state.pendingAddKong) {
    return Response.json({ error: "等待其他玩家決定是否搶槓" }, { status: 409 });
  }
  if (state.pendingFlowerRob) {
    return Response.json({ error: "等待其他玩家決定是否七搶一" }, { status: 409 });
  }

  if (declareTing) {
    return Response.json({ error: "地聽不用單獨宣告，請宣告眼牌（第一輪宣告眼牌同時算地聽）" }, { status: 400 });
  }
  if (declareEye && !eyeDiscardOptions(state, seat).some((t) => t.id === tileId)) {
    return Response.json({ error: "現在不能宣告眼牌，或打出這張後沒有聽牌" }, { status: 400 });
  }
  if (isLocked(state, seat) && state.drawnTileId !== undefined && tileId !== state.drawnTileId) {
    return Response.json({ error: "地聽後只能打出摸到的牌" }, { status: 400 });
  }

  // Execute discard（declareEye=true：打出這張的同時宣告眼牌）
  let newState = declareEye ? declareEyeAndDiscard(state, tileId) : discardTile(state, tileId);
  const ting = !!declareEye && !!newState.tingSeats?.includes(seat) && !state.tingSeats?.includes(seat);
  const events: MjEvent[] = [];
  if (declareEye) {
    const tile = newState.lastDiscard!.tile;
    events.push({ event: "mj_eye_declared", payload: { seat, tile, ting } });
    if (ting) events.push({ event: "mj_ting_declared", payload: { seat, tile } });
  }
  const discarded = discardEvents(newState, seat);
  events.push(...discarded);
  // 眼牌的人能胡這張：自動胡
  const auto = eyeAutoplay(newState);
  newState = auto.s;
  events.push(...auto.events, ...eyeViewEvents(newState));

  // Save state
  await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, auto.finished ? "finished" : undefined);
  await mjBroadcastBatch(room.code, events);
  if (auto.finished) await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房

  const actions = (discarded[0].payload.availableActions ?? []) as { type: string; playerSeat: number }[];
  return Response.json({ success: true, availableActions: actions, ting, eye: !!declareEye });
}
