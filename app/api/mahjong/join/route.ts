import { getSupabaseServer } from "@/lib/supabase-server";
import { mjBroadcast } from "@/lib/mahjong/broadcast";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name, playerId } = body as {
      code?: string;
      name?: string;
      playerId?: string;
    };

    if (!code || !name || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Find room by code
    const { data: room, error: roomError } = await supabase
      .from("mj_rooms")
      .select("id, code, status")
      .eq("code", code)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    if (room.status !== "waiting") {
      return Response.json({ error: "房間已開始遊戲，無法加入" }, { status: 400 });
    }

    // Check existing players
    const { data: existingPlayers, error: playersError } = await supabase
      .from("mj_players")
      .select("seat, player_id")
      .eq("room_id", room.id)
      .order("seat", { ascending: true });

    if (playersError) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // Check if player already in room
    const existing = existingPlayers?.find((p) => p.player_id === playerId);
    if (existing) {
      return Response.json({ seat: existing.seat, roomId: room.id });
    }

    if ((existingPlayers?.length ?? 0) >= 4) {
      return Response.json({ error: "房間已滿" }, { status: 400 });
    }

    // Find next available seat
    const takenSeats = new Set(existingPlayers?.map((p) => p.seat) ?? []);
    let seat = -1;
    for (let i = 0; i < 4; i++) {
      if (!takenSeats.has(i)) {
        seat = i;
        break;
      }
    }

    // Insert player
    const { error: insertError } = await supabase.from("mj_players").insert({
      room_id: room.id,
      player_id: playerId,
      name,
      seat,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return Response.json({ error: "座位已被佔用，請重試" }, { status: 409 });
      }
      return Response.json({ error: "加入房間失敗" }, { status: 500 });
    }

    // Broadcast player joined
    await mjBroadcast(room.code, "mj_player_joined", {
      playerId,
      name,
      seat,
      playerCount: (existingPlayers?.length ?? 0) + 1,
    });

    return Response.json({ seat, roomId: room.id });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
