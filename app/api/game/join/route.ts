import { findRoomByCode, insertSeat, loadSeats } from "@/lib/big2/roomStore";
import { broadcast } from "@/lib/broadcast";
import { endedResponse } from "@/lib/records/close";
import { hashSeatKey, newSeatKey } from "@/lib/big2/startConfirm";
import { saveSeatKeyHash } from "@/lib/big2/startConfirmStore";

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

    // Find room by code
    const room = await findRoomByCode(code);

    if (!room) {
      const ended = await endedResponse("big2", { code });
      if (ended) return ended;
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // Check existing players
    let existingPlayers: { seat: number; player_id: string }[];
    try {
      existingPlayers = await loadSeats(room.id);
    } catch {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // 原本就坐在房裡的人（重新整理、用 #room= 連結回來）：不管牌局進行到哪（playing／finished），都回原座位
    // （先認座位再看狀態；原本先擋非 waiting，開局後重新整理就回不到牌桌）
    const existing = existingPlayers.find((p) => p.player_id === playerId);
    if (existing) {
      return Response.json({
        seat: existing.seat,
        roomId: room.id,
        rejoined: true,
      });
    }

    // 不在房裡的人（含退出後再來的）開局後不能加入
    if (room.status !== "waiting") {
      return Response.json({ error: "game_in_progress", message: "房間已開始遊戲，無法加入" }, { status: 409 });
    }

    if (existingPlayers.length >= 4) {
      return Response.json({ error: "房間已滿" }, { status: 400 });
    }

    // Find next available seat
    const takenSeats = new Set(existingPlayers.map((p) => p.seat));
    let seat = -1;
    for (let i = 0; i < 4; i++) {
      if (!takenSeats.has(i)) {
        seat = i;
        break;
      }
    }

    // Insert player
    // 入座憑證（審伯複審 R4）：只在第一次入座的這個回應給本人，資料庫只存雜湊；發起、取消開局確認時房主要帶（lib/big2/startConfirm.ts）。
    // 重新加入（上面 rejoined）不再給：只知道玩家 id 的人拿不到。前端要把它和玩家 id 一起存著
    // 雜湊存在只有伺服器能讀寫的 big2_seat_keys（公開表放雜湊，任何人都能改成自己的值）。先存再入座：存不進去就不入座
    const seatKey = newSeatKey();
    await saveSeatKeyHash(room.id, playerId, hashSeatKey(seatKey));
    const insertError = await insertSeat({ room_id: room.id, player_id: playerId, name, seat });

    if (insertError) {
      if (insertError.code === "23505") {
        return Response.json({ error: "座位已被佔用，請重試" }, { status: 409 });
      }
      return Response.json({ error: "加入房間失敗" }, { status: 500 });
    }

    // Broadcast player joined
    await broadcast(room.code, "player_joined", {
      playerId,
      name,
      seat,
      playerCount: existingPlayers.length + 1,
    });

    return Response.json({ seat, roomId: room.id, seatKey });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
