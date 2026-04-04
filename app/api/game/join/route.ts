import { getServerSupabase } from "@/lib/supabase-server";
import { generateSessionToken } from "@/lib/room";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name } = body;

    if (!code || !name) {
      return Response.json(
        { error: "Missing code or name" },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();

    // Find room by code
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, status")
      .eq("code", code)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.status !== "waiting") {
      return Response.json(
        { error: "Game already started" },
        { status: 400 }
      );
    }

    // Count existing players
    const { data: players, error: playersError } = await supabase
      .from("big2_players")
      .select("seat")
      .eq("room_id", room.id);

    if (playersError) {
      return Response.json(
        { error: "Failed to check players" },
        { status: 500 }
      );
    }

    if (players && players.length >= 4) {
      return Response.json({ error: "Room is full" }, { status: 400 });
    }

    // Assign next available seat (0-3)
    const takenSeats = new Set(players?.map((p) => p.seat) ?? []);
    let seat = -1;
    for (let i = 0; i < 4; i++) {
      if (!takenSeats.has(i)) {
        seat = i;
        break;
      }
    }

    const sessionToken = generateSessionToken();

    const { data: player, error: insertError } = await supabase
      .from("big2_players")
      .insert({
        room_id: room.id,
        name,
        seat,
        session_token: sessionToken,
        hand: [],
        card_count: 0,
        is_finished: false,
      })
      .select("id, seat")
      .single();

    if (insertError) {
      return Response.json(
        { error: "Failed to join room" },
        { status: 500 }
      );
    }

    return Response.json({
      playerId: player.id,
      seat: player.seat,
      sessionToken,
      roomId: room.id,
    });
  } catch (err) {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
