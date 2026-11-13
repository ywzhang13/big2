"use client";
// 麻將觀戰模式（小宜〈麻將觀戰模式-UIUX完整規格-2026-10-30〉；老闆 2026-10-30 定案：只限 LINE 登入、不延遲、被觀戰者可收回、效力到房間結束、只能看）。
// 獨立路由 /mahjong/watch：一般打牌頁和大老二頁都不載入這支。
//   入口（輸入房號）→ 錯誤（房號不存在、未開局、沒有 LINE 登入、自己在這桌、已結束、網路）→ 選玩家申請（等待／拒絕／冷卻，倒數用伺服器時間）
//   → 觀戰（頂部「觀戰中・○○視角」、右側視角抽屜切換、離開觀戰）→ 被收回：先清掉手牌再顯示提示
// 觀戰中牌桌用一般牌桌元件畫，但所有操作都不接（不出牌、不吃碰槓胡、不眼牌）。
// 聊天、語音、互動（2026-11-13）：看得到、聽得到（名牌旁泡泡、互動動畫、聊天室），不能說、不能丟，聊天室寫「觀戰中，僅能觀看」。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import type { MjHandReveal } from "@/hooks/useMahjong";
import type { WinFx } from "@/lib/mahjong/gameState";
import { getSupabase } from "@/lib/supabase";
import { POLL_TICK_MS, SyncPolicy } from "@/lib/mahjong/syncPolicy";
import { EYE_DRAW_MS, FLOWER_FX_MS, FLOWER_STAGGER_MS } from "@/lib/mahjong/pace";
import { useMjAuth } from "@/hooks/useMjAuth";
import MjBoard from "@/components/mahjong/MjBoard";
import MjBoardMobile from "@/components/mahjong/MjBoardMobile";
import MjFlowerFx from "@/components/mahjong/MjFlowerFx";
import MjPrefsPanel from "@/components/mahjong/MjPrefsPanel";
import MjResultMobile from "@/components/mahjong/MjResultMobile";
import { useWinShow, WinShowLayer } from "@/hooks/useWinShow";
import { preloadFx, unlockAudio } from "@/lib/mahjong/fx/engine";
import MjTableMenu from "@/components/mahjong/MjTableMenu";
import MjSeatSwitch from "@/components/mahjong/spectate/MjSeatSwitch";
import { SpxAvatar, SpxToast, useTick } from "@/components/mahjong/spectate/SpectateHost";
import {
  clockSkew, fetchView, lookupRoom, requestSpectate, secondsLeft, toSpectateView,
  type SpectateLookupError, type SpectateRoom, type SpectateTarget, type SpectateView,
} from "@/lib/mahjong/spectateClient";
import MjChat, { MjChatButton } from "@/components/mahjong/MjChat";
import MjChatLogBox, { useMjChatFeed } from "@/components/mahjong/MjChatLog";
import MjFx from "@/components/mahjong/MjFx";
import "@/components/mahjong/spectate/spectate.css";

const MOBILE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";
function useMobileLandscape(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(MOBILE_LANDSCAPE_QUERY);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE_LANDSCAPE_QUERY).matches,
    () => false
  );
}

const WIND = ["東", "南", "西", "北"];
const noop = () => {};

const ERRORS: Record<SpectateLookupError, { title: string; body: (code: string) => string; cta: string }> = {
  // 整場打完伺服器會刪房，也是回 404 room_not_found（阿哲 2026-10-30：後端不改，文字一起涵蓋）
  not_found: { title: "房號不存在，或牌局已結束", body: (c) => `找不到房間 ${c}，請確認房號後再試。`, cta: "重新輸入" },
  not_started: { title: "牌局尚未開始", body: () => "房間已建立，開局後才能申請觀戰。", cta: "返回大廳" },
  not_line: { title: "尚未登入 LINE", body: () => "觀戰會顯示你的 LINE 本名與頭像。", cta: "使用 LINE 登入" },
  is_player: { title: "無法觀戰自己的牌桌", body: () => "正在這間房打牌的玩家不能觀戰同桌。", cta: "回到牌桌" },
  ended: { title: "牌局已結束", body: () => "這間房已經結束，無法再申請觀戰。", cta: "返回大廳" },
  network: { title: "無法取得房間資料", body: () => "請檢查網路後再試一次。", cta: "重試" },
};

/** 卡片上的狀態文字與樣式（規格 5.3、5.4）：冷卻看 cooldownUntil、能不能申請看伺服器的 canRequest */
function statusOf(t: SpectateTarget, skew: number): { text: string; tone: "" | "ok" | "bad" | "muted"; canApply: boolean } {
  const cd = secondsLeft(t.cooldownUntil, skew);
  const can = t.canRequest && cd === 0;
  switch (t.status) {
    case "pending": {
      const n = secondsLeft(t.expiresAt, skew);
      return n > 0 ? { text: `等待回應・剩 ${n} 秒`, tone: "", canApply: false } : { text: "申請已失效・可以再次申請", tone: "muted", canApply: true };
    }
    case "approved": return { text: "已同意", tone: "ok", canApply: false };
    case "rejected": return can ? { text: "已拒絕・可以再次申請", tone: "bad", canApply: true } : { text: `已拒絕・${cd} 秒後可再申請`, tone: "bad", canApply: false };
    case "revoked": return can ? { text: "已收回", tone: "bad", canApply: true } : { text: `已收回・${cd} 秒後可再申請`, tone: "bad", canApply: false };
    case "expired": return can ? { text: "申請已失效・可以再次申請", tone: "muted", canApply: true } : { text: `冷卻 ${cd} 秒`, tone: "", canApply: false };
    default: return can ? { text: "可申請", tone: "", canApply: true } : { text: `冷卻 ${cd} 秒`, tone: "", canApply: false };
  }
}

// 翻牌動畫播放時長（審伯首審必修②）：跟 hooks/useMahjong.ts 的 SLOW_DRAW_MS 同一個值，
// 玩家自己畫面的翻牌動畫也是播這麼久，兩邊對齊
export const WATCH_FLIP_MS = 800;

/** pull() 拿到 403／404／410（房間不見了或被收回權限）時，要不要當成「房間關閉」自動退出（老闆 2026-11-08）：
 * 整場打完伺服器會刪房，下一次一定會拿到 404／410——如果已經看過最後一把的結算（gameOver＋winner），
 * 這次不是房間中途關閉，是預期中的事，結算畫面留著，觀戰者自己按「離開觀戰」才離開；
 * 403（主動收回觀戰權限）不受影響，照舊立刻退出；還沒看過最後一把結算時，404／410 照舊視為房間關閉 */
export function shouldExitOnRoomGone(status: 403 | 404 | 410, sawFinalSettlement: boolean): boolean {
  return status === 403 || !sawFinalSettlement;
}

/** mj_game_over 廣播的內容（app/api/mahjong/action/route.ts 的 gameOverEvent()）：每一局結束都會發一次，
 *  不是只有整場最後一局才有；流局時 winnerSeat＝-1、winnerName／score 都是 null（審伯必修②） */
export interface GameOverPayload {
  winnerSeat: number; winnerName: string | null; score: unknown;
  // winFx：贏家帳號的專屬自摸特效代號，伺服器在 winners[] 這個陣列裡用物件展開整份 WinnerEntry 帶過來
  // （lib/mahjong/events.ts 的 gameOverEvent），不在上面單獨的 winnerSeat／score 這幾個欄位裡
  winners: { seat: number; name: string; score: unknown; winFx?: WinFx }[];
  allHands?: MjHandReveal[];
  settlement: unknown; playerScores?: number[]; roundInfo: unknown; gameOver: boolean;
  remainingWall?: Tile[]; handStats?: unknown;
}

/** 把 mj_game_over 的內容套進目前畫面（老闆 2026-11-08）：伺服器在同一個請求裡「先廣播這個事件、才刪房」，
 *  所以廣播一定會送到，但緊接著的 404／410（房間已經刪掉）不一定還拿得到資料——這個事件本身就夠蓋出結算畫面，
 *  不用等那次注定會撲空的輪詢。view 是 null（還沒拿過任何一次視角，事件比第一次 view 早到）時不套，
 *  等正常的 pull() 建立基線，不會卡在載入中以外的狀態。
 *  胡牌和流局都要能正常顯示（審伯必修②）：流局（winnerSeat < 0）用跟玩家自己畫面同一套空值
 *  {fans:[], totalFan:0}（照 hooks/useMahjong.ts 輪詢分支的流局寫法），不會因為 score 是 null 讓
 *  MjResultMobile 讀 winner.score.fans 壞掉；局結束時帶入伺服器已經給的 allHands，四家攤牌才看得到 */
export function applyGameOverEvent(view: SpectateView | null, p: GameOverPayload): SpectateView | null {
  if (!view) return view;
  const isDraw = p.winnerSeat == null || p.winnerSeat < 0;
  // winFx 沒有單獨帶在 winnerSeat／score 旁邊，要從 winners[] 裡找回同一個座位的那筆（老闆 2026-11-08：
  // 這裡漏了這個欄位，觀戰的人會先看到沒有 winFx 的這份、播出預設的金色自摸浮層，等下一次 pull() 拿到
  // 補上 winFx 的完整快照，才換成玩家自己設定的特效，變成播兩次）
  const winFx = isDraw ? undefined : p.winners?.find((w) => w.seat === p.winnerSeat)?.winFx;
  const winner = (isDraw
    ? { seat: -1, name: "", score: { fans: [], totalFan: 0 }, allHands: p.allHands }
    : { seat: p.winnerSeat, name: p.winnerName ?? "", score: p.score, allHands: p.allHands, ...(winFx ? { winFx } : {}) }) as SpectateView["winner"];
  return {
    ...view,
    status: "finished",
    winner,
    winners: (p.winners ?? []) as SpectateView["winners"],
    settlement: p.settlement as SpectateView["settlement"],
    playerScores: p.playerScores ?? view.playerScores,
    roundInfo: p.roundInfo as SpectateView["roundInfo"],
    gameOver: p.gameOver,
    remainingWall: p.remainingWall ?? view.remainingWall,
    handStats: p.handStats as SpectateView["handStats"],
  };
}

/** mj_draw 這一次要晚幾毫秒才讓觀戰者拉到最新資料（老闆 2026-11-08）：和玩家自己畫面同一條公式
 *  （hooks/useMahjong.ts 的 mj_draw 處理）——那家正在眼牌才要「慢慢摸」（EYE_DRAW_MS），剛好疊到補花
 *  （FLOWER_FX_MS + 每多一張疊 FLOWER_STAGGER_MS）就兩段相加，不是眼牌、也沒補花就是 0（不用慢摸） */
export function computeEyeDrawDelayMs(seat: number, eyeSeats: number[], newFlowerCount: number): number {
  const eyeMs = eyeSeats.includes(seat) ? EYE_DRAW_MS : 0;
  const flowerMs = newFlowerCount > 0 ? FLOWER_FX_MS + FLOWER_STAGGER_MS * (newFlowerCount - 1) : 0;
  return eyeMs + flowerMs;
}

/** pull() 要不要被「慢慢摸牌」關卡擋下來（老闆 2026-11-08）：不管是誰呼叫 pull()（定時輪詢、soonAfter
 *  排的那次、visibilitychange、online），只要還沒到 until 時間就擋住，摸到的牌不會提早出現 */
export function isHeldForSlowDraw(hold: { on: boolean; until: number }, now: number): boolean {
  return hold.on && now < hold.until;
}

/** 剛拿到新的一張牌（drawnTileId 變了）而且正在看的這家是眼牌的人，才播翻牌動畫；不是眼牌、或張數沒變
 *  （不是真的摸到新牌，例如重新整理拿到同一份快照）都不播（老闆 2026-11-08） */
export function shouldShowSlowDrawFlip(view: Pick<SpectateView, "drawnTileId" | "eyeSeats" | "mySeat">, prevDrawnTileId: number | null): boolean {
  return view.drawnTileId != null && view.drawnTileId !== prevDrawnTileId && view.eyeSeats.includes(view.mySeat);
}

/** 延後套用的結算（mj_game_over，眼牌那家正在慢慢摸時）在真的要套用「畫面」前，要不要被取消／忽略
 *  （審伯首審必修③）：alive=false（換視角、離開觀戰、effect 重跑）或這段等待期間已經換了新局
 *  （viewRef 現在的 roundInfo 跟排程當下不一樣，表示有更新的快照先蓋過去了）都要跳過，不能把舊結算蓋回去。
 *  注意：finalSettlementRef／viewRef 本身是在收到事件的當下「立刻」同步更新的（不受這個函式影響），
 *  這裡只控制「要不要呼叫 setView 把畫面換成這份結算」 */
export function shouldApplyDelayedSettlement(alive: boolean, currentRoundInfo: unknown, scheduledRoundInfo: unknown): boolean {
  return alive && JSON.stringify(currentRoundInfo) === JSON.stringify(scheduledRoundInfo);
}

/** 從「已經處理完」的最新快照（newView）找出 seat 剛摸到的那張牌：一般摸牌後自動打出＝newView.lastDiscard
 *  那張；自摸結束＝newView.winner／winners 裡 seat 那家的 winTile。兩種都找不到（例如槓後補牌、連續吃碰
 *  這類不是「摸一張就定案」的事件）回傳 null，呼叫端退回原本整段延遲、不翻牌的做法（審伯首審必修②） */
export function findJustDrawnTile(newView: Pick<SpectateView, "lastDiscard" | "status" | "winner" | "winners">, seat: number): Tile | null {
  if (newView.lastDiscard && newView.lastDiscard.from === seat) return newView.lastDiscard.tile;
  if (newView.status === "finished") {
    if (newView.winner?.seat === seat && newView.winner.winTile) return newView.winner.winTile;
    const w = newView.winners?.find((x) => x.seat === seat);
    if (w?.winTile) return w.winTile;
  }
  return null;
}

/** 摸牌當下（t=0）就能播正確翻牌動畫的關鍵：以「摸牌前的舊快照」oldView 為底（審伯複審必修②——
 *  不能用已經處理完的 newView 當底，那樣棄牌堆、海底、currentTurn 全部會是「打出後」的樣子，等於
 *  提早洩漏結果；也不會混進已核准觀戰那家以外的任何新資料，因為整份都原封不動沿用 oldView），
 *  只在被觀戰那家的手牌多放一張剛摸到的牌（findJustDrawnTile 找出來的那張），讓翻牌動畫在 t=0
 *  立刻顯示正確的牌，不用等到最終狀態（可能已經是打出後或結算）才看得到 */
export function buildMidDrawView(oldView: SpectateView, tile: Tile): SpectateView {
  return { ...oldView, myHand: [...oldView.myHand, tile], drawnTileId: tile.id };
}

export default function MahjongWatchPage() {
  const auth = useMjAuth();
  const mobile = useMobileLandscape();
  const lineIn = auth.status === "in" && !!auth.user && !auth.user.isGuest;
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<SpectateRoom | null>(null);
  const [error, setError] = useState<SpectateLookupError | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; assertive?: boolean } | null>(null);
  const [viewSeat, setViewSeat] = useState<number | null>(null);
  const [view, setView] = useState<SpectateView | null>(null);
  // 觀戰者畫面也要看到別家補花亮正面（老闆 2026-11-07：和玩家自己、別家視角一致）：記每家已經看過的花牌 id，
  // mj_draw 多出來的就是這次補到的，key 一樣用遞增序號（不用跟玩家那邊共用 flowerTrackerRef，觀戰是獨立的畫面）
  const [flowerFx, setFlowerFx] = useState<{ key: number; seat: number; tiles: Tile[]; delay: number; holdMs: number }[]>([]);
  const flowerSeenRef = useRef(new Map<number, Set<number>>());
  const flowerFxKeyRef = useRef(0);
  // 最後一把的結算（老闆 2026-11-08）：整場打完伺服器會刪房，下一次 pull() 一定會拿到 404／410。
  // 這個 ref 記下「已經拿到最後一把的結算（gameOver＋winner）」，404／410 到達時如果是這個情況，
  // 就不要清掉畫面、不要跳錯誤頁，讓結算（誰胡、胡什麼、台數、輸贏）留在畫面上，觀戰者自己按「離開觀戰」才離開；
  // 不是最後一把時房間還在，不會有這個 ref，404／410 仍然照舊視為房間關閉、自動退出
  const finalSettlementRef = useRef(false);
  // 眼牌那家摸牌「慢慢摸」（老闆 2026-11-08）：mj_draw 只靠 soonAfter 晚一點排下一次 pull()，
  // 但 :266 的定時輪詢、visibilitychange／online 都各自呼叫 pull()，原本沒有一個共同的關卡擋住它們，
  // 延遲期間還是可能先拉到摸牌後的最新狀態，讓觀戰者比本人更早看到。這個 ref 是唯一的關卡：
  // pull() 一開始就檢查，是真的擋住「所有」會呼叫 pull() 的入口，不是只擋 mj_draw 自己排的那次
  const holdRef = useRef<{ on: boolean; until: number }>({ on: false, until: 0 });
  // 只在「正在看的那家」自己摸牌時才播放翻牌動畫（跟玩家自己畫面的 SlowDrawTile 共用同一個視覺元件）；
  // 蓋掉 slowDraw={null} 那段舊寫法
  const [slowDraw, setSlowDraw] = useState<{ tileId: number; win: boolean } | null>(null);
  // t=0 先拉已處理完的狀態、1800ms 才換成最終畫面（stagedEyeReveal，審伯必修②）：每次排一輪新的重播
  // 就加 1，1800ms 那次 setView 之前先比對，序號對不上（同一輪裡又有更新的摸牌、或換視角／離開觀戰）
  // 就不套用，避免舊的重播蓋掉新的狀態
  const revealGenRef = useRef(0);
  // 四家切換的風位排序：換視角時畫面先清空（view＝null），沿用上一份視角的開門／莊家，按鈕順序才不會跳動
  const [lastSeats, setLastSeats] = useState<{ doorSeat?: number; dealerSeat: number } | null>(null);
  if (view && (lastSeats?.doorSeat !== view.doorSeat || lastSeats?.dealerSeat !== view.dealerSeat)) setLastSeats({ doorSeat: view.doorSeat, dealerSeat: view.dealerSeat });
  const [revokedBy, setRevokedBy] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  // 胡牌演出：和打牌頁同一份排程（hooks/useWinShow.tsx）——大牌段 → 浮層或隕石 → 結算，播法、順序、跳過都一樣
  const ws = useWinShow({ winner: view?.winner, status: view?.status ?? "", roundInfo: view?.roundInfo, roomId: room?.roomId ?? "", roomOk: !!view });
  // 大牌、隕石、浮層的聲音：手機要在使用者點擊時建立／叫醒音訊（同打牌頁 hooks/useTableSounds.ts；iPhone 只認 touchend、click、按鍵）
  useEffect(() => {
    const unlock = () => { unlockAudio(); void preloadFx().then(unlockAudio); };
    const evs = ["pointerdown", "touchend", "click", "keydown"] as const;
    evs.forEach((e) => document.addEventListener(e, unlock, true));
    return () => evs.forEach((e) => document.removeEventListener(e, unlock, true));
  }, []);
  const skew = room ? clockSkew(room.serverNow) : 0;
  // 本場聊天、互動：開始觀戰才讀歷史、訂閱觀戰頻道；離開觀戰清空
  const account = auth.status === "in" ? auth.user?.id ?? "" : "";
  const chatRoomId = viewSeat != null && room ? room.roomId : "";
  const chatRetry = useMjChatFeed({ account, roomId: chatRoomId, roomCode: room?.code ?? "", me: null, spectator: true });
  const targets = room?.players ?? [];
  useTick(!!room);

  const flash = useCallback((text: string, assertive?: boolean) => {
    setToast({ text, assertive });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 2500);
  }, []);

  const lookup = useCallback(async (c: string) => {
    setBusy(true);
    const r = await lookupRoom(c);
    setBusy(false);
    if (r.ok) { setRoom(r.data); setError(null); } else { setError(r.error); }
  }, []);

  // 從大廳輸入房號、房間已開局時會帶 ?code= 進來：確認登入後直接查房，跳到選玩家（大廳沒有觀戰按鈕，直接開這頁仍可手動輸入）
  const autoCode = useRef<string | null>(null);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c && /^\d{4}$/.test(c)) { autoCode.current = c; setCode(c); }
  }, []);
  useEffect(() => {
    const c = autoCode.current;
    if (!c || auth.status !== "in") return;
    autoCode.current = null;
    if (lineIn) void lookup(c); else setError("not_line");
  }, [auth.status, lineIn, lookup]);

  // 選玩家畫面：每 2 秒向伺服器更新四位的狀態（倒數、同意、拒絕都以伺服器為準）；分頁回前景時馬上更新
  const listCode = room?.code;
  useEffect(() => {
    if (!listCode || viewSeat != null) return;
    const refresh = async () => { const r = await lookupRoom(listCode); if (r.ok) setRoom(r.data); };
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, 2000); // 分頁在背景時不拿（省量 2026-11-01）
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [listCode, viewSeat]);

  // 觀戰中（老柯對接格式第 0 節）：只訂閱房間公開頻道 mj-{房號}，收到任何事件就重拿一次視角（150ms 內合併）。
  // 省量 2026-11-01：保險輪詢從每 3 秒改成「即時連線正常時 20 秒沒拿過才拿」，連線斷了照舊 5 秒；分頁在背景不拿，
  // 回前景、網路恢復、斷線重連後再訂閱上都馬上拿一次
  // 伺服器每次都重新驗權：被收回、沒同意＝403 not_approved → 先清掉手牌，再顯示提示（規格 5.9，順序不可相反）；房間結束＝404／410
  const focusRef = useRef<SpectateView["focusDiscard"]>(null);
  const viewRef = useRef<SpectateView | null>(null); // 目前畫面上顯示的那份（不是剛拿到還沒套用的），算節奏延遲用
  // 宣告眼牌的特效（老闆 2026-10-31：觀戰者也要看到，和玩家本人畫面一樣；做法照 hooks/useMahjong.ts 的 playDeclareFx）：
  //   收到公開事件 mj_eye_declared 就播；漏接的保險＝拿到的視角裡 eyeSeats 多了新座位就補播（剛進來的第一次不播舊的）；同一局每個座位只播一次
  const [declareFx, setDeclareFx] = useState<{ seat: number; both: boolean }[]>([]);
  const declareRef = useRef({ played: new Set<number>(), init: false, timers: new Map<number, ReturnType<typeof setTimeout>>() });
  const playDeclareFx = useCallback((seat: number, both: boolean) => {
    const d = declareRef.current;
    if (d.played.has(seat)) return;
    d.played.add(seat);
    setDeclareFx((prev) => [...prev.filter((f) => f.seat !== seat), { seat, both }]);
    // MIGI 1.9 秒、一般眼牌 1.3 秒播完（同本人畫面）
    clearTimeout(d.timers.get(seat));
    d.timers.set(seat, setTimeout(() => { d.timers.delete(seat); setDeclareFx((prev) => prev.filter((f) => f.seat !== seat)); }, both ? 1900 : 1300));
  }, []);
  const syncDeclareFx = useCallback((eyeSeats: number[], tingSeats: number[]) => {
    const d = declareRef.current;
    if (eyeSeats.length === 0) d.played.clear(); // 新的一局
    if (!d.init) { d.init = true; eyeSeats.forEach((seat) => d.played.add(seat)); return; }
    eyeSeats.forEach((seat) => playDeclareFx(seat, tingSeats.includes(seat)));
  }, [playDeclareFx]);
  useEffect(() => { const d = declareRef.current; return () => d.timers.forEach(clearTimeout); }, []);
  useEffect(() => {
    if (viewSeat == null || !room) return;
    const target = room.players.find((p) => p.seat === viewSeat);
    if (!target) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | null = null, inFlight = false, again = false, backoffUntil = 0, subscribedOnce = false;
    const sync = new SyncPolicy(20_000);
    const slowT = setTimeout(() => { if (alive) setSlow(true); }, 300); // 切換超過 300ms 才出現「載入中」
    const pull = async () => {
      // 眼牌那家正在「慢慢摸」：不管是誰呼叫 pull()（定時輪詢、soonAfter 排的那次、visibilitychange、online），
      // 在這段時間內一律不拉資料，摸到的牌、補花、輸贏都不能比本人畫面更早出現（老闆 2026-11-08）
      if (isHeldForSlowDraw(holdRef.current, Date.now())) return;
      if (holdRef.current.on) holdRef.current.on = false;
      if (Date.now() < backoffUntil) return; // 429 等待中：保險輪詢也不另外打（等待結束時 timer 會補拿一次）
      if (inFlight) { again = true; return; }
      inFlight = true;
      sync.markSent(Date.now());
      const r = await fetchView(room.roomId, target.playerId);
      inFlight = false;
      if (!alive) return;
      // 審伯複審必修②：這次請求送出「之後」可能有 mj_draw 進來、開始慢摸並同步設了 hold——這份回應已經
      // 過時（有可能是已經處理完的最終狀態，會比本人早出現），一律丟棄，等慢摸自己的時間軸去拿
      if (isHeldForSlowDraw(holdRef.current, Date.now())) return;
      if (r.ok) {
        const v = toSpectateView(r.data, focusRef.current);
        focusRef.current = v.focusDiscard;
        const prevDrawnTileId = viewRef.current?.drawnTileId ?? null;
        viewRef.current = v;
        // 整場打完的最後一把：記下來，等一下房間被刪、拿到 404／410 時不要把結算清掉（老闆 2026-11-08）
        if (v.status === "finished" && v.winner && v.gameOver) finalSettlementRef.current = true;
        // 第一次拿到這個視角：先記下現在各家的花牌 id 當基準，不要當成剛補到的（不然一進來就亮一輪）
        for (const p of v.players) if (!flowerSeenRef.current.has(p.seat)) flowerSeenRef.current.set(p.seat, new Set(p.flowers.map((t) => t.id)));
        syncDeclareFx(v.eyeSeats, v.tingSeats);
        // 剛結束慢慢摸牌、拿到新的一張：補翻牌動畫，跟玩家自己畫面的 SlowDrawTile 共用（播完自己清掉，跟
        // hooks/useMahjong.ts 的 SLOW_DRAW_MS 一樣長；只有正在看的這家自己摸牌才播，不是這家的事件不會走到這裡）
        if (shouldShowSlowDrawFlip(v, prevDrawnTileId) && v.drawnTileId != null) {
          const tileId = v.drawnTileId;
          const win = v.status === "finished" && v.winner?.seat === v.mySeat;
          setSlowDraw({ tileId, win });
          setTimeout(() => setSlowDraw((cur) => (cur?.tileId === tileId ? null : cur)), WATCH_FLIP_MS);
        }
        setView(v); setSlow(false); clearTimeout(slowT);
      } else if (r.status === 403 || r.status === 404 || r.status === 410) {
        // 審伯複審必修①：這裡是「不退出」的分支（最後一局已經看過結算），不能跟著把 alive 設成 false——
        // alive=false 會連帶讓 stagedEyeReveal 排的 1800ms 延後結算的 setView 也被擋下來，結算永遠不會出現。
        // 這個分支只代表「房間已刪、但畫面要留著」，effect 本身沒有要卸載，alive 維持 true
        if (!shouldExitOnRoomGone(r.status, finalSettlementRef.current)) return;
        alive = false;
        setView(null);
        setViewSeat(null);
        if (r.status === 403) setRevokedBy(viewSeat);
        else setError(r.status === 410 ? "ended" : "not_found");
        const rr = await lookupRoom(room.code);
        setRoom(rr.ok ? rr.data : null);
        return;
      } else if (r.status === 429) {
        // 拿太頻繁（老柯：每秒超過 10 次回 429）：畫面照舊、不報錯，等一下再拿（伺服器有給 retryAfterMs 就照它，0.3～5 秒）
        const ms = Math.min(5000, Math.max(300, Number(r.body.retryAfterMs) || 1000));
        backoffUntil = Date.now() + ms;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void pull(); }, ms);
        return;
      }
      if (again) { again = false; void pull(); }
    };
    const soon = () => { if (timer) return; timer = setTimeout(() => { timer = null; void pull(); }, 150); };
    // 慢慢摸牌的節奏（老闆 2026-11-07：觀戰者看被觀戰的人摸牌，節奏要跟那位玩家自己畫面上的一樣，不能比較快）：
    // 延後拿最新狀態的時間，而不是另外做一套動畫；拿到的還是同一個 pull()，只是晚一點拿，畫面停留的時間自然就對上了
    const soonAfter = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void pull(); }, ms); };
    // 審伯複審必修②：觀戰的翻牌要跟本人同一條時間軸——t=0（收到 mj_draw，進這個函式的當下、還沒 await
    // 之前）就要同步建立這次重播的世代（revealGenRef）、同步擋住所有一般的拉取（holdRef），不能等
    // fetchView 回來才設，不然「拉取中」那段空檔，輪詢／visibilitychange／online／已經在途中的 pull()
    // 都可能先把已經處理完的狀態秀出來。拿到資料後先比對世代還是不是同一輪，不是（例如第二次 mj_draw
    // 插進來、或換視角離開觀戰）就整個丟棄，不套用也不再往下排。800ms 翻完、停住；1800ms（都從 t=0 算，
    // 扣掉拉取花的時間）才換成真正的最終畫面（打出後，或自摸結算）。
    // 找不到剛摸到的牌（槓後補牌、連續吃碰）、拉取失敗、或還沒有基線：退回原本整段延遲、不翻牌的做法
    const stagedEyeReveal = async (seat: number, ms: number) => {
      const gen = ++revealGenRef.current;
      holdRef.current = { on: true, until: Date.now() + ms };
      const startedAt = Date.now();
      const remaining = () => Math.max(0, ms - (Date.now() - startedAt));
      // 還是同一輪才補排 soonAfter（找不到剛摸到的牌／拉取失敗／沒有基線時的退路）：已經被新一輪蓋過
      // 就不用再排，新一輪自己會處理
      const fallback = () => { if (revealGenRef.current === gen) soonAfter(remaining()); };
      const oldView = viewRef.current;
      if (!oldView) { fallback(); return; }
      const r = await fetchView(room.roomId, target.playerId);
      if (!alive || revealGenRef.current !== gen) return; // 舊的或被第二次 mj_draw 蓋過的一律丟棄
      if (!r.ok) { fallback(); return; }
      const newView = toSpectateView(r.data, focusRef.current);
      const tile = findJustDrawnTile(newView, seat);
      if (!tile) {
        viewRef.current = newView;
        if (newView.status === "finished" && newView.winner && newView.gameOver) finalSettlementRef.current = true;
        fallback();
        return;
      }
      const mid = buildMidDrawView(oldView, tile);
      viewRef.current = mid;
      setView(mid);
      setSlowDraw({ tileId: tile.id, win: newView.status === "finished" && newView.winner?.seat === seat });
      // 審伯首審必修①的同一條規則：真的是整場最後一局（gameOver===true）就立刻同步設旗標，不等 1800ms
      if (newView.status === "finished" && newView.winner && newView.gameOver) finalSettlementRef.current = true;
      setTimeout(() => setSlowDraw((cur) => (cur?.tileId === tile.id ? null : cur)), Math.max(0, WATCH_FLIP_MS - (Date.now() - startedAt))); // 翻完，停住
      setTimeout(() => { // t=0 起算 1800ms：換成真正的最終畫面（打出後的狀態，或自摸結算）
        if (!alive || revealGenRef.current !== gen) return;
        if (holdRef.current.on) holdRef.current.on = false;
        viewRef.current = newView;
        focusRef.current = newView.focusDiscard;
        setView(newView);
      }, remaining());
    };
    void pull();
    const poll = setInterval(() => { if (sync.due(Date.now(), document.hidden)) void pull(); }, POLL_TICK_MS);
    const onBack = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    const supabase = getSupabase();
    const ch = supabase.channel(`mj-${room.code}`);
    ch.on("broadcast", { event: "*" }, (msg) => {
      if (msg.event === "mj_draw") {
        // 和玩家自己畫面上同一條公式（hooks/useMahjong.ts 的 mj_draw 處理）：那家正在眼牌、或剛好補到花，
        // 就晚一點才去拿最新狀態，觀戰者才不會比本人還早看到摸牌結果
        const { seat, flowers } = (msg.payload ?? {}) as { seat?: number; flowers?: Tile[] };
        const cur = viewRef.current;
        const prevN = cur?.players.find((p) => p.seat === seat)?.flowers.length ?? 0;
        const newFlowerN = typeof seat === "number" ? Math.max(0, (flowers?.length ?? 0) - prevN) : 0;
        const ms = typeof seat === "number" ? computeEyeDrawDelayMs(seat, cur?.eyeSeats ?? [], newFlowerN) : 0;
        // 審伯首審必修②：正在看的這家自己摸牌（沒疊補花，單純眼牌延遲）才用「t=0 先拉已處理完的狀態、
        // 照本人時間軸重播」；其他情況（別的眼牌座位、疊補花）維持原本整段延遲、不翻牌的做法，範圍不擴大
        if (ms > 0 && seat === viewSeat && newFlowerN === 0) {
          void stagedEyeReveal(seat, ms);
        } else {
          // 擋住這段時間內「所有」會拉資料的入口（見上面 pull() 開頭的關卡），不是只延後這一次排的 pull()
          if (ms > 0) holdRef.current = { on: true, until: Date.now() + ms };
          if (ms > 0) soonAfter(ms); else soon();
        }
        // 被觀戰的那家不用額外亮正面（本人畫面已經在手牌最右邊顯示）；別家補花的那格亮正面跟玩家自己畫面一樣（老闆 2026-11-07）
        if (typeof seat === "number" && seat !== viewSeat && flowers) {
          const seen = flowerSeenRef.current.get(seat) ?? new Set<number>();
          flowerSeenRef.current.set(seat, new Set(flowers.map((t) => t.id)));
          const added = flowers.filter((t) => !seen.has(t.id));
          if (added.length > 0) {
            const key = ++flowerFxKeyRef.current;
            const holdMs = FLOWER_FX_MS + FLOWER_STAGGER_MS * Math.max(0, added.length - 1);
            setFlowerFx((prev) => [...prev.filter((f) => f.seat !== seat), { key, seat, tiles: added, delay: 0, holdMs }]);
            setTimeout(() => setFlowerFx((prev) => prev.filter((f) => f.key !== key)), holdMs);
          }
        }
      } else soon();
      if (msg.event === "mj_game_over") {
        // 審伯首審必修①：眼牌自摸結束時，這一批事件是「mj_draw（設 hold）→ mj_game_over（gameOver=true）→
        // 房間刪除後的 404／410」。viewRef／finalSettlementRef 要「立刻」同步更新（不等慢摸那段時間），
        // 之後不管是哪個 pull() 先拿到 404／410，都讀得到正確的 finalSettlementRef，不會因為 alive=false
        // 把結算丟掉；只有「畫面」（setView）才延後到慢摸時間過了才套用，對齊本人的節奏
        const p = (msg.payload ?? {}) as GameOverPayload;
        const next = applyGameOverEvent(viewRef.current, p);
        if (next) {
          viewRef.current = next;
          if (p.gameOver === true) finalSettlementRef.current = true;
          const wait = holdRef.current.on ? Math.max(0, holdRef.current.until - Date.now()) : 0;
          // 審伯首審必修③：延後套用的「畫面」要綁定這一局（用這次事件自己的 roundInfo），套用前確認
          // viewRef.current 還是同一局——這段等待期間如果已經有更新的快照／新局蓋過 viewRef（例如 hold
          // 提早解除、pull() 先拿到更新的資料），就不要用這份舊結算蓋回去；alive 則擋住換視角／離開觀戰
          const scheduledRoundInfo = p.roundInfo;
          if (wait > 0) {
            setTimeout(() => {
              if (!shouldApplyDelayedSettlement(alive, viewRef.current?.roundInfo, scheduledRoundInfo)) return;
              setView(next);
            }, wait);
          } else {
            setView(next);
          }
        }
      }
      if (msg.event === "mj_eye_declared") {
        const { seat, ting } = (msg.payload ?? {}) as { seat?: number; ting?: boolean };
        if (typeof seat === "number") playDeclareFx(seat, ting === true);
      }
      // 有人同意、拒絕、收回：抽屜裡四位的狀態也更新
      if (msg.event === "mj_spectators") void lookupRoom(room.code).then((rr) => { if (alive && rr.ok) setRoom(rr.data); });
    });
    ch.subscribe((status) => {
      sync.setChannel("room", status === "SUBSCRIBED");
      if (status !== "SUBSCRIBED") return;
      if (subscribedOnce) void pull(); // 斷線重連後再訂閱上：中間的事件收不到，補拿一次（第一次訂閱上時已經拿過）
      subscribedOnce = true;
    });
    return () => {
      alive = false; clearInterval(poll); clearTimeout(slowT); if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onBack); window.removeEventListener("online", onBack);
      supabase.removeChannel(ch);
    };
    // 換視角才重訂（room 每次更新都是新物件，只看 roomId／code）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSeat, room?.roomId, room?.code]);

  const apply = async (t: SpectateTarget) => {
    if (!room) return;
    const r = await requestSpectate(room.roomId, t.playerId);
    if (r.ok) flash("已送出觀戰申請");
    else if (r.error === "cooldown") flash("同一位玩家 30 秒內只能申請一次");
    else if (r.error === "already_pending") flash("已經在等對方回應");
    else if (r.error === "already_approved") flash("對方已經同意了");
    else flash("申請失敗，請再試一次");
    const rr = await lookupRoom(room.code);
    if (rr.ok) setRoom(rr.data);
  };
  /** 切換視角：先把畫面上的手牌清掉、標籤換成新玩家，等新視角的資料到了才顯示（不顯示上一位的手牌） */
  const watch = (seat: number) => { setView(null); focusRef.current = null; setSlow(false); setRevokedBy(null); setViewSeat(seat); flowerSeenRef.current = new Map(); setFlowerFx([]); finalSettlementRef.current = false; holdRef.current = { on: false, until: 0 }; setSlowDraw(null); revealGenRef.current++; };
  /** 離開觀戰：前端停止拿視角、回玩家清單；不撤銷其他玩家給的同意（對接格式 3.4、規格 5.6） */
  const leave = async () => { setView(null); setViewSeat(null); finalSettlementRef.current = false; holdRef.current = { on: false, until: 0 }; setSlowDraw(null); revealGenRef.current++; if (room) { const r = await lookupRoom(room.code); if (r.ok) setRoom(r.data); } };

  const nameOf = (seat: number | null) => targets.find((t) => t.seat === seat)?.name ?? "";
  const approved = targets.filter((t) => t.status === "approved");

  // ---------- 觀戰中 ----------
  if (viewSeat != null) {
    const v = view;
    const props = v ? {
      players: v.players, mySeat: v.mySeat, myHand: v.myHand, currentTurn: v.currentTurn, dealerSeat: v.dealerSeat, lastDiscard: v.lastDiscard,
      focusDiscard: v.focusDiscard, paceNote: null, availableActions: [], pendingAddKong: null, robKong: false, pendingFlowerRob: null, robFlower: false,
      tingSeats: v.tingSeats, eyeSeats: v.eyeSeats, eyeOptions: [], eyeWithTing: false, chiForbidden: [], opponentHands: v.opponentHands, declareFx,
      wallRemaining: v.wallRemaining, hasDrawn: v.hasDrawn, needsDraw: false, needsDiscard: false, isMyTurn: false, playerName: nameOf(viewSeat),
      drawnTileId: v.drawnTileId, slowDraw, actionNotice: null, onDraw: noop, onDiscard: noop, onAction: noop,
      dice: v.dice, doorSeat: v.doorSeat, playerScores: v.playerScores, dealerConsecutive: v.roundInfo?.dealerConsecutive,
      chatButton: <MjChatButton canSend={false} desk={!mobile} />,
      // 觀戰者看被觀戰的人（老闆 2026-11-08 定案）：暗槓要跟本人看到的一樣，最左邊一張翻開；
      // mySeat 就是被觀戰的那家，自然走同一條 MjBoard／MjBoardMobile 的「自己」渲染邏輯，不用特別標記
    } : null;
    const roundLabel = v?.roundInfo ? `${WIND[(v.roundInfo.currentRound - 1) % 4]}風圈 第${v.roundInfo.currentGame}局` : undefined;
    return (
      <div className="spx spx-watch flex flex-col flex-1 h-dvh max-h-dvh overflow-hidden bg-[#0f2a1a] relative" data-mt-stage data-spectating={viewSeat}>
        <MjPrefsPanel />
        {/* 互動特效、名牌旁的聊天泡泡：只播、只看，不能丟、不能說 */}
        {v && <MjFx players={v.players} mySeat={v.mySeat} suspended={v.status === "finished"} desk={!mobile} viewOnly roomId=""
          hand={`${v.roundInfo?.currentRound}-${v.roundInfo?.currentGame}-${v.roundInfo?.dealerConsecutive}`} />}
        <MjChat mySeat={viewSeat} myId="*spectator" roomId={chatRoomId} roomCode={room?.code ?? ""} account={account} canSend={false} claiming={false} desk={!mobile} />
        <div className="flex flex-1 min-h-0">
        {/* 牌桌區：上方不再放「觀戰中・○○視角」大提示條（老闆 2026-11-13：擋到對家），改在牌桌下方的四家切換旁顯示「觀戰中」。
            transform 讓手機牌桌（.mjm-app 是 fixed; inset: 0）只填滿這一塊，不蓋到下方的切換列 */}
        <div className="spx-stage" style={{ minWidth: 0 }}>
        {props && (mobile ? (
          <MjBoardMobile {...props} roomCode={room?.code ?? code} roundLabel={roundLabel} basePoints={v?.roomSettings?.basePoints} fanPoints={v?.roomSettings?.fanPoints} onLeave={leave} leaveLabel="離開觀戰" />
        ) : (
          <>
            {/* 桌機：左上 ☰（設定、房號、離開觀戰），和打牌時同一個選單 */}
            <div className="flex items-center px-4 py-2 h-14 border-b border-white/10">
              <div className="relative w-10 h-10">
                <MjTableMenu desk roomCode={room?.code ?? ""} roundLabel={roundLabel} basePoints={v?.roomSettings?.basePoints} fanPoints={v?.roomSettings?.fanPoints} onLeave={leave} leaveLabel="離開觀戰" />
              </div>
            </div>
            <MjBoard {...props} />
          </>
        ))}
        {!props && slow && <div className="spx-skel" role="status">正在載入{nameOf(viewSeat)}的視角…</div>}
        </div>
        {/* 聊天室：手機在左下輸入面板的位置（fixed，放在 spx-stage 外面才不會被它的 transform 框住）、桌機牌桌右邊 */}
        <MjChatLogBox variant={mobile ? "dock" : "side"} mySeat={viewSeat} canSend={false} spectator onRetry={chatRetry} />
        </div>
        {/* 四家常駐快速切換（小宜〈觀戰與回放-視角切換設計規格〉）：點一下就換，取代右上角的「視角」選單；還沒同意的人停用並寫原因 */}
        <MjSeatSwitch
          mode="觀戰中"
          compact={mobile}
          current={viewSeat}
          doorSeat={v?.doorSeat ?? lastSeats?.doorSeat}
          dealerSeat={v?.dealerSeat ?? lastSeats?.dealerSeat}
          options={targets.map((t) => ({
            seat: t.seat, name: t.name,
            disabledReason: t.seat === viewSeat || t.status === "approved" ? undefined : t.status === "pending" ? "等待回應" : "未同意",
          }))}
          onSelect={watch}
        />
        {/* 別家補花：觀戰畫面照玩家本人視角一樣用補花膠囊（老闆 2026-11-07 第三次更正：拿掉上一輪的摸牌格亮正面） */}
        <MjFlowerFx fx={flowerFx} mySeat={viewSeat ?? -1} desk={!mobile} />
        {/* 胡牌演出（一般胡的浮層、大牌段、隕石）：和玩家本人看到的一樣 */}
        {v && <WinShowLayer ws={ws} winner={v.winner} mySeat={v.mySeat} mobile={mobile} />}
        {/* 結算：演出播完才出；觀戰者不能按下一局，伺服器開下一局後畫面自己接續 */}
        {v && v.status === "finished" && v.winner && !ws.winShowHoldResult && (
          <MjResultMobile
            spectator
            desktop={!mobile}
            tingSeats={v.tingSeats}
            eyeSeats={v.eyeSeats}
            dice={v.dice}
            doorSeat={v.doorSeat}
            dealerSeat={v.dealerSeat}
            winner={v.winner}
            winners={v.winners}
            players={v.players}
            mySeat={v.mySeat}
            myId=""
            fromName={(v.winner.from ?? v.lastDiscard?.from) != null ? v.players.find((p) => p.seat === (v.winner!.from ?? v.lastDiscard?.from))?.name : undefined}
            isZimo={ws.isZimoWin}
            settlement={v.settlement}
            playerScores={v.playerScores}
            hasRounds={!!v.roomSettings}
            gameOver={v.gameOver}
            handStats={v.handStats}
            remainingWall={v.remainingWall}
            nextGameReady={v.nextGameReady}
            onNextGame={async () => null}
            onLeave={leave}
          />
        )}
        <SpxToast text={toast?.text ?? null} assertive={toast?.assertive} />
      </div>
    );
  }

  // ---------- 入口／選玩家 ----------
  const err = error ? ERRORS[error] : null;
  const errAction = () => {
    if (error === "not_line") return auth.signIn(null);
    if (error === "not_found") { setError(null); return; }
    if (error === "network") return void lookup(code);
    window.location.href = "/mahjong";
  };
  const replacement = revokedBy != null ? approved.find((t) => t.seat !== revokedBy) : undefined;
  return (
    <div className="spx spx-page">
      <MjPrefsPanel />
      {!room ? (
        <div className="spx-entry" data-spectate-entry>
          <button type="button" className="spx-btn spx-back" style={{ marginBottom: 14 }} onClick={() => { window.location.href = "/mahjong"; }} data-spectate-exit>返回</button>
          <h1>輸入房號，進入觀戰</h1>
          <p className="lede">對方同意後，你會即時看到他的手牌。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!lineIn) { setError("not_line"); return; }
              if (code.length === 4) void lookup(code);
            }}
          >
            <label htmlFor="spx-code">房號</label>
            <div className="row">
              <input id="spx-code" inputMode="numeric" maxLength={4} autoComplete="off" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-invalid={!!err} aria-describedby={err ? "spx-err" : undefined} />
              <button type="submit" className="spx-btn primary" disabled={code.length !== 4 || busy} data-spectate-lookup>查看可觀戰玩家</button>
            </div>
          </form>
          {err && (
            <div className="spx-err" id="spx-err" role="alert" data-spectate-error={error}>
              <b>{err.title}</b>
              <p>{err.body(code)}</p>
              <button type="button" className="spx-btn" onClick={errAction}>{err.cta}</button>
            </div>
          )}
          <div className="foot">觀戰者只能觀看，不能操作、聊天或發語音。</div>
        </div>
      ) : (
        <div className="spx-list" data-spectate-list>
          <button type="button" className="spx-btn spx-back" onClick={() => { setRoom(null); setRevokedBy(null); }}>返回</button>
          <div className="meta" style={{ marginTop: 10 }}>房間 {room.code}</div>
          <h1>選擇想看的玩家</h1>
          <div className="spx-cards">
            {targets.map((t) => {
              const st = statusOf(t, skew);
              return (
                <div key={t.seat} className={`spx-card ${t.status}`} data-spectate-target={t.seat} data-status={t.status}>
                  <SpxAvatar url={t.avatarUrl} name={t.name} large={!mobile} />
                  <div className="grow">
                    <div className="nm">{t.name}</div>
                    <div className={`st ${st.tone}`}>{st.text}</div>
                  </div>
                  {t.status === "approved" ? (
                    <button type="button" className="spx-btn primary" onClick={() => watch(t.seat)} data-spectate-watch={t.seat}>觀看視角</button>
                  ) : (
                    <button type="button" className="spx-btn primary" disabled={!st.canApply} onClick={() => apply(t)} data-spectate-apply={t.seat}>申請觀戰</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="hint">同一位玩家 30 秒內只能申請一次</div>
        </div>
      )}
      {revokedBy != null && (
        <div className="spx-revoked" role="alertdialog" aria-live="assertive" data-spectate-revoked={revokedBy}>
          <b>{nameOf(revokedBy)}已收回觀戰同意</b>
          <p>已立即停止顯示他的手牌。</p>
          {replacement ? (
            <button type="button" className="spx-btn primary" onClick={() => watch(replacement.seat)}>切換到{replacement.name}視角</button>
          ) : (
            <button type="button" className="spx-btn primary" onClick={() => setRevokedBy(null)}>回到玩家清單</button>
          )}
        </div>
      )}
      <SpxToast text={toast?.text ?? null} assertive={toast?.assertive} />
    </div>
  );
}
