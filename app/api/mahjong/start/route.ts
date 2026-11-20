// 麻將開始（房主）：POST { roomId, playerId }。2026-11-20 起（老闆定案，同十三支、大老二）不直接發牌，而是發起開局確認：
//   房主自己算同意，倒數 10 秒；另外三家按 /api/mahjong/start-confirm 同意，四家都同意才發牌開局、扣房卡。
//   倒數到了還有人沒按 → 不開局、回到等人，房主要再按一次（重新倒數 10 秒）。已經有一個還在倒數的就回那一個，不重新計時。
//   成功 200 { success, ok, confirm: { id, startedBy, readyIds, seatIds, deadline, serverNow } }（舊前端只看 success，不會壞）
//   錯誤照舊：不是房主 403、已開始 400、不滿 4 人 400、沒登入 401／不是本人 403、有人被暫停 403 player_suspended（不進確認）
import { loadRoom, loadPlayers, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { startBlockedError } from "@/lib/roomCard/guard";
import { beginMjConfirm } from "@/lib/mahjong/startConfirm";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleStart(request, body, fresh));
}

/** 發起開局確認。寫入都是等人階段的條件寫入：同時送兩次只會成功一次，另一次重讀後回同一個確認 */
async function handleStart(request: Request, body: unknown, fresh: boolean): Promise<Response> {
  const { roomId, playerId } = body as {
    roomId?: string;
    playerId?: string;
  };

  if (!roomId || !playerId) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  // Load room
  const room = await loadRoom(roomId, { fresh });
  if (!room) {
    return Response.json({ error: "找不到房間" }, { status: 404 });
  }

  // Verify host
  if (room.host_id !== playerId) {
    return Response.json({ error: "只有房主可以開始遊戲" }, { status: 403 });
  }

  if (room.status !== "waiting") {
    return Response.json({ error: "遊戲已開始" }, { status: 400 });
  }

  // Load players
  const players = await loadPlayers(roomId);
  // 確認是房主本人（還沒開局，座位主人從 mj_players 查）
  const denied = await seatOwnerError(request, room.game_state, playerId, players.find((p) => p.player_id === playerId)?.user_id ?? null);
  if (denied) return denied;
  if (players.length !== 4) {
    return Response.json({ error: "需要 4 位玩家才能開始" }, { status: 400 });
  }
  // 房卡：房裡有人被暫停就不能開局（403 player_suspended，回那個人的座位和名字）
  const blocked = await startBlockedError(players.map((p) => ({ userId: p.user_id ?? null, name: p.name, seat: p.seat })));
  if (blocked) return blocked;

  // 2026-11-20 起（老闆定案）不直接發牌：發起開局確認，四家都同意才發牌（lib/mahjong/startConfirm.ts → lib/mahjong/startGame.ts）
  return beginMjConfirm(room, players, playerId);
}
