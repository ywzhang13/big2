import { getSupabaseServer } from "./supabase-server";
import { broadcast } from "./broadcast";
import { deal } from "./deck";
import type { Card } from "./constants";

/**
 * Deal cards to all players, find who has 3C, update DB, and broadcast game_start.
 * Used by both /api/game/ready (when all ready) and /api/game/continue.
 */
export async function dealAndStart(
  roomId: string,
  roomCode: string,
  existingScores?: Record<string, number>
): Promise<void> {
  const supabase = getSupabaseServer();

  // Get players ordered by seat
  const { data: players, error: playersError } = await supabase
    .from("big2_players")
    .select("id, player_id, name, seat")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });

  if (playersError || !players || players.length !== 4) {
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
    const hand: Card[] = hands[player.seat];

    const { error } = await supabase
      .from("big2_players")
      .update({
        hand,
        card_count: 13,
        is_finished: false,
        finish_order: null,
      })
      .eq("id", player.id);

    if (error) {
      throw new Error("更新玩家手牌失敗");
    }
  }

  // Update room status
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

  const { error: roomError } = await supabase
    .from("big2_rooms")
    .update(roomUpdate)
    .eq("id", roomId);

  if (roomError) {
    throw new Error("更新房間狀態失敗");
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
}
