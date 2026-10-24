import { broadcast } from "@/lib/broadcast";
import { deal } from "./deck";
import type { Card } from "./constants";
import { loadRoomForDeal, loadSeatedPlayers, saveHand, startRoomIfUnchanged } from "@/lib/big2/dealStore";

/**
 * Deal cards to all players, find who has 3C, update DB, and broadcast game_start.
 * Used by both /api/game/ready (when all ready) and /api/game/continue.
 * 回傳 true＝開局了；false＝發牌途中房間被動過（例如有人在等人階段退出），沒有開局、也沒有廣播（呼叫端回 409）。
 * 最後改成 playing 時用「讀座位之前的 row_version」和狀態做條件（審伯 2026-10-24）：
 * 讀完座位後有人退出（退出會改房間、row_version +1），就不會用舊的 4 人名單開局。
 * statuses：允許從哪些狀態開局（第一場是 waiting／ready_check；/api/game/continue 的下一場是 finished）。
 */
export async function dealAndStart(
  roomId: string,
  roomCode: string,
  existingScores?: Record<string, number>,
  statuses: string[] = ["waiting", "ready_check"]
): Promise<boolean> {
  // 先記下房間版本，再讀座位
  const before = await loadRoomForDeal(roomId);
  if (!before || !statuses.includes(before.status)) return false;

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

  // Send each player their hand individually via a private channel event
  for (let i = 0; i < 4; i++) {
    const player = players[i];
    const hand: Card[] = hands[player.seat];

    await broadcast(roomCode, "deal_hand", {
      playerId: player.player_id,
      hand,
    });
  }
  return true;
}
