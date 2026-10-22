import { getSupabaseAdmin } from "../supabase-admin";
import { MahjongGameState, PlayerState } from "./gameState";
import { Tile } from "./tiles";
import { cacheGameState, getCachedGameState } from "./cache";
import { allHands, chiForbiddenKeys, eyeDiscardOptions, canDeclareTingNow, getAvailableActions, ownTurnActions } from "./gameLogic";
import { opponentHands } from "./events";
import { recordZimoWins } from "./donate/record";

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
  user_id: string | null; // 這個座位的 LINE 登入使用者；上線前的座位是 null
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

/** 這些房間 id 裡，哪些房間還在（語音檔定期清除用：房間已經不在的資料夾整包刪）。ids 要是 uuid，一次最多 100 個（呼叫端分批） */
export async function existingRoomIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabaseAdmin().from("mj_rooms").select("id").in("id", ids);
  if (error) throw new Error(`查詢房間失敗：${error.message}`);
  return new Set((data ?? []).map((r) => String(r.id)));
}

export async function loadRoom(
  roomId: string,
  opts?: { fresh?: boolean }
): Promise<MjRoom | null> {
  // Redis-first: if the room's game_state is cached, short-circuit Postgres.
  // We still need code/status/host_id from DB for correctness, so fetch a
  // lightweight row when cache hits.
  // fresh=true skips the cache (used when retrying after a write conflict,
  // since the cache may be behind Postgres).
  const cached = opts?.fresh ? null : await getCachedGameState(roomId);
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
  state.stateVersion = (state.stateVersion ?? 0) + 1;
  const update: Record<string, unknown> = { game_state: state };
  if (status) update.status = status;

  const { error } = await supabase
    .from("mj_rooms")
    .update(update)
    .eq("id", roomId);

  if (error) {
    throw new Error(`Failed to save game state: ${error.message}`);
  }
  await recordZimoWins(roomId, state); // 這局結算了：記下自摸的人（斗內卡用；失敗只記 log）
  // Fire-and-forget cache write: Postgres is already authoritative, and we
  // don't want to add HTTP latency to the critical path of every action.
  // A dropped cache write just means the next read falls back to Postgres.
  void cacheGameState(roomId, state).catch(() => {});
}

/** 條件寫入失敗：讀出後已經有人先寫了，呼叫端要重新讀取再做一次 */
export class StateConflictError extends Error {
  constructor() {
    super("牌局狀態已被其他動作更新");
  }
}

/**
 * 樂觀鎖寫入：只有資料庫裡的 stateVersion 仍是 baseVersion（讀出時的版本）
 * 才寫入，寫入時版本 +1；否則丟 StateConflictError，不寫任何東西。
 */
export async function saveGameStateIfUnchanged(
  roomId: string,
  baseVersion: number | undefined,
  state: MahjongGameState,
  status?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  state.stateVersion = (baseVersion ?? 0) + 1;
  const update: Record<string, unknown> = { game_state: state };
  if (status) update.status = status;

  let query = supabase.from("mj_rooms").update(update).eq("id", roomId);
  query =
    baseVersion === undefined
      ? query.is("game_state->stateVersion", null)
      : query.eq("game_state->>stateVersion", String(baseVersion));
  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Failed to save game state: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new StateConflictError();
  }
  await recordZimoWins(roomId, state); // 這局結算了：記下自摸的人（斗內卡用；失敗只記 log）
  void cacheGameState(roomId, state).catch(() => {});
}

// 樂觀鎖寫入衝突時最多重做幾次（每次都重新從 Postgres 讀最新狀態）
const MAX_ATTEMPTS = 5;

/**
 * 跑一個「讀 → 改 → 條件寫入」的處理函式；遇到 StateConflictError 就以
 * fresh=true（不走快取）重新讀取、整個重做。其他錯誤回 500。
 */
export async function retryOnConflict(
  handler: (fresh: boolean) => Promise<Response>
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await handler(attempt > 0);
    } catch (err) {
      if (err instanceof StateConflictError) continue;
      const message = err instanceof Error ? err.message : "伺服器錯誤";
      return Response.json({ error: message }, { status: 500 });
    }
  }
  return Response.json({ error: "同時有太多動作，請再試一次" }, { status: 409 });
}

export async function loadPlayers(roomId: string): Promise<MjPlayer[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mj_players")
    .select("id, room_id, player_id, name, seat, user_id")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });

  if (error) return [];
  return (data ?? []) as MjPlayer[];
}

/** 建房：房號重複回 "duplicate"（呼叫端換一個再試），其他錯誤丟出 */
export async function insertRoom(row: {
  code: string;
  status: string;
  host_id: string;
  game_state: Record<string, unknown> | null;
}): Promise<{ id: string } | "duplicate"> {
  const { data, error } = await getSupabaseAdmin().from("mj_rooms").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`建立房間失敗：${error.message}`);
  }
  return { id: data.id };
}

/** 加入房間用：房間裡已經有的座位（查詢失敗丟出，不當成空房） */
export async function loadSeats(roomId: string): Promise<Pick<MjPlayer, "seat" | "player_id" | "user_id">[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("mj_players")
    .select("seat, player_id, user_id")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`查詢玩家失敗：${error.message}`);
  return data ?? [];
}

/**
 * 這個帳號目前坐著的麻將房（房間還在＝這場還沒結束），最近有動靜的在前。
 * 給「重開頁面／換 Safari、主畫面 App」找回房間用；查詢失敗丟出。
 */
export async function loadSeatsByUser(
  userId: string
): Promise<{ code: string; room_id: string; status: string; seat: number; updated_at: string }[]> {
  const supabase = getSupabaseAdmin();
  const { data: mine, error } = await supabase.from("mj_players").select("room_id, seat, player_id").eq("user_id", userId);
  if (error) throw new Error(`查詢座位失敗：${error.message}`);
  if (!mine?.length) return [];
  const { data: rooms, error: e2 } = await supabase
    .from("mj_rooms")
    .select("id, code, status, updated_at, game_state")
    .in("id", mine.map((p) => p.room_id));
  if (e2) throw new Error(`查詢房間失敗：${e2.message}`);
  return (rooms ?? [])
    .map((r) => {
      const p = mine.find((x) => x.room_id === r.id)!;
      // 開局後座位已隨機打亂：以牌局狀態的座位為準
      const gameSeat = (r.game_state as { players?: { id: string; seat: number }[] } | null)?.players?.find((x) => x.id === p.player_id)?.seat;
      return { code: r.code, room_id: r.id, status: r.status, updated_at: r.updated_at, seat: gameSeat ?? p.seat };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** 坐下：座位或玩家 id 重複回 "duplicate"，其他錯誤丟出 */
export async function insertPlayer(row: {
  room_id: string;
  player_id: string;
  name: string;
  seat: number;
  user_id: string | null;
}): Promise<"ok" | "duplicate"> {
  const { error } = await getSupabaseAdmin().from("mj_players").insert(row);
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`加入房間失敗：${error.message}`);
  }
  return "ok";
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

/**
 * 已經被拿走、不該再顯示在海底的牌：被吃、碰、明槓的那張（在別人的吃碰槓裡），以及放槍被胡走的那張。
 * 牌局狀態裡的 discards 仍保留每一張打過的牌（地聽、地胡等規則看的是「打過幾張」），只在輸出給前端時濾掉。
 */
function takenFromDiscards(state: MahjongGameState): Set<number> {
  const ids = new Set<number>();
  for (const p of state.players) for (const m of p.revealed) for (const t of m.tiles) ids.add(t.id);
  for (const w of state.winners ?? []) if (w.from != null && w.winTile) ids.add(w.winTile.id);
  return ids;
}

export function toPublicPlayerState(player: PlayerState, taken: Set<number> = new Set()): PublicPlayerState {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    tileCount: player.hand.length,
    revealed: player.revealed,
    flowers: player.flowers,
    discards: player.discards.filter((t) => !taken.has(t.id)),
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
  paceUntil?: MahjongGameState["paceUntil"];
  handStats?: MahjongGameState["handStats"];
  remainingWall?: Tile[];
  serverNow?: number;
  pendingActions?: MahjongGameState["pendingActions"];
  pendingAddKong?: MahjongGameState["pendingAddKong"];
  pendingFlowerRob?: MahjongGameState["pendingFlowerRob"];
  tingSeats?: MahjongGameState["tingSeats"];
  eyeSeats?: MahjongGameState["eyeSeats"];
  // 只有一局結束後（含流局）才有：四家手牌、吃碰槓（暗槓含牌面）、花牌，格式同 mj_game_over 的 allHands
  allHands?: ReturnType<typeof allHands>;
}

export function toPublicGameState(state: MahjongGameState): PublicGameState {
  const taken = takenFromDiscards(state);
  return {
    roomCode: state.roomCode,
    status: state.status,
    players: state.players.map((p) => toPublicPlayerState(p, taken)),
    wallCount: state.wall.length,
    currentTurn: state.currentTurn,
    lastDiscard: state.lastDiscard,
    dealerSeat: state.dealerSeat,
    prevalentWind: state.prevalentWind,
    turnCount: state.turnCount,
    hasDrawn: state.hasDrawn,
    // 一砲多響還在等其他人決定時（牌局仍進行中）不公開誰胡了：最後算不算胡要看順位，
    // 先公開會讓前端先跳出「胡＋先按的人」（老闆 2026-10-22 回報）；這局結束才給
    winner: state.status === "finished" ? state.winner : undefined,
    winners: state.status === "finished" ? state.winners : undefined,
    roomSettings: state.roomSettings,
    roundInfo: state.roundInfo,
    playerScores: state.playerScores,
    settlement: state.settlement,
    gameOver: state.gameOver,
    dice: state.dice,
    doorSeat: state.doorSeat,
    nextGameReady: state.nextGameReady,
    // 牌局節奏：特效播完的伺服器時間，附上伺服器現在時間讓前端換算（不依賴手機時鐘）
    paceUntil: state.paceUntil,
    // 整場打完才公開每家的胡牌、放槍、自摸次數（總結算畫面用）
    handStats: state.gameOver ? state.handStats : undefined,
    // 牌庫：這局結束（胡牌、流局）後才公開剩下的牌牆，照摸牌順序（第 0 張是下一張要摸的；補花、槓的補牌從最後一張拿）。
    // 局還在進行（playing）時絕不給
    remainingWall: state.status === "finished" ? state.wall : undefined,
    serverNow: Date.now(),
    pendingActions: state.pendingActions,
    pendingAddKong: state.pendingAddKong,
    pendingFlowerRob: state.pendingFlowerRob,
    tingSeats: state.tingSeats ?? [],
    eyeSeats: state.eyeSeats ?? [],
    // 牌局進行中絕不帶別家手牌；結束後才攤牌
    ...(state.status === "finished" ? { allHands: allHands(state) } : {}),
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
  myAvailableActions?: { type: string; tiles?: Tile[]; ting?: boolean }[];
  myDrawnTileId?: number;
  opponentHands?: ReturnType<typeof opponentHands>;
  chiForbidden?: string[];
} {
  const pub = toPublicGameState(state);
  const player = state.players.find((p) => p.id === playerId);
  // Defensive: filter out any flower tiles that shouldn't be in hand
  const hand = player?.hand.filter((t) => t.suit !== "f");

  // Compute my available actions if this player is a potential actor on the
  // current pending discard and hasn't passed yet.
  let myAvailableActions: { type: string; tiles?: Tile[]; ting?: boolean }[] | undefined;
  if (player && state.pendingActions && state.lastDiscard) {
    const mySeat = player.seat;
    const isPending =
      state.pendingActions.potentialActors.includes(mySeat) &&
      !state.pendingActions.passedActors.includes(mySeat);
    if (isPending) {
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

  // 輪到自己且剛摸完牌：恢復自摸胡／暗槓／加槓按鈕（重新整理後不會消失）
  let myDrawnTileId: number | undefined;
  if (player && state.currentTurn === player.seat && state.drawnTileId !== undefined) {
    const own = ownTurnActions(state, player.seat);
    if (own.length > 0) myAvailableActions = own;
    myDrawnTileId = state.drawnTileId;
  } else if (player && state.currentTurn === player.seat) {
    // 吃、碰後要打牌：也可以宣告眼牌
    const eye = eyeDiscardOptions(state, player.seat);
    if (eye.length > 0) myAvailableActions = [{ type: "declare_eye", tiles: eye, ting: canDeclareTingNow(state, player.seat) }];
  }
  // 七搶一：等我決定要不要搶
  if (player && state.pendingFlowerRob?.robberSeat === player.seat) {
    myAvailableActions = [{ type: "win" }];
  }

  return {
    ...pub,
    hand,
    myAvailableActions,
    myDrawnTileId,
    // 食替：輪到我、剛吃完時，這次不能打的牌種（tileKey，例如 "s5"）；平常是空陣列。只在本人的 state 裡
    chiForbidden: player ? chiForbiddenKeys(state, player.seat) : [],
    // 眼牌的人才看得到三家手牌（只在本人的 state 裡）
    ...(player && state.status === "playing" && state.eyeSeats?.includes(player.seat)
      ? { opponentHands: opponentHands(state, player.seat) }
      : {}),
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
