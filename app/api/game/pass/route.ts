import { getServerSupabase } from "@/lib/supabase-server";

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

    // Get the player
    const { data: player, error: playerError } = await supabase
      .from("big2_players")
      .select("id, seat, is_finished")
      .eq("room_id", roomId)
      .eq("session_token", sessionToken)
      .single();

    if (playerError || !player) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (player.is_finished) {
      return Response.json(
        { error: "Player already finished" },
        { status: 400 }
      );
    }

    // Get room
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, current_turn, last_play, pass_count, round_starter, status")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.status !== "playing") {
      return Response.json(
        { error: "Game is not in progress" },
        { status: 400 }
      );
    }

    // Validate it's this player's turn
    if (room.current_turn !== player.seat) {
      return Response.json({ error: "Not your turn" }, { status: 400 });
    }

    // Cannot pass if no last_play (you must play when starting a new round)
    if (!room.last_play) {
      return Response.json(
        { error: "Cannot pass — you must play to start the round" },
        { status: 400 }
      );
    }

    // Get all players to find next active
    const { data: allPlayers } = await supabase
      .from("big2_players")
      .select("id, seat, is_finished")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (!allPlayers) {
      return Response.json(
        { error: "Failed to fetch players" },
        { status: 500 }
      );
    }

    const newPassCount = (room.pass_count ?? 0) + 1;

    // Count active (non-finished) players other than round_starter
    const activePlayers = allPlayers.filter((p) => !p.is_finished);
    const passesNeeded = activePlayers.length - 1; // everyone else must pass

    let nextTurn: number;
    let newLastPlay = room.last_play;
    let newPassCountFinal = newPassCount;
    let newRoundStarter = room.round_starter;

    if (newPassCount >= passesNeeded) {
      // Everyone else passed — round_starter gets a free turn
      nextTurn = room.round_starter;
      newLastPlay = null;
      newPassCountFinal = 0;
      // round_starter stays the same
    } else {
      // Advance to next non-finished player
      let current = player.seat;
      nextTurn = player.seat; // fallback
      for (let i = 0; i < 4; i++) {
        current = (current + 1) % 4;
        const seatInfo = allPlayers.find((p) => p.seat === current);
        if (seatInfo && !seatInfo.is_finished) {
          nextTurn = current;
          break;
        }
      }
    }

    // Update room
    const { error: roomUpdateError } = await supabase
      .from("big2_rooms")
      .update({
        pass_count: newPassCountFinal,
        current_turn: nextTurn,
        last_play: newLastPlay,
        round_starter: newRoundStarter,
      })
      .eq("id", roomId);

    if (roomUpdateError) {
      return Response.json(
        { error: "Failed to update room" },
        { status: 500 }
      );
    }

    // Broadcast pass
    const channel = supabase.channel(`room:${room.code}`);
    await channel.send({
      type: "broadcast",
      event: "pass",
      payload: { seat: player.seat },
    });

    await channel.send({
      type: "broadcast",
      event: "turn_change",
      payload: {
        currentTurn: nextTurn,
        roundCleared: newPassCount >= passesNeeded,
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
