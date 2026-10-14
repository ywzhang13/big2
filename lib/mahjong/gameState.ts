// Taiwan Mahjong game state types

import { Tile, TileSuit } from "./tiles";

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

/** 聽的牌（不是某一張實體牌，所以沒有 id） */
export interface WaitTile {
  suit: TileSuit;
  rank: number;
  display: string; // 例如 "3萬"、"東"
}

/** 一位贏家（一砲多響時每位各一筆） */
export interface WinnerEntry {
  seat: number;
  score: ScoreResult;
  winTile?: Tile;          // 胡的那張牌；八仙過海＝第 8 張花、七搶一＝搶來的花
  from?: number | null;    // 那張牌來自哪個座位；自摸、八仙過海＝null；放槍、搶槓、七搶一＝那家的座位
  waits?: WaitTile[];      // 拿掉胡的那張後，手牌原本聽哪些牌；花牌胡＝[]
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
  winner?: WinnerEntry;
  // 一炮三響: all winners on the same discard (populated incrementally as
  // each player declares win). The legacy `winner` field stays set to the
  // first (nearest to discarder) entry for display back-compat.
  winners?: WinnerEntry[];
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
  // 加槓等待搶槓：加槓的牌暫時放在 lastDiscard（from=加槓者），
  // pendingActions 只列能胡這張的人；全部 pass 後才真正完成加槓。
  pendingAddKong?: { seat: number; tile: Tile };
  // 樂觀鎖版本號：每次寫入 +1；條件寫入時版本不符代表別人先寫了
  stateVersion?: number;
  // 輪到的人這回合摸進（或補進）的牌；吃、碰後和打牌後清掉。
  // 用來判斷「現在可以自摸／暗槓／加槓」（重新整理時恢復按鈕）。不公開給其他人。
  drawnTileId?: number;
  // 七搶一：fromSeat 摸到第 8 張花，robberSeat 已有 7 張花，可以搶這張直接胡
  pendingFlowerRob?: { robberSeat: number; fromSeat: number; tile: Tile };
  // 已宣告地聽的座位（公開）。宣告後不能改聽：只能胡，或打出剛摸到的牌（不能胡時由伺服器自動打出）
  tingSeats?: number[];
  // --- Round system (圈數系統) ---
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];       // running total points per seat
  settlement?: Settlement;       // settlement for the just-finished game
  gameOver?: boolean;            // true when all rounds are complete
  // --- Dice / door (骰子開門) ---
  dice?: [number, number, number]; // 3 dice rolled at game start
  doorSeat?: number;               // 開門 seat (門風=東), used for seat wind scoring
  // --- Next-game ready check (下一局四家同意) ---
  nextGameReady?: string[];        // playerIds who have confirmed ready for next game
  // --- Leave request (離開需他家同意) ---
  leaveRequest?: {
    requesterId: string;            // playerId who wants to leave
    requesterName: string;
    requesterSeat: number;
    approvedBy: string[];           // playerIds who voted yes
    deniedBy: string[];             // playerIds who voted no
  };
}
