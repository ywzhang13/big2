"use client";
// 十三支房間的資料同步（沿用麻將的做法：即時推播為主、輪詢只當保險，見 lib/mahjong/syncPolicy.ts）
//   - 訂閱房間公開頻道 th-<房號> 和本人的座位頻道（join 回傳的 channel）；收到任何 th_ 事件就補抓一次完整狀態（短暫合併）
//   - 頻道訂閱上、斷線重連、回前景、網路恢復：都補抓一次；保險輪詢：連線正常 25 秒、斷線 5 秒
//   - 狀態一律以 GET /api/thirteen/state 的完整快照為準（手牌、截止時間都來自伺服器）；後送先回的舊回應不套用
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Arrangement, Card } from "@/lib/thirteen";
import { getSupabase } from "@/lib/supabase";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import { POLL_TICK_MS, SyncPolicy } from "@/lib/mahjong/syncPolicy";
import type { ThReveal } from "./revealTimeline";
import type { MatchStat } from "./ThResult";
import { loadSkew, saveSkew, skewFromDateHeader, skewOnClosed } from "./roomScreen";

/** baseScore：底分（老闆 2026-11-19，50／100／200／500）；畫面讀最上層的 baseScore（舊房 settings 沒有這個欄位） */
export interface ThSettings { arrangeSec: number; totalHands: number; baseScore?: number }
export interface ThWaitingView {
  status: "waiting";
  code: string;
  hostId: string;
  settings: ThSettings;
  /** 這房的底分（老柯 2026-11-19：讀最上層；舊房伺服器補 1） */
  baseScore?: number;
  /** avatarUrl：LINE 大頭照（老柯 API；沒有就是 null，座位照舊顯示名字第一個字） */
  seats: { seat: number; name: string; playerId: string; avatarUrl?: string | null }[];
}
export interface ThGameView {
  status: "playing" | "finished";
  code: string;
  sv: number;
  phase: "waiting" | "arranging" | "revealed";
  handNo: number;
  settings: ThSettings;
  serverNow: number;
  arrangeDeadline: number | null;
  /** 沒人按確認也會自動開下一局的伺服器時間（＝settleAt＋30 秒） */
  nextHandAt?: number | null;
  /** 整場累計（伺服器 matchStats）：總結算用 */
  stats?: MatchStat[];
  nextReady?: string[];
  playerScores?: number[];
  /** avatarUrl：LINE 大頭照（老柯 API；沒有就是 null，名牌照舊顯示名字第一個字） */
  players: { id: string; name: string; seat: number; submitted: boolean; avatarUrl?: string | null }[];
  me: { seat: number; hand: Card[]; arrangement: Arrangement | null } | null;
  reveal: ThReveal | null;
  /** 這房的計分規則（老柯 v4 API：牌局狀態都帶）："v4" 新房、"jia" 甲案、"v1" 更早 */
  scoreRule?: "v1" | "jia" | "v4";
  /** 這一局的彩金牌（v4 房開始理牌就公開；舊規則房、等人時 null） */
  luckyCard?: Card | null;
}
export type ThView = ThWaitingView | ThGameView;
export interface ThJoin { roomId: string; code: string; playerId: string; seat: number; channel: string }
/** 整場結束（410）時伺服器附的紀錄：四家總分、最後一局的亮牌內容（lib/thirteen/db.ts findThirteenRecord） */
export interface ThFinalRecord {
  endReason: "completed" | "dissolved";
  players: { seat: number; playerName: string; totalScore: number }[];
  finalHand: ThReveal | null;
  /** 整場累計（伺服器）；舊紀錄沒有 */
  stats?: MatchStat[] | null;
  handsPlayed?: number;
}
export interface ThClosed { roomId: string; message: string; record: ThFinalRecord | null }

/** 十三支會送的事件（lib/thirteen/server.ts、app/api/thirteen/*）。全部只當「該重抓了」的訊號 */
const EVENTS = ["th_player_joined", "th_player_left", "th_hand_start", "th_deal_hand", "th_submitted", "th_auto_arranged", "th_reveal",
  "th_next_ready", "th_leave_request", "th_leave_vote", "th_room_closed", "th_spectators", "th_spectate_request"];

export async function apiJson<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<{ status: number; body: T & { error?: string; message?: string }; date: string | null }> {
  const res = await mjFetch(path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, date: res.headers.get("date") };
}
const tabSkew = () => (typeof window === "undefined" ? null : loadSkew(window.sessionStorage));

/** 現在這間房是不是已經關閉：只認目前所在房間的關閉訊息；沒有房間（回大廳）或換了房間都回 null */
export function closedFor(closed: ThClosed | null, join: Pick<ThJoin, "roomId"> | null): ThClosed | null {
  return closed && join && closed.roomId === join.roomId ? closed : null;
}

export function useThirteenRoom(join: ThJoin | null) {
  const [view, setView] = useState<ThView | null>(null);
  // 房間關閉的訊息跟著房間 id：離開這間房（join 換掉或清空）之後就不再算「關閉」，畫面才回得了大廳
  // （老闆 2026-11-18：整場結束按「回十三支大廳」沒反應——原本關閉狀態不會清，頁面一直停在結束畫面）
  const [closedRoom, setClosedRoom] = useState<ThClosed | null>(null);
  /** 讀狀態回 403（已經不在這間房）的那一次入座：頁面用存的房間恢復時，靠它改回用房號 join（記物件不記 id：重新 join 同一間房是新的物件，不會又被當成 403） */
  const [forbiddenJoin, setForbiddenJoin] = useState<ThJoin | null>(null);
  /** 伺服器時間 − 本機時間（毫秒）：倒數一律換算成伺服器的截止時間 */
  const [clockSkew, setClockSkew] = useState(() => tabSkew() ?? 0); // 重新整理：先用這個分頁之前量過的（審伯必修 2）
  const syncRef = useRef(new SyncPolicy());
  const seqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  const joinRef = useRef(join);
  useEffect(() => { joinRef.current = join; }, [join]); // 要在下面訂閱的 effect 之前（同一輪 effect 依宣告順序跑）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchState = useCallback(async () => {
    const j = joinRef.current;
    if (!j) return;
    const seq = ++seqRef.current;
    syncRef.current.markSent(Date.now());
    const sentAt = Date.now();
    try {
      const r = await apiJson<ThView>(`/api/thirteen/state?roomId=${encodeURIComponent(j.roomId)}&playerId=${encodeURIComponent(j.playerId)}`);
      if (seq < appliedSeqRef.current || joinRef.current?.roomId !== j.roomId) return; // 後送先回：舊的不蓋新的；已換房不套用
      if (r.status === 410 || r.status === 404) {
        // 整場打完伺服器會馬上關房：最後一局的亮牌只在 410 附的紀錄裡（finalHand），畫面要靠它補播亮牌和總結算
        const record = r.status === 410 ? ((r.body as { record?: ThFinalRecord }).record ?? null) : null;
        // 410 沒有 serverNow：時差用分頁記過的，沒有就用回應的 Date 標頭估（末局重新整理也接得上亮牌進度；審伯必修 2）
        setClockSkew((cur) => skewOnClosed(tabSkew(), skewFromDateHeader(r.date, sentAt, Date.now()), cur));
        setClosedRoom({ roomId: j.roomId, message: r.status === 410 ? "這場已經結束" : "房間已經關閉", record });
        return;
      }
      if (r.status === 403) { setForbiddenJoin(j); return; }
      if (r.status !== 200) return; // 401／5xx：等下一次輪詢或事件
      const sv = (r.body as { sv?: unknown }).sv;
      const verdict = syncRef.current.checkState(sv);
      if (verdict === "refetch") { void fetchStateRef.current?.(); return; }
      if (verdict === "drop") return;
      appliedSeqRef.current = seq;
      syncRef.current.noteVersion(sv, { fromState: true });
      if (r.body.status !== "waiting" && typeof (r.body as ThGameView).serverNow === "number") {
        // 用請求來回的中點估本機時間，減掉網路延遲的偏差
        const skew = (r.body as ThGameView).serverNow - (sentAt + Date.now()) / 2;
        setClockSkew(skew);
        saveSkew(window.sessionStorage, skew);
      }
      setView(r.body as ThView);
    } catch {
      // 網路錯誤：保險輪詢會再試
    }
  }, []);
  const fetchStateRef = useRef<() => Promise<void>>(fetchState); // fetchState 不會變（useCallback 沒有依賴）

  /** 事件連發（例如 th_hand_start＋13 張發牌）只補抓一次 */
  const kick = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => { timerRef.current = null; void fetchStateRef.current(); }, 120);
  }, []);

  useEffect(() => {
    if (!join) return;
    const supabase = getSupabase();
    const sync = syncRef.current;
    sync.resetVersion();
    appliedSeqRef.current = 0;
    setView(null);
    const subscribe = (name: string, key: string): RealtimeChannel => {
      const ch = supabase.channel(name, { config: { broadcast: { self: true } } });
      for (const ev of EVENTS) {
        ch.on("broadcast", { event: ev }, (msg) => {
          const sv = (msg.payload as Record<string, unknown> | undefined)?.sv;
          // 比畫面舊的事件：完整狀態已涵蓋就不抓（見 syncPolicy）
          if (typeof sv === "number" && sync.isStale(sv) && !sync.needsRefetchAfterStale(sv, Date.now())) return;
          kick();
        });
      }
      ch.subscribe((status) => {
        sync.setChannel(key, status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") kick(); // 訂閱好之前的事件收不到：用完整狀態補（斷線重連後也一樣）
      });
      return ch;
    };
    const pub = subscribe(`th-${join.code}`, "room");
    const priv = join.channel ? subscribe(join.channel, "private") : null;
    void fetchState();
    const poll = setInterval(() => { if (sync.due(Date.now(), document.hidden)) void fetchStateRef.current(); }, POLL_TICK_MS);
    const resume = () => { if (!document.hidden) kick(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      sync.removeChannel("room"); sync.removeChannel("private");
      supabase.removeChannel(pub);
      if (priv) supabase.removeChannel(priv);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [join, fetchState, kick]);

  const start = useCallback(async () => {
    const j = joinRef.current;
    if (!j) return { ok: false, message: "還沒入座" };
    const r = await apiJson("/api/thirteen/start", { method: "POST", body: JSON.stringify({ roomId: j.roomId, playerId: j.playerId }) });
    kick();
    return r.status === 200 ? { ok: true } : { ok: false, message: r.body.message ?? "開局失敗" };
  }, [kick]);

  /** 送出三墩：網路錯誤重試 3 次；伺服器拒絕（截止時間過了、已送出）就照伺服器的狀態（重抓） */
  const submit = useCallback(async (a: Arrangement): Promise<{ ok: boolean; error?: string; message?: string }> => {
    const j = joinRef.current;
    if (!j) return { ok: false, message: "還沒入座" };
    const body = JSON.stringify({ roomId: j.roomId, playerId: j.playerId, front: a.front.map((c) => c.id), middle: a.middle.map((c) => c.id), back: a.back.map((c) => c.id) });
    for (let i = 0; i < 3; i++) {
      try {
        const r = await apiJson("/api/thirteen/submit", { method: "POST", body });
        kick();
        if (r.status === 200) return { ok: true };
        return { ok: false, error: r.body.error, message: r.body.message ?? r.body.error ?? "送出失敗" };
      } catch {
        await new Promise((res) => setTimeout(res, 600 * (i + 1)));
      }
    }
    kick();
    return { ok: false, error: "network", message: "網路不穩，送出失敗" };
  }, [kick]);

  /** 時間到：請伺服器推進（截止時間由伺服器判斷，代排、亮牌都在伺服器做） */
  const tick = useCallback(async () => {
    const j = joinRef.current;
    if (!j) return;
    await apiJson("/api/thirteen/tick", { method: "POST", body: JSON.stringify({ roomId: j.roomId, playerId: j.playerId }) }).catch(() => null);
    kick();
  }, [kick]);

  const leave = useCallback(async () => {
    const j = joinRef.current;
    if (!j) return { ok: true };
    const r = await apiJson("/api/thirteen/leave", { method: "POST", body: JSON.stringify({ roomId: j.roomId }) });
    return r.status === 200 || r.status === 404 ? { ok: true } : { ok: false, message: r.body.message ?? "現在不能離開" };
  }, []);

  /** 本局結算按「確認」（或倒數到 0）：請伺服器開下一局（四家都按了就開，沒按的人時間到也會開） */
  // 回傳伺服器有沒有收下（審伯必修 1：只有 200 才算確認；斷線丟例外、其他狀態帶原因，畫面顯示錯誤讓人重按）
  const next = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    const j = joinRef.current;
    if (!j) return { ok: false, message: "還沒入座" };
    try {
      const r = await apiJson("/api/thirteen/next-game", { method: "POST", body: JSON.stringify({ roomId: j.roomId, playerId: j.playerId }) });
      return r.status === 200 ? { ok: true } : { ok: false, message: r.body.message ?? (r.status >= 500 ? "伺服器忙碌，請再按一次" : "確認失敗，請再按一次") };
    } finally { kick(); }
  }, [kick]);

  return { view, closed: closedFor(closedRoom, join), forbidden: !!join && forbiddenJoin === join, clockSkew, refetch: kick, start, submit, tick, leave, next };
}
