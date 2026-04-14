import {
  loadRoom,
  saveGameState,
  findSeatByPlayerId,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { discardTile, getAvailableActions, advanceTurn } from "@/lib/mahjong/gameLogic";
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
      // No one can act — advance turn to next player
      const advanced = advanceTurn(newState);
      Object.assign(newState, advanced);
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

    // Priority tiers: 0=win, 1=pong/kong, 2=chi
    // Only reveal a player's action if no OTHER player has a higher-priority
    // action pending. Same player may see their own multi-tier options together
    // (e.g. own pong + own chi).
    const tierOf = (type: string) =>
      type === "win" ? 0 : type === "pong" || type === "kong" ? 1 : 2;

    const playerSeatsWithActions = new Set(actions.map((a) => a.playerSeat));
    for (const actionSeat of playerSeatsWithActions) {
      const playerActions = actions.filter((a) => a.playerSeat === actionSeat);
      // Highest-priority tier held by ANOTHER seat
      const otherTiers = actions
        .filter((a) => a.playerSeat !== actionSeat)
        .map((a) => tierOf(a.type));
      const minOtherTier = otherTiers.length > 0 ? Math.min(...otherTiers) : 999;
      // Own actions whose tier is <= minOtherTier (meaning no other higher-
      // priority seat is still in control) are revealable now.
      const filtered = playerActions.filter(
        (a) => tierOf(a.type) <= minOtherTier
      );
      if (filtered.length === 0) continue;
      const targetPlayerId = newState.players[actionSeat].id;
      await mjBroadcast(room.code, "mj_available_actions", {
        playerId: targetPlayerId,
        actions: filtered,
      });
    }

    // If turn advanced (no pending actions), broadcast the new turn so clients
    // don't need to wait for 5s polling. Prevents "輪到你摸牌" flash on next
    // player's UI and keeps flow snappy.
    if (!newState.pendingActions) {
      await mjBroadcast(room.code, "mj_turn_advance", {
        currentTurn: newState.currentTurn,
        hasDrawn: newState.hasDrawn,
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
