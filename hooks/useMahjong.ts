"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { sortTiles, isFlower, tileKey } from "@/lib/mahjong/tiles";
import type { Tile } from "@/lib/mahjong/tiles";
import { FlowerTracker, gameKeyOf } from "@/lib/mahjong/flowerTracker";
import { EyeDrawGate, StateRequestGate, ownConcealedKongMelds, readyAfterNextGame } from "@/lib/mahjong/stateSync";

/** Filter out any flower tiles that shouldn't be in hand (defensive) */
function safeHand(tiles: Tile[]): Tile[] {
  const filtered = tiles.filter((t) => {
    // Triple check: suit property, isFlower function, and display name
    if (t.suit === "f") return false;
    if (isFlower(t)) return false;
    const flowerNames = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
    if (flowerNames.includes(t.display)) return false;
    return true;
  });
  if (filtered.length !== tiles.length) {
    console.warn("[mj] safeHand filtered flowers:", tiles.length - filtered.length, "removed");
  }
  return sortTiles(filtered);
}
import type { HandStats, Meld, ScoreResult, RoomSettings, RoundInfo, Settlement, WaitTile, WinFx } from "@/lib/mahjong/gameState";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { closedFromEvent, closedFromResponse, type RoomClosedInfo } from "./roomClosed";
import { authHeaders, mjStorage } from "@/lib/mahjong/clientAuth";
import { receiveFx, setFxRoom, type FxEvent } from "@/lib/mahjong/fx/transport";
import { receiveChat, type ChatMessage } from "@/lib/mahjong/chatClient";
import { chiKinds } from "@/lib/mahjong/chiForbid";

/** 兩組按鈕一樣（種類和牌都一樣）：沿用舊的，不換掉陣列 */
function sameActions(a: { type: string; tiles?: Tile[] }[], b: { type: string; tiles?: Tile[] }[]): boolean {
  const sig = (xs: { type: string; tiles?: Tile[] }[]) => xs.map((x) => `${x.type}:${(x.tiles ?? []).map((t) => t.id).join(".")}`).join("|");
  return sig(a) === sig(b);
}

function getMjId(): string {
  if (typeof window === "undefined") return "";
  // 遊客分頁各自一個玩家 id（localStorage 是所有分頁共用）
  const store = mjStorage();
  let id = store.getItem("mj_pid");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    store.setItem("mj_pid", id);
  }
  return id;
}

/** 「這一回合」的識別：第幾圈第幾局連幾＋牌牆剩幾張＋摸進的牌。牌牆張數在一局內只會變少，
 *  所以同一局每次摸牌都不同；牌 id 每局重複使用，要靠圈局區分不同局 */
function ownTurnKey(roundInfo: RoundInfo | undefined, wallCount: number, drawnTileId: number | null | undefined): string | null {
  if (drawnTileId == null) return null;
  const game = roundInfo ? `${roundInfo.currentRound}-${roundInfo.currentGame}-${roundInfo.dealerConsecutive}` : "";
  return `${game}|${wallCount}|${drawnTileId}`;
}

async function api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  // 登入房每個動作都要帶登入 token（上線前的舊房不檢查，帶了也沒關係）
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", ...(await authHeaders()) } };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `API error ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** 補花特效的一顆膠囊：key 每次播放都換（同一家 1 秒內又補到時接續、重新播）；delay 秒 */
export interface MjFlowerFx {
  key: number;
  seat: number;
  tiles: Tile[];
  delay: number;
}

/** 慢慢摸牌時也照常即時處理的事件：摸到的牌本身、剩餘張數和補花、眼牌者看到的三家手牌 */
const SLOW_DRAW_PASS = new Set(["mj_draw_tile", "mj_draw", "mj_opponent_hands"]);
const SLOW_DRAW_MS = 800;
/** 眼牌者摸牌：翻到正面後一律再停 1 秒，才自動打出或進結算 */
const SLOW_DRAW_PAUSE_MS = 1000;
/** 牌局節奏（和伺服器 lib/mahjong/pace.ts 同一組數字）：眼牌摸牌 1.8 秒、補花 1 秒 */
const EYE_PACE_MS = 1800;
const FLOWER_PACE_MS = 1000;
/** 輪詢看到的剩餘等待最多顯示這麼久（伺服器最多也只等 4 秒） */
const PACE_NOTE_MAX_MS = 4000;
/** 吃碰槓提示（小宜 2026-10-17 方向 C）播放時間 */
const CLAIM_FX_MS = 750;
let claimNoticeSeq = 0;
/** 眼牌者送出摸牌後，等摸到的牌（事件或 API 回應）最多等多久；正常幾百毫秒就到 */
const SLOW_DRAW_WAIT_MS = 6000;

export interface MjPlayer {
  id: string;
  name: string;
  seat: number;
  tileCount: number;
  flowers: Tile[];
  discards: Tile[];
  revealed: Meld[];
  isDealer: boolean;
  /** 這位玩家帳號的專屬胡牌特效代號（伺服器依帳號給，公開代號、不含帳號資料）；有的話先預載素材 */
  winFx?: WinFx;
  /** LINE 頭像網址（老柯 2026-10-29：開局時伺服器給，只收 https；訪客、沒頭像是 null） */
  avatarUrl?: string | null;
}

/** 結算攤牌用的一家牌（贏家的 hand 不含胡的那張） */
export interface MjHandReveal {
  seat: number;
  name: string;
  hand: Tile[];
  revealed: Meld[];
  flowers: Tile[];
}

/** 贏家：winTile／from／waits 是新版後端才有，舊牌局沒有；winFx＝贏家帳號的專屬胡牌特效代號（自摸時才有） */
export interface MjWinner {
  seat: number;
  name: string;
  score: ScoreResult;
  winTile?: Tile;
  from?: number | null; // 自摸、八仙過海＝null
  waits?: WaitTile[];
  winFx?: WinFx;
}

/** 眼牌的人看到的一家手牌（mj_opponent_hands／state 的 opponentHands） */
export interface MjOpponentHand {
  seat: number;
  hand: Tile[];
  revealed: Meld[];
  drawnTileId: number | null;
}

export interface MjClientState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  players: MjPlayer[];
  myId: string;
  mySeat: number;
  myHand: Tile[];
  currentTurn: number;
  dealerSeat: number;
  lastDiscard: { tile: Tile; from: number } | null;
  // 牌桌中間那張大牌：最近打出的一張，一直顯示到下一張打出（被吃碰槓走、換局才拿掉）；伺服器的 lastDiscard 在下一家摸牌後就清掉
  focusDiscard: { tile: Tile; from: number } | null;
  // 牌局節奏（老柯 paceUntil）：補花、眼牌摸牌的特效播放中，四家都在等；顯示「X 摸牌中…」「X 補花中…」「等待中…」
  paceNote: { seat: number; kind: "eye" | "flower" | "wait" } | null;
  availableActions: { type: string; tiles?: Tile[] }[];
  // 搶槓窗口：某家加槓中，等其他家決定要不要搶槓胡
  pendingAddKong: { seat: number; tile: Tile } | null;
  // 我目前的動作按鈕是搶槓胡（顯示「搶槓胡／不搶」）
  robKong: boolean;
  // 七搶一窗口：fromSeat 摸到第 8 張花（tile），robberSeat 有 7 張花在決定要不要搶
  pendingFlowerRob: { robberSeat: number; fromSeat: number; tile: Tile } | null;
  // 我目前的動作按鈕是七搶一（顯示「七搶一／不搶」）
  robFlower: boolean;
  // 已宣告地聽的座位（公開）：第一輪宣告眼牌的人由伺服器同時算地聽
  tingSeats: number[];
  // 已宣告眼牌的座位（公開）
  eyeSeats: number[];
  // 這次打牌可以一起宣告眼牌的牌 id（打出後仍聽牌）；空陣列＝現在不能宣告
  eyeOptions: number[];
  // 這次宣告眼牌會同時算地聽（第一輪）
  eyeWithTing: boolean;
  // 剛吃完、輪到我打牌時，不能打的牌型（和吃牌用的兩張湊成順子的牌，例如 "s5"；格式同 tileKind）；空陣列＝沒有限制
  chiForbidden: string[];
  // 我眼牌時才有：其他三家的手牌（暗槓含牌面）；null＝沒有資料，照舊畫牌背
  opponentHands: MjOpponentHand[] | null;
  // 正在播宣告特效的座位（播完自動移除）；both＝第一輪眼牌同時地聽（MIGI）
  declareFx: { seat: number; both: boolean }[];
  // 正在播補花特效的膠囊（播完自動移除）
  flowerFx: MjFlowerFx[];
  // 眼牌後慢慢摸牌：只有眼牌的人自己看得到；tileId＝正在翻的那張，win＝翻開是胡牌（閃金框）
  slowDraw: { tileId: number; win: boolean } | null;
  winner?: MjWinner & { allHands?: MjHandReveal[] };
  // 一炮多響: all winners of this round (seat/name/score per winner).
  // Populated alongside `winner` when multiple players hu on the same discard.
  winners?: MjWinner[];
  wallRemaining: number;
  hostId: string;
  hasDrawn: boolean;
  drawnTileId: number | null;
  actionNotice: { seat: number; type: string; key: number } | null;
  // Round system
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];
  settlement?: Settlement;
  gameOver?: boolean;
  /** 整場打完時每家的胡牌／放槍／自摸次數（老柯 2026-10-17，只有 gameOver 時伺服器才帶） */
  handStats?: HandStats;
  /** 這局剩下的牌牆（牌庫），依摸牌順序、第 0 張是下一張要摸的；只有一局結束時伺服器才帶（老柯 2026-10-17） */
  remainingWall?: Tile[];
  // Dice / door
  dice?: [number, number, number];
  doorSeat?: number;
  // Next-game ready check
  nextGameReady?: string[];
  nextGameAllReady?: boolean;
  // Leave request (離開需他家同意)
  leaveRequest?: {
    requesterId: string;
    requesterName: string;
    requesterSeat: number;
    approvedCount?: number;
    deniedCount?: number;
  };
  leaveResult?: "granted" | "denied" | null;
}

export { getMjId };

/** join 回應（登入房才有 playerId、privateChannel） */
export interface MjJoinInfo {
  roomId: string;
  playerId?: string;
  privateChannel?: string;
}

export function useMahjong(
  roomCode: string,
  playerName: string,
  // 登入房：401＝登入失效、403＝這個座位不是你的
  onAuthError?: (status: 401 | 403) => void
) {
  // 登入房：同一個 LINE 帳號換裝置再加入時，伺服器會回原本那台的玩家 id，之後一律用它
  const [myId, setMyId] = useState(getMjId);
  // 登入房：手牌等私人事件改走本人的座位頻道（名稱只從 join 回應或 state 的 myChannel 拿）
  const [privateChannel, setPrivateChannel] = useState<string | null>(null);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  const [state, setState] = useState<MjClientState>({
    roomCode,
    status: "waiting",
    players: [],
    myId,
    mySeat: -1,
    myHand: [],
    currentTurn: -1,
    dealerSeat: 0,
    lastDiscard: null,
    focusDiscard: null,
    paceNote: null,
    availableActions: [],
    pendingAddKong: null,
    robKong: false,
    pendingFlowerRob: null,
    robFlower: false,
    tingSeats: [],
    eyeSeats: [],
    eyeOptions: [],
    eyeWithTing: false,
    chiForbidden: [],
    opponentHands: null,
    declareFx: [],
    flowerFx: [],
    slowDraw: null,
    wallRemaining: 0,
    hostId: "",
    hasDrawn: false,
    drawnTileId: null,
    actionNotice: null,
  });

  const [roomId, setRoomId] = useState<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  useEffect(() => setFxRoom(roomId), [roomId]);
  const discardingRef = useRef(false);
  // 房間已關閉（整場打完或解散後刪房）：顯示「這場已結束」，不再輪詢
  const [closed, setClosed] = useState<RoomClosedInfo | null>(null);
  const closedRef = useRef(false);
  const markClosed = useCallback((info: RoomClosedInfo) => {
    closedRef.current = true;
    // 已經有總分的就不要被沒有總分的蓋掉（例如先收到事件、之後輪詢回 404）
    setClosed((prev) => (prev && prev.players.length > 0 && info.players.length === 0 ? prev : info));
  }, []);
  // 自己回合按「過」收起自摸胡／暗槓／加槓按鈕：記下是哪一張摸牌時收起的，輪詢就不再補回。
  // 只對「這一回合」有效：換局、別人出牌／吃碰槓、我重新摸牌都會清掉（牌 id 每局會重複使用）
  const dismissedOwnActionsRef = useRef<string | null>(null);
  // 公開頻道和座位頻道之間不保證到達順序：座位頻道的動作按鈕（吃碰槓胡、槓後補牌）可能比
  // 公開的 mj_discard／mj_action 先到。記下「上一個公開事件之後才收到的按鈕」，公開事件就不要把它清掉
  const freshPrivateActionsRef = useRef(false);
  // 宣告特效：同一個座位同一局只播一次（開新局清空）；第一次拿到牌局狀態時已經眼牌的座位不播（重新整理）
  const playedFxRef = useRef(new Set<number>());
  const fxInitRef = useRef(false);
  // 特效的移除計時器（每個座位一個）：開新局、同座位再播、卸載時都要取消，舊計時器才不會刪掉新局的特效
  const fxTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // 宣告特效什麼時候播完（每個座位）：同一家正在播宣告特效時，補花膠囊延後到播完再出現
  const declareEndRef = useRef(new Map<number, number>());
  const playDeclareFx = useCallback((seat: number, both: boolean) => {
    if (playedFxRef.current.has(seat)) return;
    playedFxRef.current.add(seat);
    declareEndRef.current.set(seat, Date.now() + (both ? 1900 : 1300));
    setState((prev) => ({ ...prev, declareFx: [...prev.declareFx.filter((f) => f.seat !== seat), { seat, both }] }));
    // 牌桌中央出現→飛進名牌→名牌標示彈出：MIGI 1.41 秒飛到、1.9 秒結束；一般眼牌 0.83 秒飛到、1.3 秒結束
    clearTimeout(fxTimersRef.current.get(seat));
    fxTimersRef.current.set(seat, setTimeout(() => {
      fxTimersRef.current.delete(seat);
      setState((prev) => ({ ...prev, declareFx: prev.declareFx.filter((f) => f.seat !== seat) }));
    }, both ? 1900 : 1300));
  }, []);
  useEffect(() => {
    const timers = fxTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // 補花特效（小宜 2026-10-16）：只在收到廣播時播，輪詢只記下來不播（重新整理不重播）。
  // 每個座位已經知道的花牌 id（跟著局走，見 FlowerTracker）；事件帶來的花牌和它比對，多出來的就是這次補的
  const flowerTrackerRef = useRef(new FlowerTracker());
  const flowerFxRef = useRef(new Map<number, MjFlowerFx>()); // 正在播的膠囊（同一家 1 秒內又補到時接續）
  const flowerTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const flowerKeyRef = useRef(0);
  const clearFlowerFx = useCallback(() => {
    flowerTimersRef.current.forEach(clearTimeout);
    flowerTimersRef.current.clear();
    flowerFxRef.current.clear();
  }, []);
  const playFlowerFx = useCallback((seat: number, tiles: Tile[], delay: number) => {
    const prevFx = flowerFxRef.current.get(seat);
    const left = (declareEndRef.current.get(seat) ?? 0) - Date.now();
    const fx: MjFlowerFx = {
      key: ++flowerKeyRef.current,
      seat,
      tiles: prevFx ? [...prevFx.tiles, ...tiles] : tiles,
      delay: Math.max(delay, left > 0 ? left / 1000 : 0),
    };
    flowerFxRef.current.set(seat, fx);
    setState((prev) => ({ ...prev, flowerFx: [...prev.flowerFx.filter((f) => f.seat !== seat), fx] }));
    clearTimeout(flowerTimersRef.current.get(seat));
    flowerTimersRef.current.set(seat, setTimeout(() => {
      flowerTimersRef.current.delete(seat);
      flowerFxRef.current.delete(seat);
      setState((prev) => ({ ...prev, flowerFx: prev.flowerFx.filter((f) => f.seat !== seat) }));
    }, (fx.delay + 1) * 1000));
  }, []);
  /** 廣播事件帶來某家的花牌：有新補的花就播。這家還沒記過（剛重新整理）就只記不播 */
  const noteFlowers = useCallback((seat: number, flowers: Tile[]) => {
    const added = flowerTrackerRef.current.onEvent(seat, flowers);
    if (added.length > 0) playFlowerFx(seat, added, 0);
  }, [playFlowerFx]);
  useEffect(() => clearFlowerFx, [clearFlowerFx]);

  // 眼牌後慢慢摸牌（小宜 2026-10-16）：伺服器在同一個請求裡做完「摸牌→自動胡或自動打出」並一次廣播，
  // 所以眼牌的人送出摸牌時，先把收到的事件排隊（摸到的牌、剩餘張數／補花、三家手牌照常即時），
  // 摸到的牌翻開（0.8 秒）後再照原順序套用。只影響眼牌的人自己的畫面，其他三家完全不變。
  // 翻牌從「摸到的牌」到手時開始算（私人事件 mj_draw_tile，或摸牌 API 的回應，哪個先到用哪個），伺服器再慢也一定播完才打出。
  // 保險：兩者都沒到最多排 SLOW_DRAW_WAIT_MS；切到背景、摸牌失敗、卸載都立刻套用；排隊期間不採用輪詢
  // gen：每次開始排隊就加 1。輪詢送出後如果開始過排隊，回應就是過時的，不能套用（見 fetchState）
  // slowTile：已經開始翻的那張（事件和 API 回應都會到，第二個到的不能重新計時）
  const holdRef = useRef<{ on: boolean; gen: number; queue: (() => void)[]; timer?: ReturnType<typeof setTimeout>; refetch?: () => void; slowTile?: number }>({ on: false, gen: 0, queue: [] });
  // 眼牌者的同一次摸牌：API 回應和 mj_draw_tile 只處理先到的那個（後到的在動畫播完、打出套用後才來也不能把牌加回去）
  const eyeDrawRef = useRef(new EyeDrawGate());
  // 自己的吃碰槓（有牌面）：老柯 2026-10-29 起公開的 mj_action 不帶別家暗槓牌面，自己暗槓時改用座位頻道 mj_hand_update.myRevealed
  const myRevealedRef = useRef<Meld[] | null>(null);
  const releaseHold = useCallback(() => {
    const h = holdRef.current;
    clearTimeout(h.timer);
    if (!h.on) return;
    h.on = false;
    h.slowTile = undefined;
    const queue = h.queue;
    const refetch = h.refetch;
    h.queue = [];
    h.refetch = undefined;
    setState((prev) => (prev.slowDraw ? { ...prev, slowDraw: null } : prev));
    queue.forEach((fn) => fn());
    refetch?.(); // 排隊期間丟掉的輪詢，停完再抓一次，收斂到伺服器狀態
  }, []);
  const holdFor = useCallback((ms: number) => {
    const h = holdRef.current;
    if (!h.on) h.gen++;
    h.on = true;
    clearTimeout(h.timer);
    h.timer = setTimeout(releaseHold, ms);
  }, [releaseHold]);
  /** 顯示節奏提示 ms 毫秒（新的蓋掉舊的；舊的計時器到了不會清掉新的） */
  const paceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showPace = useCallback((note: NonNullable<MjClientState["paceNote"]>, ms: number) => {
    clearTimeout(paceTimerRef.current);
    setState((prev) => ({ ...prev, paceNote: note }));
    paceTimerRef.current = setTimeout(() => setState((prev) => (prev.paceNote === null ? prev : { ...prev, paceNote: null })), ms);
  }, []);
  useEffect(() => () => clearTimeout(paceTimerRef.current), []);
  // 「解散被取消」（有人按了不同意）的紅字提示 3 秒後自動收掉（再發起新的投票時 mj_leave_request 也會清掉）
  useEffect(() => {
    if (state.leaveResult !== "denied") return;
    const t = setTimeout(() => setState((prev) => (prev.leaveResult === "denied" ? { ...prev, leaveResult: null } : prev)), 3000);
    return () => clearTimeout(t);
  }, [state.leaveResult]);
  // 牌局有新進展的編號（收到任何廣播、自己按吃碰槓過都加 1）：state 請求在路上時有進展，回應裡的吃碰槓按鈕已經過時，不能補回畫面
  const progressRef = useRef(0);
  // 我送出、還沒回來的吃碰槓過請求數：這段期間伺服器可能還沒處理到，state 回應裡的按鈕不能信
  const actionsInFlightRef = useRef(0);
  /** 訂閱廣播事件；慢慢摸牌期間，除了摸牌本身的事件以外都先排隊 */
  const onHeld = useCallback((ch: RealtimeChannel, event: string, fn: (msg: { payload: Record<string, unknown> }) => void) => {
    ch.on("broadcast", { event }, (msg) => {
      progressRef.current++;
      stateGateRef.current.noteLocalChange(); // 牌局變了：在這之前送出的 state 請求回來時不能整份蓋掉（老闆 2026-10-25 打出去畫面回朔）
      const m = { payload: (msg.payload ?? {}) as Record<string, unknown> };
      const h = holdRef.current;
      if (h.on && !SLOW_DRAW_PASS.has(event)) h.queue.push(() => fn(m));
      else fn(m);
    });
  }, []);
  useEffect(() => {
    const hold = holdRef.current;
    const onVis = () => { if (document.hidden) releaseHold(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(hold.timer);
    };
  }, [releaseHold]);
  // 同理：莊家的地聽選項（mj_deal_hand）可能比 mj_game_start 先到
  const dealtThisGameRef = useRef(false);
  // 整場打完（gameOver）後不再採用輪詢結果：比結束事件晚回來的舊輪詢會把畫面蓋回「打牌中」，
  // 房間一關就變成「這場已結束」而看不到最終結算
  const matchOverRef = useRef(false);
  // state 請求的編號：後送先回時，比較舊的回應不能蓋掉比較新的；回前景事件連發只多送一次（見 stateSync）
  const stateGateRef = useRef(new StateRequestGate());

  // Fetch full state from API (for reconnection / polling)
  const fetchState = useCallback(async (rid: string) => {
    if (closedRef.current) return;
    if (holdRef.current.on) { holdRef.current.refetch = () => fetchStateRef.current?.(rid); return; } // 慢慢摸牌中：伺服器已經是打出後的狀態，翻完再說
    const holdGen = holdRef.current.gen;
    const reqId = stateGateRef.current.begin();
    const progressAtSend = progressRef.current;
    const actionInFlightAtSend = actionsInFlightRef.current > 0;
    const myId = myIdRef.current; // applyJoin 換了玩家 id 後，還沒重新 render 也要用新的
    try {
      const data = await api<{
        roomId: string;
        code: string;
        status: string;
        gameState: {
          roomCode: string;
          status: string;
          players: {
            id: string;
            name: string;
            seat: number;
            tileCount: number;
            revealed: Meld[];
            flowers: Tile[];
            discards: Tile[];
            isDealer: boolean;
            winFx?: WinFx;
            avatarUrl?: string | null;
          }[];
          wallCount: number;
          currentTurn: number;
          lastDiscard: { tile: Tile; from: number } | null;
          dealerSeat: number;
          prevalentWind: number;
          turnCount: number;
          hasDrawn: boolean;
          winner?: Omit<MjWinner, "name">;
          winners?: Omit<MjWinner, "name">[];
          allHands?: MjHandReveal[]; // 一局結束後才有
          hand?: Tile[];
          myAvailableActions?: { type: string; tiles?: Tile[] }[];
          pendingAddKong?: { seat: number; tile: Tile };
          pendingFlowerRob?: { robberSeat: number; fromSeat: number; tile: Tile };
          myDrawnTileId?: number;
          tingSeats?: number[];
          eyeSeats?: number[];
          opponentHands?: MjOpponentHand[]; // 我眼牌、牌局進行中才有
          myChannel?: string; // 登入房才有
        } | null;
      }>("GET", `/api/mahjong/state?roomId=${rid}&playerId=${myId}`);
      if (matchOverRef.current) return;
      // 請求在路上時開始了慢慢摸牌：這份回應不能在翻牌＋停頓期間套用。還在排隊就等停完再抓，已經停完就由最新的請求重抓一次；
      // 比已經套用的回應舊（後送先回）：丟掉
      const verdict = stateGateRef.current.settle(reqId, holdGen, holdRef.current);
      if (verdict === "refetchAfterHold") { holdRef.current.refetch = () => fetchStateRef.current?.(rid); return; }
      if (verdict === "refetchNow") { fetchStateRef.current?.(rid); return; }
      if (verdict === "drop") return;
      // 牌局節奏：伺服器說特效還沒播完（重新整理、切回前景時接上），剩下的時間用伺服器的兩個時間相減，不用手機時鐘
      {
        const g = data.gameState as { paceUntil?: number; serverNow?: number; currentTurn?: number } | null;
        const left = g?.paceUntil && g.serverNow ? g.paceUntil - g.serverNow : 0;
        if (left > 0) showPace({ seat: g?.currentTurn ?? -1, kind: "wait" }, Math.min(left, PACE_NOTE_MAX_MS));
      }

      if (!data.gameState) {
        // Room exists but no game state yet — still in lobby
        // Update players from DB
        const lobbyData = data as { lobbyPlayers?: { id: string; name: string; seat: number }[]; hostId?: string; roomSettings?: RoomSettings };
        const lobbyPlayers = lobbyData.lobbyPlayers || [];
        const hostId = lobbyData.hostId || "";
        const lobbySettings = lobbyData.roomSettings;
        if (lobbyPlayers.length > 0) {
          setState((prev) => {
            const players: MjPlayer[] = lobbyPlayers.map((p) => ({
              id: p.id, name: p.name, seat: p.seat,
              tileCount: 0, flowers: [], discards: [], revealed: [], isDealer: false,
            }));
            const mySeat = players.find((p) => p.id === myId)?.seat ?? prev.mySeat;
            return {
              ...prev,
              players,
              mySeat,
              hostId,
              ...(lobbySettings ? { roomSettings: lobbySettings } : {}),
            };
          });
        }
        return;
      }

      const gs = data.gameState;
      if (gs.myChannel) setPrivateChannel(gs.myChannel);
      const hand = gs.hand ? safeHand(gs.hand) : [];
      const mySeat = gs.players.find((p) => p.id === myId)?.seat ?? -1;
      // 漏接廣播時的保險：伺服器上已經不是收起時的那個回合，就清掉記號
      const turnKey = ownTurnKey(
        (gs as Record<string, unknown>).roundInfo as RoundInfo | undefined,
        gs.wallCount,
        gs.myDrawnTileId
      );
      if (gs.status !== "playing" || gs.currentTurn !== mySeat || turnKey !== dismissedOwnActionsRef.current) {
        dismissedOwnActionsRef.current = null;
      }
      // 自己回合的動作裡「declare_eye」不是按鈕，拆出來當眼牌選項
      const polledActions = gs.myAvailableActions?.filter((a) => a.type !== "declare_eye");
      const polledEye = gs.myAvailableActions?.find((a) => a.type === "declare_eye") as { tiles?: Tile[]; ting?: boolean } | undefined;
      const polledEyeIds = polledEye?.tiles?.map((t) => t.id);
      // 漏接 mj_eye_declared 的保險：輪詢發現新的眼牌座位就補播特效（第一次拿到狀態時不播，例如重新整理）
      const polledEyeSeats = gs.eyeSeats ?? [];
      if (polledEyeSeats.length === 0) playedFxRef.current.clear();
      if (!fxInitRef.current) {
        fxInitRef.current = true;
        polledEyeSeats.forEach((seat) => playedFxRef.current.add(seat));
      } else {
        polledEyeSeats.forEach((seat) => playDeclareFx(seat, (gs.tingSeats ?? []).includes(seat)));
      }
      const stillMyDiscard = gs.status === "playing" && gs.currentTurn === mySeat && gs.hasDrawn && !gs.lastDiscard;
      const pendingAddKong = gs.pendingAddKong ?? null;
      const pendingFlowerRob = gs.pendingFlowerRob ?? null;

      flowerTrackerRef.current.onPoll(gs.players, (gs as Record<string, unknown>).roundInfo as RoundInfo | undefined);
      setState((prev) => ({
        ...prev,
        status: gs.status as MjClientState["status"],
        players: gs.players.map((p) => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          tileCount: p.tileCount,
          flowers: p.flowers,
          discards: p.discards,
          revealed: p.revealed,
          isDealer: p.isDealer,
          ...(p.winFx ? { winFx: p.winFx } : {}),
          ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
        })),
        myHand: hand,
        mySeat,
        currentTurn: gs.currentTurn,
        dealerSeat: gs.dealerSeat,
        // 搶槓窗口期間 lastDiscard 是加槓的牌，不是打出去的牌，不當棄牌顯示
        lastDiscard: pendingAddKong ? null : gs.lastDiscard,
        // 中間的大牌：伺服器有打出的牌就用它；沒有（下一家已經摸牌）就留著上一張，除非那張已經不在打出那家的海底（被吃碰槓胡走）
        focusDiscard: !pendingAddKong && gs.lastDiscard
          ? gs.lastDiscard
          : prev.focusDiscard && gs.players[prev.focusDiscard.from]?.discards?.some((t) => t.id === prev.focusDiscard!.tile.id)
            ? prev.focusDiscard
            : null,
        pendingAddKong,
        robKong: pendingAddKong != null && pendingAddKong.seat !== mySeat,
        pendingFlowerRob,
        robFlower: pendingFlowerRob != null && pendingFlowerRob.robberSeat === mySeat,
        // 輪到我且剛摸完牌：重新整理後把摸進的那張分開顯示
        drawnTileId: gs.myDrawnTileId ?? prev.drawnTileId,
        wallRemaining: gs.wallCount,
        hasDrawn: gs.hasDrawn,
        // 請求送出時我的動作還在路上，或送出後已經有新進展（例如我按了過、上家已經打牌）：這份的按鈕是舊的，保留畫面上的。
        // 其他情況這份比收到的所有事件都新，以伺服器為準：漏接廣播時補出按鈕，畫面上殘留的舊按鈕（例如晚到的私人事件）也清掉
        availableActions: actionInFlightAtSend || progressRef.current !== progressAtSend
          ? prev.availableActions
          : turnKey != null && turnKey === dismissedOwnActionsRef.current
            ? []
            : sameActions(prev.availableActions, polledActions ?? []) ? prev.availableActions : (polledActions ?? []),
        tingSeats: gs.tingSeats ?? prev.tingSeats,
        eyeSeats: gs.eyeSeats ?? prev.eyeSeats,
        opponentHands: gs.status === "playing" ? gs.opponentHands ?? null : null,
        // 輪詢有帶（摸牌後）就用輪詢的；沒帶時（例如莊家開局沒摸牌）還是我的打牌回合就保留
        eyeOptions: polledEyeIds ?? (gs.myAvailableActions ? [] : stillMyDiscard ? prev.eyeOptions : []),
        eyeWithTing: polledEye ? polledEye.ting === true : gs.myAvailableActions ? false : stillMyDiscard ? prev.eyeWithTing : false,
        // 吃牌限制：伺服器的牌局狀態為準（剛吃完、輪到我打牌時才有）
        chiForbidden: chiKinds((gs as { chiForbidden?: unknown }).chiForbidden),
        // 一局結束後 state 會帶四家手牌（allHands）；舊版沒有就保留廣播收到的
        winner: gs.winner
          ? {
              ...gs.winner,
              name: gs.players[gs.winner.seat]?.name ?? "",
              allHands: gs.allHands ?? prev.winner?.allHands,
            }
          : gs.status === "finished" && gs.allHands
            ? { seat: -1, name: "", score: { fans: [], totalFan: 0 }, allHands: gs.allHands } // 流局
            : prev.winner,
        winners: gs.winners
          ? gs.winners.length > 0
            ? gs.winners.map((w) => ({ ...w, name: gs.players[w.seat]?.name ?? "" }))
            : undefined
          : gs.status === "playing" ? undefined : prev.winners,
        // Round system fields from polling
        roomSettings: (gs as Record<string, unknown>).roomSettings as RoomSettings | undefined ?? prev.roomSettings,
        roundInfo: (gs as Record<string, unknown>).roundInfo as RoundInfo | undefined ?? prev.roundInfo,
        playerScores: (gs as Record<string, unknown>).playerScores as number[] | undefined ?? prev.playerScores,
        settlement: (gs as Record<string, unknown>).settlement as Settlement | undefined ?? prev.settlement,
        gameOver: (gs as Record<string, unknown>).gameOver as boolean | undefined ?? prev.gameOver,
        handStats: (gs as Record<string, unknown>).handStats as HandStats | undefined ?? prev.handStats,
        remainingWall: gs.status === "finished" ? (gs as Record<string, unknown>).remainingWall as Tile[] | undefined ?? prev.remainingWall : undefined,
        dice: (gs as Record<string, unknown>).dice as [number, number, number] | undefined ?? prev.dice,
        doorSeat: (gs as Record<string, unknown>).doorSeat as number | undefined ?? prev.doorSeat,
        nextGameReady: (gs as Record<string, unknown>).nextGameReady as string[] | undefined ?? prev.nextGameReady,
      }));
    } catch (err) {
      // 房間已刪：410 附總結算；404 表示房間不在了但沒有紀錄（例如一局都沒打完就解散）
      const status = (err as { status?: number }).status;
      if (status === 410 || status === 404) {
        let body: unknown = null;
        try { body = JSON.parse((err as Error).message); } catch {}
        markClosed(status === 410 ? closedFromResponse(body) : { players: [] });
        return;
      }
      if (status === 401 || status === 403) {
        onAuthErrorRef.current?.(status);
        return;
      }
      console.error("[mj] fetchState failed:", err);
    }
  }, [markClosed, playDeclareFx, showPace]);
  const fetchStateRef = useRef<((rid: string) => Promise<void>) | null>(null);
  useEffect(() => { fetchStateRef.current = fetchState; }, [fetchState]);

  // 只給本人的事件（手牌、摸到的牌、可以吃碰槓胡）。舊房送在房間頻道、登入房送在座位頻道，
  // 兩邊都掛上；payload 一樣帶 playerId，不是我的就略過
  // chRoom＝這個頻道屬於哪個房號（mj_chat 交給聊天模組核對，換房後才送達的舊房事件丟掉）
  const bindPrivateEvents = useCallback((ch: RealtimeChannel, myId: string, chRoom: string) => {
      // --- mj_deal_hand (private) ---
      onHeld(ch, "mj_deal_hand", ({ payload }) => {
        const { playerId, hand, flowers, eyeOptions, eyeWithTing } = payload as {
          playerId: string;
          hand: Tile[];
          flowers: Tile[];
          eyeOptions?: number[]; // 莊家打第一張時可以一起宣告眼牌的牌
          eyeWithTing?: boolean;
        };
        if (playerId !== myId) return;
        dealtThisGameRef.current = true;
        // 莊家開局 17 張：伺服器把最後一張（含補花後補進的那張）當成摸進的牌；照樣分開放在最右邊，和重新整理後一致
        const dealtDrawn = hand.length % 3 === 2 ? hand[hand.length - 1]?.id ?? null : null;
        setState((prev) => ({
          ...prev,
          myHand: safeHand(hand),
          drawnTileId: dealtDrawn,
          eyeOptions: eyeOptions ?? [],
          eyeWithTing: eyeWithTing === true,
          // Update my flower count in players list
          players: prev.players.map((p) =>
            p.id === myId ? { ...p, flowers, tileCount: hand.length } : p
          ),
        }));
      });

      // --- mj_draw_tile (private) ---
      onHeld(ch, "mj_draw_tile", ({ payload }) => {
        const { playerId, hand, flowers, canWin, canKong, kongOptions, addKongOptions, eyeOptions, eyeWithTing } = payload as {
          playerId: string;
          tile: Tile;
          hand: Tile[];
          flowers?: Tile[];
          canWin: boolean;
          canKong: boolean;
          kongOptions: number[][];
          addKongOptions?: number[];
          eyeOptions?: number[];
          eyeWithTing?: boolean;
        };
        if (playerId !== myId) return;
        dismissedOwnActionsRef.current = null; // 新摸的牌（含槓後補牌）重新判斷
        freshPrivateActionsRef.current = true;
        const actions: { type: string; tiles?: Tile[] }[] = [];
        if (canWin) {
          actions.push({ type: "win" });
        }
        if (canKong && kongOptions) {
          for (const group of kongOptions) {
            const tiles = hand.filter((t) => group.includes(t.id));
            actions.push({ type: "kong", tiles });
          }
        }
        for (const id of addKongOptions ?? []) {
          const tile = hand.find((t) => t.id === id);
          if (tile) actions.push({ type: "add_kong", tiles: [tile] });
        }
        const drawnTile = payload.tile as Tile;
        // 這一次眼牌摸牌已經由 API 回應處理過（可能動畫已播完、打出已套用）：整個略過
        if (drawnTile && !eyeDrawRef.current.claimEvent(drawnTile.id)) return;
        if (flowers) noteFlowers(stateRef.current.mySeat, flowers);
        // 眼牌的人自己送出的摸牌：開始翻牌，翻開（0.8 秒）後再停 1 秒，才套用排隊中的自動打出／自動胡
        const slow = holdRef.current.on && drawnTile ? { tileId: drawnTile.id, win: canWin } : null;
        // API 回應已經先開始翻同一張：不重新計時
        if (slow && holdRef.current.slowTile !== drawnTile.id) {
          holdFor(SLOW_DRAW_MS + SLOW_DRAW_PAUSE_MS);
          holdRef.current.slowTile = drawnTile.id;
        }
        console.log("[mj] mj_draw_tile", { drawnTileId: drawnTile?.id, drawnDisplay: drawnTile?.display, handLen: hand.length });
        setState((prev) => ({
          ...prev,
          myHand: safeHand(hand),
          availableActions: slow ? [] : actions, // 眼牌的人不用按：伺服器已經自動胡或打出
          slowDraw: slow,
          eyeOptions: eyeOptions ?? [],
          eyeWithTing: eyeWithTing === true,
          robKong: false,
          hasDrawn: true,
          drawnTileId: drawnTile?.id ?? null,
          // Update flowers if provided (補花)
          players: flowers
            ? prev.players.map((p) =>
                p.id === myId ? { ...p, flowers, tileCount: hand.length } : p
              )
            : prev.players,
        }));
      });

      // --- mj_available_actions (private) ---
      onHeld(ch, "mj_available_actions", ({ payload }) => {
        const { playerId, actions, robKong, robFlower } = payload as {
          playerId: string;
          actions: { type: string; playerSeat: number; tiles?: Tile[] }[];
          robKong?: boolean;
          robFlower?: boolean;
        };
        if (playerId !== myId) return;
        freshPrivateActionsRef.current = true;
        setState((prev) => ({
          ...prev,
          robKong: robKong === true,
          robFlower: robFlower === true,
          availableActions: actions.map((a) => ({
            type: a.type,
            tiles: a.tiles,
          })),
        }));
      });

      // --- mj_hand_update (private, after action) ---
      onHeld(ch, "mj_hand_update", ({ payload }) => {
        const { playerId, hand, drawnTileId, eyeOptions, eyeWithTing, chiForbidden, myRevealed } = payload as {
          playerId: string;
          hand: Tile[];
          myRevealed?: Meld[]; // 自己暗槓時才有：自己的吃碰槓（有牌面）
          drawnTileId?: number;
          eyeOptions?: number[]; // 吃、碰後要打牌：可以一起宣告眼牌的牌
          eyeWithTing?: boolean;
          chiForbidden?: unknown; // 吃完後這一輪不能打的牌型
        };
        if (playerId !== myId) return;
        if (myRevealed) myRevealedRef.current = myRevealed;
        setState((prev) => ({
          ...prev,
          // 自己暗槓：自己座位的吃碰槓整份換成有牌面的版本（公開的 mj_action 只有蓋著的牌）
          ...(myRevealed ? { players: prev.players.map((p) => (p.seat === prev.mySeat ? { ...p, revealed: myRevealed } : p)) } : {}),
          myHand: safeHand(hand),
          // Authoritative: kong → replacement tile id; chi/pong → null
          drawnTileId: drawnTileId ?? null,
          ...(eyeOptions ? { eyeOptions, eyeWithTing: eyeWithTing === true } : {}),
          chiForbidden: chiKinds(chiForbidden),
        }));
      });

      // --- mj_effect (private)：互動特效。不跟牌局節奏排隊，收到就交給特效模組（id 去重） ---
      ch.on("broadcast", { event: "mj_effect" }, ({ payload }) => {
        const { playerId, effect } = payload as { playerId: string; effect: FxEvent };
        if (playerId === myId) receiveFx(effect);
      });

      // --- mj_chat (private)：打字聊天、語音訊息（老柯〈聊天與語音訊息〉）。不跟牌局節奏排隊；聊天模組用 id 去重，不是目前這一場的丟掉 ---
      ch.on("broadcast", { event: "mj_chat" }, ({ payload }) => {
        const { playerId, message } = payload as { playerId: string; message: ChatMessage };
        if (playerId === myId) receiveChat(message, playerId, chRoom);
      });

      // --- mj_opponent_hands (private)：我眼牌時，三家手牌的完整快照（直接整份取代） ---
      onHeld(ch, "mj_opponent_hands", ({ payload }) => {
        const { playerId, opponentHands } = payload as { playerId: string; opponentHands: MjOpponentHand[] };
        if (playerId !== myId) return;
        setState((prev) => (prev.status === "playing" ? { ...prev, opponentHands } : prev));
      });
  }, [noteFlowers, holdFor, onHeld]);

  // 登入房：另外訂閱本人的座位頻道（房間頻道照舊訂閱）
  useEffect(() => {
    if (!privateChannel || !playerName) return;
    const supabase = getSupabase();
    const ch = supabase.channel(privateChannel);
    // 座位頻道名稱是 mj-<房號>-p-<雜湊>（lib/mahjong/access.ts privateChannelName）
    bindPrivateEvents(ch, myId, /^mj-(.+?)-p-/.exec(privateChannel)?.[1] ?? "");
    ch.subscribe((status) => {
      // 訂閱好之前送的私人事件收不到，用 state 補
      if (status === "SUBSCRIBED" && roomIdRef.current) fetchState(roomIdRef.current);
    });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [privateChannel, playerName, myId, bindPrivateEvents, fetchState]);

  // Subscribe to Supabase Realtime
  useEffect(() => {
    if (!playerName || !roomCode || !myId) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`mj-${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    // --- mj_player_joined ---
    onHeld(channel, "mj_player_joined", ({ payload }) => {
      const { playerId, name, seat } = payload as {
        playerId: string;
        name: string;
        seat: number;
      };
      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        const exists = prev.players.find((p) => p.id === playerId);
        let players: MjPlayer[];
        if (exists) {
          players = prev.players.map((p) =>
            p.id === playerId ? { ...p, name, seat } : p
          );
        } else {
          players = [
            ...prev.players,
            {
              id: playerId,
              name,
              seat,
              tileCount: 0,
              flowers: [],
              discards: [],
              revealed: [],
              isDealer: false,
            },
          ];
        }
        players.sort((a, b) => a.seat - b.seat);
        const hostPlayer = players.find((p) => p.seat === 0);
        const mySeat = playerId === myId ? seat : prev.mySeat;
        return {
          ...prev,
          players,
          mySeat,
          // 已知房主就照舊：房主退出、房主轉交後，新進來坐到座位 1 的人不是房主（老闆 2026-10-24）
          hostId: prev.hostId || hostPlayer?.id || "",
        };
      });
    });

    // --- mj_player_left：有人在等人時退出房間（POST /api/mahjong/leave）：座位空出來、房主照伺服器給的 ---
    onHeld(channel, "mj_player_left", ({ payload }) => {
      const { playerId, hostId } = payload as { playerId: string; hostId?: string | null };
      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        return { ...prev, players: prev.players.filter((p) => p.id !== playerId), hostId: hostId ?? prev.hostId };
      });
    });

    // --- mj_game_start ---
    onHeld(channel, "mj_game_start", ({ payload }) => {
      eyeDrawRef.current.reset(); // 上一局沒處理完的摸牌作廢（牌 id 每局重複使用）
      myRevealedRef.current = null; // 上一局自己暗槓留下的吃碰槓不能帶到這一局
      dismissedOwnActionsRef.current = null;
      playedFxRef.current.clear();
      // 上一局還在播的宣告特效：取消移除計時器，畫面立即清空（見下方 declareFx: []）
      fxTimersRef.current.forEach(clearTimeout);
      fxTimersRef.current.clear();
      declareEndRef.current.clear();
      clearFlowerFx(); // 上一局的補花膠囊同理（見下方 flowerFx: []）
      const msg = payload as {
        currentTurn: number;
        dealerSeat: number;
        prevalentWind: number;
        wallCount: number;
        players: {
          id: string;
          name: string;
          seat: number;
          tileCount: number;
          revealed: Meld[];
          flowers: Tile[];
          discards: Tile[];
          isDealer: boolean;
          winFx?: WinFx;
          avatarUrl?: string | null;
        }[];
        roundInfo?: RoundInfo;
        playerScores?: number[];
        dice?: [number, number, number];
        doorSeat?: number;
      };
      const mySeat = msg.players.find((p) => p.id === myId)?.seat ?? -1;
      setState((prev) => ({
        ...prev,
        status: "playing",
        mySeat,
        currentTurn: msg.currentTurn,
        dealerSeat: msg.dealerSeat,
        wallRemaining: msg.wallCount,
        lastDiscard: null,
        focusDiscard: null,
        paceNote: null,
        availableActions: [],
        pendingAddKong: null,
        robKong: false,
        pendingFlowerRob: null,
        robFlower: false,
        tingSeats: [],
        eyeSeats: [],
        declareFx: [],
        flowerFx: [],
        opponentHands: null,
        // 座位頻道的發牌（含莊家的眼牌選項）可能先到，先到就保留
        eyeOptions: dealtThisGameRef.current ? prev.eyeOptions : [],
        eyeWithTing: dealtThisGameRef.current ? prev.eyeWithTing : false,
        chiForbidden: [],
        // 上一局最後摸進的牌 id 不能留到新局（牌 id 每局重複使用）；座位頻道的發牌先到就保留它標的那張
        drawnTileId: dealtThisGameRef.current ? prev.drawnTileId : null,
        hasDrawn: msg.currentTurn === msg.dealerSeat, // dealer starts with 17
        players: msg.players.map((p) => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          tileCount: p.tileCount,
          flowers: p.flowers || [],
          discards: p.discards || [],
          revealed: p.revealed || [],
          isDealer: p.isDealer,
          ...(p.winFx ? { winFx: p.winFx } : {}), // 開局廣播也帶座位代號（老柯第二版），一開局就能預載
          ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), // 開局廣播也帶 LINE 頭像（老柯 2026-10-29），和 winFx 一樣要保留
        })),
        winner: undefined,
        winners: undefined,
        settlement: undefined,
        gameOver: false,
        handStats: undefined,
        remainingWall: undefined,
        ...(msg.roundInfo ? { roundInfo: msg.roundInfo } : {}),
        ...(msg.playerScores ? { playerScores: msg.playerScores } : {}),
        ...(msg.dice ? { dice: msg.dice } : {}),
        ...(msg.doorSeat != null ? { doorSeat: msg.doorSeat } : {}),
        nextGameReady: [],
        nextGameAllReady: false,
      }));
      // 開局補花：每家開局的花都是剛補的；依座位順序（自己→下家→對家→上家）每隔 0.12 秒出現
      const opening = flowerTrackerRef.current.onGameStart(msg.players.map((p) => ({ seat: p.seat, flowers: p.flowers || [] })), msg.roundInfo);
      for (const p of opening) playFlowerFx(p.seat, p.flowers, mySeat < 0 ? 0 : ((p.seat - mySeat + 4) % 4) * 0.12);
    });

    bindPrivateEvents(channel, myId, roomCode);

    // --- mj_draw (public) ---
    onHeld(channel, "mj_draw", ({ payload }) => {
      const { seat, tileCount, wallCount, flowers } = payload as {
        seat: number;
        tileCount: number;
        wallCount: number;
        flowers?: Tile[];
      };
      // 牌局節奏（和伺服器的 paceUntil 一致）：別家是眼牌者時，伺服器在同一個請求裡摸牌＋自動打出，事件一次送來；
      // 其他三家也要等他翻牌＋停 1 秒（補到花再加 1 秒）才看到打出和輪到下一家，所以接下來的事件先排隊。
      // 別家補花（不是眼牌者）：伺服器會等膠囊播完才處理下一個動作，這裡只顯示「補花中」
      const cur = stateRef.current;
      const gotFlower = !!flowers && flowers.length > (cur.players.find((p) => p.seat === seat)?.flowers.length ?? 0);
      if (seat !== cur.mySeat && cur.eyeSeats.includes(seat) && !document.hidden) {
        const ms = EYE_PACE_MS + (gotFlower ? FLOWER_PACE_MS : 0);
        holdFor(ms);
        showPace({ seat, kind: "eye" }, ms);
      } else if (gotFlower && seat !== cur.mySeat) {
        showPace({ seat, kind: "flower" }, FLOWER_PACE_MS);
      }
      if (flowers) noteFlowers(seat, flowers);
      setState((prev) => ({
        ...prev,
        wallRemaining: wallCount,
        hasDrawn: true,
        // 七搶一不搶後會重送摸牌事件；若又要等七搶一，後面的 pending 事件會再設回來
        pendingFlowerRob: null,
        robFlower: false,
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount, ...(flowers ? { flowers } : {}) } : p
        ),
      }));
    });

    // --- mj_discard ---
    onHeld(channel, "mj_discard", ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      const { seat, tile } = payload as {
        seat: number;
        tile: Tile;
        availableActions: { type: string; playerSeat: number }[];
      };
      const keepEarlyActions = freshPrivateActionsRef.current;
      freshPrivateActionsRef.current = false;
      setState((prev) => ({
        ...prev,
        lastDiscard: { tile, from: seat },
        focusDiscard: { tile, from: seat },
        // Clear actions — new mj_available_actions will re-populate after this
        // arrives (server sends mj_discard first, action broadcasts second).
        // 登入房的按鈕走座位頻道，可能比這個事件先到：這張牌有給我按鈕就保留
        availableActions:
          keepEarlyActions && (payload as { availableActions?: { playerSeat: number }[] }).availableActions?.some((a) => a.playerSeat === prev.mySeat)
            ? prev.availableActions
            : [],
        eyeOptions: [],
        eyeWithTing: false,
        chiForbidden: [],
        drawnTileId: prev.mySeat === seat ? null : prev.drawnTileId,
        players: prev.players.map((p) =>
          p.seat === seat
            ? {
                ...p,
                // Bug #5: prevent duplicate discards
                discards: p.discards.some((d) => d.id === tile.id)
                  ? p.discards
                  : [...p.discards, tile],
                tileCount: p.tileCount - 1,
              }
            : p
        ),
        // If not my discard, keep hand; if mine, remove that tile
        myHand:
          prev.mySeat === seat
            ? prev.myHand.filter((t) => t.id !== tile.id)
            : prev.myHand,
      }));
    });

    // --- mj_action (chi/pong/kong) ---
    onHeld(channel, "mj_action", ({ payload }) => {
      const noticeKey = ++claimNoticeSeq;
      dismissedOwnActionsRef.current = null;
      const msg = payload as {
        type: string;
        seat: number;
        tiles: Tile[];
        tileCount?: number;
      };
      const keepEarlyActions = freshPrivateActionsRef.current;
      freshPrivateActionsRef.current = false;
      // 自己暗槓用的 myRevealed：在 setState 外面取出並清掉（用完就丟，不留給下一次槓）
      const pendingMyRevealed = myRevealedRef.current;
      const ownHiddenKongNow = msg.type === "concealed_kong" && msg.seat === stateRef.current.mySeat;
      if (ownHiddenKongNow) myRevealedRef.current = null;
      setState((prev) => {
        const meld: Meld = {
          type: msg.type as Meld["type"],
          tiles: msg.tiles,
          from: prev.lastDiscard?.from,
        };
        // If I'm the one who did chi/pong/kong, immediately remove the used
        // tiles from my hand to avoid a brief window where stale tiles are
        // clickable before mj_hand_update arrives (causes "卡住" feel).
        // 自己暗槓：公開廣播只有蓋著的 4 張（沒有牌面也沒有真的 id），改用座位頻道的 myRevealed；
        // 還沒到就先不加這一副（不畫空白牌），等 mj_hand_update 整份更正
        const ownHiddenKong = msg.type === "concealed_kong" && msg.seat === prev.mySeat;
        // 剛好多一副才採用（舊的、或 mj_hand_update 已經先套用過都不採用）
        const mine = ownHiddenKong ? ownConcealedKongMelds(prev.players.find((p) => p.seat === prev.mySeat)?.revealed ?? [], pendingMyRevealed) : null;
        const meldTileIds = new Set((ownHiddenKong ? (mine ?? []).flatMap((m) => m.tiles) : msg.tiles).map((t) => t.id));
        const updatedHand =
          msg.seat === prev.mySeat
            ? prev.myHand.filter((t) => !meldTileIds.has(t.id))
            : prev.myHand;
        return {
          ...prev,
          currentTurn: msg.seat,
          lastDiscard: null,
          // 被吃碰槓走的那張已經不在海底：中間的大牌一起拿掉
          focusDiscard: prev.focusDiscard && meldTileIds.has(prev.focusDiscard.tile.id) ? null : prev.focusDiscard,
          // 我槓完補牌的按鈕（槓上開花、再槓）走座位頻道，可能比這個事件先到
          availableActions: keepEarlyActions && msg.seat === prev.mySeat ? prev.availableActions : [],
          hasDrawn: true, // after chi/pong/kong player must discard (or already drew for kong)
          actionNotice: { seat: msg.seat, type: msg.type, key: noticeKey },
          myHand: updatedHand,
          // 被吃碰槓拿走的那張從打出那家的海底拿掉（和伺服器輸出的 state 一致，不用等輪詢）
          players: prev.players.map((p) => {
            const discards = p.discards.filter((t) => !meldTileIds.has(t.id));
            if (ownHiddenKong && p.seat === msg.seat) return { ...p, discards, revealed: mine ?? p.revealed, tileCount: msg.tileCount ?? p.tileCount };
            return p.seat === msg.seat
              ? {
                  ...p,
                  discards,
                  // 輪詢可能比這個事件先拿到吃碰完的狀態：同一組已經在了就不再加（不然會暫時出現兩組）
                  revealed: p.revealed.some((m) => m.tiles.length === msg.tiles.length && msg.tiles.every((t) => m.tiles.some((x) => x.id === t.id)))
                    ? p.revealed
                    : [...p.revealed, meld],
                  tileCount: msg.tileCount ?? p.tileCount,
                }
              : { ...p, discards };
          }),
        };
      });
      // 吃碰槓提示（吃碰區原地閃）0.75 秒後收掉；之後又有人吃碰就不動新的那個
      setTimeout(() => {
        setState((prev) => (prev.actionNotice?.key === noticeKey ? { ...prev, actionNotice: null } : prev));
      }, CLAIM_FX_MS);
    });

    // --- mj_add_kong_pending (public): 加槓中，等其他家決定要不要搶槓 ---
    onHeld(channel, "mj_add_kong_pending", ({ payload }) => {
      const { seat, tile, tileCount } = payload as {
        seat: number;
        tile: Tile;
        tileCount: number;
      };
      setState((prev) => ({
        ...prev,
        pendingAddKong: { seat, tile },
        availableActions: [],
        robKong: false,
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount } : p
        ),
      }));
    });

    // --- mj_eye_declared (public)：有人打牌時一起宣告眼牌；ting＝第一輪同時算地聽（雙色特效） ---
    onHeld(channel, "mj_eye_declared", ({ payload }) => {
      const { seat, ting } = payload as { seat: number; tile: Tile; ting?: boolean };
      setState((prev) => ({
        ...prev,
        eyeSeats: prev.eyeSeats.includes(seat) ? prev.eyeSeats : [...prev.eyeSeats, seat],
        tingSeats: ting && !prev.tingSeats.includes(seat) ? [...prev.tingSeats, seat] : prev.tingSeats,
      }));
      playDeclareFx(seat, ting === true);
    });

    // --- mj_ting_declared (public): 第一輪宣告眼牌時伺服器同時算地聽 ---
    onHeld(channel, "mj_ting_declared", ({ payload }) => {
      const { seat } = payload as { seat: number; tile: Tile };
      setState((prev) => ({
        ...prev,
        tingSeats: prev.tingSeats.includes(seat) ? prev.tingSeats : [...prev.tingSeats, seat],
      }));
    });

    // --- mj_flower_rob_pending (public): 有人摸到第 8 張花，等 7 張花的人決定要不要七搶一 ---
    onHeld(channel, "mj_flower_rob_pending", ({ payload }) => {
      const { robberSeat, fromSeat, tile } = payload as {
        robberSeat: number;
        fromSeat: number;
        tile: Tile;
      };
      setState((prev) => ({
        ...prev,
        pendingFlowerRob: { robberSeat, fromSeat, tile },
        availableActions: [],
        robFlower: false,
      }));
    });

    // --- mj_add_kong (public): 加槓完成，把那組碰升成槓（不新增一組） ---
    onHeld(channel, "mj_add_kong", ({ payload }) => {
      const noticeKey = ++claimNoticeSeq;
      const { seat, tile, tileCount } = payload as {
        seat: number;
        tile: Tile;
        tileCount: number;
      };
      setState((prev) => ({
        ...prev,
        currentTurn: seat,
        pendingAddKong: null,
        robKong: false,
        actionNotice: { seat, type: "add_kong", key: noticeKey },
        myHand:
          seat === prev.mySeat
            ? prev.myHand.filter((t) => t.id !== tile.id)
            : prev.myHand,
        players: prev.players.map((p) => {
          if (p.seat !== seat) return p;
          // 輪詢可能已經先拿到升級後的槓，找不到同種的碰就不動
          const idx = p.revealed.findIndex(
            (m) => m.type === "pong" && tileKey(m.tiles[0]) === tileKey(tile)
          );
          const revealed =
            idx === -1
              ? p.revealed
              : p.revealed.map((m, i) =>
                  i === idx ? { ...m, type: "kong" as const, tiles: [...m.tiles, tile] } : m
                );
          return { ...p, revealed, tileCount };
        }),
      }));
      setTimeout(() => {
        setState((prev) => (prev.actionNotice?.key === noticeKey ? { ...prev, actionNotice: null } : prev));
      }, CLAIM_FX_MS);
    });

    // --- mj_turn_advance (from discard when no actions, to avoid flash) ---
    onHeld(channel, "mj_turn_advance", ({ payload }) => {
      const { currentTurn, hasDrawn } = payload as {
        currentTurn: number;
        hasDrawn: boolean;
      };
      setState((prev) => ({
        ...prev,
        currentTurn,
        hasDrawn,
      }));
    });

    // --- mj_pass ---
    onHeld(channel, "mj_pass", ({ payload }) => {
      const { seat: _seat, allPassed, currentTurn: newTurn, hasDrawn: newHasDrawn } = payload as {
        seat: number;
        allPassed?: boolean;
        currentTurn?: number;
        hasDrawn?: boolean;
      };
      setState((prev) => ({
        ...prev,
        // Only clear my own action buttons if *I* was the one passing. Do not
        // clear based on `allPassed` — in edge cases (stale broadcasts, out-of-
        // order delivery) that can hide my still-valid chi/pong button before
        // I've had a chance to decide. A legitimate allPassed=true always
        // implies my own pass already cleared them earlier.
        availableActions:
          prev.mySeat === _seat ? [] : prev.availableActions,
        robKong: prev.mySeat === _seat ? false : prev.robKong,
        robFlower: prev.mySeat === _seat ? false : prev.robFlower,
        ...(allPassed ? { pendingFlowerRob: null } : {}),
        // When allPassed, server sends authoritative turn state so currentTurn
        // + hasDrawn update together (no "輪到你摸牌" flash).
        ...(allPassed && newTurn != null && newHasDrawn != null
          ? { currentTurn: newTurn, hasDrawn: newHasDrawn }
          : {}),
      }));
    });

    // --- mj_leave_request ---
    onHeld(channel, "mj_leave_request", ({ payload }) => {
      const { requesterId, requesterName, requesterSeat } = payload as {
        requesterId: string;
        requesterName: string;
        requesterSeat: number;
      };
      setState((prev) => ({
        ...prev,
        leaveRequest: { requesterId, requesterName, requesterSeat, approvedCount: 0, deniedCount: 0 },
        leaveResult: null,
      }));
    });

    // --- mj_leave_vote ---
    // --- mj_room_closed：這場已寫紀錄並刪房（最終結算照常顯示） ---
    onHeld(channel, "mj_room_closed", ({ payload }) => {
      markClosed(closedFromEvent(payload));
    });

    onHeld(channel, "mj_leave_vote", ({ payload }) => {
      const { approvedCount, deniedCount, result, requesterSeat, requesterName } = payload as {
        voterId: string;
        voterSeat: number;
        approve: boolean;
        approvedCount: number;
        deniedCount: number;
        result: "granted" | "denied" | "vote";
        requesterSeat: number;
        requesterName: string;
      };
      // 四家同意解散：房間會被關掉，先停在「這場已結束」，總分等 mj_room_closed 帶來
      if (result === "granted") markClosed({ endReason: "dissolved", players: [] });
      setState((prev) => ({
        ...prev,
        leaveRequest:
          result === "vote"
            ? {
                requesterId: prev.leaveRequest?.requesterId ?? "",
                requesterName,
                requesterSeat,
                approvedCount,
                deniedCount,
              }
            : undefined,
        leaveResult: result === "granted" ? "granted" : result === "denied" ? "denied" : prev.leaveResult,
        // If granted, game becomes finished
        ...(result === "granted" ? { status: "finished" as const } : {}),
      }));
    });

    // --- mj_next_game_ready (partial readiness or all ready) ---
    onHeld(channel, "mj_next_game_ready", ({ payload }) => {
      const { readyIds, allReady } = payload as { readyIds: string[]; allReady?: boolean };
      setState((prev) => ({
        ...prev,
        nextGameReady: readyIds,
        nextGameAllReady: allReady === true,
      }));
    });

    // --- mj_game_over ---
    onHeld(channel, "mj_game_over", ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      freshPrivateActionsRef.current = false;
      dealtThisGameRef.current = false;
      if ((payload as { gameOver?: boolean }).gameOver) matchOverRef.current = true;
      // 牌局結束：三家手牌改看結算攤牌（allHands），不再顯示眼牌視角
      setState((prev) => ({ ...prev, opponentHands: null }));
      const msg = payload as {
        winnerSeat: number;
        winnerName: string | null;
        score: ScoreResult | null;
        winners?: MjWinner[];
        allHands: MjHandReveal[];
        settlement?: Settlement;
        playerScores?: number[];
        roundInfo?: RoundInfo;
        gameOver?: boolean;
        handStats?: HandStats;
        remainingWall?: Tile[];
        winFx?: WinFx; // 贏家帳號的專屬胡牌特效代號（自摸時才有）
      };
      // 放槍被胡走的那張（不是自摸）從海底拿掉，和伺服器輸出的 state 一致
      const wonFromDiscard = new Set((msg.winners ?? []).filter((w) => w.from != null && w.winTile).map((w) => w.winTile!.id));
      setState((prev) => ({
        ...prev,
        players: wonFromDiscard.size
          ? prev.players.map((p) => ({ ...p, discards: p.discards.filter((t) => !wonFromDiscard.has(t.id)) }))
          : prev.players,
        status: "finished",
        availableActions: [],
        // 搶槓胡：結算畫面靠 lastDiscard 顯示「某某 放槍」，把加槓的牌放回來
        lastDiscard: prev.pendingAddKong
          ? { tile: prev.pendingAddKong.tile, from: prev.pendingAddKong.seat }
          : prev.lastDiscard,
        pendingAddKong: null,
        robKong: false,
        pendingFlowerRob: null,
        robFlower: false,
        winner:
          msg.winnerSeat >= 0
            ? {
                ...msg.winners?.find((w) => w.seat === msg.winnerSeat),
                seat: msg.winnerSeat,
                name: msg.winnerName || "",
                score: msg.score || { fans: [], totalFan: 0 },
                allHands: msg.allHands,
                ...(msg.winFx ? { winFx: msg.winFx } : {}),
              }
            : {
                seat: -1,
                name: "",
                score: { fans: [], totalFan: 0 },
                allHands: msg.allHands,
              },
        winners: msg.winners && msg.winners.length > 0 ? msg.winners : undefined,
        settlement: msg.settlement,
        playerScores: msg.playerScores ?? prev.playerScores,
        roundInfo: msg.roundInfo ?? prev.roundInfo,
        gameOver: msg.gameOver ?? false,
        handStats: msg.handStats ?? prev.handStats,
        remainingWall: msg.remainingWall ?? prev.remainingWall,
      }));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[mj] connected to room", roomCode);
        const rid = roomIdRef.current;
        if (rid) {
          fetchState(rid);
        }
      }
    });

    channelRef.current = channel;

    // Periodic state poll for recovery
    const pollTimer = setInterval(() => {
      const rid = roomIdRef.current;
      if (!rid || closedRef.current) return;
      fetchState(rid);
    }, 5000);
    // iPhone 主畫面 App／Safari 從背景回來：計時器和即時連線可能停過，馬上重抓一次，不等下一輪輪詢（最多 5 秒）
    const onResume = () => {
      const rid = roomIdRef.current;
      if (document.hidden || !rid || closedRef.current) return;
      if (!stateGateRef.current.allowResume(Date.now())) return; // visibilitychange＋pageshow 連發：只抓一次
      fetchState(rid);
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);

    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode, playerName, myId, fetchState, markClosed, bindPrivateEvents, playDeclareFx, playFlowerFx, noteFlowers, clearFlowerFx, onHeld, holdFor, showPace]);

  const isHost = state.hostId === myId || (state.hostId === "" && state.mySeat === 0);

  // --- API calls ---

  /** 動作 API：登入房回 401／403 時通知頁面（退回登入閘門／回大廳），錯誤照樣往外丟 */
  const call = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      return await api("POST", path, body);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) onAuthErrorRef.current?.(status);
      throw err;
    }
  }, []);

  const createRoom = useCallback(async () => {
    const data = await api<{ code: string; roomId: string }>("POST", "/api/mahjong/create", {
      hostId: myId,
    });
    return data;
  }, [myId]);

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      const data = await api<{ seat: number; roomId: string }>("POST", "/api/mahjong/join", {
        code,
        playerId: myId,
        name,
      });
      return data;
    },
    [myId]
  );

  const startGame = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    await call("/api/mahjong/start", {
      roomId: rid,
      playerId: myId,
    });
  }, [myId, call]);

  const drawTileAction = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    const cur = stateRef.current;
    const eye = cur.eyeSeats.includes(cur.mySeat) && !document.hidden;
    const drawToken = eyeDrawRef.current.start(eye);
    if (eye) holdFor(SLOW_DRAW_WAIT_MS); // 眼牌：先排隊，收到摸到的牌再翻（在背景就不翻，直接套用）
    try {
      const res = (await call("/api/mahjong/draw", {
        roomId: rid,
        playerId: myId,
      })) as { drawnTile?: Tile | null; canWin?: boolean; autoWin?: boolean } | null;
      const h = holdRef.current;
      const tile = res?.drawnTile;
      // 私人事件還沒到（不同頻道、順序不保證）：用 API 回應的那張先開始翻，打出等翻完＋停 1 秒。
      // 事件已經先處理過這一次摸牌就什麼都不做（不重新計時、不蓋掉新狀態）
      if (eye && tile && eyeDrawRef.current.claimResponse(drawToken, tile.id)) {
        if (!h.on) return; // 排隊已經結束（等太久保險放行）：打出已套用，不能再把牌加回去
        holdFor(SLOW_DRAW_MS + SLOW_DRAW_PAUSE_MS);
        h.slowTile = tile.id;
        setState((prev) => ({
          ...prev,
          myHand: prev.myHand.some((t) => t.id === tile.id) ? prev.myHand : safeHand([...prev.myHand, tile]),
          slowDraw: { tileId: tile.id, win: res?.canWin === true || res?.autoWin === true },
          availableActions: [],
          hasDrawn: true,
          drawnTileId: tile.id,
        }));
      } else if (eye && !tile && h.on && h.slowTile === undefined) {
        releaseHold(); // 沒摸到牌（例如進入七搶一）：直接套用
      }
    } catch (err) {
      releaseHold();
      // Race: auto-draw effect can fire before the mj_action broadcast
      // flips hasDrawn to true after chi/pong/kong. Server will reject with
      // "已經摸過牌了" — safe to ignore; the next discard path will proceed.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("已經摸過牌了") || msg.includes("等待其他玩家動作中")) return;
      console.error("[mj] draw failed:", err);
    }
  }, [myId, call, holdFor, releaseHold]);

  const discardTile = useCallback(
    async (tileId: number, declareEye?: boolean) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      // Bug #16: prevent double-discard race condition
      if (discardingRef.current) return;
      discardingRef.current = true;
      freshPrivateActionsRef.current = false;
      stateGateRef.current.beginLocal(); // 打出前（和伺服器處理完之前）送出的 state 回應不能把這張牌放回手上
      // Optimistically remove tile from hand + mark hasDrawn=false so UI
      // doesn't keep showing "輪到你打牌" during the pending-action window
      setState((prev) => {
        const tile = prev.myHand.find((t) => t.id === tileId);
        return {
          ...prev,
          myHand: prev.myHand.filter((t) => t.id !== tileId),
          availableActions: [],
          eyeOptions: [],
          eyeWithTing: false,
          chiForbidden: [],
          drawnTileId: null,
          hasDrawn: false,
          lastDiscard: tile ? { tile, from: prev.mySeat } : prev.lastDiscard,
          focusDiscard: tile ? { tile, from: prev.mySeat } : prev.focusDiscard,
        };
      });
      try {
        await call("/api/mahjong/discard", {
          roomId: rid,
          playerId: myId,
          tileId,
          ...(declareEye ? { declareEye: true } : {}),
        });
      } catch (err) {
        console.error("[mj] discard failed:", err);
        // Revert on failure — poll will fix state
        const rid2 = roomIdRef.current;
        if (rid2) fetchState(rid2);
      } finally {
        discardingRef.current = false;
        if (stateGateRef.current.endLocal()) fetchState(rid); // 打牌請求在路上時丟掉過輪詢：現在補抓
      }
    },
    [myId, fetchState, call]
  );

  const doAction = useCallback(
    async (actionType: string, tiles?: Tile[]) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      // 自己回合（摸牌後）的「過」只是不做自摸胡／暗槓／加槓，不送後端：
      // 後端在沒有等待窗口時收到 pass 會直接跳到下一家
      const cur = stateRef.current;
      if (
        actionType === "pass" &&
        cur.currentTurn === cur.mySeat &&
        cur.hasDrawn &&
        !cur.robKong &&
        !cur.robFlower &&
        !cur.pendingAddKong &&
        !cur.pendingFlowerRob
      ) {
        // 地聽／眼牌後不能換牌：不胡就打出剛摸到的那張
        if ((cur.tingSeats.includes(cur.mySeat) || cur.eyeSeats.includes(cur.mySeat)) && cur.drawnTileId != null) {
          await discardTile(cur.drawnTileId);
          return;
        }
        dismissedOwnActionsRef.current = ownTurnKey(cur.roundInfo, cur.wallRemaining, cur.drawnTileId);
        setState((prev) => ({ ...prev, availableActions: [] }));
        return;
      }
      // Optimistically clear action buttons immediately
      freshPrivateActionsRef.current = false;
      stateGateRef.current.beginLocal();
      progressRef.current++;
      actionsInFlightRef.current++;
      setState((prev) => ({ ...prev, availableActions: [] }));
      let failed = false;
      try {
        const res = await call("/api/mahjong/action", {
          roomId: rid,
          playerId: myId,
          actionType,
          tiles: tiles?.map((t) => t.id),
        });
        console.log(`[mj] action ${actionType} success`, res);
      } catch (err) {
        console.error(`[mj] action ${actionType} failed:`, err, { tiles: tiles?.map(t => ({ id: t.id, display: t.display })) });
        failed = true;
      } finally {
        // 請求回來了：在路上時送出的 state 請求，回應一律當作過時
        actionsInFlightRef.current--;
        progressRef.current++;
      }
      const refetch = stateGateRef.current.endLocal(); // 動作在路上時丟掉過輪詢：補抓一次
      // Resync state from server to recover（要在上面放行之後，這份回應的按鈕才會採用）
      if (failed || refetch) fetchState(rid);
    },
    [myId, fetchState, discardTile, call]
  );

  /**
   * 等人階段退出房間（POST /api/mahjong/leave）：回傳 null＝已經離開（成功，或伺服器說本來就不在房內 404），
   * 字串＝失敗要顯示的提示；開局了（409）順便重抓狀態，畫面換成牌桌、走原本的投票離開
   */
  const leaveWaiting = useCallback(async (): Promise<string | null> => {
    const rid = roomIdRef.current;
    if (!rid) return null;
    try {
      await call("/api/mahjong/leave", { roomId: rid });
      return null;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) return null;
      if (status === 409) {
        fetchState(rid);
        return /game_in_progress/.test((err as Error).message) ? "牌局已經開始，不能直接退出" : "退出失敗，請再試一次";
      }
      if (status === 401 || status === 403) return null; // 頁面已經由 onAuthError 處理（退回登入或回大廳）
      return "退出失敗，請再試一次";
    }
  }, [call, fetchState]);

  const requestLeave = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    try {
      await call("/api/mahjong/leave-request", {
        roomId: rid,
        playerId: myId,
      });
    } catch (err) {
      console.error("[mj] leave-request failed:", err);
    }
  }, [myId, call]);

  const voteLeave = useCallback(
    async (approve: boolean) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      try {
        await call("/api/mahjong/leave-vote", {
          roomId: rid,
          playerId: myId,
          approve,
        });
      } catch (err) {
        console.error("[mj] leave-vote failed:", err);
      }
    },
    [myId, call]
  );

  /**
   * 按「下一局」：成功就先把自己標成已同意（不用等 mj_next_game_ready 廣播；第 4 個按、已經開新局時不標，見 readyAfterNextGame）；
   * 被拒絕（這局其實還沒結束／整場已結束／房間不在／網路錯誤）回傳要顯示的訊息，並馬上重抓狀態，讓畫面跟上伺服器。
   * 登入失效、座位不是自己的（401／403）由 onAuthError 處理，不另外顯示。
   */
  const nextGame = useCallback(async (): Promise<string | null> => {
    const rid = roomIdRef.current;
    if (!rid) return null;
    const pressedGame = gameKeyOf(stateRef.current.roundInfo); // 按的是哪一局的結算
    try {
      const res = (await call("/api/mahjong/next-game", {
        roomId: rid,
        playerId: myId,
      })) as { started?: boolean } | null;
      // 第 4 個按（started）或回應到之前已經換局：不動；第 1～3 個：先把自己標成已同意
      setState((prev) => {
        const ready = readyAfterNextGame(prev, myId, res, pressedGame);
        return ready ? { ...prev, nextGameReady: ready } : prev;
      });
      return null;
    } catch (err) {
      console.error("[mj] next-game failed:", err);
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) return null;
      fetchStateRef.current?.(rid);
      let msg = "";
      try { msg = (JSON.parse((err as Error).message) as { error?: string }).error ?? ""; } catch {}
      if (status === 400 && msg) return `${msg}，已重新整理牌局`;
      if (status === 404) return "房間已經不在了";
      return "沒有送出，請再按一次";
    }
  }, [myId, call]);

  const setRoomIdExternal = useCallback((id: string) => {
    setRoomId(id);
    roomIdRef.current = id;
    // Fetch state immediately on reconnect — don't wait for 5s polling tick
    if (id) {
      fetchState(id);
    }
  }, [fetchState]);

  /** join 成功：登入房改用伺服器回的玩家 id、訂閱座位頻道，再開始抓狀態 */
  const applyJoin = useCallback((info: MjJoinInfo) => {
    if (info.playerId && info.playerId !== myIdRef.current) {
      myIdRef.current = info.playerId;
      setMyId(info.playerId);
      setState((prev) => ({ ...prev, myId: info.playerId! }));
    }
    if (info.privateChannel) setPrivateChannel(info.privateChannel);
    setRoomIdExternal(info.roomId);
  }, [setRoomIdExternal]);

  const isMyTurn = state.currentTurn === state.mySeat;
  const needsDraw = isMyTurn && !state.hasDrawn && state.status === "playing";
  // 搶槓／七搶一窗口期間不能打牌（後端會回 409）
  const needsDiscard =
    isMyTurn &&
    state.hasDrawn &&
    state.status === "playing" &&
    !state.pendingAddKong &&
    !state.pendingFlowerRob &&
    !state.slowDraw; // 慢慢摸牌中：伺服器已經處理完，不能再點牌

  // Auto-draw: when it's my turn and I need to draw, do it automatically
  // BUT NOT if there are pending actions OR I just discarded (pending
  // chi/pong/kong/win window on my own discard).
  const justDiscarded =
    state.lastDiscard != null && state.lastDiscard.from === state.mySeat;
  useEffect(() => {
    if (
      needsDraw &&
      state.mySeat >= 0 &&
      state.availableActions.length === 0 &&
      !justDiscarded
    ) {
      const timer = setTimeout(() => {
        drawTileAction();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [needsDraw, state.mySeat, state.availableActions.length, justDiscarded]);

  return {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    nextGame,
    requestLeave,
    voteLeave,
    drawTile: drawTileAction,
    discardTile,
    doAction,
    setRoomId: setRoomIdExternal,
    applyJoin,
    closed,
    markClosed,
    createRoom,
    joinRoom,
    leaveWaiting,
    /** 目前的房間 id（聊天綁定「這一場」用） */
    roomId,
  };
}
