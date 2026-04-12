import { getSupabaseServer } from "../supabase-server";
import { MahjongGameState, PlayerState } from "./gameState";
import { Tile } from "./tiles";

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

export interface MjRoom {
  id: string;
  code: string;
  status: string;
  host_id: string | null;
  game_state: MahjongGameState | null;
}

export interface MjPlayer {
  id: string;
  room_id: string;
  player_id: string;
  name: string;
  seat: number;
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

export async function loadRoom(roomId: string): Promise<MjRoom | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("mj_rooms")
    .select("id, code, status, host_id, game_state")
    .eq("id", roomId)
    .single();

  if (error || !data) return null;
  return data as MjRoom;
}

export async function loadRoomByCode(code: string): Promise<MjRoom | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("mj_rooms")
    .select("id, code, status, host_id, game_state")
    .eq("code", code)
    .single();

  if (error || !data) return null;
  return data as MjRoom;
}

export async function saveGameState(
  roomId: string,
  state: MahjongGameState,
  status?: string
): Promise<void> {
  const supabase = getSupabaseServer();
  const update: Record<string, unknown> = { game_state: state };
  if (status) update.status = status;

  const { error } = await supabase
    .from("mj_rooms")
    .update(update)
    .eq("id", roomId);

  if (error) {
    throw new Error(`Failed to save game state: ${error.message}`);
  }
}

export async function loadPlayers(roomId: string): Promise<MjPlayer[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("mj_players")
    .select("id, room_id, player_id, name, seat")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });

  if (error) return [];
  return (data ?? []) as MjPlayer[];
}

// ---------------------------------------------------------------------------
// State sanitization — strip concealed hands for broadcast
// ---------------------------------------------------------------------------

export interface PublicPlayerState {
  id: string;
  name: string;
  seat: number;
  tileCount: number;
  revealed: PlayerState["revealed"];
  flowers: Tile[];
  discards: Tile[];
  isDealer: boolean;
}

export function toPublicPlayerState(player: PlayerState): PublicPlayerState {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    tileCount: player.hand.length,
    revealed: player.revealed,
    flowers: player.flowers,
    discards: player.discards,
    isDealer: player.isDealer,
  };
}

export interface PublicGameState {
  roomCode: string;
  status: MahjongGameState["status"];
  players: PublicPlayerState[];
  wallCount: number;
  currentTurn: number;
  lastDiscard: MahjongGameState["lastDiscard"];
  dealerSeat: number;
  prevalentWind: number;
  turnCount: number;
  hasDrawn: boolean;
  winner?: MahjongGameState["winner"];
}

export function toPublicGameState(state: MahjongGameState): PublicGameState {
  return {
    roomCode: state.roomCode,
    status: state.status,
    players: state.players.map(toPublicPlayerState),
    wallCount: state.wall.length,
    currentTurn: state.currentTurn,
    lastDiscard: state.lastDiscard,
    dealerSeat: state.dealerSeat,
    prevalentWind: state.prevalentWind,
    turnCount: state.turnCount,
    hasDrawn: state.hasDrawn,
    winner: state.winner,
  };
}

/** Build state view for a specific player (includes their hand) */
export function toPlayerGameState(
  state: MahjongGameState,
  playerId: string
): PublicGameState & { hand?: Tile[] } {
  const pub = toPublicGameState(state);
  const player = state.players.find((p) => p.id === playerId);
  return {
    ...pub,
    hand: player?.hand,
  };
}

export function findSeatByPlayerId(
  state: MahjongGameState,
  playerId: string
): number {
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined) return -1;
  return player.seat;
}
