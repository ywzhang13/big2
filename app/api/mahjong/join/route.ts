import { insertPlayer, loadRoomByCode, loadSeats } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { endedResponse } from "@/lib/records/close";
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn, notYourSeat, privateChannelName } from "@/lib/mahjong/access";

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
    const room = await loadRoomByCode(code);

    if (!room) {
      // 這個房號剛結束、房間已刪（例如結算後重新整理）：回「這場已結束」（410）
      const ended = await endedResponse("mahjong", { code });
      if (ended) return ended;
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    // 一定要登入（所有麻將房間）
    const user = await getAuthUser(request);
    if (!user) return notLoggedIn();
    // 回傳本人的玩家 id 和座位頻道（手牌等私人事件走這裡）
    const seatInfo = (pid: string) => ({ playerId: pid, privateChannel: privateChannelName(room.code, pid) });

    // Check existing players first so rejoins (refresh / disconnect) work
    // even while status==="playing".
    let existingPlayers: Awaited<ReturnType<typeof loadSeats>>;
    try {
      existingPlayers = await loadSeats(room.id);
    } catch {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // 同一個人已經坐下（換裝置、清掉瀏覽器資料）→ 回到原本的座位，沿用原本的玩家 id
    const mine = existingPlayers.find((p) => p.user_id === user.id);
    if (mine) {
      return Response.json({ seat: mine.seat, roomId: room.id, rejoined: true, ...seatInfo(mine.player_id) });
    }

    // 這個玩家 id 已經坐下、但不是這個帳號（別人的座位，或上線前沒綁帳號的舊座位）
    if (existingPlayers.some((p) => p.player_id === playerId)) return notYourSeat();

    // New player — only allow if still in lobby
    if (room.status !== "waiting") {
      return Response.json({ error: "房間已開始遊戲，無法加入" }, { status: 400 });
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
    const inserted = await insertPlayer({
      room_id: room.id,
      player_id: playerId,
      name,
      seat,
      user_id: user.id,
    }).catch(() => null);

    if (inserted === "duplicate") {
      return Response.json({ error: "座位已被佔用，請重試" }, { status: 409 });
    }
    if (!inserted) {
      return Response.json({ error: "加入房間失敗" }, { status: 500 });
    }

    // Broadcast player joined
    await mjBroadcast(room.code, "mj_player_joined", {
      playerId,
      name,
      seat,
      playerCount: existingPlayers.length + 1,
    });

    return Response.json({ seat, roomId: room.id, ...seatInfo(playerId) });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
