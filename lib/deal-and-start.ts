import { broadcast } from "@/lib/broadcast";
import { deal } from "./deck";
import { loadRoomForDeal, loadSeatedPlayers, saveHand, startRoomIfUnchanged } from "@/lib/big2/dealStore";

/**
 * Deal cards to all players, find who has 3C, update DB, and broadcast game_start.
 * Used by both /api/game/ready (when all ready) and /api/game/continue.
 * 回傳 true＝開局了；false＝發牌途中房間被動過（例如有人在等人階段退出），沒有開局、也沒有廣播（呼叫端回 409）。
 * 最後改成 playing 時用「讀座位之前的 row_version」和狀態做條件（審伯 2026-10-24）：
 * 讀完座位後有人退出（退出會改房間、row_version +1），就不會用舊的 4 人名單開局。
 * statuses：允許從哪些狀態開局（第一場是 waiting／ready_check；/api/game/continue 的下一場是 finished）。
 * expectedRowVersion：開局確認用，只有房間版本還是這個值才開（lib/big2/startConfirm.ts）。
 */
export async function dealAndStart(
  roomId: string,
  roomCode: string,
  existingScores?: Record<string, number>,
  statuses: string[] = ["waiting", "ready_check"],
  expectedRowVersion?: number
): Promise<boolean> {
  // 先記下房間版本，再讀座位
  const before = await loadRoomForDeal(roomId);
  if (!before || !statuses.includes(before.status)) return false;
  // 開局確認（審伯 R2）：只能用「四家都同意的那次寫入」之後的版本開局；中間有人取消、重新開始、退出，版本就變了，不開
  if (expectedRowVersion !== undefined && before.row_version !== expectedRowVersion) return false;

  // Get players ordered by seat
  const players = await loadSeatedPlayers(roomId);
  if (players.length !== 4) {
    throw new Error("無法取得玩家資料");
  }

  // Deal cards
  const hands = deal();

  // Find who has 3C
  let starterSeat = 0;
  for (let i = 0; i < 4; i++) {
    if (hands[i].includes("3C")) {
      starterSeat = i;
      break;
    }
  }

  // Update each player's hand in DB
  for (let i = 0; i < 4; i++) {
    const player = players[i];
    await saveHand(player.id, hands[player.seat]);
  }

  // Update room status（條件寫入：版本和狀態都沒變才開局）
  const roomUpdate: Record<string, unknown> = {
    status: "playing",
    current_turn: starterSeat,
    last_play: null,
    pass_count: 0,
    round_starter: starterSeat,
    ready_players: [],
    start_confirm: null,      // 開局確認用完了（lib/big2/startConfirm.ts）
    last_start_confirm: null,
  };
  if (existingScores !== undefined) {
    roomUpdate.scores = existingScores;
  }

  if (!(await startRoomIfUnchanged(roomId, before.row_version, statuses, roomUpdate))) {
    return false; // 中間有人退出或房間被改過：不開局、不廣播（寫進去的手牌下一次發牌會覆蓋）
  }

  // Public broadcast: player info without hands
  const publicPlayers = players.map((p) => ({
    id: p.player_id,
    name: p.name,
    seat: p.seat,
    cardCount: 13,
  }));

  await broadcast(roomCode, "game_start", {
    currentTurn: starterSeat,
    roundStarter: starterSeat,
    players: publicPlayers,
    ...(existingScores !== undefined ? { scores: existingScores } : {}),
  });

  // 手牌不廣播（2026-11-27）：big2-<房號> 是公開頻道，知道房號的人都收得到。
  // 前端收到 game_start 後自己讀 /api/game/state，帶入座憑證才拿得到「自己」的手牌
  return true;
}
