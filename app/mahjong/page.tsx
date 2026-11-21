"use client";

import MjLeaveVoteStatus from "@/components/mahjong/MjLeaveVoteStatus";
import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useMahjong, getMjId, type MjJoinInfo, type MjConfirmInfo } from "@/hooks/useMahjong";
import StartConfirm, { secondsLeftOf } from "@/components/gameLobby/StartConfirm";
import { CreateRoomShell, InviteNamePrompt, JoinByCode, WaitingRoom } from "@/components/gameLobby/GameLobby";
import { MJ_SECTIONS } from "@/components/mahjong/mjLobbySections";
import { initialName, inviteNeedsName, loadGameName, saveGameName } from "@/components/gameLobby/name";
import { mjConfirmNote, mjConfirmSeats } from "@/components/mahjong/mjStartConfirmView";
import { START_CONFIRM_MS } from "@/lib/lobby/startConfirm";
import { useMjAuth } from "@/hooks/useMjAuth";
import { isGuestTab, mjFetch, mjStorage, ROOM_CODE_RE } from "@/lib/mahjong/clientAuth";
import { AuthBar, GuestGate, LoginGate, PairedNotice, PortraitHint } from "@/components/mahjong/MjLobbyAuth";
import MjRecords from "@/components/mahjong/MjRecords";
import MjBoard from "@/components/mahjong/MjBoard";
import MjBoardMobile from "@/components/mahjong/MjBoardMobile";
import MjResultMobile from "@/components/mahjong/MjResultMobile";
import MjFlowerFx from "@/components/mahjong/MjFlowerFx";
import MjTile, { TILE_FACE_SRCS } from "@/components/mahjong/MjTile";
import { warmImages } from "@/lib/perf/tableFirst";
import type { Tile } from "@/lib/mahjong/tiles";
import RoomClosed from "@/components/RoomClosed";
import { closedFromResponse } from "@/hooks/roomClosed";
import MjGameOver from "@/components/mahjong/MjGameOver";
import MjFx from "@/components/mahjong/MjFx";
import { bigWinPlayed } from "@/lib/mahjong/bigWin";
import { prefetchMeteorFx } from "@/components/mahjong/MeteorFx";
import { prefetchZimoFx } from "@/components/mahjong/ZimoFx";
import { isZimoFxNew } from "@/lib/mahjong/winShow";
import { setBgWarmPaused } from "@/components/mahjong/FxBgWarm";
import { useWinShow, WinShowLayer } from "@/hooks/useWinShow";
import MjChat, { MjChatButton } from "@/components/mahjong/MjChat";
import MjChatLogBox, { useMjChatFeed } from "@/components/mahjong/MjChatLog";
import { useTableSounds } from "@/hooks/useTableSounds";
import MjPrefsPanel from "@/components/mahjong/MjPrefsPanel";
import MjTableMenu from "@/components/mahjong/MjTableMenu";
import { gameVibrate } from "@/components/gamePrefs/vibrate";
import { SpectateManage, SpectateRequestCard, useSpectateManage } from "@/components/mahjong/spectate/SpectateHost";
import { bindPrefsAccount } from "@/lib/mahjong/prefs";
import BlockedDialog from "@/components/roomCard/BlockedDialog";
import { blockedFrom, type Blocked } from "@/components/roomCard/client";
import { refreshMyCards, useMyCards } from "@/components/roomCard/useMyCards";

// 手機橫向（小宜規格）：高度 ≤ 500px 的橫向畫面改用手機版牌桌
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


// Read room code from URL hash: #room=XXXX
function getRoomFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/^#room=(\d{4})$/);
  return match ? match[1] : null;
}

// LINE 登入完回來時房號在 query（?room=XXXX，見 lib/mahjong/clientAuth 的 loginReturnUrl）
function getRoomFromQuery(): string | null {
  if (typeof window === "undefined") return null;
  const room = new URLSearchParams(window.location.search).get("room");
  return room && ROOM_CODE_RE.test(room) ? room : null;
}

// 開房、加入、取名、等人改用三款共用的 gameLobby（小宜〈共用開房流程 v1.1〉；老闆 2026-11-20「麻將開房還不是共用元件」）：
//   名字照共用規則存在這台的 game_name（遊客分頁走 mjStorage＝sessionStorage），第一次讀會搬舊的 mj_name（自己改過的）／big2_name
const storedName = () => loadGameName(mjStorage(), { mj: mjStorage(), big2: window.localStorage });

// 大廳 Logo（小宜 C 書法橫式）：遊戲裡的平面牌（MjTile）＋細金線＋明體金漸層標題，橫排一行最省高度
const BRAND_TILES: Tile[] = [
  { id: 0, suit: "z", rank: 5, display: "中" },
  { id: 1, suit: "z", rank: 6, display: "發" },
  { id: 2, suit: "z", rank: 7, display: "白" },
];

function Brand() {
  return (
    <div className="mjl-brand">
      <span className="tiles">
        {BRAND_TILES.map((t) => (
          <MjTile key={t.id} tile={t} width="var(--brand-tile-w)" height="var(--brand-tile-h)" />
        ))}
      </span>
      <span className="rule" />
      <span className="txt">
        <h1>台灣麻將</h1>
        <p>TAIWAN MAHJONG · 4 PLAYERS</p>
      </span>
    </div>
  );
}

export default function MahjongPage() {
  const auth = useMjAuth();
  useEffect(() => { warmImages(TILE_FACE_SRCS); }, []); // 牌優先：進麻將大廳就在背景先載全部牌面，開局時手牌不用一張張等（lib/perf/tableFirst.ts）
  // 偏好設定跟著登入的人：LINE 帳號用帳號的、訪客和沒登入用這台的；換帳號、登出就換主人（不沿用上一個帳號的顏色）
  const prefsUserId = auth.status === "in" ? auth.user?.id ?? null : null;
  const prefsGuest = !!auth.user?.isGuest;
  useEffect(() => {
    if (auth.status === "checking") return; // 還不知道是誰：先用這台的
    bindPrefsAccount(prefsUserId ? { id: prefsUserId, isGuest: prefsGuest } : null);
  }, [auth.status, prefsUserId, prefsGuest]);
  const [screen, setScreen] = useState<"home" | "create" | "join" | "room">("home");
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [nameReady, setNameReady] = useState(false);
  const [error, setError] = useState("");
  // 建房／加入成功的 join 回應（登入房有玩家 id 和座位頻道），交給牌桌
  const [joined, setJoined] = useState<MjJoinInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  // 開房、加入被伺服器擋下（房卡 v1.2 2-4：帳號已暫停）
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // 被暫停（房卡 v1.2 2-4，房卡第二批）：大廳按鈕上面紅條、建立／加入變灰不能按；歷史紀錄、排行榜、回到房間照常
  const suspended = !!useMyCards(auth.status === "in" ? auth.user : null)?.suspended;
  // 總大廳頭像選單的「歷史紀錄」（/mahjong?records=1）：直接打開歷史紀錄，網址拿掉參數
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("records") !== "1") return;
    setShowRecords(true);
    q.delete("records");
    history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : "") + window.location.hash);
  }, []);

  // Check hash on load
  useEffect(() => {
    const code = getRoomFromHash() ?? getRoomFromQuery();
    if (code) {
      setRoomCode(code);
      setScreen("room");
    }
    // 邀請連結：這台存過名字（game_name）就直接入座，沒有才問名字（v1.1 §6）
    const stored = storedName();
    if (!inviteNeedsName(stored)) {
      setName(stored);
      setNameReady(true);
    }

    const onHash = () => {
      const c = getRoomFromHash();
      if (c) {
        setRoomCode(c);
        setScreen("room");
      } else {
        setScreen("home");
        setRoomCode("");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 登入流程結束後（supabase-js 已從網址取出 token），把 ?room=XXXX 換回 #room=XXXX
  useEffect(() => {
    if (auth.status === "checking") return;
    const code = getRoomFromQuery();
    if (code) window.history.replaceState(window.history.state, "", `/mahjong#room=${code}`);
  }, [auth.status]);

  // 暱稱欄預設值（v1.1 §4-2）：game_name → 登入的 LINE 名稱前 8 個字（顯示「● LINE 名稱」）；遊客不帶 LINE 名稱
  const lineName = auth.user && !auth.user.isGuest ? auth.user.displayName ?? "" : "";
  const nameInit = () => initialName(storedName(), lineName);

  // 401：登入失效 → 退回登入閘門（在房間裡就是「加入房間 XXXX」）；403：座位不是你的、或遊客／LINE 不同桌 → 回大廳
  const { expire } = auth;
  const handleAuthError = useCallback((status: 401 | 403, code?: string, body?: unknown) => {
    if (status === 401) {
      expire();
      return;
    }
    const block = code === "suspended" ? blockedFrom(body ?? { error: code }) : null; // 用邀請網址進房被擋（房卡 v1.2 2-4）：跳視窗、回大廳
    if (block) {
      setBlocked(block);
      refreshMyCards();
      setJoined(null);
      window.location.hash = "";
      return;
    }
    setError(
      code === "guest_not_allowed"
        ? "遊客只能加入遊客建的房間"
        : code === "guest_room"
          ? "這是遊客的測試房間，LINE 帳號不能加入"
          : "無法進入這間房"
    );
    setJoined(null);
    window.location.hash = "";
  }, [expire]);

  /** 加入房間（建房後房主也要加入）；回傳 null 表示失敗，錯誤已顯示 */
  async function joinRoom(code: string, nm = name.trim()): Promise<(MjJoinInfo & { ended?: boolean }) | null> {
    const res = await mjFetch("/api/mahjong/join", {
      method: "POST",
      body: JSON.stringify({ code, playerId: getMjId(), name: nm }),
    });
    const data = await res.json();
    // 房間已開局、你不在這桌：改進觀戰畫面（/mahjong/watch 帶房號直接查房）；觀戰只限 LINE 帳號
    if (data.started && data.error !== "guest_room") {
      if (auth.user?.isGuest) setError("需要 LINE 登入才能觀戰");
      else window.location.href = `/mahjong/watch?code=${encodeURIComponent(code)}`;
      return null;
    }
    const block = blockedFrom(data);
    if (block) {
      setBlocked(block);
      refreshMyCards();
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      handleAuthError(res.status, data.error);
      return null;
    }
    // 410：這場已結束，進房後顯示總結算
    if (res.status === 410) return { roomId: "", ended: true };
    if (!res.ok) {
      setError((data.error === "bad_name" && data.message) || data.error || "加入房間失敗"); // 名字不合法：顯示伺服器的「名字要是 1～8 個字」
      return null;
    }
    return data as MjJoinInfo;
  }

  // 找回沒打完的牌局（老柯 GET /api/mahjong/my-room）：LINE 登入、在大廳時問一次，從背景回來（主畫面 App）再問一次。
  // 遊客不提供；有房就在大廳最上面顯示「回到房間」，按下去用 join 拿回原本的座位（伺服器用 LINE 帳號認人）
  const [myRoom, setMyRoom] = useState<{ code: string; status: string } | null>(null);
  const lobbyHome = auth.status === "in" && !!auth.user && !auth.user.isGuest && screen === "home" && !roomCode;
  useEffect(() => {
    if (!lobbyHome) return;
    let alive = true;
    const ask = () => {
      if (document.hidden) return;
      mjFetch("/api/mahjong/my-room")
        .then(async (res) => {
          const data = res.ok ? ((await res.json()) as { room?: { code: string; status: string } | null }) : null;
          if (alive) setMyRoom(data?.room && ROOM_CODE_RE.test(data.room.code) ? data.room : null);
        })
        .catch(() => {});
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", ask);
    };
  }, [lobbyHome]);

  // 斗內後台入口拿掉（老闆 2026-11-20 斗內下架；房卡後台入口在總大廳頭像選單）

  async function handleResume(code: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    const nm = nameInit().name || "玩家";
    setName(nm);
    setNameReady(true);
    try {
      const info = await joinRoom(code, nm);
      if (!info) {
        setMyRoom(null);
        return;
      }
      setMyRoom(null);
      setRoomCode(code);
      setJoined(info.ended ? null : info);
      setScreen("room");
      window.location.hash = `room=${code}`;
    } catch {
      setError("網路錯誤，請重試");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** 建立房間：設定卡回傳「代號 → 值」（rounds／base／fan），名字是暱稱欄去掉前後空白後的 */
  async function handleCreate(values: Record<string, number>, nm: string) {
    if (isSubmitting) return; // prevent double-click
    setIsSubmitting(true);
    setError("");
    setName(nm);
    try {
      const myId = getMjId();
      const res = await mjFetch("/api/mahjong/create", {
        method: "POST",
        body: JSON.stringify({ hostId: myId, totalRounds: values.rounds, basePoints: values.base, fanPoints: values.fan }),
      });
      const data = await res.json();
      if (res.status === 401) {
        handleAuthError(401);
        return;
      }
      const block = blockedFrom(data);
      if (block) {
        setBlocked(block);
        refreshMyCards();
        return;
      }
      if (!res.ok) {
        setError(data.error || "建立房間失敗");
        return;
      }
      // 房主加入：要等回應拿座位頻道，開局發牌才收得到
      const info = await joinRoom(data.code, nm);
      if (!info) return;
      saveGameName(mjStorage(), nm); // 成功送出才存（v1.1 §4-2）
      setNameReady(true);
      setRoomCode(data.code);
      setJoined(info.ended ? null : info);
      setScreen("room");
      window.location.hash = `room=${data.code}`;
    } catch {
      setError("網路錯誤，請重試");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** 輸入房號加入（房號 4 碼、名字由共用畫面檢查好才會送） */
  async function handleJoin(joinCode: string, nm: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setName(nm);
    try {
      const info = await joinRoom(joinCode, nm);
      if (!info) return;
      saveGameName(mjStorage(), nm);
      setNameReady(true);
      setRoomCode(joinCode);
      // 410：不帶 join 資訊，進房後自動加入會拿到「這場已結束」
      setJoined(info.ended ? null : info);
      setScreen("room");
      window.location.hash = `room=${joinCode}`;
    } catch {
      setError("網路錯誤，請重試");
    } finally {
      setIsSubmitting(false);
    }
  }

  function goHome() {
    window.location.href = "/";
  }

  // 沒登入：大廳／房號連結都先擋登入閘門（只有 LINE 登入；從 ?guest=1 進來的分頁改成遊客的測試密碼）
  const inRoom = screen === "room" && !!roomCode;
  if (auth.status !== "in" || !auth.user) {
    return (
      <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]">
        <PortraitHint label="返回首頁" onClick={goHome} />
        <Brand />
        {auth.guestMode ? (
          <GuestGate
            checking={auth.status === "checking"}
            roomCode={inRoom ? roomCode : null}
            onSubmit={auth.signInGuest}
            onBack={() => {
              if (inRoom) window.location.hash = "";
              else goHome();
            }}
          />
        ) : (
        <LoginGate
          status={auth.status === "in" ? "checking" : auth.status}
          roomCode={inRoom ? roomCode : null}
          errorText={auth.errorText}
          handoff={auth.handoff}
          onCancelPairing={auth.cancelPairing}
          onContinueHere={auth.continueHere}
          onLogin={() => auth.signIn(inRoom ? roomCode : null)}
          onBack={() => {
            if (inRoom) window.location.hash = "";
            else goHome();
          }}
        />
        )}
      </div>
    );
  }

  // --- Create / Join：三款共用的開房、加入畫面（設定卡、暱稱欄、按鈕都在共用外框裡；右上角帳號列、品牌區是麻將自己的） ---
  if (screen === "create" || screen === "join") {
    const back = () => { setScreen("home"); setError(""); };
    return (
      <>
        <PortraitHint label="返回首頁" onClick={goHome} />
        {screen === "create" ? (
          <CreateRoomShell className="mjl" attrs={{ "data-mj-lobby": "create" }} brand={<Brand />} top={<AuthBar user={auth.user} onSignOut={auth.signOut} />}
            sections={MJ_SECTIONS} initialName={nameInit()} busy={isSubmitting} error={error} onCreate={(v, nm) => void handleCreate(v, nm)} onBack={back} />
        ) : (
          <JoinByCode className="mjl" brand={<Brand />} top={<AuthBar user={auth.user} onSignOut={auth.signOut} />}
            initialName={nameInit()} busy={isSubmitting} error={error} onJoin={(code, nm) => void handleJoin(code, nm)} onBack={back} />
        )}
        <MjPrefsPanel />
        <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
      </>
    );
  }

  // --- Home screen ---
  if (screen !== "room") {
    return (
      <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]">
        <PortraitHint label="返回首頁" onClick={goHome} />
        <AuthBar user={auth.user} onSignOut={auth.signOut} />
        <MjPrefsPanel />
        <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
        {auth.pairedAs !== null && <PairedNotice name={auth.pairedAs} onOk={auth.dismissPairedAs} onNotMe={auth.signOut} />}
        <Brand />
        <div className="mjl-col">
          {screen === "home" ? (
            <div className="mjl-col fade-in">
              {myRoom && (
                <button onClick={() => handleResume(myRoom.code)} disabled={isSubmitting} className="mjl-btn resume">
                  {myRoom.status === "waiting" ? "你在房間等開局，" : "你有一局還沒打完，"}
                  <b>回到房間 {myRoom.code}</b>
                </button>
              )}
              {suspended && <div className="rc-ban" role="status" data-rc-suspended-ban>帳號已暫停</div>}
              <button
                onClick={() => {
                  setScreen("create");
                  setError("");
                }}
                disabled={suspended}
                className={`mjl-btn primary${suspended ? " rc-lock" : ""}`}
              >
                建立房間
              </button>
              <button
                onClick={() => {
                  setScreen("join");
                  setError("");
                }}
                disabled={suspended}
                className={`mjl-btn second${suspended ? " rc-lock" : ""}`}
              >
                加入房間
              </button>
              <button
                onClick={() => {
                  setShowRecords(true);
                  setError("");
                }}
                className="mjl-btn ghost"
              >
                歷史紀錄
              </button>
              {/* 排行榜（公開）；斗內後台入口拿掉（2026-11-20 斗內下架） */}
              <div className="flex gap-3">
                <a href="/mahjong/ranks" className="mjl-btn ghost text-center flex-1" data-lobby-board>排行榜</a>
              </div>
              <button onClick={goHome} className="mjl-foot">
                返回首頁
              </button>
            </div>
          ) : null}

          {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
        </div>
        {showRecords && (
          <MjRecords
            user={auth.user}
            onClose={() => setShowRecords(false)}
            onCreate={() => {
              setShowRecords(false);
              setScreen("create");
            }}
            onUnauthorized={expire}
          />
        )}
      </div>
    );
  }

  // 主畫面 App 剛領回登入、要進房：先確認帳號，按「好」才進房；「不是我」＝登出，回到保留房號的登入閘門
  if (auth.pairedAs !== null) {
    return (
      <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]">
        <PortraitHint label="返回首頁" onClick={goHome} />
        <Brand />
        <div className="mjl-col mjl-gate fade-in">
          <h2 className="mjl-join-ttl">
            加入房間 <b>{roomCode}</b>
          </h2>
          <PairedNotice name={auth.pairedAs} onOk={auth.dismissPairedAs} onNotMe={auth.signOut} inline />
        </div>
      </div>
    );
  }

  // --- Room ---
  return (
    <RoomView
      code={roomCode}
      playerName={name}
      nameReady={nameReady}
      nameInit={nameInit()}
      accountId={auth.user.id}
      guest={!!auth.user.isGuest}
      initialJoin={joined}
      onSetName={(n) => {
        setName(n);
        setNameReady(true);
        saveGameName(mjStorage(), n);
      }}
      onAuthError={handleAuthError}
      onGoHome={goHome}
      onLeft={() => {
        // 等人時退出房間成功：清掉網址的房號、忘記剛才的房間，回麻將大廳（重新整理也不會再進去）
        setJoined(null);
        setMyRoom(null);
        window.location.hash = "";
      }}
    />
  );
}

// ─── Room Component ───
// Countdown shown after all 4 players agree to next game
function NextGameCountdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n <= 0) return;
    const t = setTimeout(() => setN((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [n]);
  return (
    <div
      className="py-3 rounded-xl text-center"
      style={{
        background: "linear-gradient(90deg, rgba(201,169,110,0.25) 0%, rgba(201,169,110,0.1) 100%)",
        border: "1px solid rgba(201,169,110,0.35)",
      }}
    >
      <p className="text-[#f0d68a] text-sm font-bold">
        下一局準備中... {n > 0 ? n : ""}
      </p>
    </div>
  );
}

function RoomView({
  code,
  playerName,
  nameReady,
  nameInit,
  initialJoin,
  onSetName,
  onAuthError,
  onGoHome,
  onLeft,
  accountId,
  guest,
}: {
  /** 登入帳號 id、是不是訪客（聊天：換帳號就清空；訪客只能看、聽） */
  accountId: string;
  guest: boolean;
  code: string;
  playerName: string;
  nameReady: boolean;
  /** 邀請連結取名頁的暱稱欄預設值（game_name → LINE 名稱） */
  nameInit: { name: string; fromLine: boolean };
  initialJoin: MjJoinInfo | null;
  onSetName: (n: string) => void;
  onAuthError: (status: 401 | 403, code?: string, body?: unknown) => void;
  onGoHome: () => void;
  /** 等人時退出房間成功（回麻將大廳） */
  onLeft: () => void;
}) {

  const {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    startConfirm,
    confirmStart,
    cancelStart,
    refreshState,
    nextGame,
    requestLeave,
    voteLeave,
    drawTile,
    discardTile,
    doAction,
    applyJoin,
    closed,
    markClosed,
    leaveWaiting,
    roomId,
  } = useMahjong(code, nameReady ? playerName : "", onAuthError);
  const [startBlocked, setStartBlocked] = useState<Blocked | null>(null);

  // 等人時「退出房間」（老闆 2026-10-24）：伺服器真的把你移出房間、空出座位，才回大廳；失敗留在原畫面並提示
  // 等人時「退出房間」（老闆 2026-10-24）：伺服器真的把你移出房間、空出座位，才回大廳；失敗留在原畫面，由共用等人畫面顯示原因。
  // 房間已滿、自己不在裡面（按鈕是「返回」）：直接回大廳
  const leaveWaitingRoom = async (notSeated: boolean): Promise<{ ok: boolean; message?: string }> => {
    if (notSeated) { onLeft(); return { ok: true }; }
    const err = await leaveWaiting();
    if (err) return { ok: false, message: err };
    onLeft();
    return { ok: true };
  };

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showSpectateManage, setShowSpectateManage] = useState(false);
  // 觀戰（老馬 2026-10-30）：牌局進行中、我有座位、房間還開著才收申請、管觀戰；遊客房也照樣收（觀戰者一定是 LINE 登入，伺服器檢查）
  const spectateActive = !!roomId && state.status === "playing" && state.mySeat >= 0 && !closed;
  const spectateManage = useSpectateManage(roomId, state.myId, state.spectateTick, spectateActive);
  const isMobileLandscape = useMobileLandscape();
  // 本場聊天清單：進房、重新整理時用歷史補齊（hook 要在下面任何 return 之前）
  const chatRetry = useMjChatFeed({ account: accountId, roomId: closed ? "" : roomId, roomCode: code, me: state.myId || null });

  // 胡牌演出（浮層、大牌段、隕石、結算先等）：和觀戰頁共用 hooks/useWinShow.tsx（老馬 2026-10-30 原封搬出，邏輯沒改）
  // 整場打完（completed）時伺服器結算後馬上關房：最後一局照樣播，播完才出最終結算；解散等其他原因關房不播（審伯 2026-10-23）
  const winShowRoomOk = !closed || (closed.endReason === "completed" && !!state.gameOver);
  const ws = useWinShow({ winner: state.winner, status: state.status, roundInfo: state.roundInfo, roomId, roomOk: winShowRoomOk });
  const { isZimoWin, showWinner, winShowKey, winShowLive, winShowHoldResult } = ws;
  // 帳號專屬隕石：房間裡有這個帳號（伺服器給 players[].winFx 時），開局就先把圖、字型、音效載好；贏的那一刻才知道的話上面會等它載好再播
  // 背景預熱（components/mahjong/FxBgWarm.tsx）只在不是打牌中的時候做：牌局進行中、胡牌特效在播時暫停；等人、結算、等下一局、離開牌桌時繼續
  const bgWarmPause = state.status === "playing" || !!winShowLive || (!!winShowKey && !bigWinPlayed(winShowKey));
  useEffect(() => { setBgWarmPaused(bgWarmPause); }, [bgWarmPause]);
  useEffect(() => () => setBgWarmPaused(false), []);
  const meteorInRoom = state.players.some((p) => p.winFx === "meteor") || showWinner?.winFx === "meteor";
  useEffect(() => { if (meteorInRoom) prefetchMeteorFx(); }, [meteorInRoom]);
  // 自摸特效庫的新特效：房間裡有人選了哪一種，就先載那一種（和隕石一樣；一般牌局沒人有，不下載）
  const zfxInRoom = [...new Set([...state.players.map((p) => p.winFx), showWinner?.winFx].filter(isZimoFxNew))].sort().join();
  useEffect(() => { for (const fx of zfxInRoom.split(",").filter(isZimoFxNew)) prefetchZimoFx(fx); }, [zfxInRoom]);


  // Pass roomId (登入房另有玩家 id、座位頻道) from create/join to the hook
  useEffect(() => {
    if (initialJoin) {
      applyJoin(initialJoin);
    }
  }, [initialJoin, applyJoin]);

  // When joining via hash link (no initialJoin), call join API
  useEffect(() => {
    if (nameReady && playerName && code && !initialJoin) {
      const pid = getMjId();
      mjFetch("/api/mahjong/join", {
        method: "POST",
        body: JSON.stringify({ code, playerId: pid, name: playerName }),
      })
        .then(async (res) => {
          const data = await res.json();
          // 這場已結束、房間已刪：顯示總結算
          if (res.status === 410) markClosed(closedFromResponse(data));
          else if (res.status === 401 || res.status === 403) onAuthError(res.status, data.error, data);
          else if (data.roomId) applyJoin(data as MjJoinInfo);
        })
        .catch((err) => console.error("[mj] auto-join failed:", err));
    }
  }, [nameReady, playerName, code, initialJoin, applyJoin, markClosed, onAuthError]);

  // Vibrate on my turn
  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current && state.status === "playing") {
      gameVibrate(200); // 共用設定「震動」關掉就不震（麻將換共用設定面板 2026-11-20）
    }
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, state.status]);

  // 牌桌音效：任何人打出一張牌響一次出牌聲；輪到自己要打牌超過 8 秒沒打響提醒聲（每 8 秒、最多 3 次）。
  // 輪到自己有自摸、暗槓、眼牌按鈕時照樣計時；結算、不是在打牌時不計時；都走互動音效的音量和靜音
  useTableSounds({
    roomId: closed ? "" : roomId,
    hand: `${state.roundInfo?.currentRound}-${state.roundInfo?.currentGame}-${state.roundInfo?.dealerConsecutive}`,
    focusDiscard: state.status === "playing" ? state.focusDiscard : null,
    needsDiscard,
    status: state.status,
  });

  // 房間已關閉：整場打完的最終結算畫面本身就有「回大廳」，其他情況（解散、重新整理、
  // 用房號加入已刪的房）顯示「這場已結束」
  const finalOverlayShown = state.status === "finished" && !!state.winner && !!state.gameOver;
  if (closed && !(closed.endReason === "completed" && finalOverlayShown)) {
    return (
      <>
        <PortraitHint label="返回首頁" onClick={onGoHome} />
        <RoomClosed info={closed} onGoHome={onGoHome} />
      </>
    );
  }

  // 邀請連結進來、這台還沒存過名字：共用的取名頁（品牌區＋「加入房間 XXXX」＋暱稱欄＋加入）
  if (!nameReady) {
    return (
      <>
        <PortraitHint label="返回首頁" onClick={onGoHome} />
        <InviteNamePrompt className="mjl" brand={<Brand />} code={code} initialName={nameInit} busy={false} error="" onJoin={(n) => onSetName(n)} onBack={onGoHome} />
      </>
    );
  }

  // Lobby (waiting for players)：三款共用的等人畫面（房號卡＋複製邀請連結、設定摘要、四列座位、開始鈕、退出房間；v1.1 §7）
  if (state.status === "waiting") {
    const isInRoom = state.players.some((p) => p.id === state.myId);
    const roomFull = state.players.length >= 4 && !isInRoom;
    // 遊客的房間只有遊客能進：連結帶 ?guest=1，別的分頁打開就是遊客登入
    const inviteUrl = typeof window === "undefined" ? `/mahjong#room=${code}` : `${window.location.origin}/mahjong${isGuestTab() ? "?guest=1" : ""}#room=${code}`;
    const rs = state.roomSettings;
    // 房裡有人被暫停（房卡 v1.2 2-5）：伺服器回 403 player_suspended，跳「不能開局」列出座位；房間維持等人
    const start = async (): Promise<{ ok: boolean; message?: string }> => {
      try {
        await startGame();
        return { ok: true };
      } catch (e) {
        let body: unknown = null;
        try { body = JSON.parse((e as Error).message); } catch { /* 不是 JSON */ }
        const b = blockedFrom(body, code);
        if (b) { setStartBlocked(b); return { ok: true }; } // 已經跳視窗說明，等人畫面不再另外寫錯誤
        return { ok: false, message: "開局失敗，請再按一次" };
      }
    };
    return (
      <>
        <PortraitHint label="退出房間" onClick={() => void leaveWaitingRoom(roomFull)} />
        <WaitingRoom className="mjl" code={code} inviteUrl={inviteUrl} summary={rs ? [`${rs.totalRounds}圈`, `底${rs.basePoints}`, `台${rs.fanPoints}`] : []}
          isHost={isHost} full={roomFull} onStart={start} onLeave={() => leaveWaitingRoom(roomFull)}
          seats={state.players.map((p) => ({ seat: p.seat, name: p.name, avatarUrl: p.avatarUrl ?? null, me: p.id === state.myId, host: p.id === state.hostId }))} />
        <BlockedDialog blocked={startBlocked} onClose={() => setStartBlocked(null)} />
        {/* 開局確認（老闆 2026-11-20）：房主按開始後蓋共用的 StartConfirm（四家小牌子、10 秒倒數、同意／房主取消）；
            四家都同意伺服器就發牌（畫面跟著狀態換成牌桌）；時間到沒到齊就回等人，上面一條提示誰沒按 */}
        <MjStartConfirm players={state.players} myId={state.myId} isHost={isHost} info={startConfirm} onTimeUp={refreshState} onCancel={cancelStart}
          onAgree={async () => {
            const r = await confirmStart();
            const b = r.ok ? null : blockedFrom(r.body, code); // 發牌前伺服器再查一次暫停：跟開始被擋一樣跳「不能開局」
            if (b) { setStartBlocked(b); return { ok: true }; }
            return r;
          }} />
      </>
    );
  }

  // Playing (or finished — show board with result overlay)
  const isFinished = state.status === "finished" && state.winner;

  const handleLeave = () => {
    // Mid-session (game active or finished-but-not-all-rounds-done) needs consent
    const inSession =
      state.status === "playing" ||
      (state.status === "finished" && state.roomSettings && !state.gameOver);
    if (inSession) {
      setShowLeaveConfirm(true);
    } else {
      onGoHome();
    }
  };

  const roundLabel = state.roundInfo && state.roomSettings
    ? `${["東", "南", "西", "北"][(state.roundInfo.currentRound - 1) % 4]}風圈 第${state.roundInfo.currentGame}局`
    : undefined;

  const nameOfSeat = (seat: number) => state.players.find((p) => p.seat === seat)?.name ?? "";

  // 打字聊天與語音訊息：LINE 登入、已入座才能發；輪到自己、可以吃碰槓胡時底板收起
  const chatCanSend = !guest && state.mySeat >= 0;
  const chatButton = <MjChatButton canSend={chatCanSend} desk={!isMobileLandscape} />;
  // 聊天室（components/social/）：手機接在輸入面板正上方、桌機放牌桌右邊；點聊天室外面就關
  const chatBox = (
    <MjChatLogBox variant={isMobileLandscape ? "dock" : "side"} mySeat={state.mySeat} canSend={chatCanSend} guest={guest}
      myTurn={needsDiscard} claiming={state.availableActions.length > 0} onRetry={chatRetry} />
  );
  // 觀戰：四家被觀戰人數（公開，state／mj_spectators 帶的 spectatorCounts）補進名牌；申請卡、觀戰管理只有座位本人看得到
  const spectatorCounts = state.spectatorCounts;
  const playersWithViewers = spectatorCounts ? state.players.map((p) => ({ ...p, viewerCount: spectatorCounts[p.id] ?? 0 })) : state.players;
  const spectateMenu = spectateActive ? { count: spectateManage.info?.approved.length ?? 0, onOpen: () => setShowSpectateManage(true) } : undefined;
  const boardProps = {
    chatButton,
    players: playersWithViewers,
    mySeat: state.mySeat,
    myHand: state.myHand,
    currentTurn: state.currentTurn,
    dealerSeat: state.dealerSeat,
    lastDiscard: state.lastDiscard,
    focusDiscard: state.focusDiscard,
    paceNote: state.paceNote,
    availableActions: state.availableActions,
    pendingAddKong: state.pendingAddKong,
    robKong: state.robKong,
    pendingFlowerRob: state.pendingFlowerRob,
    robFlower: state.robFlower,
    tingSeats: state.tingSeats,
    eyeSeats: state.eyeSeats,
    eyeOptions: state.eyeOptions,
    eyeWithTing: state.eyeWithTing,
    chiForbidden: state.chiForbidden,
    chiForbiddenBy: state.chiForbiddenBy,
    opponentHands: state.opponentHands,
    declareFx: state.declareFx,
    wallRemaining: state.wallRemaining,
    hasDrawn: state.hasDrawn,
    needsDraw,
    needsDiscard,
    isMyTurn,
    playerName,
    drawnTileId: state.drawnTileId,
    drawnSeat: state.drawnSeat,
    slowDraw: state.slowDraw,
    actionNotice: state.actionNotice,
    onDraw: drawTile,
    onDiscard: discardTile,
    onAction: doAction,
    dice: state.dice,
    doorSeat: state.doorSeat,
    playerScores: state.playerScores,
    dealerConsecutive: state.roundInfo?.dealerConsecutive,
    flowerLabel: state.flowerLabel,
  };

  return (
    <div className="flex flex-col flex-1 h-dvh max-h-dvh overflow-hidden bg-[#0f2a1a] relative" data-mj-shake data-mt-stage>
      <MjPrefsPanel />
      {/* 互動特效：選一位玩家送 5 種特效；結算畫面出現時收掉 */}
      <MjFx players={state.players} mySeat={state.mySeat} suspended={!!isFinished} desk={!isMobileLandscape}
        hand={`${state.roundInfo?.currentRound}-${state.roundInfo?.currentGame}-${state.roundInfo?.dealerConsecutive}`} roomId={closed ? "" : roomId} />
      {/* 打字聊天與語音訊息：泡泡貼名牌、聊天底板、送出狀態（房間關了就清空） */}
      <MjChat
        mySeat={state.mySeat}
        myId={state.myId}
        roomId={closed ? "" : roomId}
        roomCode={code}
        account={accountId}
        canSend={chatCanSend}
        claiming={state.availableActions.length > 0}
        desk={!isMobileLandscape}
      />
      {/* 觀戰申請卡（非阻斷，不擋手牌、出牌和聊天）、觀戰管理（牌桌選單打開，收回同意） */}
      {spectateActive && <SpectateRequestCard info={spectateManage.info} roomId={roomId} playerId={state.myId} desk={!isMobileLandscape} onChanged={spectateManage.reload} />}
      {spectateActive && showSpectateManage && (
        <SpectateManage info={spectateManage.info} roomId={roomId} playerId={state.myId} onClose={() => setShowSpectateManage(false)} onChanged={spectateManage.reload} />
      )}
      {/* 手機直向：蓋轉向提示（牌桌照常掛著，連線不中斷） */}
      <PortraitHint label="離開房間" onClick={handleLeave} />

      {isMobileLandscape ? (
        <>
        <MjBoardMobile
          {...boardProps}
          roomCode={code}
          roundLabel={roundLabel}
          basePoints={state.roomSettings?.basePoints}
          fanPoints={state.roomSettings?.fanPoints}
          onLeave={handleLeave}
          spectateMenu={spectateMenu}
        />
        {chatBox}
        </>
      ) : (
      <div className="flex flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        {/* 左上 ☰：設定、房號、圈局、底台、離開房間（和手機版同一個選單；唯一的設定入口） */}
        <div className="relative w-10 h-10">
          <MjTableMenu desk roomCode={code} roundLabel={roundLabel} basePoints={state.roomSettings?.basePoints} fanPoints={state.roomSettings?.fanPoints} onLeave={handleLeave} spectate={spectateMenu} />
        </div>
        <div className="text-center">
          <h1 className="text-sm font-bold text-[#f0d68a] font-heading">
            台灣麻將 · {code}
          </h1>
          {state.roundInfo && state.roomSettings && (
            <p className="text-[10px] text-white/40">
              {["東", "南", "西", "北"][(state.roundInfo.currentRound - 1) % 4]}風圈
              {" "}第{state.roundInfo.currentGame}局
              {state.roundInfo.dealerConsecutive > 0 && ` · 連${state.roundInfo.dealerConsecutive}莊`}
            </p>
          )}
        </div>
        {/* 右邊留同寬的空位，標題才會置中（右上齒輪拿掉了，設定在左上 ☰） */}
        <div className="w-10 h-10" aria-hidden />
      </div>

      <MjBoard {...boardProps} />
      </div>
      {chatBox}
      </div>
      )}

      {/* 補花特效：掛在 body，貼著補花那一家的名牌（桌機、手機共用；自己補花已經在手牌最右邊顯示，這裡只播別家的） */}
      <MjFlowerFx fx={state.flowerFx} mySeat={state.mySeat} desk={!isMobileLandscape} />

      {/* Leave confirmation modal (requester side) */}
      {showLeaveConfirm && !state.leaveRequest && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-[60] px-4">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-[#f0d68a] font-bold text-lg text-center mb-2">離開房間？</h3>
            <p className="text-white/60 text-sm text-center mb-4">
              牌局尚未結束，需要其他玩家同意你才能離開（輪到他超過 3 分鐘沒動作的人不計票）。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 text-white/70 font-bold cursor-pointer active:scale-95 transition-all"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  await requestLeave();
                  setShowLeaveConfirm(false);
                }}
                className="flex-1 py-3 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold cursor-pointer active:scale-95 transition-all"
              >
                請求離開
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave request active — voter side (not requester) */}
      {state.leaveRequest && state.leaveRequest.requesterId !== state.myId && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-[60] px-4">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-[#f0d68a] font-bold text-lg text-center mb-2">
              {state.leaveRequest.requesterName} 想離開
            </h3>
            <p className="text-white/60 text-sm text-center mb-1">
              同意的話遊戲會結束回大廳
            </p>
            <div className="mb-4">
              <MjLeaveVoteStatus roomId={roomId} playerId={state.myId} isRequester={false}
                fallbackApproved={state.leaveRequest.approvedCount ?? 0} tick={state.leaveRequest.approvedCount ?? 0} />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => voteLeave(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 text-white/70 font-bold cursor-pointer active:scale-95 transition-all"
              >
                不同意
              </button>
              <button
                onClick={() => voteLeave(true)}
                className="flex-1 py-3 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold cursor-pointer active:scale-95 transition-all"
              >
                同意
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave request waiting — requester side */}
      {state.leaveRequest && state.leaveRequest.requesterId === state.myId && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-[60] px-4">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-5 max-w-sm w-full shadow-2xl text-center">
            <div className="animate-pulse">
              <h3 className="text-[#f0d68a] font-bold text-lg mb-2">等待其他玩家同意...</h3>
            </div>
            <MjLeaveVoteStatus roomId={roomId} playerId={state.myId} isRequester
              fallbackApproved={state.leaveRequest.approvedCount ?? 0} tick={state.leaveRequest.approvedCount ?? 0} />
            <div>
              {(state.leaveRequest.deniedCount ?? 0) > 0 && (
                <p className="text-red-400 text-sm">已有玩家不同意</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leave denied toast */}
      {state.leaveResult === "denied" && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-red-900/80 border border-red-500/40 rounded-xl px-4 py-2 text-red-200 text-sm z-[55] fade-in">
          離開請求被拒絕
        </div>
      )}

      {/* 胡牌演出：一般胡牌的浮層、大牌段、隕石（hooks/useWinShow.tsx，和觀戰頁共用） */}
      <WinShowLayer ws={ws} winner={state.winner} mySeat={state.mySeat} mobile={isMobileLandscape} />

      {/* 結算浮層：桌機和手機橫向同一個樣式（老闆選定手機版），桌機只是放大；大牌特效播的時候先不出 */}
      {isFinished && state.winner && !winShowHoldResult && (
        <MjResultMobile
          desktop={!isMobileLandscape}
          tingSeats={state.tingSeats}
          eyeSeats={state.eyeSeats}
          dice={state.dice}
          doorSeat={state.doorSeat}
          dealerSeat={state.dealerSeat}
          dealerConsecutive={state.roundInfo?.dealerConsecutive}
          roomLine={state.roomSettings ? `${state.roomSettings.totalRounds} 圈・底 ${state.roomSettings.basePoints} 台 ${state.roomSettings.fanPoints}` : undefined}
          winner={state.winner}
          winners={state.winners}
          players={state.players}
          mySeat={state.mySeat}
          myId={state.myId}
          fromName={(state.winner.from ?? state.lastDiscard?.from) != null ? nameOfSeat((state.winner.from ?? state.lastDiscard?.from)!) : undefined}
          isZimo={isZimoWin}
          settlement={state.settlement}
          playerScores={state.playerScores}
          hasRounds={!!state.roomSettings}
          gameOver={state.gameOver}
          handStats={state.handStats}
          remainingWall={state.remainingWall}
          nextGameReady={state.nextGameReady}
          onNextGame={nextGame}
          onLeave={() => {
            if (state.gameOver || !state.roomSettings) onGoHome();
            else setShowLeaveConfirm(true);
          }}
        />
      )}
    </div>
  );
}

// ─── 開局確認（共用 StartConfirm；倒數照伺服器截止時間，到 0 讀一次狀態讓伺服器判斷） ───
function MjStartConfirm({ players, myId, isHost, info, onAgree, onCancel, onTimeUp }: {
  players: { id: string; name: string; seat: number }[]; myId: string; isHost: boolean; info: MjConfirmInfo;
  onAgree: () => Promise<{ ok: boolean; message?: string }>; onCancel: () => Promise<{ ok: boolean; message?: string }>; onTimeUp: () => void;
}) {
  const sc = info.startConfirm;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [errO, setErr] = useState<{ deadline: number | null; msg: string } | null>(null);
  const firedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!sc) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [sc]);
  const secs = sc ? secondsLeftOf(sc.deadline, now, info.clockSkew) : 0;
  useEffect(() => {
    if (!sc) return;
    if (secs === 0 && firedFor.current !== sc.deadline) { firedFor.current = sc.deadline; onTimeUp(); }
  }, [sc, secs, onTimeUp]);
  // 到 0 之後伺服器還沒回到等人（時差、網路）：每 2 秒再讀一次
  useEffect(() => {
    if (!sc || secs > 0) return;
    const t = setInterval(onTimeUp, 2000);
    return () => clearInterval(t);
  }, [sc, secs, onTimeUp]);
  const deadline = sc?.deadline ?? null;
  const err = errO && errO.deadline === deadline ? errO.msg : null;
  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setErr({ deadline, msg: r.message ?? "送出失敗，請再按一次" });
  };
  const note = mjConfirmNote(info.lastStartConfirm, !!sc, players, myId, isHost);
  return (
    <>
      {note && <div className="stc-note" role="status" data-mj-start-note={info.lastStartConfirm?.reason}>{note}</div>}
      {sc && (
        <StartConfirm seats={mjConfirmSeats(players, sc.readyIds, myId)} secondsLeft={secs} totalSeconds={START_CONFIRM_MS / 1000} isHost={isHost} busy={busy} error={err}
          onAgree={() => void run(onAgree)} onCancel={() => void run(onCancel)} />
      )}
    </>
  );
}
