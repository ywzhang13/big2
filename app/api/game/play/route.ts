import { getSupabaseServer } from "@/lib/supabase-server";
import { broadcast } from "@/lib/broadcast";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import type { Card } from "@/lib/constants";
import type { Combo } from "@/lib/combo";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  current_turn: number;
  last_play: {
    seat: number;
    cards: Card[];
    combo: Combo;
    playerName: string;
  } | null;
  pass_count: number;
  round_starter: number;
}

interface PlayerRow {
  id: string;
  player_id: string;
  name: string;
  seat: number;
  hand: Card[];
  card_count: number;
  is_finished: boolean;
  finish_order: number | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, playerId, cards } = body as {
      roomId?: string;
      playerId?: string;
      cards?: string[];
    };

    if (!roomId || !playerId || !cards || !Array.isArray(cards)) {
      return Response.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    if (cards.length === 0) {
      return Response.json({ error: "必須選擇至少一張牌" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Get room
    const { data: room, error: roomError } = await supabase
      .from("big2_rooms")
      .select("id, code, status, current_turn, last_play, pass_count, round_starter")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return Response.json({ error: "找不到房間" }, { status: 404 });
    }

    const typedRoom = room as RoomRow;

    if (typedRoom.status !== "playing") {
      return Response.json({ error: "遊戲尚未開始" }, { status: 400 });
    }

    // Get player
    const { data: player, error: playerError } = await supabase
      .from("big2_players")
      .select("id, player_id, name, seat, hand, card_count, is_finished, finish_order")
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .single();

    if (playerError || !player) {
      return Response.json({ error: "找不到玩家" }, { status: 404 });
    }

    const typedPlayer = player as PlayerRow;

    // Verify it's their turn
    if (typedPlayer.seat !== typedRoom.current_turn) {
      return Response.json({ error: "還沒輪到你" }, { status: 400 });
    }

    if (typedPlayer.is_finished) {
      return Response.json({ error: "你已經出完牌了" }, { status: 400 });
    }

    // Verify all cards are in hand
    const handSet = new Set(typedPlayer.hand);
    for (const card of cards) {
      if (!handSet.has(card)) {
        return Response.json(
          { error: `手牌中沒有 ${card}` },
          { status: 400 }
        );
      }
    }

    // Detect combo
    const combo = detectCombo(cards as Card[]);
    if (!combo) {
      return Response.json({ error: "無效的牌型" }, { status: 400 });
    }

    // Check if first turn of the game (round_starter has 3C, last_play is null, and no passes yet)
    const isFirstTurn =
      typedRoom.last_play === null && typedRoom.pass_count === 0;

    // First turn must include 3C
    // We check if this is the very first play by seeing if there's been any play at all
    // The first play of the entire game requires 3C
    if (isFirstTurn && !cards.includes("3C")) {
      // Check if any player has 3C (meaning it's the start of the game)
      const { data: allPlayers } = await supabase
        .from("big2_players")
        .select("hand, seat")
        .eq("room_id", roomId);

      const starterHas3C = allPlayers?.some(
        (p) =>
          p.seat === typedRoom.current_turn &&
          Array.isArray(p.hand) &&
          p.hand.includes("3C")
      );

      if (starterHas3C) {
        return Response.json(
          { error: "第一手必須出梅花3" },
          { status: 400 }
        );
      }
    }

    // If there's a last play, must beat it
    if (typedRoom.last_play !== null) {
      const lastCombo = detectCombo(typedRoom.last_play.cards as Card[]);
      if (lastCombo && !beats(lastCombo, combo)) {
        return Response.json(
          { error: "必須出比上家更大的牌" },
          { status: 400 }
        );
      }
    }

    // Remove cards from hand
    const newHand = typedPlayer.hand.filter((c) => !cards.includes(c));
    const newCardCount = newHand.length;
    const isFinished = newCardCount === 0;

    // Determine finish order if player finished
    let finishOrder: number | null = null;
    if (isFinished) {
      // Count how many players have already finished
      const { data: finishedPlayers } = await supabase
        .from("big2_players")
        .select("id")
        .eq("room_id", roomId)
        .eq("is_finished", true);

      finishOrder = (finishedPlayers?.length ?? 0) + 1;
    }

    // Update player in DB
    const playerUpdate: Record<string, unknown> = {
      hand: newHand,
      card_count: newCardCount,
    };
    if (isFinished) {
      playerUpdate.is_finished = true;
      playerUpdate.finish_order = finishOrder;
    }

    await supabase
      .from("big2_players")
      .update(playerUpdate)
      .eq("id", typedPlayer.id);

    // Get all players to determine next turn and game over
    const { data: allPlayers } = await supabase
      .from("big2_players")
      .select("player_id, name, seat, card_count, is_finished, hand")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });

    if (!allPlayers) {
      return Response.json({ error: "查詢玩家失敗" }, { status: 500 });
    }

    // Update the current player's data in allPlayers for accurate check
    const currentPlayerIdx = allPlayers.findIndex(
      (p) => p.player_id === playerId
    );
    if (currentPlayerIdx >= 0) {
      allPlayers[currentPlayerIdx].card_count = newCardCount;
      allPlayers[currentPlayerIdx].is_finished = isFinished;
    }

    // Game over when FIRST player finishes (Taiwan rules)
    const gameOver = isFinished && finishOrder === 1;

    // Calculate next turn (skip finished players)
    let nextTurn = typedPlayer.seat;
    if (!gameOver) {
      for (let i = 1; i <= 4; i++) {
        const candidateSeat = (typedPlayer.seat + i) % 4;
        const candidate = allPlayers.find((p) => p.seat === candidateSeat);
        if (candidate && !candidate.is_finished) {
          nextTurn = candidateSeat;
          break;
        }
      }
    }

    // Update room state
    const lastPlay = {
      seat: typedPlayer.seat,
      cards: combo.cards,
      combo: {
        type: combo.type,
        rank: combo.rank,
        suit: combo.suit,
        cards: combo.cards,
      },
      playerName: typedPlayer.name,
    };

    const roomUpdate: Record<string, unknown> = {
      current_turn: nextTurn,
      last_play: lastPlay,
      pass_count: 0,
      round_starter: typedPlayer.seat,
    };

    if (gameOver) {
      roomUpdate.status = "finished";
    }

    await supabase.from("big2_rooms").update(roomUpdate).eq("id", roomId);

    // Find winner name
    let winnerName: string | undefined;
    if (isFinished && finishOrder === 1) {
      winnerName = typedPlayer.name;
    }

    // Broadcast play
    const broadcastPayload: Record<string, unknown> = {
      seat: typedPlayer.seat,
      cards: combo.cards,
      combo: {
        type: combo.type,
        rank: combo.rank,
        suit: combo.suit,
        cards: combo.cards,
      },
      playerName: typedPlayer.name,
      cardCount: newCardCount,
      isFinished,
      finishOrder,
      nextTurn,
      gameOver,
      winner: winnerName,
    };

    await broadcast(typedRoom.code, "play_cards", broadcastPayload);

    // If game over, broadcast each player's remaining hand
    if (gameOver) {
      const hands: Record<string, Card[]> = {};
      for (const p of allPlayers) {
        hands[p.player_id] = p.player_id === playerId ? newHand : (p.hand as Card[]);
      }

      await broadcast(typedRoom.code, "game_over", {
        winner: winnerName ?? typedPlayer.name,
        hands,
        lastPlay: {
          cards: combo.cards,
          comboType: combo.type,
          playerName: typedPlayer.name,
        },
      });
    }

    return Response.json({ success: true, gameOver: gameOver ?? false });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
