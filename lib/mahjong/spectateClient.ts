// 麻將觀戰模式：前端和伺服器的往來（老馬 2026-10-30）。
// 格式照老柯〈觀戰模式-前後端對接格式-2026-10-30〉（worktree .tmp/）；畫面照小宜〈麻將觀戰模式-UIUX完整規格-2026-10-30〉。格式有變只改這個檔。
// 原則：玩家用遊戲裡的 playerId（座位 id）、申請用 requestId，前端拿不到帳號 id；時間都是伺服器的毫秒數，倒數一律用「伺服器時間差」換算。
import type { MjClientState, MjHandReveal, MjPlayer, MjWinner } from "@/hooks/useMahjong";
import type { Tile } from "@/lib/mahjong/tiles";
import { safeHand } from "./handOrder";
import type { Meld } from "@/lib/mahjong/gameState";
import { mjFetch } from "./clientAuth";

export type SpectateStatus = "available" | "pending" | "approved" | "rejected" | "revoked" | "expired";

/** 3.1 的一位玩家（照座位 0～3 排） */
export interface SpectateTarget {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  seat: number;
  status: SpectateStatus;
  /** pending：申請失效的時間（伺服器毫秒） */
  expiresAt: number | null;
  /** 可以再申請的時間（伺服器毫秒）；冷卻中的判斷看這個和 canRequest */
  cooldownUntil: number | null;
  canRequest: boolean;
  viewerCount: number;
}

export interface SpectateRoom {
  roomId: string;
  code: string;
  serverNow: number;
  players: SpectateTarget[];
}

/** 入口錯誤（小宜 5.2 的六種）；伺服器錯誤碼在 lookupError 換算 */
export type SpectateLookupError = "not_found" | "not_started" | "not_line" | "is_player" | "ended" | "network";

/** 觀戰者看到的牌桌：和玩家的 state 同一個形狀（給牌桌元件直接用），mySeat＝目前視角的座位、myHand＝那位玩家的手牌，其他三家只有公開資料 */
export type SpectateView = Pick<MjClientState,
  "status" | "players" | "mySeat" | "myHand" | "currentTurn" | "dealerSeat" | "lastDiscard" | "focusDiscard" | "tingSeats" | "eyeSeats"
  | "wallRemaining" | "hasDrawn" | "drawnTileId" | "roomSettings" | "roundInfo" | "playerScores" | "dice" | "doorSeat" | "gameOver"
  | "winner" | "winners" | "settlement" | "handStats" | "remainingWall" | "nextGameReady">;

/** 4.1 觀戰管理清單（被觀戰的玩家本人） */
export interface SpectateManageInfo {
  serverNow: number;
  pending: { requestId: string; name: string; avatarUrl: string | null; expiresAt: number }[];
  approved: { requestId: string; name: string; avatarUrl: string | null }[];
}

type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> };

async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Res<T>> {
  try {
    const r = await mjFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, status: r.status, error: typeof j.error === "string" ? j.error : "network", body: j };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, status: 0, error: "network", body: {} };
  }
}

/** 伺服器錯誤碼 → 入口錯誤（對接格式第 2 節） */
export function lookupError(code: string): SpectateLookupError {
  switch (code) {
    case "room_not_found": case "bad_request": return "not_found";
    case "not_started": return "not_started";
    case "not_logged_in": case "guest_not_allowed": return "not_line";
    case "own_table": return "is_player";
    case "room_ended": return "ended";
    default: return "network";
  }
}

/** 3.1 查房、列出玩家與申請狀態 */
export async function lookupRoom(code: string): Promise<{ ok: true; data: SpectateRoom } | { ok: false; error: SpectateLookupError }> {
  const r = await call<SpectateRoom>("GET", `/api/mahjong/spectate/room?code=${encodeURIComponent(code)}`);
  return r.ok ? r : { ok: false, error: lookupError(r.error) };
}

/** 3.2 申請觀戰；失敗時 error＝already_pending／already_approved／cooldown（附 cooldownUntil）… */
export function requestSpectate(roomId: string, targetPlayerId: string) {
  return call<{ status: "pending"; expiresAt: number; serverNow: number }>("POST", "/api/mahjong/spectate/request", { roomId, targetPlayerId });
}

interface ServerPlayer { id: string; name: string; seat: number; tileCount: number; revealed: Meld[]; flowers: Tile[]; discards: Tile[]; isDealer: boolean; winFx?: MjPlayer["winFx"]; avatarUrl?: string | null }
interface ServerView {
  status: string; players: ServerPlayer[]; wallCount: number; currentTurn: number; lastDiscard: { tile: Tile; from: number } | null; dealerSeat: number;
  hasDrawn: boolean; hand?: Tile[]; myDrawnTileId?: number; tingSeats?: number[]; eyeSeats?: number[]; pendingAddKong?: unknown;
  roomSettings?: MjClientState["roomSettings"]; roundInfo?: MjClientState["roundInfo"]; playerScores?: number[]; dice?: [number, number, number]; doorSeat?: number; gameOver?: boolean;
  // 一局結束後才有（同一般 state）：贏家、一炮多響、結算、四家攤牌、整場統計、剩下的牌牆、同意下一局的人
  winner?: Omit<MjWinner, "name">; winners?: Omit<MjWinner, "name">[]; allHands?: MjHandReveal[]; settlement?: MjClientState["settlement"];
  handStats?: MjClientState["handStats"]; remainingWall?: Tile[]; nextGameReady?: string[];
}
export interface SpectateViewResponse {
  roomId: string; code: string; status: string;
  target: { playerId: string; name: string; seat: number };
  spectatorCounts: Record<string, number>;
  gameState: ServerView;
}

/** 3.3 看某位已同意玩家的視角；沒同意或已收回＝403 not_approved，房間結束＝404／410 */
export function fetchView(roomId: string, targetPlayerId: string) {
  return call<SpectateViewResponse>("GET", `/api/mahjong/spectate/view?roomId=${encodeURIComponent(roomId)}&target=${encodeURIComponent(targetPlayerId)}`);
}

/** 伺服器的牌局狀態 → 牌桌元件用的形狀（同 hooks/useMahjong.ts fetchState 的換算，只取觀戰需要的欄位）；prevFocus：中間那張大牌沿用上一次的 */
export function toSpectateView(r: SpectateViewResponse, prevFocus: SpectateView["focusDiscard"]): SpectateView {
  const gs = r.gameState;
  const counts = r.spectatorCounts ?? {};
  const lastDiscard = gs.pendingAddKong ? null : gs.lastDiscard;
  return {
    status: gs.status as SpectateView["status"],
    players: gs.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, tileCount: p.tileCount, flowers: p.flowers, discards: p.discards, revealed: p.revealed, isDealer: p.isDealer,
      ...(p.winFx ? { winFx: p.winFx } : {}), ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), viewerCount: counts[p.id] ?? 0,
    })),
    mySeat: r.target.seat,
    // 和本人畫面用同一個排序（lib/mahjong/handOrder.ts）：伺服器摸牌是接在手牌最後，不排會亂；剛摸的那張由 drawnTileId 分到右邊
    myHand: safeHand(gs.hand ?? []),
    currentTurn: gs.currentTurn,
    dealerSeat: gs.dealerSeat,
    lastDiscard,
    focusDiscard: lastDiscard ?? (prevFocus && gs.players[prevFocus.from]?.discards?.some((t) => t.id === prevFocus.tile.id) ? prevFocus : null),
    tingSeats: gs.tingSeats ?? [],
    eyeSeats: gs.eyeSeats ?? [],
    wallRemaining: gs.wallCount,
    hasDrawn: gs.hasDrawn,
    drawnTileId: gs.myDrawnTileId ?? null,
    roomSettings: gs.roomSettings,
    roundInfo: gs.roundInfo,
    playerScores: gs.playerScores,
    dice: gs.dice,
    doorSeat: gs.doorSeat,
    gameOver: gs.gameOver,
    // 結算用（同 hooks/useMahjong.ts fetchState）：贏家補上名字和四家攤牌；流局＝seat -1
    winner: gs.winner
      ? { ...gs.winner, name: gs.players[gs.winner.seat]?.name ?? "", allHands: gs.allHands }
      : gs.status === "finished" && gs.allHands
        ? { seat: -1, name: "", score: { fans: [], totalFan: 0 }, allHands: gs.allHands }
        : undefined,
    winners: gs.winners && gs.winners.length > 0 ? gs.winners.map((w) => ({ ...w, name: gs.players[w.seat]?.name ?? "" })) : undefined,
    settlement: gs.settlement,
    handStats: gs.handStats,
    remainingWall: gs.status === "finished" ? gs.remainingWall : undefined,
    nextGameReady: gs.nextGameReady,
  };
}

/** 4.1 觀戰管理清單（座位本人） */
export function fetchManage(roomId: string, playerId: string) {
  return call<SpectateManageInfo>("GET", `/api/mahjong/spectate/manage?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`);
}

/** 4.2 同意／拒絕；409 not_pending＝已過期或已處理 */
export function respondSpectate(roomId: string, playerId: string, requestId: string, approve: boolean) {
  return call<{ status: "approved" | "rejected" }>("POST", "/api/mahjong/spectate/respond", { roomId, playerId, requestId, approve });
}

/** 4.3 收回；requestId 不給＝收回全部 */
export function revokeSpectate(roomId: string, playerId: string, requestId?: string) {
  return call<{ revoked: number }>("POST", "/api/mahjong/spectate/revoke", { roomId, playerId, ...(requestId ? { requestId } : {}) });
}

/** 伺服器時間差（伺服器 − 本機，毫秒）：每次收到 serverNow 就更新，倒數一律用「本機現在＋時間差」換成伺服器時間 */
export function clockSkew(serverNow: number | undefined): number {
  return typeof serverNow === "number" && Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
}

/** 到 at（伺服器毫秒）還剩幾秒；過了回 0 */
export function secondsLeft(at: number | null | undefined, skew: number): number {
  return typeof at === "number" ? Math.max(0, Math.ceil((at - (Date.now() + skew)) / 1000)) : 0;
}
