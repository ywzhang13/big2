import { type NextRequest } from "next/server";
import { loadRoomPlayers, loadRoomState } from "@/lib/big2/roomStore";
import { endedResponse } from "@/lib/records/close";
import { confirmView, settleBig2Confirm } from "@/lib/big2/startConfirm";
import type { Card } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get("roomId");
    const playerId = searchParams.get("playerId");

    if (!roomId || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    // 開局確認中：時間到、或座位變了就先作廢（回到等人），再讀狀態（保底輪詢、前端倒數到 0 時讀一次都會觸發）
    if ((await loadRoomState(roomId))?.status === "ready_check") await settleBig2Confirm(roomId);

    // Get room
    const room = await loadRoomState(roomId);

    if (!room) {
      const ended = await endedResponse("big2", { roomId });
      if (ended) return ended;
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Get all players
    const allPlayers = await loadRoomPlayers(roomId);

    if (!allPlayers) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // Find requesting player
    const me = allPlayers.find((p) => p.player_id === playerId);
    if (!me) {
      return Response.json({ error: "你不在這個房間" }, { status: 403 });
    }

    // Build response: only include the requesting player's hand
    const players = allPlayers.map((p) => ({
      id: p.player_id,
      name: p.name,
      seat: p.seat,
      cardCount: p.card_count,
      isFinished: p.is_finished,
      finishOrder: p.finish_order,
    }));

    return Response.json({
      roomId: room.id,
      roomCode: room.code,
      status: room.status,
      hostId: room.host_id,
      currentTurn: room.current_turn,
      lastPlay: room.last_play,
      passCount: room.pass_count,
      roundStarter: room.round_starter,
      scores: room.scores,
      readyPlayers: room.ready_players,
      startConfirm: room.status === "ready_check" ? confirmView(room.start_confirm, Date.now()) : null, // 開局確認：誰已同意、截止時間
      lastStartConfirm: room.status === "waiting" ? (room.last_start_confirm ?? null) : null,         // 上一次為什麼沒開成、誰沒按
      players,
      myHand: me.hand as Card[],
      mySeat: me.seat,
    });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
