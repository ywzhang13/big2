import { type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { Card } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get("roomId");
    const playerId = searchParams.get("playerId");

    if (!roomId || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Get room
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select(
        "id, code, status, host_id, current_turn, last_play, pass_count, round_starter, scores, ready_players"
      )
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Get all players
    const { data: allPlayers, error: playersError } = await supabase
      .from("big2_players")
      .select(
        "player_id, name, seat, card_count, is_finished, finish_order, hand"
      )
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (playersError || !allPlayers) {
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
