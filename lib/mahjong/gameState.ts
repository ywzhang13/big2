// Taiwan Mahjong game state types

import { Tile } from "./tiles";

export interface Meld {
  type: "chi" | "pong" | "kong" | "concealed_kong";
  tiles: Tile[];
  from?: number; // which player provided the tile (seat index, for pong/chi/kong)
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number; // 0-3
  hand: Tile[]; // concealed tiles
  revealed: Meld[]; // face-up melds
  flowers: Tile[]; // flower tiles
  discards: Tile[]; // tiles this player discarded
  isDealer: boolean;
}

export interface ScoreResult {
  fans: { name: string; value: number }[];
  totalFan: number;
}

export interface RoomSettings {
  totalRounds: number;   // 圈數: 1/2/4/8
  basePoints: number;    // 底 (base payment per game)
  fanPoints: number;     // 台 (payment per fan)
}

export interface RoundInfo {
  currentRound: number;       // 第幾圈 (1-based)
  currentGame: number;        // 圈內第幾局 (1-4)
  dealerConsecutive: number;  // 連莊次數 (0 = first time dealer)
  initialDealerSeat: number;  // 第一圈的起莊座位
}

export interface Settlement {
  deltas: number[];           // point change per seat this game
  reason: "win" | "self_draw" | "draw"; // how the game ended
  fanTotal: number;           // total fans (0 for draw)
  paymentPerPlayer: number;   // how much each loser pays (for display)
}

export interface MahjongGameState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  players: PlayerState[];
  wall: Tile[]; // remaining tiles in the wall
  currentTurn: number; // seat index 0-3
  lastDiscard: { tile: Tile; from: number } | null;
  dealerSeat: number;
  prevalentWind: number; // 1=東 2=南 3=西 4=北
  turnCount: number;
  winner?: { seat: number; score: ScoreResult };
  // Track if the current player just drew (for discard validation)
  hasDrawn: boolean;
  // Track if this is the very first draw of the round (for 天/地胡)
  isFirstRound: boolean;
  // Track if the last action was a kong (for 槓上開花)
  isAfterKong: boolean;
  // Multi-player action window after a discard
  pendingActions?: {
    discardFrom: number;         // who discarded
    potentialActors: number[];   // seats that can act
    passedActors: number[];      // seats that already passed
  };
  // --- Round system (圈數系統) ---
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];       // running total points per seat
  settlement?: Settlement;       // settlement for the just-finished game
  gameOver?: boolean;            // true when all rounds are complete
}
