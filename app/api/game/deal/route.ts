import { getSupabaseServer } from "@/lib/supabase-server";
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

    // Verify room exists and player is host
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, host_id, status")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    if (room.host_id !== playerId) {
      return Response.json({ error: "只有房主可以發牌" }, { status: 403 });
    }

    await dealAndStart(roomId, room.code);

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
