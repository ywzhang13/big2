import {
  loadRoom,
  saveGameState,
  findSeatByPlayerId,
} from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import {
  drawTile,
  canConcealedKong,
} from "@/lib/mahjong/gameLogic";
import { isWinningHand } from "@/lib/mahjong/winCheck";
import { MahjongGameState } from "@/lib/mahjong/gameState";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId } = body as {
      roomId?: string;
      playerId?: string;
    };

    if (!roomId || !playerId) {
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
    if (state.hasDrawn) {
      return Response.json({ error: "已經摸過牌了" }, { status: 400 });
    }

    // Draw tile
    const newState = drawTile(state);

    // Check for draw game (wall exhausted)
    if (newState.status === "finished") {
      await saveGameState(roomId, newState, "finished");

      await mjBroadcast(room.code, "mj_game_over", {
        winnerSeat: -1,
        winnerName: null,
        score: null,
        allHands: newState.players.map((p) => ({
          seat: p.seat,
          name: p.name,
          hand: p.hand,
          revealed: p.revealed,
          flowers: p.flowers,
        })),
      });

      return Response.json({ success: true, draw: true });
    }

    const player = newState.players[seat];
    const drawnTile = player.hand[player.hand.length - 1];

    // Check self-draw win (自摸)
    const canWin = isWinningHand(player.hand, player.revealed.length);

    // Check concealed kong (暗槓)
    const kongOptions = canConcealedKong(player.hand);
    const canKong = kongOptions.length > 0;

    // Save state
    await saveGameState(roomId, newState);

    // Broadcast public draw info (tile count + flowers for all to see補花)
    await mjBroadcast(room.code, "mj_draw", {
      seat,
      tileCount: player.hand.length,
      wallCount: newState.wall.length,
      flowers: player.flowers,
    });

    // Send drawn tile only to the drawing player (include flowers for補花)
    await mjBroadcast(room.code, "mj_draw_tile", {
      playerId,
      tile: drawnTile,
      hand: player.hand,
      flowers: player.flowers,
      canWin,
      canKong,
      kongOptions: canKong
        ? kongOptions.map((group) => group.map((t) => t.id))
        : [],
    });

    return Response.json({
      success: true,
      drawnTile,
      canWin,
      canKong,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "伺服器錯誤";
    return Response.json({ error: message }, { status: 500 });
  }
}
