"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { sortTiles, isFlower, tileKey } from "@/lib/mahjong/tiles";
import type { Tile } from "@/lib/mahjong/tiles";
import { FlowerTracker, gameKeyOf } from "@/lib/mahjong/flowerTracker";
import { EyeDrawGate, StateRequestGate, readyAfterNextGame } from "@/lib/mahjong/stateSync";

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
import type { Meld, ScoreResult, RoomSettings, RoundInfo, Settlement, WaitTile } from "@/lib/mahjong/gameState";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { closedFromEvent, closedFromResponse, type RoomClosedInfo } from "./roomClosed";
import { authHeaders, mjStorage } from "@/lib/mahjong/clientAuth";

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
}

/** 結算攤牌用的一家牌（贏家的 hand 不含胡的那張） */
export interface MjHandReveal {
  seat: number;
  name: string;
  hand: Tile[];
  revealed: Meld[];
  flowers: Tile[];
}

/** 贏家：winTile／from／waits 是新版後端才有，舊牌局沒有 */
export interface MjWinner {
  seat: number;
  name: string;
  score: ScoreResult;
  winTile?: Tile;
  from?: number | null; // 自摸、八仙過海＝null
  waits?: WaitTile[];
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
  actionNotice: { seat: number; type: string } | null;
  // Round system
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];
  settlement?: Settlement;
  gameOver?: boolean;
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
    availableActions: [],
    pendingAddKong: null,
    robKong: false,
    pendingFlowerRob: null,
    robFlower: false,
    tingSeats: [],
    eyeSeats: [],
    eyeOptions: [],
    eyeWithTing: false,
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
  /** 訂閱廣播事件；慢慢摸牌期間，除了摸牌本身的事件以外都先排隊 */
  const onHeld = useCallback((ch: RealtimeChannel, event: string, fn: (msg: { payload: Record<string, unknown> }) => void) => {
    ch.on("broadcast", { event }, (msg) => {
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
        })),
        myHand: hand,
        mySeat,
        currentTurn: gs.currentTurn,
        dealerSeat: gs.dealerSeat,
        // 搶槓窗口期間 lastDiscard 是加槓的牌，不是打出去的牌，不當棄牌顯示
        lastDiscard: pendingAddKong ? null : gs.lastDiscard,
        pendingAddKong,
        robKong: pendingAddKong != null && pendingAddKong.seat !== mySeat,
        pendingFlowerRob,
        robFlower: pendingFlowerRob != null && pendingFlowerRob.robberSeat === mySeat,
        // 輪到我且剛摸完牌：重新整理後把摸進的那張分開顯示
        drawnTileId: gs.myDrawnTileId ?? prev.drawnTileId,
        wallRemaining: gs.wallCount,
        hasDrawn: gs.hasDrawn,
        // availableActions: prefer broadcast-delivered value (fresh), but
        // fall back to polled myAvailableActions if the broadcast was missed
        // so chi/pong/kong buttons appear even after realtime drops.
        availableActions: prev.availableActions.length > 0
          ? prev.availableActions
          : turnKey != null && turnKey === dismissedOwnActionsRef.current
            ? []
            : (polledActions ?? []),
        tingSeats: gs.tingSeats ?? prev.tingSeats,
        eyeSeats: gs.eyeSeats ?? prev.eyeSeats,
        opponentHands: gs.status === "playing" ? gs.opponentHands ?? null : null,
        // 輪詢有帶（摸牌後）就用輪詢的；沒帶時（例如莊家開局沒摸牌）還是我的打牌回合就保留
        eyeOptions: polledEyeIds ?? (gs.myAvailableActions ? [] : stillMyDiscard ? prev.eyeOptions : []),
        eyeWithTing: polledEye ? polledEye.ting === true : gs.myAvailableActions ? false : stillMyDiscard ? prev.eyeWithTing : false,
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
  }, [markClosed, playDeclareFx]);
  const fetchStateRef = useRef<((rid: string) => Promise<void>) | null>(null);
  useEffect(() => { fetchStateRef.current = fetchState; }, [fetchState]);

  // 只給本人的事件（手牌、摸到的牌、可以吃碰槓胡）。舊房送在房間頻道、登入房送在座位頻道，
  // 兩邊都掛上；payload 一樣帶 playerId，不是我的就略過
  const bindPrivateEvents = useCallback((ch: RealtimeChannel, myId: string) => {
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
        setState((prev) => ({
          ...prev,
          myHand: safeHand(hand),
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
        const { playerId, hand, drawnTileId, eyeOptions, eyeWithTing } = payload as {
          playerId: string;
          hand: Tile[];
          drawnTileId?: number;
          eyeOptions?: number[]; // 吃、碰後要打牌：可以一起宣告眼牌的牌
          eyeWithTing?: boolean;
        };
        if (playerId !== myId) return;
        setState((prev) => ({
          ...prev,
          myHand: safeHand(hand),
          // Authoritative: kong → replacement tile id; chi/pong → null
          drawnTileId: drawnTileId ?? null,
          ...(eyeOptions ? { eyeOptions, eyeWithTing: eyeWithTing === true } : {}),
        }));
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
    bindPrivateEvents(ch, myId);
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
          hostId: hostPlayer?.id || prev.hostId,
        };
      });
    });

    // --- mj_game_start ---
    onHeld(channel, "mj_game_start", ({ payload }) => {
      eyeDrawRef.current.reset(); // 上一局沒處理完的摸牌作廢（牌 id 每局重複使用）
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
        })),
        winner: undefined,
        winners: undefined,
        settlement: undefined,
        gameOver: false,
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

    bindPrivateEvents(channel, myId);

    // --- mj_draw (public) ---
    onHeld(channel, "mj_draw", ({ payload }) => {
      const { seat, tileCount, wallCount, flowers } = payload as {
        seat: number;
        tileCount: number;
        wallCount: number;
        flowers?: Tile[];
      };
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
        // Clear actions — new mj_available_actions will re-populate after this
        // arrives (server sends mj_discard first, action broadcasts second).
        // 登入房的按鈕走座位頻道，可能比這個事件先到：這張牌有給我按鈕就保留
        availableActions:
          keepEarlyActions && (payload as { availableActions?: { playerSeat: number }[] }).availableActions?.some((a) => a.playerSeat === prev.mySeat)
            ? prev.availableActions
            : [],
        eyeOptions: [],
        eyeWithTing: false,
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
      dismissedOwnActionsRef.current = null;
      const msg = payload as {
        type: string;
        seat: number;
        tiles: Tile[];
        tileCount?: number;
      };
      const keepEarlyActions = freshPrivateActionsRef.current;
      freshPrivateActionsRef.current = false;
      setState((prev) => {
        const meld: Meld = {
          type: msg.type as Meld["type"],
          tiles: msg.tiles,
          from: prev.lastDiscard?.from,
        };
        // If I'm the one who did chi/pong/kong, immediately remove the used
        // tiles from my hand to avoid a brief window where stale tiles are
        // clickable before mj_hand_update arrives (causes "卡住" feel).
        const meldTileIds = new Set(msg.tiles.map((t) => t.id));
        const updatedHand =
          msg.seat === prev.mySeat
            ? prev.myHand.filter((t) => !meldTileIds.has(t.id))
            : prev.myHand;
        return {
          ...prev,
          currentTurn: msg.seat,
          lastDiscard: null,
          // 我槓完補牌的按鈕（槓上開花、再槓）走座位頻道，可能比這個事件先到
          availableActions: keepEarlyActions && msg.seat === prev.mySeat ? prev.availableActions : [],
          hasDrawn: true, // after chi/pong/kong player must discard (or already drew for kong)
          actionNotice: { seat: msg.seat, type: msg.type },
          myHand: updatedHand,
          // 被吃碰槓拿走的那張從打出那家的海底拿掉（和伺服器輸出的 state 一致，不用等輪詢）
          players: prev.players.map((p) => {
            const discards = p.discards.filter((t) => !meldTileIds.has(t.id));
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
      // Auto-clear action notice after 1.5s
      setTimeout(() => {
        setState((prev) => ({ ...prev, actionNotice: null }));
      }, 1500);
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
        actionNotice: { seat, type: "add_kong" },
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
        setState((prev) => ({ ...prev, actionNotice: null }));
      }, 1500);
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
  }, [roomCode, playerName, myId, fetchState, markClosed, bindPrivateEvents, playDeclareFx, playFlowerFx, noteFlowers, clearFlowerFx, onHeld]);

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
          drawnTileId: null,
          hasDrawn: false,
          lastDiscard: tile ? { tile, from: prev.mySeat } : prev.lastDiscard,
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
      setState((prev) => ({ ...prev, availableActions: [] }));
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
        // Resync state from server to recover
        fetchState(rid);
      }
    },
    [myId, fetchState, discardTile, call]
  );

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
  };
}
