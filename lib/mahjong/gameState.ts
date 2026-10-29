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
  userId?: string | null; // 這個座位的 LINE 登入使用者（Supabase auth user id）；只在伺服器用，不公開
  avatarUrl?: string | null; // LINE 大頭貼網址（開局時從登入資料取；遊客、查不到是 null）；公開給同桌
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
  from?: number | null;    // 那張牌來自哪個座位；自摸、八仙過海＝null；放槍、搶槓、七搶一＝那家的座位（七搶一＝那 1 張花的人，也是付錢的人）
  waits?: WaitTile[];      // 拿掉胡的那張後，手牌原本聽哪些牌；花牌胡＝[]
  winFx?: WinFx;           // 帳號專屬的自摸特效代號（公開，全桌照這個播）；只有設定表裡的帳號自摸才有（lib/mahjong/winFx.ts）
}

/** 帳號專屬的自摸特效代號；新增特效時在這裡加一種，前端照代號播放 */
export type WinFx = "meteor";

/** 整場統計：每家這場胡牌、放槍、自摸各幾次（座位 0～3） */
export interface HandStats {
  wins: number[];      // 胡牌次數（自摸也算；一砲多響每個胡的人各算一次）
  dealIns: number[];   // 放槍次數（一砲多響只算一次；搶槓算被搶的人放槍）
  selfDraws: number[]; // 自摸次數（八仙過海算自摸；七搶一 2026-10-22 起不算）
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
  // 舊版七搶一等待（2026-10-22 起七搶一立刻成立，不會再產生；留著給上線時還在等待中的牌局收尾）
  pendingFlowerRob?: { robberSeat: number; fromSeat: number; tile: Tile };
  // 已宣告地聽的座位（公開）。宣告後不能改聽：只能胡，或打出剛摸到的牌（不能胡時由伺服器自動打出）
  tingSeats?: number[];
  // 已宣告眼牌的座位（公開）。宣告後能胡就自動胡、不能胡就自動打出摸到的牌，不能吃碰槓；
  // 看得到其他三家的手牌（只送給本人）。第一輪宣告眼牌同時算地聽（也記在 tingSeats）
  eyeSeats?: number[];
  // 過水中的座位（不公開，只在伺服器）：打出自己聽的牌、或能胡別人的牌卻沒胡（pass）就進入；
  // 過水中不能胡任何牌（自摸、放槍、搶槓）。打出一張不是自己聽的牌就解除。每局重來
  guoShuiSeats?: number[];
  // 碰的過水（不公開，只在伺服器）：座位 → 按過沒碰（或沒明槓）的牌種（tileKey）。
  // 自己下一次摸牌或打牌前，這些牌都不能碰、也不能明槓；自己摸牌（從牌牆摸、槓後補牌、補花都算）或打出一張牌就清掉。每局重來
  pongPassKeys?: Record<number, string[]>;
  // 食替（老闆 2026-10-21）：吃完要打牌的座位，和這次不能打的牌種（tileKey）——會和吃牌用的兩張湊成順子的牌。
  // 吃的時候設、打出一張牌就清掉。只在伺服器；本人的牌局狀態另外給 chiForbidden
  chiForbid?: { seat: number; keys: string[] };
  // 對局紀錄用：新版開局時寫入。上線前開局的房間沒有這兩個欄位 → 不補記紀錄
  startedAt?: string;       // 開局時間（ISO）
  handsCompleted?: number;  // 這場已打完（已結算）幾局，含流局
  // --- Round system (圈數系統) ---
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];       // running total points per seat
  settlement?: Settlement;       // settlement for the just-finished game
  gameOver?: boolean;            // true when all rounds are complete
  // --- Dice / door (骰子開門) ---
  dice?: [number, number, number]; // 3 dice rolled at game start
  doorSeat?: number;               // 開門 seat (門風=東), used for seat wind scoring
  // --- 整場統計（每局結算時累加；整場打完才放進公開狀態）---
  handStats?: HandStats;
  // --- 牌局節奏（lib/mahjong/pace.ts）---
  paceUntil?: number;              // 伺服器時間（毫秒）：補花／眼牌摸牌的特效播完前，摸牌、打牌、吃碰胡都等到這時才處理
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
