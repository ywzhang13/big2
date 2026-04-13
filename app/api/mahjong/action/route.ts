import {
  loadRoom,
  saveGameState,
  findSeatByPlayerId,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import {
  executeAction,
  declareWin,
  advanceTurn,
  drawTile,
  AvailableAction,
} from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { Tile } from "@/lib/mahjong/tiles";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId, actionType, tiles } = body as {
      roomId?: string;
      playerId?: string;
      actionType?: "chi" | "pong" | "kong" | "win" | "pass";
      tiles?: number[]; // tile IDs
    };

    if (!roomId || !playerId || !actionType) {
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

    const seat = findSeatByPlayerId(state, playerId);
    if (seat === -1) {
      return Response.json({ error: "玩家不在此房間" }, { status: 403 });
    }

    let newState: MahjongGameState;

    if (actionType === "win") {
      // Determine if self-draw or from discard
      const isSelfDraw = state.currentTurn === seat && state.hasDrawn;
      newState = declareWin(state, seat, isSelfDraw);
      newState.pendingActions = undefined;

      await saveGameState(roomId, newState, "finished");

      // Broadcast game over with all hands revealed
      await mjBroadcast(room.code, "mj_game_over", {
        winnerSeat: seat,
        winnerName: newState.players[seat].name,
        score: newState.winner!.score,
        allHands: newState.players.map((p) => ({
          seat: p.seat,
          name: p.name,
          hand: p.hand,
          revealed: p.revealed,
          flowers: p.flowers,
        })),
      });

      return Response.json({ success: true });
    }

    if (actionType === "pass") {
      // Multi-player action window: track who has passed
      if (state.pendingActions) {
        const pending = { ...state.pendingActions };
        // Add this player to passedActors if they are a potential actor
        if (
          pending.potentialActors.includes(seat) &&
          !pending.passedActors.includes(seat)
        ) {
          pending.passedActors = [...pending.passedActors, seat];
        }

        const allPassed = pending.potentialActors.every((s) =>
          pending.passedActors.includes(s)
        );

        if (allPassed) {
          // Everyone passed — advance turn, clear pending
          newState = advanceTurn(state);
          newState.pendingActions = undefined;
        } else {
          // Still waiting for others — just update passedActors
          newState = { ...state, pendingActions: pending } as MahjongGameState;
        }
      } else {
        // No pending actions — just advance turn
        newState = advanceTurn(state);
      }

      await saveGameState(roomId, newState);

      // Broadcast that the turn advances (no action taken)
      await mjBroadcast(room.code, "mj_pass", {
        seat,
        allPassed: !newState.pendingActions, // true if turn advanced
      });

      return Response.json({ success: true });
    }

    // chi / pong / kong
    if (!state.lastDiscard) {
      return Response.json({ error: "沒有可以吃碰槓的牌" }, { status: 400 });
    }

    // Resolve tile objects from IDs
    const player = state.players[seat];
    let actionTiles: Tile[] | undefined;
    if (tiles && tiles.length > 0) {
      actionTiles = tiles.map((tileId) => {
        const found = player.hand.find((t) => t.id === tileId);
        if (!found) throw new Error(`找不到牌 id=${tileId}`);
        return found;
      });
    }

    const action: AvailableAction = {
      type: actionType as "chi" | "pong" | "kong",
      playerSeat: seat,
      tiles: actionTiles,
    };

    newState = executeAction(state, action);
    // Clear pendingActions after a successful chi/pong/kong
    newState.pendingActions = undefined;

    await saveGameState(roomId, newState);

    // Broadcast the action (revealed meld) with tileCount
    const updatedPlayer = newState.players[seat];
    const lastMeld = updatedPlayer.revealed[updatedPlayer.revealed.length - 1];
    await mjBroadcast(room.code, "mj_action", {
      type: actionType,
      seat,
      tiles: lastMeld.tiles,
      tileCount: updatedPlayer.hand.length,
    });

    // After chi/pong, the player needs to discard.
    // After kong, the player already drew a replacement (handled in executeAction).
    // Send the player their updated hand.
    // Defensive: filter flowers from hand
    await mjBroadcast(room.code, "mj_hand_update", {
      playerId,
      hand: newState.players[seat].hand.filter((t) => t.suit !== "f"),
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}
