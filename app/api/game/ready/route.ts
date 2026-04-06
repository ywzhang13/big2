import { getSupabaseServer } from "@/lib/supabase-server";
import { broadcast } from "@/lib/broadcast";
import { dealAndStart } from "@/lib/deal-and-start";

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

    const supabase = getSupabaseServer();

    // Get room
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, status, ready_players")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    if (room.status !== "ready_check") {
      return Response.json({ error: "目前不在準備確認階段" }, { status: 400 });
    }

    // Verify player is in the room
    const { data: player } = await supabase
      .from("big2_players")
      .select("id")
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .single();

    if (!player) {
      return Response.json({ error: "你不在這個房間" }, { status: 403 });
    }

    // Add to ready_players if not already there
    const readyPlayers: string[] = Array.isArray(room.ready_players)
      ? room.ready_players
      : [];

    if (!readyPlayers.includes(playerId)) {
      readyPlayers.push(playerId);
    }

    const { error: updateError } = await supabase
      .from("big2_rooms")
      .update({ ready_players: readyPlayers })
      .eq("id", roomId);

    if (updateError) {
      return Response.json({ error: "更新準備狀態失敗" }, { status: 500 });
    }

    await broadcast(room.code, "player_ready", {
      playerId,
      readyCount: readyPlayers.length,
    });

    // If all 4 ready, deal
    if (readyPlayers.length >= 4) {
      await dealAndStart(roomId, room.code);
      return Response.json({ allReady: true });
    }

    return Response.json({ allReady: false });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
