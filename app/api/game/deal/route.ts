import { getServerSupabase } from "@/lib/supabase-server";
import { deal } from "@/lib/deck";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, sessionToken } = body;

    if (!roomId || !sessionToken) {
      return Response.json(
        { error: "Missing roomId or sessionToken" },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();

    // Verify the requesting player is in this room
    const { data: requestingPlayer, error: playerError } = await supabase
      .from("big2_players")
      .select("id")
      .eq("room_id", roomId)
      .eq("session_token", sessionToken)
      .single();

    if (playerError || !requestingPlayer) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get room info
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, status")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "Room not found" }, { status: 404 });
    }

    // Get all players
    const { data: players, error: playersError } = await supabase
      .from("big2_players")
      .select("id, seat")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (playersError || !players || players.length !== 4) {
      return Response.json(
        { error: "Need exactly 4 players to deal" },
        { status: 400 }
      );
    }

    // Deal cards
    const hands = deal();

    // Find who has 3C
    let startingSeat = 0;
    for (let i = 0; i < 4; i++) {
      if (hands[i].includes("3C")) {
        startingSeat = players[i].seat;
        break;
      }
    }

    // Write each player's hand to DB
    for (let i = 0; i < 4; i++) {
      const { error: updateError } = await supabase
        .from("big2_players")
        .update({
          hand: hands[i],
          card_count: 13,
        })
        .eq("id", players[i].id);

      if (updateError) {
        return Response.json(
          { error: "Failed to update player hand" },
          { status: 500 }
        );
      }
    }

    // Update room status and current turn
    const { error: roomUpdateError } = await supabase
      .from("big2_rooms")
      .update({
        status: "playing",
        current_turn: startingSeat,
        round_starter: startingSeat,
        last_play: null,
        pass_count: 0,
      })
      .eq("id", roomId);

    if (roomUpdateError) {
      return Response.json(
        { error: "Failed to update room" },
        { status: 500 }
      );
    }

    // Broadcast game_start via Realtime
    const channel = supabase.channel(`room:${room.code}`);
    await channel.send({
      type: "broadcast",
      event: "game_start",
      payload: {
        currentTurn: startingSeat,
      },
    });

    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
