// 名字（共用開房流程，和十三支一樣，2026-11-20）：去掉前後空白後 1～8 個字（Array.from 算，表情符號算 1 個字），不合法回 400 bad_name；
// 等人時同一個帳號重新加入、名字換了 → 座位名字換新，廣播 mj_player_joined（renamed: true）；開局後重新加入名字不變。
// 入座廣播帶 avatarUrl（LINE 大頭照，沒有是 null），等人畫面直接顯示。
import { insertPlayer, loadRoomByCode, loadSeats, renameLobbyPlayer } from "@/lib/mahjong/db";
import { NAME_MESSAGE, normalizeName } from "@/lib/thirteen/playerName";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { endedResponse } from "@/lib/records/close";
import { getAuthUser, getPictureUrls } from "@/lib/auth";
import { notLoggedIn, notYourSeat, privateChannelName } from "@/lib/mahjong/access";
import { suspendedError } from "@/lib/roomCard/guard";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name: rawName, playerId } = body as {
      code?: string;
      name?: string;
      playerId?: string;
    };

    if (!code || !playerId) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }
    // 名字：空字串、只有空白、不是字串、超過 8 字都回 bad_name（審伯 R2），不入座、不改名
    const name = normalizeName(rawName);
    if (!name) return Response.json({ error: "bad_name", message: NAME_MESSAGE }, { status: 400 });

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
      // 開局後座位已隨機打亂：以牌局狀態裡的座位為準（mj_players.seat 只是入座順序）
      const gameSeat = (room.game_state as { players?: { id: string; seat: number }[] } | null)?.players?.find((p) => p.id === mine.player_id)?.seat;
      // 等人時換了名字：座位名字換新、通知同桌（開局後名字已寫進牌局，不改）。
      // 改名和開局由資料庫函式排先後（審伯 R1）：這裡讀到 waiting 之後才開局的，函式會回 started，不改、不廣播
      if (room.status === "waiting" && mine.name !== name && (await renameLobbyPlayer(room.id, mine.player_id, name)) === "renamed") {
        const [avatarUrl] = await getPictureUrls([user.id]);
        await mjBroadcast(room.code, "mj_player_joined", { playerId: mine.player_id, name, seat: mine.seat, playerCount: existingPlayers.length, renamed: true, avatarUrl });
      }
      return Response.json({ seat: gameSeat ?? mine.seat, roomId: room.id, rejoined: true, ...seatInfo(mine.player_id) });
    }

    // 這個玩家 id 已經坐下、但不是這個帳號（別人的座位，或上線前沒綁帳號的舊座位）
    if (existingPlayers.some((p) => p.player_id === playerId)) return notYourSeat();

    // 遊客和 LINE 玩家不同桌：遊客房只收遊客、一般房只收 LINE 玩家（遊客的牌局不會出現在 LINE 帳號的歷史紀錄）
    const guestRoom = (room.game_state as { guestRoom?: boolean } | null)?.guestRoom === true;
    // started：房間已開局，前端改走觀戰（訪客則提示要 LINE 登入）
    const started = room.status !== "waiting";
    if (guestRoom !== user.isGuest) {
      return Response.json({ error: guestRoom ? "guest_room" : "guest_not_allowed", started }, { status: 403 });
    }

    // 房卡：被暫停的人不能加入新房（403 suspended）；上面已經坐下的人重新加入不擋，正在打的那一場照常打完
    const suspended = await suspendedError(user.id);
    if (suspended) return suspended;

    // New player — only allow if still in lobby
    if (started) {
      return Response.json({ error: "房間已開始遊戲，無法加入", started }, { status: 400 });
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

    // Broadcast player joined（帶大頭照，等人畫面直接顯示）
    const [avatarUrl] = await getPictureUrls([user.id]);
    await mjBroadcast(room.code, "mj_player_joined", {
      playerId,
      name,
      seat,
      playerCount: existingPlayers.length + 1,
      avatarUrl,
    });

    return Response.json({ seat, roomId: room.id, ...seatInfo(playerId) });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
