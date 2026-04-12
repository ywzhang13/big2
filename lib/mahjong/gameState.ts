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
}
