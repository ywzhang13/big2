import { applyZimoFx, prefetchZimoFx } from "@/lib/mahjong/zimoFx/attach";
import {
  loadRoom,
  loadPlayers,
  saveGameStateIfUnchanged,
  toPublicGameState,
  retryOnConflict,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { getPictureUrls } from "@/lib/auth";
import { mjBroadcast, mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { applyPace, dealPaceMs } from "@/lib/mahjong/pace";
import { initGame, dealTiles, eyeDiscardOptions, canDeclareTingNow, shuffleSeats } from "@/lib/mahjong/gameLogic";
import { applySettlement, flowerRobEvents, gameOverEvent } from "@/lib/mahjong/events";
import { closeMahjongIfOver } from "@/lib/records/close";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  return retryOnConflict((fresh) => handleStart(request, body, fresh));
}

/**
 * 開局。條件寫入：只有房間狀態還是讀出時的版本才寫入（同一筆 update 也把
 * status 改成 playing／finished），所以同時送兩次開局時，晚到的那次會衝突、
 * 重新讀到 status 已不是 waiting 而被擋下，不會蓋掉已開的局、也不會重複廣播。
 */
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

  // 開局隨機排座位（老闆 2026-10-17）：牌局狀態的座位以這個順序為準；mj_players.seat 只代表入座順序，不再改它。
  // userId 跟著玩家走，所以 LINE 帳號認座位、找回房間、對局紀錄、整場統計都用新座位
  const seated = shuffleSeats(players);

  // Initialize game — pass room settings if present
  const playerInfos = seated.map((p) => ({
    id: p.player_id,
    name: p.name,
  }));

  const savedSettings = (room.game_state as unknown as Record<string, unknown>)?.roomSettings as
    | { totalRounds: number; basePoints: number; fanPoints: number }
    | undefined;

  let state = initGame(playerInfos, savedSettings);
  state.roomCode = room.code;
  // 記下每個座位綁定的使用者，之後每個動作都用它確認本人、整場結束寫進對局紀錄
  state.players.forEach((p, i) => (p.userId = seated[i].user_id ?? null));
  // 同桌顯示 LINE 大頭貼（老闆 2026-10-29）：開局時取一次，之後每局沿用
  // 自摸特效和大頭貼同時查（不多串一次往返）：公開座位資料帶代號讓前端預載；起手就胡也照這個
  const zimoFxPrefs = prefetchZimoFx(state);
  const pics = await getPictureUrls(state.players.map((p) => p.userId));
  state.players.forEach((p, i) => (p.avatarUrl = pics[i]));
  applyZimoFx(state, await zimoFxPrefs);

  // 第一局：從建房者開始逆時針數，第一把骰子點數決定第一個莊家
  // 起莊者 = 開門者（第一局同一顆骰子）
  const hostSeat = state.players.findIndex((p) => p.id === room.host_id);
  const baseSeat = hostSeat >= 0 ? hostSeat : 0;
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const d3 = 1 + Math.floor(Math.random() * 6);
  const sum = d1 + d2 + d3;
  const firstDealerSeat = (baseSeat + ((sum - 1) % 4)) % 4;
  state.dealerSeat = firstDealerSeat;
  if (state.roundInfo) {
    state.roundInfo.initialDealerSeat = firstDealerSeat;
  }

  // 對局紀錄：記開局時間；打完幾局從 0 開始算（applySettlement 會加）
  state.startedAt = new Date().toISOString();
  state.handsCompleted = 0;
  state = dealTiles(state);

  // 第一局起莊 = 開門，覆寫 dealTiles 重新骰出的 dice/doorSeat
  state.dice = [d1, d2, d3];
  state.doorSeat = firstDealerSeat;

  // 開局補花就八仙過海：這局直接結束（先照常送開局事件，最後送 mj_game_over）
  const endedAtDeal = state.status === "finished";
  if (endedAtDeal) applySettlement(state);

  // Save full state to DB
  const baseVersion = (room.game_state as { stateVersion?: number } | null)?.stateVersion;
  applyPace(state, dealPaceMs(state)); // 起手補花的特效播完，莊家才能打第一張
  await saveGameStateIfUnchanged(roomId, baseVersion, state, endedAtDeal ? "finished" : "playing");

  // Broadcast public game start (no hands)
  const publicState = toPublicGameState(state);
  await mjBroadcast(room.code, "mj_game_start", {
    currentTurn: publicState.currentTurn,
    dealerSeat: publicState.dealerSeat,
    prevalentWind: publicState.prevalentWind,
    wallCount: publicState.wallCount,
    players: publicState.players,
    roundInfo: state.roundInfo,
    playerScores: state.playerScores,
    dice: state.dice,
    doorSeat: state.doorSeat,
  });

  // Send each player their hand privately (defensive: filter flowers from hand)
  for (const player of state.players) {
    await mjBroadcast(room.code, "mj_deal_hand", {
      playerId: player.id,
      hand: player.hand.filter((t) => t.suit !== "f"),
      flowers: player.flowers,
      // 開局莊家打第一張時可以宣告眼牌（同時算地聽）：能宣告的出牌選項（其他人是空陣列）
      eyeOptions: eyeDiscardOptions(state, player.seat).map((t) => t.id),
      eyeWithTing: canDeclareTingNow(state, player.seat),
    });
  }

  // 開局就八仙過海 → 結束；開局就 7＋1 張花 → 等有 7 張的人決定要不要七搶一
  await mjBroadcastBatch(room.code, endedAtDeal ? [gameOverEvent(state)] : flowerRobEvents(state));
  if (endedAtDeal) await closeMahjongIfOver(roomId, room.code, state); // 只有一局又開局八仙：整場打完

  return Response.json({ success: true });
}
