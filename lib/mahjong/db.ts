import { getSupabaseServer } from "../supabase-server";
import { MahjongGameState, PlayerState } from "./gameState";
import { Tile } from "./tiles";
import { cacheGameState, getCachedGameState } from "./cache";

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
  // Redis-first: if the room's game_state is cached, short-circuit Postgres.
  // We still need code/status/host_id from DB for correctness, so fetch a
  // lightweight row when cache hits.
  const cached = await getCachedGameState(roomId);
  const supabase = getSupabaseServer();
  if (cached) {
    const { data, error } = await supabase
      .from("mj_rooms")
      .select("id, code, status, host_id")
      .eq("id", roomId)
      .single();
    if (!error && data) {
      return { ...data, game_state: cached } as MjRoom;
    }
    // fall through on cache/DB row miss
  }
  const { data, error } = await supabase
    .from("mj_rooms")
    .select("id, code, status, host_id, game_state")
    .eq("id", roomId)
    .single();

  if (error || !data) return null;
  const room = data as MjRoom;
  // Populate cache so subsequent reads stay fast
  if (room.game_state) {
    await cacheGameState(roomId, room.game_state);
  }
  return room;
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
  // Write-through to Redis so the next loadRoom gets the latest state
  // without re-reading Postgres. Failure here is non-fatal (DB is source
  // of truth) but logged inside cacheGameState.
  await cacheGameState(roomId, state);
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
  winners?: MahjongGameState["winners"];
  // Round system
  roomSettings?: MahjongGameState["roomSettings"];
  roundInfo?: MahjongGameState["roundInfo"];
  playerScores?: MahjongGameState["playerScores"];
  settlement?: MahjongGameState["settlement"];
  gameOver?: MahjongGameState["gameOver"];
  // Dice / door
  dice?: MahjongGameState["dice"];
  doorSeat?: MahjongGameState["doorSeat"];
  nextGameReady?: MahjongGameState["nextGameReady"];
  pendingActions?: MahjongGameState["pendingActions"];
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
    winners: state.winners,
    roomSettings: state.roomSettings,
    roundInfo: state.roundInfo,
    playerScores: state.playerScores,
    settlement: state.settlement,
    gameOver: state.gameOver,
    dice: state.dice,
    doorSeat: state.doorSeat,
    nextGameReady: state.nextGameReady,
    pendingActions: state.pendingActions,
  };
}

/** Build state view for a specific player (includes their hand and any
 *  actions they can currently take). `myAvailableActions` is a recovery
 *  path: if the realtime mj_available_actions broadcast was missed or the
 *  client reloaded, the polled state can still surface the chi/pong/kong/
 *  win buttons. */
export function toPlayerGameState(
  state: MahjongGameState,
  playerId: string
): PublicGameState & {
  hand?: Tile[];
  myAvailableActions?: { type: string; tiles?: Tile[] }[];
} {
  const pub = toPublicGameState(state);
  const player = state.players.find((p) => p.id === playerId);
  // Defensive: filter out any flower tiles that shouldn't be in hand
  const hand = player?.hand.filter((t) => t.suit !== "f");

  // Compute my available actions if this player is a potential actor on the
  // current pending discard and hasn't passed yet. Lazy-load to avoid
  // circular import.
  let myAvailableActions: { type: string; tiles?: Tile[] }[] | undefined;
  if (player && state.pendingActions && state.lastDiscard) {
    const mySeat = player.seat;
    const isPending =
      state.pendingActions.potentialActors.includes(mySeat) &&
      !state.pendingActions.passedActors.includes(mySeat);
    if (isPending) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getAvailableActions } = require("./gameLogic") as typeof import("./gameLogic");
      const all = getAvailableActions(state);
      // Apply the same priority filter the broadcast uses
      const tierOf = (type: string) =>
        type === "win" ? 0 : type === "pong" || type === "kong" ? 1 : 2;
      const passedSet = new Set(state.pendingActions.passedActors);
      const unpassed = all.filter((a) => !passedSet.has(a.playerSeat));
      const mine = unpassed.filter((a) => a.playerSeat === mySeat);
      const otherTiers = unpassed
        .filter((a) => a.playerSeat !== mySeat)
        .map((a) => tierOf(a.type));
      const minOtherTier = otherTiers.length > 0 ? Math.min(...otherTiers) : 999;
      myAvailableActions = mine
        .filter((a) => tierOf(a.type) <= minOtherTier)
        .map((a) => ({ type: a.type, tiles: a.tiles }));
    }
  }

  return {
    ...pub,
    hand,
    myAvailableActions,
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
