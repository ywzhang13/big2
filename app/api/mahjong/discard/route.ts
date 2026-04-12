import {
  loadRoom,
  saveGameState,
  findSeatByPlayerId,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { discardTile, getAvailableActions } from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId, tileId } = body as {
      roomId?: string;
      playerId?: string;
      tileId?: number;
    };

    if (!roomId || !playerId || tileId === undefined) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    // Load room and state
    const room = await loadRoom(roomId);
    if (!room || !room.game_state) {
      return Response.json({ error: "找不到遊戲" }, { status: 404 });
    }

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

    // Execute discard
    const newState = discardTile(state, tileId);

    // Check available actions for other players
    const actions = getAvailableActions(newState);

    // If there are actions available, save pendingActions so the action
    // route knows who still needs to pass before the turn advances.
    if (actions.length > 0) {
      const potentialActors = [...new Set(actions.map((a) => a.playerSeat))];
      newState.pendingActions = {
        discardFrom: seat,
        potentialActors,
        passedActors: [],
      };
    } else {
      // No one can act — clear any stale pending and leave state as-is
      // (turn will NOT auto-advance here; the next player must draw)
      newState.pendingActions = undefined;
    }

    // Save state
    await saveGameState(roomId, newState);

    // Broadcast discard
    const discardedTile = newState.lastDiscard!.tile;
    await mjBroadcast(room.code, "mj_discard", {
      seat,
      tile: discardedTile,
      availableActions: actions.map((a) => ({
        type: a.type,
        playerSeat: a.playerSeat,
      })),
    });

    // Send targeted available actions to each player who can act
    const playerSeatsWithActions = new Set(actions.map((a) => a.playerSeat));
    for (const actionSeat of playerSeatsWithActions) {
      const playerActions = actions.filter((a) => a.playerSeat === actionSeat);
      const targetPlayerId = newState.players[actionSeat].id;
      await mjBroadcast(room.code, "mj_available_actions", {
        playerId: targetPlayerId,
        actions: playerActions,
      });
    }

    return Response.json({
      success: true,
      availableActions: actions.map((a) => ({
        type: a.type,
        playerSeat: a.playerSeat,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}
