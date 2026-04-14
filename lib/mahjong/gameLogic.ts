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
} from "./tiles";
import {
  Meld,
  PlayerState,
  MahjongGameState,
  ScoreResult,
  RoomSettings,
  RoundInfo,
  Settlement,
} from "./gameState";
import { isWinningHand } from "./winCheck";
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

  return s;
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

  const tileIndex = player.hand.findIndex((t) => t.id === tileId);
  if (tileIndex === -1) {
    throw new Error("Tile not in hand");
  }

  const [discarded] = player.hand.splice(tileIndex, 1);
  player.discards.push(discarded);
  s.lastDiscard = { tile: discarded, from: s.currentTurn };
  s.hasDrawn = false;
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
    if (matchCount >= 3) {
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
    s.lastDiscard = null;
    s.isAfterKong = false;
  } else if (action.type === "kong") {
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
  } else {
    s.status = "finished";
    s.hasDrawn = false;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Declare Win
// ---------------------------------------------------------------------------

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
    isRobbingKong: false, // set externally if applicable
    isFirstDraw: s.isFirstRound,
  };

  const score = calculateScore(scoringCtx);

  // 連N / 拉N bonus apply whenever the dealer was on a consecutive streak.
  // Awarded to the winner regardless of whether winner is dealer or not —
  // i.e. 莊家胡 (continue), 莊家放槍 or 莊家被自摸 (streak broken) both count.
  const consecutive = s.roundInfo?.dealerConsecutive ?? 0;
  if (consecutive > 0) {
    score.fans.push({ name: `連${consecutive}`, value: consecutive });
    score.fans.push({ name: `拉${consecutive}`, value: consecutive });
    score.totalFan += consecutive * 2;
  }

  s.winner = { seat, score };
  s.status = "finished";

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

  if (!state.winner || state.winner.seat < 0) {
    // 流局
    return { deltas, reason: "draw", fanTotal: 0, paymentPerPlayer: 0 };
  }

  const winnerSeat = state.winner.seat;
  // totalFan already includes 連N/拉N from declareWin if dealer was on streak
  const totalFan = state.winner.score.totalFan;
  const isSelfDraw = state.winner.score.fans.some(f => f.name.includes("自摸"));
  const basePayment = basePoints + totalFan * fanPoints;
  const dealerSeat = state.dealerSeat;

  // Dealer tai adjustment: whenever dealer and the winner are different,
  // the dealer (as the loser / 放槍者 / 被自摸者) pays an extra 1 台 (莊家台)
  // on top of the base payment, corresponding to dealer-bonus.
  // If dealer is the winner, the dealer-tai is already inside totalFan.
  const dealerExtra = fanPoints; // extra 1 tai equivalent

  if (isSelfDraw) {
    // 自摸: all 3 losers pay
    // If dealer is a non-winner, dealer pays base + dealer-tai extra.
    // Winner receives sum of payments from all losers.
    let winnerCredit = 0;
    for (let i = 0; i < 4; i++) {
      if (i === winnerSeat) continue;
      const thisLoserIsDealer = i === dealerSeat && winnerSeat !== dealerSeat;
      const pay = basePayment + (thisLoserIsDealer ? dealerExtra : 0);
      deltas[i] = -pay;
      winnerCredit += pay;
    }
    deltas[winnerSeat] = winnerCredit;
    return { deltas, reason: "self_draw", fanTotal: totalFan, paymentPerPlayer: basePayment };
  } else {
    // 放槍: only the discarder pays
    const loserSeat = state.lastDiscard?.from ?? -1;
    if (loserSeat >= 0) {
      const loserIsDealer = loserSeat === dealerSeat && winnerSeat !== dealerSeat;
      const pay = basePayment + (loserIsDealer ? dealerExtra : 0);
      deltas[winnerSeat] = pay;
      deltas[loserSeat] = -pay;
    }
    return { deltas, reason: "win", fanTotal: totalFan, paymentPerPlayer: basePayment };
  }
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
  const winnerSeat = s.winner?.seat ?? -1;
  const isDealerWin = winnerSeat === s.dealerSeat;
  const isDrawGame = winnerSeat < 0;

  // Determine if dealer stays
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
  s.settlement = undefined;
  s.lastDiscard = null;
  s.turnCount = 0;
  s.isFirstRound = true;
  s.isAfterKong = false;
  s.hasDrawn = false;
  s.pendingActions = undefined;
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
