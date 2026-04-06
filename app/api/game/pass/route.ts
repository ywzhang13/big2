import { getSupabaseServer } from "@/lib/supabase-server";
import { broadcast } from "@/lib/broadcast";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  current_turn: number;
  last_play: {
    seat: number;
    cards: string[];
    combo: Record<string, unknown>;
    playerName: string;
  } | null;
  pass_count: number;
  round_starter: number;
}

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
      .select(
        "id, code, status, current_turn, last_play, pass_count, round_starter"
      )
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    const typedRoom = room as RoomRow;

    if (typedRoom.status !== "playing") {
      return Response.json({ error: "遊戲尚未開始" }, { status: 400 });
    }

    // Get player
    const { data: player, error: playerError } = await supabase
      .from("big2_players")
      .select("id, player_id, name, seat, is_finished")
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .single();

    if (playerError || !player) {
      return Response.json({ error: "找不到玩家" }, { status: 404 });
    }

    // Verify it's their turn
    if (player.seat !== typedRoom.current_turn) {
      return Response.json({ error: "還沒輪到你" }, { status: 400 });
    }

    // Can't pass on free play (no last_play)
    if (typedRoom.last_play === null) {
      return Response.json({ error: "自由出牌時不能 PASS" }, { status: 400 });
    }

    // Get all players to determine active count and next turn
    const { data: allPlayers } = await supabase
      .from("big2_players")
      .select("player_id, seat, is_finished")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (!allPlayers) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    const activePlayers = allPlayers.filter((p) => !p.is_finished);
    const newPassCount = typedRoom.pass_count + 1;

    // Check if round clears: all other active players have passed
    const clearRound = newPassCount >= activePlayers.length - 1;

    let nextTurn: number;

    if (clearRound) {
      // Round clears: turn goes back to round_starter, last_play is cleared
      nextTurn = typedRoom.round_starter;

      // If the round starter has finished, find next active player
      const starter = allPlayers.find(
        (p) => p.seat === typedRoom.round_starter
      );
      if (starter?.is_finished) {
        for (let i = 1; i <= 4; i++) {
          const candidateSeat = (typedRoom.round_starter + i) % 4;
          const candidate = allPlayers.find((p) => p.seat === candidateSeat);
          if (candidate && !candidate.is_finished) {
            nextTurn = candidateSeat;
            break;
          }
        }
      }

      await supabase
        .from("big2_rooms")
        .update({
          current_turn: nextTurn,
          last_play: null,
          pass_count: 0,
          round_starter: nextTurn,
        })
        .eq("id", roomId);
    } else {
      // Advance to next active player
      nextTurn = player.seat;
      for (let i = 1; i <= 4; i++) {
        const candidateSeat = (player.seat + i) % 4;
        const candidate = allPlayers.find((p) => p.seat === candidateSeat);
        if (candidate && !candidate.is_finished) {
          nextTurn = candidateSeat;
          break;
        }
      }

      await supabase
        .from("big2_rooms")
        .update({
          current_turn: nextTurn,
          pass_count: newPassCount,
        })
        .eq("id", roomId);
    }

    await broadcast(typedRoom.code, "pass", {
      seat: player.seat,
      playerName: player.name,
      passCount: clearRound ? 0 : newPassCount,
      nextTurn,
      clearRound,
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
