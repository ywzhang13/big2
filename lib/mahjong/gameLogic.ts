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
  players: { id: string; name: string }[]
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

  return {
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

  if (s.wall.length === 0) {
    // 流局 — no more tiles
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
    const meld: Meld = {
      type: "chi",
      tiles: sortTiles([...action.tiles, disc]),
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

  const scoringCtx: ScoringContext = {
    concealed,
    revealed: player.revealed,
    winTile,
    isSelfDraw,
    isDealer: player.isDealer,
    seatWind: seat + 1, // seat 0=東(1), 1=南(2), etc.
    prevalentWind: s.prevalentWind,
    flowers: player.flowers,
    isLastTile: s.wall.length === 0,
    isAfterKong: s.isAfterKong,
    isRobbingKong: false, // set externally if applicable
    isFirstDraw: s.isFirstRound,
  };

  const score = calculateScore(scoringCtx);

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
  return state.wall.length === 0 && state.status === "playing";
}
