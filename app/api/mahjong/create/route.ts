import { insertRoom } from "@/lib/mahjong/db";
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { after } from "next/server";
import { sweepIdleRooms } from "@/lib/records/close";

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hostId, totalRounds, basePoints, fanPoints } = body as {
      hostId?: string;
      totalRounds?: number;
      basePoints?: number;
      fanPoints?: number;
    };

    if (!hostId) {
      return Response.json({ error: "缺少 hostId" }, { status: 400 });
    }
    // 麻將一定要登入（LINE 或遊客）才能建房
    const user = await getAuthUser(request);
    if (!user) return notLoggedIn();

    // Validate settings
    const validRounds = [1, 2, 4, 8];
    const rounds = totalRounds && validRounds.includes(totalRounds) ? totalRounds : undefined;
    const base = basePoints && basePoints > 0 ? basePoints : undefined;
    const fan = fanPoints && fanPoints > 0 ? fanPoints : undefined;

    // Build room settings if any were provided
    const roomSettings = rounds != null ? {
      totalRounds: rounds,
      basePoints: base ?? 10,
      fanPoints: fan ?? 10,
    } : undefined;

    let code = "";
    let roomId = "";

    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateCode();

      // Store settings in game_state so they persist；遊客建的房標成遊客房（LINE 玩家不能加入，見 join）
      const lobbyState = { ...(roomSettings ? { roomSettings } : {}), ...(user.isGuest ? { guestRoom: true } : {}) };
      const inserted = await insertRoom({
        code,
        status: "waiting",
        host_id: hostId,
        game_state: Object.keys(lobbyState).length > 0 ? lobbyState : null,
      }).catch(() => null);
      if (inserted === "duplicate") continue;
      if (!inserted) {
        return Response.json({ error: "建立房間失敗" }, { status: 500 });
      }

      roomId = inserted.id;
      break;
    }

    if (!roomId) {
      return Response.json({ error: "無法產生房間代碼，請重試" }, { status: 500 });
    }

    // 建房時順便清閒置太久的房間（打過牌的先記成中途解散）；回應送出後才跑，不拖慢建房
    after(() => sweepIdleRooms().then(() => undefined));

    return Response.json({ code, roomId, roomSettings });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
