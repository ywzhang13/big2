"use client";
// 十三支（首頁第三張卡進來）：登入 → 大廳（開房／輸入房號）→ 等人（滿 4 人房主開局）→ 理牌 → 送出後等其他人
//   → 亮牌（開始比牌、三墩輪流翻、牌型特效、打槍、全壘打）→ 本局結算 → 下一局 …… → 整場總結算 → 回十三支大廳
// 房號放在網址 #room=1234：重新整理、斷線回來都用同一個房號再呼叫 join，伺服器認回原座位（同一局、同一手牌）
// 登入沿用麻將（LINE／測試用遊客）；資料同步見 components/thirteen/useThirteenRoom.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { handRuleOf, type Arrangement } from "@/lib/thirteen";
import { useMjAuth } from "@/hooks/useMjAuth";
import { bindPrefsAccount } from "@/lib/mahjong/prefs";
import { migrateOldSfxSwitch } from "@/components/thirteen/sfx";
import { mjStorage } from "@/lib/mahjong/clientAuth";
import { AuthBar, GuestGate, LoginGate, PortraitHint } from "@/components/mahjong/MjLobbyAuth";
import ThArrange from "@/components/thirteen/ThArrange";
import ThLobby, { ThBrand } from "@/components/thirteen/ThLobby";
import { InviteNamePrompt } from "@/components/gameLobby/GameLobby";
import { initialName, inviteNeedsName, loadGameName, saveGameName } from "@/components/gameLobby/name";
import ThTable from "@/components/thirteen/ThTable";
import ThReveal from "@/components/thirteen/ThReveal";
import { ThFinalResult, type MatchStat } from "@/components/thirteen/ThResult";
import type { ThReveal as Reveal } from "@/components/thirteen/revealTimeline";
import ThWaiting from "@/components/thirteen/ThWaiting";
import { applyFelt, loadFelt } from "@/components/thirteen/feltTheme";
import { clearLastJoin, confirmView, finalSeen, loadLastJoin, markFinalSeen, revealClock, revealScreen, saveLastJoin, sendConfirm, syncShow, type ConfirmState, type RevealShow } from "@/components/thirteen/roomScreen";
import { toServerArrangeSec } from "@/components/thirteen/arrangeTime";
import { apiJson, useThirteenRoom, type ThGameView, type ThJoin } from "@/components/thirteen/useThirteenRoom";
import "@/components/thirteen/thRoom.css";
import BlockedDialog from "@/components/roomCard/BlockedDialog";
import { blockedFrom, type Blocked } from "@/components/roomCard/client";
import { refreshMyCards } from "@/components/roomCard/useMyCards";

/** 本機送出要比伺服器截止早一點：倒數到 0 的自動送出才不會晚到被拒（伺服器到點也會自己代排） */
const SUBMIT_EARLY_MS = 1000;

function playerId(): string {
  const store = mjStorage();
  let id = store.getItem("th_pid");
  if (!id) { id = Math.random().toString(36).slice(2, 10); store.setItem("th_pid", id); }
  return id;
}
const hashRoom = () => /(?:^|[#&])room=(\d{4})/.exec(window.location.hash)?.[1] ?? null;
/** LINE 登入回來帶的 ?room=1234（老柯 b1a68fa）：讀到就換回 #room=（比照麻將 getRoomFromQuery） */
function adoptQueryRoom(): void {
  const room = new URLSearchParams(window.location.search).get("room");
  if (room && /^\d{4}$/.test(room)) window.history.replaceState(window.history.state, "", `${window.location.pathname}#room=${room}`);
}
/** 分頁存的「上次入座的房間」（重新整理恢復用，見 components/thirteen/roomScreen.ts） */
const tabStore = () => window.sessionStorage;
/** 這台存的暱稱（三款共用 game_name；遊客分頁存 sessionStorage，同麻將）。第一次讀會把麻將手動改過的 mj_name、大老二的 big2_name 搬過來 */
const storedName = () => loadGameName(mjStorage(), { mj: mjStorage(), big2: window.localStorage });

export default function ThirteenPage() {
  const router = useRouter();
  return (
    <>
      <ThirteenScreens />
      {/* 手機直向：蓋一層「請轉橫向」（同麻將；畫面照常掛著、連線不斷） */}
      <PortraitHint label="返回首頁" onClick={() => router.push("/")} />
    </>
  );
}

function ThirteenScreens() {
  const router = useRouter();
  const auth = useMjAuth();
  const [join, setJoin] = useState<ThJoin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 開房、加入、開局被伺服器擋下（房卡 v1.2 2-4 帳號已暫停、2-5 不能開局）
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const blockedDialog = <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />;
  const [resume, setResume] = useState<{ code: string; status: string } | null>(null);
  const [invite, setInvite] = useState<string | null>(null); // 點邀請連結進來、這台還沒存過名字：先問名字（小宜 v1.1 §6）
  const [arrangeKey, setArrangeKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const room = useThirteenRoom(join);
  useEffect(() => { applyFelt(loadFelt(), false); }, []); // 簡約牌桌：用本機記的那一款（v7 §1；設定在特效測試頁可以切）
  const loggedIn = auth.status === "in" && !!auth.user;
  // 共用設定（聲音）跟著登入的人：和麻將同一份（LINE 帳號存伺服器、訪客和沒登入存這台 mj.prefs.v4）；
  // 綁好之後把舊的十三支音效開關 th_sfx 轉一次（有帳號時等伺服器的設定回來再轉）
  const prefsUserId = auth.status === "in" ? auth.user?.id ?? null : null;
  const prefsGuest = !!auth.user?.isGuest;
  useEffect(() => {
    if (auth.status === "checking") return; // 還不知道是誰：先用這台的
    bindPrefsAccount(prefsUserId ? { id: prefsUserId, isGuest: prefsGuest } : null);
    const ctrl = new AbortController(); // 登出、換帳號、離開頁面：取消還沒跑完的轉換
    void migrateOldSfxSwitch({ account: prefsUserId && !prefsGuest ? prefsUserId : null, signal: ctrl.signal });
    return () => ctrl.abort();
  }, [auth.status, prefsUserId, prefsGuest]);

  const lineName = auth.user?.displayName ?? null;
  /** 不經過暱稱欄的入座（回到房間、已經有名字的邀請連結）：這台存的名字 → LINE 名稱前 8 個字 */
  const autoName = useCallback(() => initialName(storedName(), lineName).name || "玩家", [lineName]);

  /** save：名字是玩家在暱稱欄按「建立房間」「加入」送出的，成功才存成 game_name */
  const doJoin = useCallback(async (code: string, name: string, save = false) => {
    setBusy(true); setError("");
    try {
      const r = await apiJson<{ roomId: string; seat: number; playerId: string; channel: string }>("/api/thirteen/join",
        { method: "POST", body: JSON.stringify({ code, playerId: playerId(), name }) });
      if (r.status !== 200) {
        const block = blockedFrom(r.body);
        if (block) { setBlocked(block); refreshMyCards(); }
        else setError(r.body.message ?? (r.status === 404 ? "找不到這個房號" : "加入失敗"));
        if (hashRoom() === code) history.replaceState(null, "", window.location.pathname);
        return;
      }
      const j = { roomId: r.body.roomId, code, playerId: r.body.playerId, seat: r.body.seat, channel: r.body.channel };
      if (save) saveGameName(mjStorage(), name);
      setInvite(null);
      saveLastJoin(tabStore(), j);
      setJoin(j);
      if (hashRoom() !== code) window.location.hash = `room=${code}`;
    } catch {
      setError("網路不穩，請再試一次");
    } finally { setBusy(false); }
  }, []);

  async function doCreate(arrangeSec: number, totalHands: number, baseScore: number, name: string) {
    setBusy(true); setError("");
    try {
      const c = await apiJson<{ roomId: string; code: string }>("/api/thirteen/create", { method: "POST", body: JSON.stringify({ hostId: playerId(), arrangeSec: toServerArrangeSec(arrangeSec), totalHands, baseScore }) });
      if (c.status !== 200) {
        const block = blockedFrom(c.body);
        if (block) { setBlocked(block); refreshMyCards(); } else setError(c.body.message ?? "開房失敗");
        return;
      }
      await doJoin(c.body.code, name, true);
    } catch {
      setError("網路不穩，請再試一次");
    } finally { setBusy(false); }
  }

  // 登入好：網址有房號就直接入座（重新整理、邀請連結）；沒有就查有沒有還沒打完的房
  useEffect(() => {
    if (!loggedIn || join) return;
    adoptQueryRoom();
    const code = hashRoom();
    // 重新整理：網址的房號就是上次入座的那間 → 直接用存的房間 id 讀狀態（末局亮牌、總結算中房間已經關了也讀得到 410 紀錄；
    // 房號被別場重用也不會用 join 誤入新場）。審伯必修 1
    const saved = code ? loadLastJoin(tabStore(), code) : null;
    if (saved) { setJoin(saved); return; }
    if (code) {
      if (inviteNeedsName(storedName())) setInvite(code); // 第一次用邀請連結：問名字
      else void doJoin(code, autoName());                 // 存過名字：直接入座
      return;
    }
    apiJson<{ room: { code: string; status: string } | null }>("/api/thirteen/my-room")
      .then((r) => setResume(r.status === 200 && r.body.room ? { code: r.body.room.code, status: r.body.room.status } : null))
      .catch(() => {});
  }, [loggedIn, join, doJoin, autoName]);

  // 倒數用的時鐘；理牌截止時間（伺服器時間）過了就請伺服器推進一次（代排、亮牌由伺服器決定）
  const view = room.view;
  const { forbidden } = room;
  useEffect(() => {
    if (!forbidden) return;
    clearLastJoin(tabStore());
    setJoin(null); // join 清空後上面的 effect 會照網址房號重新 join
  }, [forbidden]);

  const deadline = view && view.status !== "waiting" ? view.arrangeDeadline : null;
  const arranging = !!view && view.status !== "waiting" && view.phase === "arranging";
  useEffect(() => {
    if (!arranging) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [arranging]);
  const deadlineRef = useRef<number | null>(null);
  const skewRef = useRef(0);
  useEffect(() => { deadlineRef.current = deadline; skewRef.current = room.clockSkew; }, [deadline, room.clockSkew]);
  const pastDeadline = arranging && deadline !== null && now + room.clockSkew > deadline + 500;
  const { tick } = room;
  useEffect(() => { if (pastDeadline) void tick(); }, [pastDeadline, tick]);

  const onSubmit = useCallback(async (a: Arrangement) => {
    setNotice("");
    const r = await room.submit(a);
    if (r.ok) return;
    // 截止時間過了／已經送出：伺服器已代排或已收過，等重抓的狀態換成牌桌（不能重來，否則新畫面倒數已是 0 又會馬上送出）
    if (r.error === "time_up" || r.error === "already_submitted" || r.error === "not_arranging") return;
    setNotice(r.message ?? "送出失敗");
    // 其他原因沒收、時間還夠：理牌畫面重來一次
    if (deadlineRef.current !== null && deadlineRef.current - (Date.now() + skewRef.current) > 2000) setArrangeKey((k) => k + 1);
  }, [room]);

  // ---- 亮牌與結算 ----
  // 起點＝伺服器的亮牌時間 revealedAt 換成本機時間（四家同步、重新整理接著播）；結算面板在 settleAt、確認倒數到 nextHandAt（老柯 4b25124）。
  // 整場最後一局：伺服器亮牌同時就關房，只拿得到 410 附的紀錄（finalHand，一樣有 revealedAt）
  const [showState, setShow] = useState<RevealShow<Reveal> | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null); // 末局「看總結算」（本機）
  const [confirmSt, setConfirmSt] = useState<ConfirmState>(null);        // 一般局「確認」：照伺服器回應（審伯必修 1）
  const closedRec = room.closed?.record ?? null;
  const finalHand = closedRec?.endReason === "completed" ? closedRec.finalHand : null;
  const liveReveal = view && view.status !== "waiting" && view.phase === "revealed" ? view.reveal : null;
  const nextHandAt = view && view.status !== "waiting" ? view.nextHandAt ?? null : null;
  const roomId = join?.roomId ?? null;
  // 換局在畫面算的時候就換（syncShow），不等 useEffect：不然新一局亮牌進來的第一個畫面還是上一局，上一局的結算面板會閃一下
  const show = syncShow(showState, roomId, finalHand ?? liveReveal, !!finalHand, Date.now());
  if (show !== showState) setShow(show);
  // 總結算中重新整理：這場的總結算已經看過 → 直接回總結算，不重播末局亮牌（審伯必修 1）
  const showKey = show?.key ?? null, showFinal = !!show?.final;
  useEffect(() => {
    if (showKey && showFinal && roomId && finalSeen(tabStore(), roomId)) setConfirmedKey(showKey);
  }, [showKey, showFinal, roomId]);
  /** 整場累計（伺服器）：關房後用 410 紀錄的，還在打用讀狀態的 */
  const matchStats: MatchStat[] | null = (closedRec?.stats ?? (view && view.status !== "waiting" ? view.stats : null)) ?? null;

  const goHome = () => router.push("/");
  /** 回十三支大廳：清掉網址的房號、離開這間房（useThirteenRoom 的關閉訊息跟著房間 id，離開後就不再顯示結束畫面） */
  const backToLobby = () => {
    history.replaceState(null, "", window.location.pathname);
    clearLastJoin(tabStore());
    setInvite(null);
    setJoin(null);
    setShow(null);
    setConfirmedKey(null);
  };
  const leaveRoom = async () => {
    const r = await room.leave();
    if (r.ok) backToLobby();
    return r;
  };

  if (!loggedIn) {
    return (
      <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]">
        {auth.guestMode ? (
          <GuestGate checking={auth.status === "checking"} roomCode={null} onSubmit={auth.signInGuest} onBack={goHome} />
        ) : (
          <LoginGate status={auth.status === "in" ? "checking" : auth.status} roomCode={null} errorText={auth.errorText} handoff={auth.handoff}
            onCancelPairing={auth.cancelPairing} onContinueHere={auth.continueHere} onLogin={() => auth.signIn(null)} onBack={goHome} />
        )}
      </div>
    );
  }

  // 亮牌、本局結算、整場總結算（下一局開始發牌了就回理牌畫面）
  const newHandStarted = !!show && !!view && view.status !== "waiting" && view.phase === "arranging" && view.handNo > show.rv.handNo;
  // 非末局亮牌、本局結算確認前或確認後收到解散關房：不再播亮牌、等下一局，直接進下面的關房總結算（審伯必修 2）
  const screen = revealScreen({ hasShow: !!show, showFinal: !!show?.final, confirmed: !!show && confirmedKey === show.key, newHandStarted, closed: !!room.closed });
  if (show && join && (screen === "reveal" || screen === "final")) {
    const rv = show.rv;
    const names = [0, 1, 2, 3].map((seat) => (view && view.status !== "waiting" ? view.players.find((p) => p.seat === seat)?.name : undefined)
      ?? closedRec?.players.find((p) => p.seat === seat)?.playerName ?? "");
    if (screen === "final") {
      return (
        <div className="th-bg">
          <div className="th-felt" />
          <ThFinalResult players={names.map((playerName, seat) => ({ seat, playerName, totalScore: rv.playerScores[seat] ?? 0 }))}
            mySeat={join.seat} hands={rv.handNo} stats={matchStats} onLobby={backToLobby} baseScore={rv.baseScore ?? null} />
        </div>
      );
    }
    // 重新整理時房間已經關了（沒有狀態）：用紀錄的名字湊一個牌桌
    const tableView: ThGameView = view && view.status !== "waiting" ? view : {
      status: "finished", code: join.code, sv: 0, phase: "revealed", handNo: rv.handNo, settings: { arrangeSec: 0, totalHands: rv.handNo },
      serverNow: 0, arrangeDeadline: null, players: names.map((name, seat) => ({ id: `s${seat}`, name, seat, submitted: true })),
      me: { seat: join.seat, hand: [], arrangement: null }, reveal: rv,
    };
    // 起點、結算面板都照伺服器時間（revealedAt、settleAt）＋時差換算；410 才拿到的末局一樣（審伯必修 2）
    const { startAt } = revealClock({ revealedAt: rv.revealedAt ?? null, settleAt: rv.settleAt ?? null }, room.clockSkew, Date.now(), show.startAt);
    const cv = confirmView(confirmSt, show.key, view && view.status !== "waiting" ? view.nextReady : undefined, join.playerId);
    return (
      <ThReveal key={show.key} view={tableView} rv={rv} startAt={startAt} settleAt={rv.settleAt != null ? rv.settleAt - room.clockSkew : null}
        confirmBy={!show.final && nextHandAt !== null ? nextHandAt - room.clockSkew : null}
        confirmed={!show.final && cv.confirmed} sending={!show.final && cv.sending} error={show.final ? null : cv.error}
        confirmLabel={show.final ? "看總結算" : "確認"}
        onConfirm={() => {
          if (show.final) { setConfirmedKey(show.key); markFinalSeen(tabStore(), join.roomId); return; }
          void sendConfirm(room.next, show.key, setConfirmSt);
        }} />
    );
  }

  // 整場結束（例如中途解散）：伺服器有紀錄就直接給總結算，沒有就一行字＋回大廳
  if (room.closed && closedRec && join) {
    return (
      <div className="th-bg">
        <div className="th-felt" />
        <ThFinalResult players={closedRec.players} mySeat={join.seat} hands={closedRec.finalHand?.handNo ?? closedRec.handsPlayed ?? 0}
          stats={matchStats} onLobby={backToLobby} baseScore={closedRec.finalHand?.baseScore ?? null} />
      </div>
    );
  }

  if (room.closed) {
    return (
      <div className="mjl mjl-wait-page flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6" data-th-closed>
        {/* 不用 .mjw：麻將的 .mjw 在手機橫向會變成兩欄、標題隱藏（那是等人畫面的排法） */}
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#f0d68a] font-heading">{room.closed.message}</h2>
          <button type="button" data-th-back-lobby className="mjl-btn primary w-full" onClick={backToLobby}>回十三支大廳</button>
        </div>
      </div>
    );
  }

  if (!join && invite) {
    return <><InviteNamePrompt className="mjl" brand={<ThBrand />} top={<AuthBar user={auth.user!} onSignOut={auth.signOut} />} code={invite}
      initialName={initialName(storedName(), lineName)} busy={busy} error={error} onJoin={(name) => void doJoin(invite, name, true)} onBack={backToLobby} />{blockedDialog}</>;
  }
  if (!join || !view) {
    if (join || (busy && hashRoom())) return <div className="th-room th-loading">進入房間中…</div>;
    return <><ThLobby user={auth.user!} onSignOut={auth.signOut} busy={busy} error={error} resume={resume} nameInit={initialName(storedName(), lineName)}
      onCreate={doCreate} onJoin={(code, name) => void doJoin(code, name, true)} onResume={(code) => void doJoin(code, autoName())} onHome={goHome} />{blockedDialog}</>;
  }

  if (view.status === "waiting") {
    const start = async () => {
      const r = await room.start();
      const block = r.ok ? null : blockedFrom(r.body, join.code);
      if (block) { setBlocked(block); return { ok: true }; } // 已經跳視窗說明，等人畫面不再另外寫錯誤
      return r;
    };
    // 開局確認：四家都同意、發牌前伺服器再查一次暫停（403 player_suspended）→ 跟開始被擋一樣跳「不能開局」視窗
    const agree = async (confirmId: string) => {
      const r = await room.confirmStart(confirmId);
      const block = r.ok ? null : blockedFrom((r as { body?: unknown }).body, join.code);
      if (block) { setBlocked(block); return { ok: true }; }
      return r;
    };
    return <><ThWaiting view={view} myPlayerId={join.playerId} clockSkew={room.clockSkew} onStart={start} onLeave={leaveRoom}
      onAgree={agree} onCancel={room.cancelStart} onTimeUp={() => void room.tick()} />{blockedDialog}</>;
  }

  const me = view.me;
  if (view.phase === "arranging" && me && !me.arrangement && view.arrangeDeadline !== null) {
    return (
      <>
        <ThArrange key={`${view.handNo}-${arrangeKey}`} cards={me.hand} deadline={view.arrangeDeadline - room.clockSkew - SUBMIT_EARLY_MS} onSubmit={onSubmit}
          rule={handRuleOf(view.scoreRule ?? "v1", view.luckyCard?.rank ?? null)} lucky={view.luckyCard ?? null} />
        {notice && <div className="th-toast" role="alert">{notice}</div>}
      </>
    );
  }
  return <ThTable view={view} now={now} clockSkew={room.clockSkew} />;
}
