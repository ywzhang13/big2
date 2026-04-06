import { getSupabaseServer } from "@/lib/supabase-server";
import { calculateScore } from "@/lib/scoring";
import { dealAndStart } from "@/lib/deal-and-start";
import type { Card } from "@/lib/constants";

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
      .select("id, code, host_id, status, scores")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Verify player is host
    if (room.host_id !== playerId) {
      return Response.json(
        { error: "只有房主可以繼續遊戲" },
        { status: 403 }
      );
    }

    if (room.status !== "finished") {
      return Response.json(
        { error: "遊戲尚未結束" },
        { status: 400 }
      );
    }

    // Get all players
    const { data: players, error: playersError } = await supabase
      .from("big2_players")
      .select("player_id, name, seat, hand, is_finished, finish_order")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (playersError || !players || players.length !== 4) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // Calculate scores from current hands
    const existingScores: Record<string, number> =
      (room.scores as Record<string, number>) ?? {};

    const roundScores: Record<string, number> = {};
    let loserTotal = 0;
    let winnerId: string | null = null;

    for (const p of players) {
      const hand = p.hand as Card[];
      const score = calculateScore(hand);
      roundScores[p.player_id] = score;

      if (score === 0) {
        winnerId = p.player_id;
      } else {
        loserTotal += score; // score is negative
      }
    }

    // Winner gets abs of losers' total
    if (winnerId) {
      roundScores[winnerId] = Math.abs(loserTotal);
    }

    // Accumulate scores
    for (const p of players) {
      existingScores[p.player_id] =
        (existingScores[p.player_id] ?? 0) + (roundScores[p.player_id] ?? 0);
    }

    // Deal new cards and start
    await dealAndStart(roomId, room.code, existingScores);

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
