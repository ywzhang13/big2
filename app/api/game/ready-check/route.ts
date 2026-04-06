import { getSupabaseServer } from "@/lib/supabase-server";
import { broadcast } from "@/lib/broadcast";

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
      .select("id, code, host_id, status")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Verify player is host
    if (room.host_id !== playerId) {
      return Response.json({ error: "只有房主可以發起準備確認" }, { status: 403 });
    }

    // Check we have 4 players
    const { count } = await supabase
      .from("big2_players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId);

    if ((count ?? 0) < 4) {
      return Response.json({ error: "需要4位玩家才能開始" }, { status: 400 });
    }

    // Update room status
    const { error: updateError } = await supabase
      .from("big2_rooms")
      .update({ status: "ready_check", ready_players: [] })
      .eq("id", roomId);

    if (updateError) {
      return Response.json({ error: "更新房間狀態失敗" }, { status: 500 });
    }

    await broadcast(room.code, "ready_check", {
      hostId: playerId,
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
