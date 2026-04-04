import { getServerSupabase } from "@/lib/supabase-server";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import { Card } from "@/lib/constants";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, sessionToken, cards } = body as {
      roomId: string;
      sessionToken: string;
      cards: string[];
    };

    if (!roomId || !sessionToken || !cards || !Array.isArray(cards)) {
      return Response.json(
        { error: "Missing roomId, sessionToken, or cards" },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();

    // Get the player
    const { data: player, error: playerError } = await supabase
      .from("big2_players")
      .select("id, seat, hand, is_finished")
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

    // Validate the player has these cards
    const hand: Card[] = player.hand;
    for (const card of cards) {
      if (!hand.includes(card)) {
        return Response.json(
          { error: `Card ${card} not in hand` },
          { status: 400 }
        );
      }
    }

    // Detect combo
    const combo = detectCombo(cards as Card[]);
    if (!combo) {
      return Response.json(
        { error: "Invalid card combination" },
        { status: 400 }
      );
    }

    // Validate against last_play (if any)
    if (room.last_play) {
      const lastCombo = detectCombo(room.last_play.cards as Card[]);
      if (lastCombo && !beats(lastCombo, combo)) {
        return Response.json(
          { error: "Play does not beat the current cards on the table" },
          { status: 400 }
        );
      }
    }

    // Remove cards from hand
    const newHand = hand.filter((c: Card) => !cards.includes(c));
    const isFinished = newHand.length === 0;

    // Count how many players are already finished to determine finish_order
    let finishOrder: number | null = null;
    if (isFinished) {
      const { data: finishedPlayers } = await supabase
        .from("big2_players")
        .select("id")
        .eq("room_id", roomId)
        .eq("is_finished", true);

      finishOrder = (finishedPlayers?.length ?? 0) + 1;
    }

    // Update player
    const { error: updatePlayerError } = await supabase
      .from("big2_players")
      .update({
        hand: newHand,
        card_count: newHand.length,
        is_finished: isFinished,
        ...(finishOrder !== null ? { finish_order: finishOrder } : {}),
      })
      .eq("id", player.id);

    if (updatePlayerError) {
      return Response.json(
        { error: "Failed to update player" },
        { status: 500 }
      );
    }

    // Check if game is over (3 players finished = only 1 left)
    const { data: allPlayers } = await supabase
      .from("big2_players")
      .select("id, seat, hand, is_finished, name, finish_order")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    const activePlayers = allPlayers?.filter((p) => !p.is_finished) ?? [];
    const gameOver = activePlayers.length <= 1;

    if (gameOver && activePlayers.length === 1) {
      // Mark the last player as finished
      const lastPlayer = activePlayers[0];
      const lastFinishOrder = (finishOrder ?? 0) + 1;
      await supabase
        .from("big2_players")
        .update({ is_finished: true, finish_order: lastFinishOrder })
        .eq("id", lastPlayer.id);
    }

    // Determine next turn
    let nextTurn = room.current_turn;
    if (!gameOver) {
      // Find next non-finished player
      const seats = allPlayers!.map((p) => ({
        seat: p.seat,
        finished: p.id === player.id ? isFinished : p.is_finished,
      }));

      let current = player.seat;
      for (let i = 0; i < 4; i++) {
        current = (current + 1) % 4;
        const seatInfo = seats.find((s) => s.seat === current);
        if (seatInfo && !seatInfo.finished) {
          nextTurn = current;
          break;
        }
      }
    }

    // Update room
    const { error: roomUpdateError } = await supabase
      .from("big2_rooms")
      .update({
        last_play: { cards, type: combo.type, seat: player.seat },
        current_turn: nextTurn,
        pass_count: 0,
        round_starter: player.seat,
        ...(gameOver ? { status: "finished" } : {}),
      })
      .eq("id", roomId);

    if (roomUpdateError) {
      return Response.json(
        { error: "Failed to update room" },
        { status: 500 }
      );
    }

    // Broadcast play_cards
    const channel = supabase.channel(`room:${room.code}`);
    await channel.send({
      type: "broadcast",
      event: "play_cards",
      payload: {
        seat: player.seat,
        cards,
        comboType: combo.type,
        cardsLeft: newHand.length,
      },
    });

    if (!gameOver) {
      await channel.send({
        type: "broadcast",
        event: "turn_change",
        payload: { currentTurn: nextTurn },
      });
    } else {
      // Broadcast game_over with remaining hands
      const results = allPlayers!.map((p) => ({
        seat: p.seat,
        name: p.name,
        hand: p.hand,
        finishOrder: p.id === player.id ? finishOrder : p.finish_order,
      }));

      await channel.send({
        type: "broadcast",
        event: "game_over",
        payload: { results },
      });
    }

    return Response.json({
      success: true,
      combo_type: combo.type,
      game_over: gameOver,
    });
  } catch (err) {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
