// Taiwan 16-tile Mahjong game logic
// All functions are pure — they return new state without mutating input.

import {
  Tile,
  TileSuit,
  tileKey,
  buildTiles,
  shuffle,
  sortTiles,
  isFlower,
  tileDisplay,
} from "./tiles";
import {
  Meld,
  PlayerState,
  MahjongGameState,
  ScoreResult,
  RoomSettings,
  RoundInfo,
  Settlement,
  WaitTile,
  WinnerEntry,
} from "./gameState";
import { isWinningHand, findWaitingTiles } from "./winCheck";
import { calculateScore, ScoringContext } from "./scoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneState(state: MahjongGameState): MahjongGameState {
  return JSON.parse(JSON.stringify(state));
}

function nextSeat(seat: number): number {
  return (seat + 1) % 4;
}

function prevSeat(seat: number): number {
  return (seat + 3) % 4;
}

/** 牌牆剩 16 張（海底）時不能再槓：暗槓、明槓、加槓都不行 */
export function canKongNow(state: MahjongGameState): boolean {
  return state.wall.length > 16;
}

/** 剛摸進（或補進）手牌的那張：hand 最後一張（補花後也是最後補進的那張） */
function markDrawn(s: MahjongGameState, seat: number): void {
  const hand = s.players[seat].hand;
  s.drawnTileId = hand.length > 0 ? hand[hand.length - 1].id : undefined;
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

/**
 * Create a new game with 4 players. Dealer is seat 0 by default.
 */
export function initGame(
  players: { id: string; name: string }[],
  settings?: RoomSettings
): MahjongGameState {
  if (players.length !== 4) {
    throw new Error("Exactly 4 players required");
  }

  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    seat: i,
    hand: [],
    revealed: [],
    flowers: [],
    discards: [],
    isDealer: i === 0,
  }));

  const state: MahjongGameState = {
    roomCode: "",
    status: "waiting",
    players: playerStates,
    wall: [],
    currentTurn: 0,
    lastDiscard: null,
    dealerSeat: 0,
    prevalentWind: 1, // 東
    turnCount: 0,
    hasDrawn: false,
    isFirstRound: true,
    isAfterKong: false,
  };

  if (settings) {
    state.roomSettings = settings;
    state.roundInfo = {
      currentRound: 1,
      currentGame: 1,
      dealerConsecutive: 0,
      initialDealerSeat: 0,
    };
    state.playerScores = [0, 0, 0, 0];
  }

  return state;
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

/**
 * Shuffle the wall, deal 16 tiles to each player (dealer gets 17),
 * then handle flowers for all players.
 */
export function dealTiles(state: MahjongGameState): MahjongGameState {
  let s = cloneState(state);
  const allTiles = shuffle(buildTiles());

  // Wall = all 144 tiles, shuffled
  s.wall = allTiles;
  s.status = "playing";
  s.lastDiscard = null;
  s.turnCount = 0;
  s.isFirstRound = true;
  s.isAfterKong = false;

  // Roll 3 dice, compute door seat (開門)
  // 骰子從自己(莊家)=1 開始往右(CCW)算
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const d3 = 1 + Math.floor(Math.random() * 6);
  const sum = d1 + d2 + d3;
  s.dice = [d1, d2, d3];
  s.doorSeat = (s.dealerSeat + ((sum - 1) % 4)) % 4;

  // Reset players
  for (const p of s.players) {
    p.hand = [];
    p.revealed = [];
    p.flowers = [];
    p.discards = [];
    p.isDealer = p.seat === s.dealerSeat;
  }

  // Deal: 16 tiles each, dealer gets 17
  for (let round = 0; round < 4; round++) {
    for (let seat = 0; seat < 4; seat++) {
      const count = 4; // deal 4 tiles per round
      const tiles = s.wall.splice(0, count);
      s.players[seat].hand.push(...tiles);
    }
  }
  // Dealer gets 1 extra (17th tile)
  const extraTile = s.wall.splice(0, 1);
  s.players[s.dealerSeat].hand.push(...extraTile);

  // Handle flowers for all players
  for (let seat = 0; seat < 4; seat++) {
    s = handleFlowers(s, seat);
  }

  // Sort hands
  for (const p of s.players) {
    p.hand = sortTiles(p.hand);
  }

  s.currentTurn = s.dealerSeat;
  s.hasDrawn = true; // Dealer already has 17 tiles, so they should discard
  markDrawn(s, s.dealerSeat);

  return checkDealFlowerWin(s);
}

/**
 * 開局補花完就湊成花牌立刻胡（和打牌中同規則）：
 *   - 一家 8 張花 → 八仙過海，立刻結束
 *   - 一家 7 張、另一家 1 張 → 設 pendingFlowerRob（fromSeat＝拿到那 1 張的人），
 *     等有 7 張的人決定要不要七搶一；莊家照樣先等這個決定才能打牌
 */
export function checkDealFlowerWin(s: MahjongGameState): MahjongGameState {
  const eight = s.players.find((p) => p.flowers.length === 8);
  if (eight) return finishFlowerWin(s, eight.seat, "八仙過海", eight.flowers[eight.flowers.length - 1], null);
  const robber = s.players.find((p) => p.flowers.length === 7);
  const holder = s.players.find((p) => p.flowers.length === 1);
  if (robber && holder) {
    s.pendingFlowerRob = { robberSeat: robber.seat, fromSeat: holder.seat, tile: holder.flowers[0] };
  }
  return s;
}

// ---------------------------------------------------------------------------
// Handle Flowers
// ---------------------------------------------------------------------------

/**
 * Remove any flower tiles from a player's hand, add to their flowers array,
 * and draw replacement tiles from the END of the wall.
 * Repeats until no flowers remain in hand.
 */
export function handleFlowers(
  state: MahjongGameState,
  seat: number
): MahjongGameState {
  let s = cloneState(state);
  const player = s.players[seat];

  let hasFlower = true;
  while (hasFlower) {
    hasFlower = false;
    const flowersInHand = player.hand.filter(isFlower);
    if (flowersInHand.length > 0) {
      hasFlower = true;
      // Move flowers out
      for (const f of flowersInHand) {
        player.flowers.push(f);
        player.hand = player.hand.filter((t) => t.id !== f.id);
      }
      // Draw replacements from end of wall
      if (s.wall.length >= flowersInHand.length) {
        const replacements = s.wall.splice(
          s.wall.length - flowersInHand.length,
          flowersInHand.length
        );
        player.hand.push(...replacements);
      }
    }
  }

  return s;
}

// ---------------------------------------------------------------------------
// 八仙過海 / 七搶一（花牌立刻胡）
// ---------------------------------------------------------------------------

export const FLOWER_WIN_FAN = 8;
const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];

/** 這組贏家是不是花牌立刻胡（八仙過海／七搶一） */
export function isFlowerWin(w: { score: ScoreResult }): boolean {
  return w.score.fans.some((f) => FLOWER_WIN_NAMES.includes(f.name));
}

/** 拿掉胡的那張後，手牌原本聽哪些牌（給攤牌畫面用） */
function waitsOf(concealed: Tile[], winTileId: number, meldCount: number): WaitTile[] {
  const rest = concealed.filter((t) => t.id !== winTileId);
  return findWaitingTiles(rest, meldCount).map((k) => {
    const suit = k[0] as TileSuit;
    const rank = parseInt(k.slice(1), 10);
    return { suit, rank, display: tileDisplay({ id: -1, suit, rank, display: "" }) };
  });
}

/**
 * 攤牌用：四家手牌、吃碰槓（暗槓也給牌面）、花牌。mj_game_over 和結束後的 state 用同一份格式。
 * 贏家的 hand 一律不含胡的那張（自摸也拿掉），胡的那張在 winners[].winTile。
 */
export function allHands(s: MahjongGameState) {
  return s.players.map((p) => {
    const winTileId = s.winners?.find((w) => w.seat === p.seat)?.winTile?.id;
    return {
      seat: p.seat,
      name: p.name,
      hand: p.hand.filter((t) => t.id !== winTileId),
      revealed: p.revealed,
      flowers: p.flowers,
    };
  });
}

/**
 * 直接以八仙過海／七搶一結束這局：8 台，不加其他牌型台；
 * 莊家台照自摸的原則（莊家胡三家都加，閒家胡只有莊家那份加），結算走自摸的算法。
 */
function finishFlowerWin(
  s: MahjongGameState,
  seat: number,
  name: "八仙過海" | "七搶一",
  winTile: Tile,
  from: number | null
): MahjongGameState {
  const fans: { name: string; value: number }[] = [{ name, value: FLOWER_WIN_FAN }];
  const consecutive = s.roundInfo?.dealerConsecutive ?? 0;
  fans.push({ name: seat === s.dealerSeat ? "莊家" : "莊家(斷)", value: 1 });
  if (consecutive > 0) {
    fans.push({ name: `連${consecutive}`, value: consecutive });
    fans.push({ name: `拉${consecutive}`, value: consecutive });
  }
  const totalFan = fans.reduce((n, f) => n + f.value, 0);
  const entry: WinnerEntry = { seat, score: { fans, totalFan }, winTile, from, waits: [] };
  s.winners = [entry];
  s.winner = entry;
  s.status = "finished";
  s.pendingActions = undefined;
  s.pendingAddKong = undefined;
  s.pendingFlowerRob = undefined;
  return s;
}

/**
 * 摸牌／補牌後檢查花牌：
 *   - 摸的人湊滿 8 張花 → 八仙過海，立刻結束
 *   - 摸的人摸到第 8 張花、另一家已有 7 張 → 設 pendingFlowerRob，等那家決定要不要七搶一
 * prev 是摸牌前的狀態（用來判斷這次有沒有摸到花）。
 */
export function checkFlowerWin(
  prev: MahjongGameState,
  s: MahjongGameState,
  seat: number
): MahjongGameState {
  const before = prev.players[seat].flowers.length;
  const mine = s.players[seat].flowers;
  if (mine.length === before) return s;
  if (mine.length === 8) return finishFlowerWin(s, seat, "八仙過海", mine[mine.length - 1], null);
  const total = s.players.reduce((n, p) => n + p.flowers.length, 0);
  const robber = s.players.find((p) => p.seat !== seat && p.flowers.length === 7);
  if (total === 8 && robber) {
    s.pendingFlowerRob = { robberSeat: robber.seat, fromSeat: seat, tile: mine[mine.length - 1] };
  }
  return s;
}

/** 七搶一：有 7 張花的人搶走第 8 張花，直接胡 */
export function robFlower(state: MahjongGameState): MahjongGameState {
  if (!state.pendingFlowerRob) throw new Error("沒有可以搶的花");
  const { robberSeat, fromSeat, tile } = state.pendingFlowerRob;
  const s = cloneState(state);
  s.players[fromSeat].flowers = s.players[fromSeat].flowers.filter((f) => f.id !== tile.id);
  s.players[robberSeat].flowers.push(tile);
  return finishFlowerWin(s, robberSeat, "七搶一", tile, fromSeat);
}

/** 七搶一不搶：清掉等待，摸到花的人照常繼續 */
export function passFlowerRob(state: MahjongGameState): MahjongGameState {
  if (!state.pendingFlowerRob) throw new Error("沒有可以搶的花");
  const s = cloneState(state);
  s.pendingFlowerRob = undefined;
  return s;
}

/**
 * 輪到自己、摸牌後可以做的動作（自摸胡、暗槓、加槓）。
 * 沒摸牌（吃碰後、等待別人決定時）回空陣列。牌牆剩 16 張時不給槓。
 */
export function ownTurnActions(
  state: MahjongGameState,
  seat: number
): { type: "win" | "kong" | "add_kong" | "declare_ting"; tiles?: Tile[] }[] {
  if (
    state.status !== "playing" ||
    state.currentTurn !== seat ||
    !state.hasDrawn ||
    state.drawnTileId === undefined ||
    state.lastDiscard ||
    state.pendingAddKong ||
    state.pendingFlowerRob
  ) {
    return [];
  }
  const p = state.players[seat];
  const actions: { type: "win" | "kong" | "add_kong" | "declare_ting"; tiles?: Tile[] }[] = [];
  if (isWinningHand(p.hand, p.revealed.length)) actions.push({ type: "win" });
  // 地聽後不能改聽：不給暗槓／加槓
  if (canKongNow(state) && !state.tingSeats?.includes(seat)) {
    for (const group of canConcealedKong(p.hand)) actions.push({ type: "kong", tiles: group });
    for (const t of canAddKong(p)) actions.push({ type: "add_kong", tiles: [t] });
  }
  const ting = tingDiscardOptions(state, seat);
  if (ting.length > 0) actions.push({ type: "declare_ting", tiles: ting });
  return actions;
}

// ---------------------------------------------------------------------------
// 地聽
// ---------------------------------------------------------------------------

/**
 * 現在能不能宣告地聽（打出這張的同時宣告）：
 *   - 輪到自己、已摸牌（莊家開局 17 張也算）、沒有等待中的窗口、還沒宣告過
 *   - 桌上打出的牌還在 5 張以內（這張是第 1～5 張）
 *   - 自己第一輪打牌；莊家多一次機會：第 1 張或第 5 張（自己的第 2 張）
 *   - 在那之前沒有任何人吃、碰、槓（含暗槓）
 */
export function canDeclareTingNow(state: MahjongGameState, seat: number): boolean {
  const p = state.players[seat];
  if (
    state.status !== "playing" ||
    state.currentTurn !== seat ||
    !state.hasDrawn ||
    state.lastDiscard ||
    state.pendingActions ||
    state.pendingAddKong ||
    state.pendingFlowerRob ||
    state.tingSeats?.includes(seat)
  ) {
    return false;
  }
  if (state.turnCount > 4) return false;
  if (state.players.some((x) => x.revealed.length > 0)) return false;
  return p.discards.length === 0 || (p.isDealer && p.discards.length === 1);
}

/** 打出後仍聽牌（至少聽一種）的手牌 id；不能宣告地聽時回空陣列 */
export function tingDiscardOptions(state: MahjongGameState, seat: number): Tile[] {
  if (!canDeclareTingNow(state, seat)) return [];
  const p = state.players[seat];
  return p.hand.filter((t) => {
    const rest = p.hand.filter((x) => x.id !== t.id);
    return findWaitingTiles(rest, p.revealed.length).length > 0;
  });
}

/** 宣告地聽並打出 tileId：記到 tingSeats 後照一般打牌處理 */
export function declareTingAndDiscard(state: MahjongGameState, tileId: number): MahjongGameState {
  const seat = state.currentTurn;
  if (!tingDiscardOptions(state, seat).some((t) => t.id === tileId)) {
    throw new Error("現在不能宣告地聽，或打出這張後沒有聽牌");
  }
  const s = cloneState(state);
  s.tingSeats = [...(s.tingSeats ?? []), seat];
  return discardTile(s, tileId);
}

/**
 * 地聽的人摸牌後不能胡：自動打出剛摸到的牌（回傳打牌後的狀態）；
 * 不需要自動打時回 null（沒宣告、能胡、等待窗口中…）。
 */
export function autoDiscardForTing(state: MahjongGameState): MahjongGameState | null {
  const seat = state.currentTurn;
  if (
    state.status !== "playing" ||
    !state.tingSeats?.includes(seat) ||
    !state.hasDrawn ||
    state.drawnTileId === undefined ||
    state.lastDiscard ||
    state.pendingActions ||
    state.pendingAddKong ||
    state.pendingFlowerRob
  ) {
    return null;
  }
  const p = state.players[seat];
  if (isWinningHand(p.hand, p.revealed.length)) return null;
  return discardTile(state, state.drawnTileId);
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/**
 * Current player draws a tile from the front of the wall.
 */
export function drawTile(state: MahjongGameState): MahjongGameState {
  let s = cloneState(state);

  if (s.wall.length <= 16) {
    // 流局 — 剩餘 16 張（海底）時結束
    s.status = "finished";
    return s;
  }

  if (s.hasDrawn) {
    throw new Error("Player has already drawn this turn");
  }

  const tile = s.wall.splice(0, 1)[0];
  const player = s.players[s.currentTurn];
  player.hand.push(tile);
  s.hasDrawn = true;
  s.lastDiscard = null;

  // Handle flowers drawn
  if (isFlower(tile)) {
    s = handleFlowers(s, s.currentTurn);
  }
  markDrawn(s, s.currentTurn);

  return checkFlowerWin(state, s, s.currentTurn);
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

/**
 * Current player discards a tile by its id.
 */
export function discardTile(
  state: MahjongGameState,
  tileId: number
): MahjongGameState {
  const s = cloneState(state);
  const player = s.players[s.currentTurn];

  if (!s.hasDrawn) {
    throw new Error("Must draw before discarding");
  }

  if (s.tingSeats?.includes(s.currentTurn) && s.drawnTileId !== undefined && tileId !== s.drawnTileId) {
    throw new Error("地聽後只能打出摸到的牌");
  }

  const tileIndex = player.hand.findIndex((t) => t.id === tileId);
  if (tileIndex === -1) {
    throw new Error("Tile not in hand");
  }

  const [discarded] = player.hand.splice(tileIndex, 1);
  player.discards.push(discarded);
  s.lastDiscard = { tile: discarded, from: s.currentTurn };
  s.hasDrawn = false;
  s.drawnTileId = undefined;
  s.isAfterKong = false;
  s.isFirstRound = false;
  s.turnCount++;

  return s;
}

// ---------------------------------------------------------------------------
// Available Actions
// ---------------------------------------------------------------------------

export interface AvailableAction {
  type: "chi" | "pong" | "kong" | "win";
  playerSeat: number;
  tiles?: Tile[]; // for chi: which tiles from hand to use
}

/**
 * Check what actions are available after a discard.
 * Priority: win > pong/kong > chi
 */
export function getAvailableActions(
  state: MahjongGameState
): AvailableAction[] {
  if (!state.lastDiscard) return [];

  const actions: AvailableAction[] = [];
  const disc = state.lastDiscard.tile;
  const discKey = tileKey(disc);
  const fromSeat = state.lastDiscard.from;

  for (let seat = 0; seat < 4; seat++) {
    if (seat === fromSeat) continue;

    const player = state.players[seat];
    const handKeys = player.hand.map(tileKey);

    // --- Win check ---
    const testHand = [...player.hand, disc];
    if (isWinningHand(testHand, player.revealed.length)) {
      actions.push({ type: "win", playerSeat: seat });
    }

    // --- Kong (明槓): player has 3 of the discarded tile ---
    const matchCount = handKeys.filter((k) => k === discKey).length;
    if (matchCount >= 3 && canKongNow(state)) {
      const kongTiles = player.hand.filter((t) => tileKey(t) === discKey);
      actions.push({ type: "kong", playerSeat: seat, tiles: kongTiles });
    }

    // --- Pong: player has 2 of the discarded tile ---
    if (matchCount >= 2) {
      const pongTiles = player.hand
        .filter((t) => tileKey(t) === discKey)
        .slice(0, 2);
      actions.push({ type: "pong", playerSeat: seat, tiles: pongTiles });
    }

    // --- Chi: only from left player (上家) ---
    if (seat === nextSeat(fromSeat)) {
      const suit = disc.suit;
      const rank = disc.rank;

      if (suit === "m" || suit === "p" || suit === "s") {
        // Three possible sequences containing the discarded tile
        const sequences: [number, number][] = [
          [rank - 2, rank - 1], // disc is the high tile
          [rank - 1, rank + 1], // disc is the middle tile
          [rank + 1, rank + 2], // disc is the low tile
        ];

        for (const [r1, r2] of sequences) {
          if (r1 < 1 || r1 > 9 || r2 < 1 || r2 > 9) continue;
          const k1 = `${suit}${r1}`;
          const k2 = `${suit}${r2}`;
          const t1 = player.hand.find((t) => tileKey(t) === k1);
          const t2 = player.hand.find((t) => tileKey(t) === k2);
          if (t1 && t2) {
            actions.push({ type: "chi", playerSeat: seat, tiles: [t1, t2] });
          }
        }
      }
    }
  }

  // 搶槓窗口：加槓那張牌只能拿來胡，不能吃碰槓
  if (state.pendingAddKong) {
    return actions.filter((a) => a.type === "win");
  }
  // 地聽的人不能改聽：別人打的牌只能拿來胡，不能吃碰槓
  if (state.tingSeats?.length) {
    const ting = state.tingSeats;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (ting.includes(actions[i].playerSeat) && actions[i].type !== "win") actions.splice(i, 1);
    }
  }

  // Sort by priority: win > kong > pong > chi
  const priority: Record<string, number> = { win: 0, kong: 1, pong: 2, chi: 3 };
  actions.sort((a, b) => priority[a.type] - priority[b.type]);

  return actions;
}

// ---------------------------------------------------------------------------
// Execute Action
// ---------------------------------------------------------------------------

/**
 * Execute a chi/pong/kong action on the last discard.
 */
export function executeAction(
  state: MahjongGameState,
  action: AvailableAction
): MahjongGameState {
  let s = cloneState(state);

  if (!s.lastDiscard) {
    throw new Error("No discard to act on");
  }

  const disc = s.lastDiscard.tile;
  const player = s.players[action.playerSeat];

  if (action.type === "chi") {
    if (!action.tiles || action.tiles.length !== 2) {
      throw new Error("Chi requires exactly 2 tiles from hand");
    }
    // Remove tiles from hand
    for (const t of action.tiles) {
      const idx = player.hand.findIndex((h) => h.id === t.id);
      if (idx === -1) throw new Error("Chi tile not in hand");
      player.hand.splice(idx, 1);
    }
    // Display order: put the taken (discarded) tile in the middle,
    // flanked by the two hand tiles (traditional 台灣麻將 convention).
    const [t1, t2] = action.tiles;
    const meld: Meld = {
      type: "chi",
      tiles: [t1, disc, t2],
      from: s.lastDiscard.from,
    };
    player.revealed.push(meld);
    s.currentTurn = action.playerSeat;
    s.hasDrawn = true; // After chi, player must discard (no draw)
    s.drawnTileId = undefined;
    s.lastDiscard = null;
    s.isAfterKong = false;
  } else if (action.type === "pong") {
    if (!action.tiles || action.tiles.length < 2) {
      throw new Error("Pong requires at least 2 tiles from hand");
    }
    const pongTiles = action.tiles.slice(0, 2);
    for (const t of pongTiles) {
      const idx = player.hand.findIndex((h) => h.id === t.id);
      if (idx === -1) throw new Error("Pong tile not in hand");
      player.hand.splice(idx, 1);
    }
    const meld: Meld = {
      type: "pong",
      tiles: [...pongTiles, disc],
      from: s.lastDiscard.from,
    };
    player.revealed.push(meld);
    s.currentTurn = action.playerSeat;
    s.hasDrawn = true; // After pong, player must discard
    s.drawnTileId = undefined;
    s.lastDiscard = null;
    s.isAfterKong = false;
  } else if (action.type === "kong") {
    if (!canKongNow(s)) {
      throw new Error("牌牆剩 16 張，不能再槓");
    }
    if (!action.tiles || action.tiles.length < 3) {
      throw new Error("Kong requires at least 3 tiles from hand");
    }
    const kongTiles = action.tiles.slice(0, 3);
    for (const t of kongTiles) {
      const idx = player.hand.findIndex((h) => h.id === t.id);
      if (idx === -1) throw new Error("Kong tile not in hand");
      player.hand.splice(idx, 1);
    }
    const meld: Meld = {
      type: "kong",
      tiles: [...kongTiles, disc],
      from: s.lastDiscard.from,
    };
    player.revealed.push(meld);
    s.currentTurn = action.playerSeat;
    s.lastDiscard = null;
    s.isAfterKong = true;

    // Kong: draw a replacement tile from end of wall
    if (s.wall.length > 0) {
      const replacement = s.wall.splice(s.wall.length - 1, 1)[0];
      player.hand.push(replacement);
      s.hasDrawn = true;

      // Handle flower in replacement
      if (isFlower(replacement)) {
        s = handleFlowers(s, action.playerSeat);
      }
      markDrawn(s, action.playerSeat);
      return checkFlowerWin(state, s, action.playerSeat);
    } else {
      s.status = "finished"; // wall exhausted
      s.hasDrawn = false;
    }
  }

  return s;
}

// ---------------------------------------------------------------------------
// Concealed Kong
// ---------------------------------------------------------------------------

/**
 * Check if a player can declare a concealed kong (暗槓) from their hand.
 * Returns arrays of 4 tiles that can form concealed kongs.
 */
export function canConcealedKong(hand: Tile[]): Tile[][] {
  const countMap = new Map<string, Tile[]>();
  for (const t of hand) {
    if (t.suit === "f") continue;
    const k = tileKey(t);
    if (!countMap.has(k)) countMap.set(k, []);
    countMap.get(k)!.push(t);
  }

  const result: Tile[][] = [];
  for (const [, tiles] of countMap) {
    if (tiles.length === 4) {
      result.push(tiles);
    }
  }
  return result;
}

/**
 * Execute a concealed kong for the current player.
 */
export function executeConcealedKong(
  state: MahjongGameState,
  tiles: Tile[]
): MahjongGameState {
  let s = cloneState(state);
  const player = s.players[s.currentTurn];

  if (tiles.length !== 4) {
    throw new Error("Concealed kong requires exactly 4 tiles");
  }
  if (!canKongNow(s)) {
    throw new Error("牌牆剩 16 張，不能再槓");
  }

  // Verify all tiles are in hand and are the same
  const key = tileKey(tiles[0]);
  for (const t of tiles) {
    if (tileKey(t) !== key) throw new Error("All kong tiles must be the same");
    const idx = player.hand.findIndex((h) => h.id === t.id);
    if (idx === -1) throw new Error("Kong tile not in hand");
    player.hand.splice(idx, 1);
  }

  const meld: Meld = {
    type: "concealed_kong",
    tiles: tiles,
  };
  player.revealed.push(meld);
  s.isAfterKong = true;

  // Draw replacement from end of wall
  if (s.wall.length > 0) {
    const replacement = s.wall.splice(s.wall.length - 1, 1)[0];
    player.hand.push(replacement);
    s.hasDrawn = true;

    if (isFlower(replacement)) {
      s = handleFlowers(s, s.currentTurn);
    }
    markDrawn(s, s.currentTurn);
    return checkFlowerWin(state, s, s.currentTurn);
  } else {
    s.status = "finished";
    s.hasDrawn = false;
  }

  return s;
}

/**
 * Execute adding a tile to an existing pong to make a kong (加槓).
 */
export function executeAddKong(
  state: MahjongGameState,
  tile: Tile
): MahjongGameState {
  let s = cloneState(state);
  const player = s.players[s.currentTurn];

  // Find a revealed pong with matching tile key
  const k = tileKey(tile);
  const meldIdx = player.revealed.findIndex(
    (m) => m.type === "pong" && tileKey(m.tiles[0]) === k
  );
  if (meldIdx === -1) {
    throw new Error("No matching pong found for add kong");
  }

  // Remove tile from hand
  const handIdx = player.hand.findIndex((t) => t.id === tile.id);
  if (handIdx === -1) throw new Error("Tile not in hand");
  player.hand.splice(handIdx, 1);

  // Upgrade pong to kong
  player.revealed[meldIdx].type = "kong";
  player.revealed[meldIdx].tiles.push(tile);
  s.isAfterKong = true;

  // Draw replacement
  if (s.wall.length > 0) {
    const replacement = s.wall.splice(s.wall.length - 1, 1)[0];
    player.hand.push(replacement);
    s.hasDrawn = true;

    if (isFlower(replacement)) {
      s = handleFlowers(s, s.currentTurn);
    }
    markDrawn(s, s.currentTurn);
    return checkFlowerWin(state, s, s.currentTurn);
  } else {
    s.status = "finished";
    s.hasDrawn = false;
  }

  return s;
}

/**
 * 手上可以加槓的牌：和自己已碰的刻子同一種牌。
 */
export function canAddKong(player: PlayerState): Tile[] {
  const pongKeys = new Set(
    player.revealed.filter((m) => m.type === "pong").map((m) => tileKey(m.tiles[0]))
  );
  return player.hand.filter((t) => pongKeys.has(tileKey(t)));
}

/**
 * 宣告加槓（當前玩家）。
 * - 沒人能搶：直接完成加槓並補摸一張（同 executeAddKong）
 * - 有人能胡這張：先不完成，把牌放進 lastDiscard（from=加槓者）、
 *   設 pendingAddKong，pendingActions 只列能胡的人，等他們胡或 pass
 */
export function startAddKong(
  state: MahjongGameState,
  tile: Tile
): MahjongGameState {
  const seat = state.currentTurn;
  const player = state.players[seat];
  if (!state.hasDrawn || state.lastDiscard || state.pendingAddKong || state.pendingFlowerRob) {
    throw new Error("現在不能加槓");
  }
  if (!canKongNow(state)) {
    throw new Error("牌牆剩 16 張，不能再槓");
  }
  if (!canAddKong(player).some((t) => t.id === tile.id)) {
    throw new Error("這張牌不能加槓");
  }

  const s = cloneState(state);
  const p = s.players[seat];
  p.hand = p.hand.filter((t) => t.id !== tile.id);
  s.lastDiscard = { tile, from: seat };
  s.pendingAddKong = { seat, tile };

  const robbers = [...new Set(getAvailableActions(s).map((a) => a.playerSeat))];
  if (robbers.length === 0) {
    return executeAddKong(state, tile);
  }
  s.pendingActions = { discardFrom: seat, potentialActors: robbers, passedActors: [] };
  return s;
}

/**
 * 搶槓窗口裡沒人胡（全部 pass）：把牌還給加槓者並完成加槓、補摸一張。
 */
export function completeAddKong(state: MahjongGameState): MahjongGameState {
  if (!state.pendingAddKong) throw new Error("沒有等待中的加槓");
  const { seat, tile } = state.pendingAddKong;
  const s = cloneState(state);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat;
  s.lastDiscard = null;
  s.pendingAddKong = undefined;
  s.pendingActions = undefined;
  return executeAddKong(s, tile);
}

// ---------------------------------------------------------------------------
// Declare Win
// ---------------------------------------------------------------------------

// 地胡的條件，改這兩個常數即可：
//   DIHU_CHI_BREAKS：有人「吃」過是否也破地胡（老闆確認：吃、碰、槓都破）
//   DIHU_RON_FROM_ANY：胡其他閒家第一輪打的牌是否也算（目前：只有胡莊家打的牌算）
const DIHU_CHI_BREAKS = true;
const DIHU_RON_FROM_ANY = false;

/**
 * 地胡：閒家在自己第一次摸牌（還沒打過牌）時胡，自摸或胡莊家打的牌都算；
 * 在那之前只要任何人吃、碰、明槓、暗槓過就不算。
 */
function isDiHu(s: MahjongGameState, player: PlayerState, isSelfDraw: boolean): boolean {
  if (player.isDealer || player.discards.length > 0) return false;
  const broken = s.players.some((p) =>
    p.revealed.some((m) => m.type !== "chi" || DIHU_CHI_BREAKS)
  );
  if (broken) return false;
  if (isSelfDraw) return true;
  return DIHU_RON_FROM_ANY || s.lastDiscard?.from === s.dealerSeat;
}

/**
 * A player declares win.
 * - isSelfDraw: true if the player drew the winning tile themselves
 * - For ron (not self-draw), the winning tile is lastDiscard
 */
export function declareWin(
  state: MahjongGameState,
  seat: number,
  isSelfDraw: boolean
): MahjongGameState {
  const s = cloneState(state);
  const player = s.players[seat];

  let winTile: Tile;
  let concealed: Tile[];

  if (isSelfDraw) {
    // The last tile drawn is the winning tile (last in hand)
    winTile = player.hand[player.hand.length - 1];
    concealed = [...player.hand];
  } else {
    // Winning off someone else's discard
    if (!s.lastDiscard) {
      throw new Error("No discard to win from");
    }
    winTile = s.lastDiscard.tile;
    concealed = [...player.hand, winTile];
  }

  // Verify it's a winning hand
  if (!isWinningHand(concealed, player.revealed.length)) {
    throw new Error("Not a winning hand");
  }

  // 門風 = relative to 開門 seat (door opener). Door=東(1), next CCW=南(2), etc.
  // Fallback to dealerSeat if dice haven't been rolled yet.
  const refSeat = s.doorSeat ?? s.dealerSeat;
  const seatWindOffset = (seat - refSeat + 4) % 4;
  const seatWind = seatWindOffset + 1; // 1=東 2=南 3=西 4=北

  const scoringCtx: ScoringContext = {
    concealed,
    revealed: player.revealed,
    winTile,
    isSelfDraw,
    isDealer: player.isDealer,
    seatWind,
    prevalentWind: s.prevalentWind,
    flowers: player.flowers,
    isLastTile: s.wall.length === 0,
    isAfterKong: s.isAfterKong,
    isRobbingKong: !isSelfDraw && !!s.pendingAddKong,
    isTing: !!s.tingSeats?.includes(seat),
    // 天胡：莊家在打出第一張牌前胡（isFirstRound 會在第一次打牌時關掉）。
    // 開局先暗槓再補牌胡是槓上開花，不是天胡：天胡要莊家還沒有任何槓
    isFirstDraw: player.isDealer
      ? s.isFirstRound && player.revealed.length === 0
      : isDiHu(s, player, isSelfDraw),
  };

  const score = calculateScore(scoringCtx);

  // 莊家 / 連 N / 拉 N 台：只有「付錢或收錢其中一方是莊家」的那筆才算。
  //   - 莊家胡：莊家 1 台已由 scoring.ts 處理；若 consecutive>0 再加 連/拉
  //   - 非莊家自摸：加 莊家(斷) 1 台 + 連N + 拉N，settlement 只向莊家收這段
  //   - 非莊家胡莊家放的槍：加 莊家(斷) 1 台 + 連N + 拉N，莊家全付
  //   - 非莊家胡非莊家放的槍：不加，莊家也不用付
  const consecutive = s.roundInfo?.dealerConsecutive ?? 0;
  const dealerPays = isSelfDraw || s.lastDiscard?.from === s.dealerSeat;
  if (player.isDealer) {
    if (consecutive > 0) {
      score.fans.push({ name: `連${consecutive}`, value: consecutive });
      score.fans.push({ name: `拉${consecutive}`, value: consecutive });
      score.totalFan += consecutive * 2;
    }
  } else if (dealerPays) {
    // 斷莊：莊家 1 台 + 連N + 拉N — 只由莊家付
    score.fans.push({ name: "莊家(斷)", value: 1 });
    score.totalFan += 1;
    if (consecutive > 0) {
      score.fans.push({ name: `連${consecutive}`, value: consecutive });
      score.fans.push({ name: `拉${consecutive}`, value: consecutive });
      score.totalFan += consecutive * 2;
    }
  }

  // Append to winners array (一炮三響 support). Keep `winner` as the first
  // entry for UI back-compat. Caller is responsible for status finalization.
  const entry: WinnerEntry = {
    seat,
    score,
    winTile,
    from: isSelfDraw ? null : s.lastDiscard!.from, // 放槍、搶槓都記那張牌的來源
    waits: waitsOf(concealed, winTile.id, player.revealed.length),
  };
  s.winners = [...(s.winners ?? []), entry];
  if (!s.winner) s.winner = entry;

  return s;
}

// ---------------------------------------------------------------------------
// Advance Turn
// ---------------------------------------------------------------------------

/**
 * Move to the next player's turn (after discard and no one acts).
 */
export function advanceTurn(state: MahjongGameState): MahjongGameState {
  const s = cloneState(state);
  s.currentTurn = nextSeat(s.currentTurn);
  s.hasDrawn = false;
  s.isAfterKong = false;
  return s;
}

// ---------------------------------------------------------------------------
// Check for draw game
// ---------------------------------------------------------------------------

/**
 * Check if the game should end in a draw (流局/荒牌).
 */
export function isDraw(state: MahjongGameState): boolean {
  return state.wall.length <= 16 && state.status === "playing";
}

/**
 * Apply 雙響/三響 rule to state.winners in place:
 *   1 winner → unchanged
 *   2 winners (ron) → keep only the highest-priority seat (closest CCW to
 *                     the discarder); the other forfeits their hu.
 *   3 winners → unchanged (一炮三響, all win simultaneously).
 * Also resyncs state.winner to winners[0] after filtering.
 */
export function applyWinnerOrderRule(state: MahjongGameState): MahjongGameState {
  const s = cloneState(state);
  const winners = s.winners ?? [];
  if (winners.length !== 2) {
    if (winners.length > 0) s.winner = winners[0];
    return s;
  }
  // Self-draw scenarios never have length 2; only ron can have multi-winners.
  const discarder = s.lastDiscard?.from ?? -1;
  const priority = (seat: number) =>
    discarder >= 0 ? ((seat - discarder - 1 + 4) % 4) : seat;
  const sorted = [...winners].sort((a, b) => priority(a.seat) - priority(b.seat));
  s.winners = [sorted[0]];
  s.winner = sorted[0];
  return s;
}

// ---------------------------------------------------------------------------
// Settlement (結算)
// ---------------------------------------------------------------------------

/**
 * Calculate point settlement for a finished game.
 * 自摸: 三家各付 (底 + 台數 × 台)
 * 放槍: 放槍者付 (底 + 台數 × 台)
 * 流局: no payment
 * 連莊: adds dealerConsecutive as extra 台 (拉莊)
 */
export function calculateSettlement(state: MahjongGameState): Settlement {
  const settings = state.roomSettings;
  if (!settings) {
    return { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 };
  }

  const { basePoints, fanPoints } = settings;
  const deltas = [0, 0, 0, 0];

  let winners = state.winners && state.winners.length > 0
    ? state.winners.slice()
    : state.winner ? [state.winner] : [];

  if (winners.length === 0 || winners[0].seat < 0) {
    // 流局
    return { deltas, reason: "draw", fanTotal: 0, paymentPerPlayer: 0 };
  }

  // Rule: only 三響 (3 winners) may all hu simultaneously. With exactly 2
  // winners on a single discard (雙響), only the highest-priority seat —
  // closest in CCW order to the discarder — actually gets the hu; the other
  // forfeits. (Self-draw can only have 1 winner, so length === 2 implies ron.)
  const isSelfDrawMulti = winners.length === 1 &&
    winners[0].score.fans.some(f => f.name.includes("自摸"));
  if (winners.length === 2 && !isSelfDrawMulti) {
    const discarder = state.lastDiscard?.from ?? -1;
    const priority = (seat: number) =>
      discarder >= 0 ? ((seat - discarder - 1 + 4) % 4) : seat;
    winners.sort((a, b) => priority(a.seat) - priority(b.seat));
    winners = winners.slice(0, 1);
  }

  const dealerSeat = state.dealerSeat;
  const consecutive = state.roundInfo?.dealerConsecutive ?? 0;
  // 斷莊罰 (只在非莊家贏時由莊家單獨支付)：
  //   莊家 1 台 + 連N 台 + 拉N 台 = 1 + 2*consecutive
  const streakFan = 1 + consecutive * 2;

  // Self-draw can only be a single winner.
  // 八仙過海／七搶一也是三家都付，照自摸算（莊家台已在 finishFlowerWin 加好）
  const isSelfDraw = winners.length === 1 &&
    (winners[0].score.fans.some(f => f.name.includes("自摸")) || isFlowerWin(winners[0]));

  if (isSelfDraw) {
    const winnerSeat = winners[0].seat;
    const totalFan = winners[0].score.totalFan;
    const isDealerWin = winnerSeat === dealerSeat;
    if (isDealerWin) {
      // 莊家自摸：三家各付 (底+台×台)
      const payment = basePoints + totalFan * fanPoints;
      for (let i = 0; i < 4; i++) {
        if (i === winnerSeat) deltas[i] = payment * 3;
        else deltas[i] = -payment;
      }
      return { deltas, reason: "self_draw", fanTotal: totalFan, paymentPerPlayer: payment };
    }
    // 非莊家自摸：兩家閒家各付 baseFans 部分；莊家額外多付 streakFan 部分
    const baseFans = Math.max(0, totalFan - streakFan);
    const nonDealerPayment = basePoints + baseFans * fanPoints;
    const dealerPayment = nonDealerPayment + streakFan * fanPoints;
    let winnerGain = 0;
    for (let i = 0; i < 4; i++) {
      if (i === winnerSeat) continue;
      const pay = i === dealerSeat ? dealerPayment : nonDealerPayment;
      deltas[i] = -pay;
      winnerGain += pay;
    }
    deltas[winnerSeat] = winnerGain;
    return {
      deltas,
      reason: "self_draw",
      fanTotal: totalFan,
      paymentPerPlayer: nonDealerPayment, // representative non-dealer share
    };
  }

  // 放槍 / 一炮多響: discarder pays each winner their individual (底+台×台).
  // 莊家台只在這筆的一方是莊家時才有，已由 declareWin 依此加進 totalFan
  // （莊家胡、或莊家放槍），所以這裡一律由放槍者照 totalFan 付，莊家不另付。
  const loserSeat = state.lastDiscard?.from ?? -1;
  let totalFanSum = 0;
  let paymentSum = 0;
  if (loserSeat >= 0) {
    for (const w of winners) {
      const payment = basePoints + w.score.totalFan * fanPoints;
      deltas[w.seat] += payment;
      deltas[loserSeat] -= payment;
      totalFanSum += w.score.totalFan;
      paymentSum += payment;
    }
  }
  return {
    deltas,
    reason: "win",
    fanTotal: totalFanSum,
    paymentPerPlayer: winners.length === 1 ? paymentSum : Math.round(paymentSum / winners.length),
  };
}

// ---------------------------------------------------------------------------
// Next Game (下一局)
// ---------------------------------------------------------------------------

/**
 * Determine if all rounds are complete.
 */
export function isAllRoundsComplete(state: MahjongGameState): boolean {
  if (!state.roomSettings || !state.roundInfo) return true;
  const { totalRounds } = state.roomSettings;
  const { currentRound, currentGame } = state.roundInfo;
  const totalGames = totalRounds * 4;
  const currentGameNumber = (currentRound - 1) * 4 + currentGame;
  return currentGameNumber >= totalGames;
}

/**
 * Prepare state for the next game in a multi-round session.
 * - 莊家胡 or 流局 → 連莊 (dealer stays)
 * - Otherwise → dealer rotates to next seat
 * - When dealer rotates past initial dealer → next 圈
 * - Deals new tiles automatically
 */
export function startNextGame(state: MahjongGameState): MahjongGameState {
  if (!state.roomSettings || !state.roundInfo) {
    throw new Error("No round settings");
  }

  let s = cloneState(state);
  const ri = { ...s.roundInfo! };
  const winnerSeats = (s.winners && s.winners.length > 0
    ? s.winners.map(w => w.seat)
    : s.winner ? [s.winner.seat] : []);
  const isDealerWin = winnerSeats.includes(s.dealerSeat);
  const isDrawGame = winnerSeats.length === 0 || winnerSeats[0] < 0;

  // Determine if dealer stays (dealer wins as part of multi-winner also counts)
  const dealerStays = isDealerWin || isDrawGame;

  if (dealerStays) {
    ri.dealerConsecutive++;
  } else {
    // Dealer rotates
    ri.dealerConsecutive = 0;
    const newDealer = nextSeat(s.dealerSeat);
    s.dealerSeat = newDealer;

    // Check if we've gone around (new dealer is back to initialDealerSeat)
    if (newDealer === ri.initialDealerSeat) {
      // Next 圈
      ri.currentRound++;
      ri.currentGame = 1;
    } else {
      ri.currentGame++;
    }
  }

  s.roundInfo = ri;

  // Update prevalent wind based on current round
  // 第1圈=東風圈(1), 第2圈=南風圈(2), etc.
  s.prevalentWind = ((ri.currentRound - 1) % 4) + 1;

  // Reset game state for new deal
  s.status = "playing";
  s.winner = undefined;
  s.winners = undefined;
  s.settlement = undefined;
  s.lastDiscard = null;
  s.turnCount = 0;
  s.isFirstRound = true;
  s.isAfterKong = false;
  s.hasDrawn = false;
  s.pendingActions = undefined;
  s.pendingAddKong = undefined;
  s.pendingFlowerRob = undefined;
  s.tingSeats = undefined;
  s.gameOver = false;

  // Reset players
  for (const p of s.players) {
    p.hand = [];
    p.revealed = [];
    p.flowers = [];
    p.discards = [];
    p.isDealer = p.seat === s.dealerSeat;
  }

  // Deal new tiles
  s = dealTiles(s);

  return s;
}
