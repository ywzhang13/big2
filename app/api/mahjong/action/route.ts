import {
  loadRoom,
  saveGameState,
  findSeatByPlayerId,
  toPublicGameState,
} from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import {
  executeAction,
  executeConcealedKong,
  executeAddKong,
  declareWin,
  advanceTurn,
  drawTile,
  calculateSettlement,
  isAllRoundsComplete,
  getAvailableActions,
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

      // Calculate settlement if round system is active
      let settlement = undefined;
      if (newState.roomSettings) {
        settlement = calculateSettlement(newState);
        newState.settlement = settlement;
        // Update running scores
        if (newState.playerScores) {
          newState.playerScores = newState.playerScores.map(
            (s, i) => s + settlement!.deltas[i]
          );
        }
        // Check if all rounds complete
        newState.gameOver = isAllRoundsComplete(newState);
      }

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
        settlement,
        playerScores: newState.playerScores,
        roundInfo: newState.roundInfo,
        gameOver: newState.gameOver,
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

      // When all passed and turn advanced, send mj_turn_advance so clients
      // can update currentTurn immediately (avoid 5s polling lag).
      if (!newState.pendingActions) {
        await mjBroadcast(room.code, "mj_turn_advance", {
          currentTurn: newState.currentTurn,
          hasDrawn: newState.hasDrawn,
        });
      }

      // If pending window still open, check whether chi should now be
      // revealed (all higher-priority players have passed).
      if (newState.pendingActions && state.lastDiscard) {
        const remainingActions = getAvailableActions(newState);
        const passedSet = new Set(newState.pendingActions.passedActors);
        const highPriorityStillWaiting = remainingActions.some(
          (a) =>
            (a.type === "win" || a.type === "pong" || a.type === "kong") &&
            !passedSet.has(a.playerSeat)
        );
        if (!highPriorityStillWaiting) {
          // Reveal chi to any seats that have chi available and haven't passed
          const chiActions = remainingActions.filter(
            (a) => a.type === "chi" && !passedSet.has(a.playerSeat)
          );
          const chiSeats = new Set(chiActions.map((a) => a.playerSeat));
          for (const chiSeat of chiSeats) {
            const playerActions = chiActions.filter((a) => a.playerSeat === chiSeat);
            const targetPlayerId = newState.players[chiSeat].id;
            await mjBroadcast(room.code, "mj_available_actions", {
              playerId: targetPlayerId,
              actions: playerActions,
            });
          }
        }
      }

      return Response.json({ success: true });
    }

    // chi / pong / kong
    // Concealed kong (暗槓) is triggered from own hand after drawing — no lastDiscard.
    // Add kong (加槓) may also be triggered on own turn with lastDiscard absent.
    const isConcealedKong =
      actionType === "kong" &&
      state.currentTurn === seat &&
      state.hasDrawn &&
      !state.lastDiscard;

    if (!state.lastDiscard && !isConcealedKong) {
      return Response.json({ error: "沒有可以吃碰槓的牌" }, { status: 400 });
    }

    // Priority: win > pong/kong > chi
    // If this is a chi, check no one else has a pending pong/kong/win that
    // hasn't passed yet. Pong/kong/win can execute immediately (higher priority
    // than chi, and they short-circuit the action window).
    if (actionType === "chi") {
      const allAvailable = getAvailableActions(state);
      const pending = state.pendingActions;
      const higherPriorityWaiting = allAvailable.some((a) => {
        if (a.playerSeat === seat) return false;
        if (a.type !== "pong" && a.type !== "kong" && a.type !== "win") return false;
        // This other seat can pong/kong/win — have they passed yet?
        const hasPassed = pending?.passedActors.includes(a.playerSeat) ?? false;
        return !hasPassed;
      });
      if (higherPriorityWaiting) {
        return Response.json(
          { error: "等待其他玩家決定是否碰/槓/胡" },
          { status: 409 }
        );
      }
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

    if (isConcealedKong) {
      // 暗槓: 4 tiles from own hand, no discard involved
      if (!actionTiles || actionTiles.length !== 4) {
        return Response.json({ error: "暗槓需要 4 張相同的牌" }, { status: 400 });
      }
      newState = executeConcealedKong(state, actionTiles);
    } else {
      const action: AvailableAction = {
        type: actionType as "chi" | "pong" | "kong",
        playerSeat: seat,
        tiles: actionTiles,
      };
      newState = executeAction(state, action);
    }
    // Clear pendingActions after a successful chi/pong/kong
    newState.pendingActions = undefined;

    await saveGameState(roomId, newState);

    // Broadcast the action (revealed meld) with tileCount
    // Use lastMeld.type so "concealed_kong" (暗槓) is correctly conveyed
    // to clients (for faceDown rendering and scoring).
    const updatedPlayer = newState.players[seat];
    const lastMeld = updatedPlayer.revealed[updatedPlayer.revealed.length - 1];
    await mjBroadcast(room.code, "mj_action", {
      type: lastMeld.type,
      seat,
      tiles: lastMeld.tiles,
      tileCount: updatedPlayer.hand.length,
    });

    // After chi/pong, the player needs to discard.
    // After kong, the player already drew a replacement (handled in executeAction).
    // Send the player their updated hand.
    // For kong, also send the replacement tile id so UI can show it separated
    // on the right (just like a normal draw).
    const handNoFlowers = newState.players[seat].hand.filter((t) => t.suit !== "f");
    const drawnTileId =
      actionType === "kong" && handNoFlowers.length > 0
        ? handNoFlowers[handNoFlowers.length - 1].id
        : undefined;
    await mjBroadcast(room.code, "mj_hand_update", {
      playerId,
      hand: handNoFlowers,
      drawnTileId,
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}
