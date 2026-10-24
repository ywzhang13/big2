import { type NextRequest } from "next/server";
import { loadRoomPlayers, loadRoomState } from "@/lib/big2/roomStore";
import { endedResponse } from "@/lib/records/close";
import type { Card } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get("roomId");
    const playerId = searchParams.get("playerId");

    if (!roomId || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    // Get room
    const room = await loadRoomState(roomId);

    if (!room) {
      const ended = await endedResponse("big2", { roomId });
      if (ended) return ended;
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Get all players
    const allPlayers = await loadRoomPlayers(roomId);

    if (!allPlayers) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // Find requesting player
    const me = allPlayers.find((p) => p.player_id === playerId);
    if (!me) {
      return Response.json({ error: "你不在這個房間" }, { status: 403 });
    }

    // Build response: only include the requesting player's hand
    const players = allPlayers.map((p) => ({
      id: p.player_id,
      name: p.name,
      seat: p.seat,
      cardCount: p.card_count,
      isFinished: p.is_finished,
      finishOrder: p.finish_order,
    }));

    return Response.json({
      roomId: room.id,
      roomCode: room.code,
      status: room.status,
      hostId: room.host_id,
      currentTurn: room.current_turn,
      lastPlay: room.last_play,
      passCount: room.pass_count,
      roundStarter: room.round_starter,
      scores: room.scores,
      readyPlayers: room.ready_players,
      players,
      myHand: me.hand as Card[],
      mySeat: me.seat,
    });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
