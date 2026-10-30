"use client";
// 麻將觀戰模式（小宜〈麻將觀戰模式-UIUX完整規格-2026-10-30〉；老闆 2026-10-30 定案：只限 LINE 登入、不延遲、被觀戰者可收回、效力到房間結束、只能看）。
// 獨立路由 /mahjong/watch：一般打牌頁和大老二頁都不載入這支。
//   入口（輸入房號）→ 錯誤（房號不存在、未開局、沒有 LINE 登入、自己在這桌、已結束、網路）→ 選玩家申請（等待／拒絕／冷卻，倒數用伺服器時間）
//   → 觀戰（頂部「觀戰中・○○視角」、右側視角抽屜切換、離開觀戰）→ 被收回：先清掉手牌再顯示提示
// 觀戰中牌桌用一般牌桌元件畫，但所有操作都不接（不出牌、不吃碰槓胡、不眼牌），聊天、語音、互動特效都不掛。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";
import { useMjAuth } from "@/hooks/useMjAuth";
import MjBoard from "@/components/mahjong/MjBoard";
import MjBoardMobile from "@/components/mahjong/MjBoardMobile";
import MjPrefsPanel from "@/components/mahjong/MjPrefsPanel";
import MjResultMobile from "@/components/mahjong/MjResultMobile";
import { useWinShow, WinShowLayer } from "@/hooks/useWinShow";
import { preloadFx, unlockAudio } from "@/lib/mahjong/fx/engine";
import MjTableMenu from "@/components/mahjong/MjTableMenu";
import { SpxAvatar, SpxToast, useTick } from "@/components/mahjong/spectate/SpectateHost";
import {
  clockSkew, fetchView, lookupRoom, requestSpectate, secondsLeft, toSpectateView,
  type SpectateLookupError, type SpectateRoom, type SpectateTarget, type SpectateView,
} from "@/lib/mahjong/spectateClient";
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
  const [revokedBy, setRevokedBy] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(true);
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
    const t = setInterval(refresh, 2000);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [listCode, viewSeat]);

  // 觀戰中（老柯對接格式第 0 節）：只訂閱房間公開頻道 mj-{房號}，收到任何事件就重拿一次視角（150ms 內合併）；另外每 3 秒保險一次。
  // 伺服器每次都重新驗權：被收回、沒同意＝403 not_approved → 先清掉手牌，再顯示提示（規格 5.9，順序不可相反）；房間結束＝404／410
  const focusRef = useRef<SpectateView["focusDiscard"]>(null);
  useEffect(() => {
    if (viewSeat == null || !room) return;
    const target = room.players.find((p) => p.seat === viewSeat);
    if (!target) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | null = null, inFlight = false, again = false, backoffUntil = 0;
    const slowT = setTimeout(() => { if (alive) setSlow(true); }, 300); // 切換超過 300ms 才出現「載入中」
    const pull = async () => {
      if (Date.now() < backoffUntil) return; // 429 等待中：保險輪詢也不另外打（等待結束時 timer 會補拿一次）
      if (inFlight) { again = true; return; }
      inFlight = true;
      const r = await fetchView(room.roomId, target.playerId);
      inFlight = false;
      if (!alive) return;
      if (r.ok) {
        const v = toSpectateView(r.data, focusRef.current);
        focusRef.current = v.focusDiscard;
        setView(v); setSlow(false); clearTimeout(slowT);
      } else if (r.status === 403 || r.status === 404 || r.status === 410) {
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
    void pull();
    const poll = setInterval(pull, 3000);
    const supabase = getSupabase();
    const ch = supabase.channel(`mj-${room.code}`);
    ch.on("broadcast", { event: "*" }, (msg) => {
      soon();
      // 有人同意、拒絕、收回：抽屜裡四位的狀態也更新
      if (msg.event === "mj_spectators") void lookupRoom(room.code).then((rr) => { if (alive && rr.ok) setRoom(rr.data); });
    });
    ch.subscribe();
    return () => { alive = false; clearInterval(poll); clearTimeout(slowT); if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
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
  const watch = (seat: number) => { setView(null); focusRef.current = null; setSlow(false); setRevokedBy(null); setViewSeat(seat); };
  /** 離開觀戰：前端停止拿視角、回玩家清單；不撤銷其他玩家給的同意（對接格式 3.4、規格 5.6） */
  const leave = async () => { setView(null); setViewSeat(null); if (room) { const r = await lookupRoom(room.code); if (r.ok) setRoom(r.data); } };

  const nameOf = (seat: number | null) => targets.find((t) => t.seat === seat)?.name ?? "";
  const approved = targets.filter((t) => t.status === "approved");

  // ---------- 觀戰中 ----------
  if (viewSeat != null) {
    const v = view;
    const props = v ? {
      players: v.players, mySeat: v.mySeat, myHand: v.myHand, currentTurn: v.currentTurn, dealerSeat: v.dealerSeat, lastDiscard: v.lastDiscard,
      focusDiscard: v.focusDiscard, paceNote: null, availableActions: [], pendingAddKong: null, robKong: false, pendingFlowerRob: null, robFlower: false,
      tingSeats: v.tingSeats, eyeSeats: v.eyeSeats, eyeOptions: [], eyeWithTing: false, chiForbidden: [], opponentHands: v.opponentHands, declareFx: [],
      wallRemaining: v.wallRemaining, hasDrawn: v.hasDrawn, needsDraw: false, needsDiscard: false, isMyTurn: false, playerName: nameOf(viewSeat),
      drawnTileId: v.drawnTileId, slowDraw: null, actionNotice: null, onDraw: noop, onDiscard: noop, onAction: noop,
      dice: v.dice, doorSeat: v.doorSeat, playerScores: v.playerScores, dealerConsecutive: v.roundInfo?.dealerConsecutive,
    } : null;
    const roundLabel = v?.roundInfo ? `${WIND[(v.roundInfo.currentRound - 1) % 4]}風圈 第${v.roundInfo.currentGame}局` : undefined;
    return (
      <div className="spx spx-watch flex flex-col flex-1 h-dvh max-h-dvh overflow-hidden bg-[#0f2a1a] relative" data-mt-stage data-spectating={viewSeat}>
        <MjPrefsPanel />
        <div className={`spx-bar${mobile ? "" : " d"}`} role="status" data-spectate-bar>觀戰中・{nameOf(viewSeat)}視角</div>
        {props && (mobile ? (
          <MjBoardMobile {...props} roomCode={room?.code ?? code} roundLabel={roundLabel} basePoints={v?.roomSettings?.basePoints} fanPoints={v?.roomSettings?.fanPoints} onLeave={leave} leaveLabel="離開觀戰" />
        ) : (
          <>
            {/* 桌機：左上 ☰（設定、房號、離開觀戰），和打牌時同一個選單；中間留給頂部的觀戰標籤 */}
            <div className="flex items-center px-4 py-2 h-14 border-b border-white/10">
              <div className="relative w-10 h-10">
                <MjTableMenu desk roomCode={room?.code ?? ""} roundLabel={roundLabel} basePoints={v?.roomSettings?.basePoints} fanPoints={v?.roomSettings?.fanPoints} onLeave={leave} leaveLabel="離開觀戰" />
              </div>
            </div>
            <MjBoard {...props} />
          </>
        ))}
        {!props && slow && <div className="spx-skel" role="status">正在載入{nameOf(viewSeat)}的視角…</div>}
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
        {mobile && (
          <button type="button" className="spx-btn spx-viewbtn" aria-expanded={drawer} onClick={() => setDrawer((d) => !d)} data-spectate-drawer-toggle>視角</button>
        )}
        {!mobile && (
          <button type="button" className="spx-btn spx-viewbtn" style={{ right: 24, top: 10 }} aria-expanded={drawer} onClick={() => setDrawer((d) => !d)} data-spectate-drawer-toggle>
            {drawer ? "收合" : "切換視角"}
          </button>
        )}
        {drawer && (
          <aside className={`spx-drawer${mobile ? "" : " d"}`} aria-label="切換視角" data-spectate-drawer>
            <h2>切換視角</h2>
            {targets.map((t) => {
              const cur = t.seat === viewSeat, can = !cur && t.status === "approved";
              const s = cur ? "目前視角" : can ? "可切換" : statusOf(t, skew).text;
              return (
                <button key={t.seat} type="button" className={`spx-opt${cur ? " cur" : ""}${can ? " can" : ""}`} disabled={!can} aria-current={cur || undefined}
                  onClick={() => watch(t.seat)} data-spectate-switch={t.seat}>
                  <span>{t.name}</span>
                  <span className="s">{s}</span>
                </button>
              );
            })}
            <button type="button" className="spx-btn" onClick={leave} data-spectate-leave>離開觀戰</button>
          </aside>
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
