import { getSupabaseServer } from "@/lib/supabase-server";
import { broadcast } from "@/lib/broadcast";
import { calculateScore } from "@/lib/scoring";
import { dealAndStart } from "@/lib/deal-and-start";
import type { Card } from "@/lib/constants";

/**
 * 繼續下一局 — 四家同意制（與麻將 next-game 相同邏輯）。
 *
 * 流程：
 *   1. 任一玩家呼叫此端點時，把 playerId 加到 ready_players
 *   2. 廣播 `next_game_ready` 讓其他玩家看到進度
 *   3. 只有當四人都同意時，才結算上局分數並發新牌
 *
 * 原本僅限房主一鍵繼續；改為四家同意以避免有人還在看結算時被拉進下一局。
 */
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

    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, host_id, status, scores, ready_players")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }
    if (room.status !== "finished") {
      return Response.json({ error: "遊戲尚未結束" }, { status: 400 });
    }

    // Verify player is actually in the room
    const { data: playerCheck } = await supabase
      .from("big2_players")
      .select("player_id")
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (!playerCheck) {
      return Response.json({ error: "玩家不在此房間" }, { status: 403 });
    }

    const readyList: string[] = Array.isArray(room.ready_players)
      ? (room.ready_players as string[])
      : [];
    if (!readyList.includes(playerId)) {
      readyList.push(playerId);
    }

    if (readyList.length < 4) {
      // Still waiting — persist and broadcast progress
      await supabase
        .from("big2_rooms")
        .update({ ready_players: readyList })
        .eq("id", roomId);
      await broadcast(room.code, "next_game_ready", {
        readyIds: readyList,
      });
      return Response.json({ success: true, ready: readyList.length, total: 4 });
    }

    // All 4 ready — compute round scores and deal new hand
    const { data: players, error: playersError } = await supabase
      .from("big2_players")
      .select("player_id, name, seat, hand, is_finished, finish_order")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (playersError || !players || players.length !== 4) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

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
        loserTotal += score;
      }
    }
    if (winnerId) {
      roundScores[winnerId] = Math.abs(loserTotal);
    }
    for (const p of players) {
      existingScores[p.player_id] =
        (existingScores[p.player_id] ?? 0) + (roundScores[p.player_id] ?? 0);
    }

    // Clear ready list as part of the deal (dealAndStart also sets ready_players: [])
    await dealAndStart(roomId, room.code, existingScores);

    return Response.json({ success: true, ready: 4, total: 4, started: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
