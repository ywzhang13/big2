import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { broadcast } from "@/lib/broadcast";
import { isSeatInPerson } from "@/lib/big2/startConfirm";
import { big2RoundScores } from "@/lib/scoring";
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
    const { roomId, playerId, seatKey } = body as {
      roomId?: string;
      playerId?: string;
      seatKey?: unknown;
    };

    if (!roomId || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    // 座位本人才能按繼續（2026-11-27，同出牌、過）：原本只填別人的玩家 id 就能替他按，湊滿四家就開下一局
    if (!(await isSeatInPerson(roomId, playerId, seatKey))) {
      return Response.json({ error: "not_your_seat", message: "請重新整理後再操作" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();

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
    const roundScores = big2RoundScores(
      players.map((p) => ({ player_id: p.player_id, hand: p.hand as Card[] }))
    );
    for (const p of players) {
      existingScores[p.player_id] =
        (existingScores[p.player_id] ?? 0) + (roundScores[p.player_id] ?? 0);
    }

    // Clear ready list as part of the deal (dealAndStart also sets ready_players: [])
    // 下一場從 finished 開局；發牌途中房間被動過就不開局，回 409
    if (!(await dealAndStart(roomId, room.code, existingScores, ["finished"]))) {
      return Response.json({ error: "room_changed" }, { status: 409 });
    }

    return Response.json({ success: true, ready: 4, total: 4, started: true });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
