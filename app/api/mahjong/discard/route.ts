import {
  loadRoom,
  saveGameStateIfUnchanged,
  findSeatByPlayerId,
  retryOnConflict,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { discardTile, declareTingAndDiscard, tingDiscardOptions } from "@/lib/mahjong/gameLogic";
import { discardEvents } from "@/lib/mahjong/events";
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
  const { roomId, playerId, tileId, declareTing } = body as {
    roomId?: string;
    playerId?: string;
    tileId?: number;
    declareTing?: boolean; // 打出這張的同時宣告地聽
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

  if (declareTing && !tingDiscardOptions(state, seat).some((t) => t.id === tileId)) {
    return Response.json({ error: "現在不能宣告地聽，或打出這張後沒有聽牌" }, { status: 400 });
  }
  if (state.tingSeats?.includes(seat) && state.drawnTileId !== undefined && tileId !== state.drawnTileId) {
    return Response.json({ error: "地聽後只能打出摸到的牌" }, { status: 400 });
  }

  // Execute discard（declareTing=true：打出這張的同時宣告地聽）
  const newState = declareTing ? declareTingAndDiscard(state, tileId) : discardTile(state, tileId);
  const events = discardEvents(newState, seat);
  if (declareTing) {
    events.unshift({ event: "mj_ting_declared", payload: { seat, tile: newState.lastDiscard!.tile } });
  }

  // Save state
  await saveGameStateIfUnchanged(roomId, state.stateVersion, newState);
  await mjBroadcastBatch(room.code, events);

  const actions = (events[declareTing ? 1 : 0].payload.availableActions ?? []) as { type: string; playerSeat: number }[];
  return Response.json({ success: true, availableActions: actions, ting: !!declareTing });
}
