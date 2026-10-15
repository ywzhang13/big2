"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useMahjong, getMjId, type MjJoinInfo } from "@/hooks/useMahjong";
import { useMjAuth } from "@/hooks/useMjAuth";
import { isGuestTab, mjFetch, mjStorage, ROOM_CODE_RE } from "@/lib/mahjong/clientAuth";
import { AuthBar, GuestGate, LoginGate, PairedNotice, PortraitHint } from "@/components/mahjong/MjLobbyAuth";
import MjRecords from "@/components/mahjong/MjRecords";
import MjBoard from "@/components/mahjong/MjBoard";
import MjBoardMobile from "@/components/mahjong/MjBoardMobile";
import MjResultMobile from "@/components/mahjong/MjResultMobile";
import RoomClosed from "@/components/RoomClosed";
import { closedFromResponse } from "@/hooks/roomClosed";
import MjGameOver from "@/components/mahjong/MjGameOver";

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

const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];

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

// 暱稱來源（小宜規格 §8）：line＝登入時帶入的 LINE 名稱，manual＝自己改過（之後登入不再覆寫）
type NameSource = "line" | "manual";

/** 暱稱輸入框；名稱是 LINE 帶入的就在右側標「● LINE 名稱」，一改字就消失 */
function NameField({
  value,
  onChange,
  fromLine,
}: {
  value: string;
  onChange: (v: string) => void;
  fromLine: boolean;
}) {
  return (
    <div className="mjl-field w-full">
      <input
        type="text"
        maxLength={8}
        placeholder="你的暱稱"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // 手機橫向叫出鍵盤時，iOS 會把輸入框頂到鍵盤後面
        onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center" })}
        className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                   placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
      />
      {fromLine && (
        <span className="mjl-from-line">
          <i />
          LINE 名稱
        </span>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="mjl-brand text-center">
      <div className="tiles flex gap-1 justify-center mb-2">
        {[{t:"中",c:"#dc2626"},{t:"發",c:"#15803d"},{t:"",c:""}].map((x,i)=>(
          <div key={i} className="w-10 h-14 rounded-md flex items-center justify-center"
            style={{background:"linear-gradient(145deg, #f5f0e0 0%, #e8dfc8 50%, #d4c9a8 100%)",boxShadow:"2px 3px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.8)",border:"1px solid rgba(180,170,140,0.6)"}}>
            {x.t ? <span className="text-xl font-black" style={{color:x.c,fontFamily:"serif"}}>{x.t}</span>
              : <div className="w-6 h-8 rounded-sm" style={{border:"2.5px solid #1a1a1a"}} />}
          </div>
        ))}
      </div>
      <h1 className="font-bold tracking-wider text-[#f0d68a] font-heading">
        台灣麻將
      </h1>
      <p className="text-white/50 mt-2 text-sm">Taiwan Mahjong — 4 Players</p>
    </div>
  );
}

export default function MahjongPage() {
  const auth = useMjAuth();
  const [screen, setScreen] = useState<"home" | "create" | "join" | "room">("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [nameSource, setNameSource] = useState<NameSource | null>(null);
  const [nameReady, setNameReady] = useState(false);
  const [error, setError] = useState("");
  // 建房／加入成功的 join 回應（登入房有玩家 id 和座位頻道），交給牌桌
  const [joined, setJoined] = useState<MjJoinInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  // Room settings
  const [totalRounds, setTotalRounds] = useState(1);
  const [basePoints, setBasePoints] = useState(100);
  const [fanPoints, setFanPoints] = useState(20);

  // Check hash on load
  useEffect(() => {
    const code = getRoomFromHash() ?? getRoomFromQuery();
    if (code) {
      setRoomCode(code);
      setScreen("room");
    }
    const stored = mjStorage().getItem("mj_name");
    if (stored) {
      setName(stored);
      setNameReady(true);
    }
    const src = mjStorage().getItem("mj_name_source");
    if (src === "line" || src === "manual") setNameSource(src);

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

  // 登入後暱稱帶入 LINE 名稱（自己改過就不覆寫；超過 8 字取前 8 字）
  const lineName = auth.user?.displayName ?? "";
  useEffect(() => {
    if (!lineName || mjStorage().getItem("mj_name_source") === "manual") return;
    const n = Array.from(lineName).slice(0, 8).join("");
    mjStorage().setItem("mj_name", n);
    mjStorage().setItem("mj_name_source", "line");
    setName(n);
    setNameSource("line");
  }, [lineName]);

  function editName(v: string) {
    setName(v);
    if (nameSource !== "manual") {
      setNameSource("manual");
      mjStorage().setItem("mj_name_source", "manual");
    }
  }

  // 401：登入失效 → 退回登入閘門（在房間裡就是「加入房間 XXXX」）；403：座位不是你的、或遊客／LINE 不同桌 → 回大廳
  const { expire } = auth;
  const handleAuthError = useCallback((status: 401 | 403, code?: string) => {
    if (status === 401) {
      expire();
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
  async function joinRoom(code: string): Promise<(MjJoinInfo & { ended?: boolean }) | null> {
    const res = await mjFetch("/api/mahjong/join", {
      method: "POST",
      body: JSON.stringify({ code, playerId: getMjId(), name: name.trim() }),
    });
    const data = await res.json();
    if (res.status === 401 || res.status === 403) {
      handleAuthError(res.status, data.error);
      return null;
    }
    // 410：這場已結束，進房後顯示總結算
    if (res.status === 410) return { roomId: "", ended: true };
    if (!res.ok) {
      setError(data.error || "加入房間失敗");
      return null;
    }
    return data as MjJoinInfo;
  }

  async function handleCreate() {
    if (isSubmitting) return; // prevent double-click
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    setIsSubmitting(true);
    setError("");
    mjStorage().setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      const res = await mjFetch("/api/mahjong/create", {
        method: "POST",
        body: JSON.stringify({ hostId: myId, totalRounds, basePoints, fanPoints }),
      });
      const data = await res.json();
      if (res.status === 401) {
        handleAuthError(401);
        return;
      }
      if (!res.ok) {
        setError(data.error || "建立房間失敗");
        return;
      }
      // 房主加入：要等回應拿座位頻道，開局發牌才收得到
      const info = await joinRoom(data.code);
      if (!info) return;
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

  async function handleJoin() {
    if (isSubmitting) return;
    if (!joinCode || joinCode.length !== 4) {
      setError("請輸入4位數房間碼");
      return;
    }
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    setIsSubmitting(true);
    setError("");
    mjStorage().setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const info = await joinRoom(joinCode);
      if (!info) return;
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

  // --- Home / Create / Join screens ---
  if (screen !== "room") {
    return (
      <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]">
        <PortraitHint label="返回首頁" onClick={goHome} />
        <AuthBar user={auth.user} onSignOut={auth.signOut} />
        {auth.pairedAs !== null && <PairedNotice name={auth.pairedAs} onOk={auth.dismissPairedAs} onNotMe={auth.signOut} />}
        <Brand />
        <div className={`mjl-col${screen === "create" ? " mjl-form" : ""}`}>
          {screen === "home" ? (
            <div className="mjl-col fade-in">
              <button
                onClick={() => {
                  setScreen("create");
                  setError("");
                }}
                className="mjl-btn primary"
              >
                建立房間
              </button>
              <button
                onClick={() => {
                  setScreen("join");
                  setError("");
                }}
                className="mjl-btn second"
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
              <button onClick={goHome} className="mjl-foot">
                返回首頁
              </button>
            </div>
          ) : screen === "create" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <NameField value={name} onChange={editName} fromLine={nameSource === "line" && !auth.user.isGuest} />

              {/* 房間設定 */}
              <div className="flex flex-col gap-3">

                {/* 圈數 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">圈數</span>
                    <span className="text-white/40 text-xs">每圈4局</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 4, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setTotalRounds(n)}
                        className={`py-2.5 rounded-xl text-base font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${totalRounds === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}圈
                      </button>
                    ))}
                  </div>
                </div>

                {/* 底 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">底</span>
                    <span className="text-white/40 text-xs">基本分</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[30, 50, 100, 200, 300, 500, 600, 1000].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBasePoints(n)}
                        className={`py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${basePoints === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 每台 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">每台</span>
                    <span className="text-white/40 text-xs">台數加成</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[10, 20, 30, 50, 100, 200].map((n) => (
                      <button
                        key={n}
                        onClick={() => setFanPoints(n)}
                        className={`py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${fanPoints === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 結算公式預覽 */}
                <div className="rounded-xl px-4 py-3 flex items-center justify-center gap-2"
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    border: "1px dashed rgba(201,169,110,0.2)",
                  }}>
                  <span className="text-white/40 text-xs">每局</span>
                  <span className="text-[#C9A96E] font-bold text-sm">{basePoints}</span>
                  <span className="text-white/30 text-xs">+</span>
                  <span className="text-white/60 text-xs">台數</span>
                  <span className="text-white/30 text-xs">×</span>
                  <span className="text-[#C9A96E] font-bold text-sm">{fanPoints}</span>
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={isSubmitting}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110 disabled:opacity-60 disabled:cursor-wait"
              >
                {isSubmitting ? "建立中..." : "建立房間"}
              </button>
              <button
                onClick={() => {
                  setScreen("home");
                  setError("");
                }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
              >
                返回
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="房間碼 (4位數)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center" })}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl
                           tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal
                           placeholder:text-base outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />
              <NameField value={name} onChange={editName} fromLine={nameSource === "line" && !auth.user.isGuest} />
              <button
                onClick={handleJoin}
                disabled={isSubmitting}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110 disabled:opacity-60 disabled:cursor-wait"
              >
                {isSubmitting ? "加入中..." : "加入遊戲"}
              </button>
              <button
                onClick={() => {
                  setScreen("home");
                  setError("");
                }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
              >
                返回
              </button>
            </div>
          )}

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
      nameFromLine={nameSource === "line" && !auth.user.isGuest}
      initialJoin={joined}
      onSetName={(n) => {
        setName(n);
        setNameReady(true);
        mjStorage().setItem("mj_name", n);
      }}
      onNameEdited={() => {
        if (nameSource !== "manual") {
          setNameSource("manual");
          mjStorage().setItem("mj_name_source", "manual");
        }
      }}
      onAuthError={handleAuthError}
      onGoHome={goHome}
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
  nameFromLine,
  initialJoin,
  onSetName,
  onNameEdited,
  onAuthError,
  onGoHome,
}: {
  code: string;
  playerName: string;
  nameReady: boolean;
  nameFromLine: boolean;
  initialJoin: MjJoinInfo | null;
  onSetName: (n: string) => void;
  onNameEdited: () => void;
  onAuthError: (status: 401 | 403, code?: string) => void;
  onGoHome: () => void;
}) {
  // 還沒改過字就顯示頁面的暱稱（登入後才帶入的 LINE 名稱也會跟上）
  const [editedName, setEditedName] = useState<string | null>(null);
  const localName = editedName ?? playerName;

  const {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    nextGame,
    requestLeave,
    voteLeave,
    drawTile,
    discardTile,
    doAction,
    applyJoin,
    closed,
    markClosed,
  } = useMahjong(code, nameReady ? playerName : "", onAuthError);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const isMobileLandscape = useMobileLandscape();

  // Detect win type for celebration overlay
  const isZimoWin =
    state.winner != null &&
    state.winner.seat >= 0 &&
    state.winner.score.fans.some((f) => f.name.includes("自摸"));
  const isRonWin =
    state.winner != null &&
    state.winner.seat >= 0 &&
    !isZimoWin;
  // 八仙過海／七搶一：花牌立刻胡，沒有自摸或放槍
  const flowerWinName = state.winner?.score.fans.find((f) => FLOWER_WIN_NAMES.includes(f.name))?.name;

  // Celebration overlay (shown briefly on all players' screens)
  const [celebrationMode, setCelebrationMode] = useState<"zimo" | "ron" | null>(null);
  const lastWinnerSeatRef = useRef<number | null>(null);
  useEffect(() => {
    const w = state.winner;
    if (!w || w.seat < 0) {
      lastWinnerSeatRef.current = null;
      return;
    }
    if (lastWinnerSeatRef.current === w.seat) return;
    lastWinnerSeatRef.current = w.seat;
    if (isZimoWin) {
      setCelebrationMode("zimo");
      const t = setTimeout(() => setCelebrationMode(null), 3500);
      return () => clearTimeout(t);
    }
    if (isRonWin) {
      setCelebrationMode("ron");
      const t = setTimeout(() => setCelebrationMode(null), 2000);
      return () => clearTimeout(t);
    }
  }, [state.winner, isZimoWin, isRonWin]);

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
          else if (res.status === 401 || res.status === 403) onAuthError(res.status, data.error);
          else if (data.roomId) applyJoin(data as MjJoinInfo);
        })
        .catch((err) => console.error("[mj] auto-join failed:", err));
    }
  }, [nameReady, playerName, code, initialJoin, applyJoin, markClosed, onAuthError]);

  // Vibrate on my turn
  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current && state.status === "playing") {
      try {
        navigator.vibrate?.(200);
      } catch {}
    }
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, state.status]);

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

  // Name input (when joining via hash)
  if (!nameReady) {
    return (
      <div className="mjl flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <PortraitHint label="返回首頁" onClick={onGoHome} />
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-[#f0d68a] font-heading">加入房間 {code}</h2>
          <NameField
            value={localName}
            onChange={(v) => {
              setEditedName(v);
              onNameEdited();
            }}
            fromLine={nameFromLine}
          />
          <button
            onClick={() => {
              if (localName.trim()) onSetName(localName.trim());
            }}
            className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                       cursor-pointer active:scale-95 transition-all duration-150"
          >
            加入
          </button>
        </div>
      </div>
    );
  }

  // Lobby (waiting for players)
  if (state.status === "waiting") {
    const isFull = state.players.length >= 4;
    const isInRoom = state.players.some((p) => p.id === state.myId);
    const roomFull = isFull && !isInRoom;

    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <PortraitHint label="返回首頁" onClick={onGoHome} />
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#f0d68a] font-heading">等待玩家加入</h2>

          {roomFull && (
            <div className="w-full rounded-2xl bg-red-500/20 border border-red-500/30 p-4 text-center fade-in">
              <p className="text-red-400 font-bold text-lg">房間已滿</p>
              <p className="text-red-300/70 text-sm mt-1">此房間已有 4 位玩家</p>
            </div>
          )}

          {/* Room code */}
          <div className="bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="text-4xl font-bold text-[#C9A96E] tracking-[0.3em] font-heading">{code}</p>
            <button
              onClick={() => {
                const base = window.location.origin + "/mahjong";
                // 遊客的房間只有遊客能進：連結帶 ?guest=1，別的分頁打開就是遊客登入
                navigator.clipboard?.writeText(`${base}${isGuestTab() ? "?guest=1" : ""}#room=${code}`);
              }}
              className="mt-2 text-xs text-white/40 cursor-pointer active:text-[#C9A96E] hover:text-white/60 transition-colors"
            >
              點擊複製連結
            </button>
          </div>

          {/* Room settings display */}
          {state.roomSettings && (
            <div className="bg-white/5 rounded-xl px-4 py-2.5 w-full">
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-white/40">{state.roomSettings.totalRounds}圈</span>
                <span className="text-white/40">底{state.roomSettings.basePoints}</span>
                <span className="text-white/40">台{state.roomSettings.fanPoints}</span>
              </div>
            </div>
          )}

          {/* Player seats */}
          <div className="grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              return (
                <div
                  key={seat}
                  className={`rounded-xl p-4 text-center transition-all duration-300 ${
                    player
                      ? "bg-[#C9A96E]/20 border border-[#C9A96E]/30"
                      : "bg-white/5 border border-white/10"
                  }`}
                >
                  <p className="text-xs text-white/40 mb-1">
                    座位 {seat + 1}
                  </p>
                  {player ? (
                    <p className="font-bold text-[#f0d68a]">
                      {player.name}
                      {player.id === state.myId && " (你)"}
                      {player.id === state.hostId && " *"}
                    </p>
                  ) : (
                    <p className="text-white/20">等待中...</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Start button */}
          {isHost ? (
            <button
              onClick={startGame}
              disabled={state.players.length !== 4}
              className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                         cursor-pointer active:scale-95 transition-all duration-150
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {state.players.length === 4
                ? "開始遊戲"
                : `等待玩家 (${state.players.length}/4)`}
            </button>
          ) : (
            <div className="w-full py-4 rounded-2xl bg-white/10 text-center">
              <p className="text-white/50 font-medium">
                {state.players.length === 4
                  ? "等待房主開始遊戲"
                  : `等待玩家 (${state.players.length}/4)`}
              </p>
            </div>
          )}

          <button
            onClick={onGoHome}
            className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
          >
            返回首頁
          </button>
        </div>
      </div>
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

  const boardProps = {
    players: state.players,
    mySeat: state.mySeat,
    myHand: state.myHand,
    currentTurn: state.currentTurn,
    dealerSeat: state.dealerSeat,
    lastDiscard: state.lastDiscard,
    availableActions: state.availableActions,
    pendingAddKong: state.pendingAddKong,
    robKong: state.robKong,
    pendingFlowerRob: state.pendingFlowerRob,
    robFlower: state.robFlower,
    tingSeats: state.tingSeats,
    eyeSeats: state.eyeSeats,
    eyeOptions: state.eyeOptions,
    eyeWithTing: state.eyeWithTing,
    opponentHands: state.opponentHands,
    declareFx: state.declareFx,
    wallRemaining: state.wallRemaining,
    hasDrawn: state.hasDrawn,
    needsDraw,
    needsDiscard,
    isMyTurn,
    playerName,
    drawnTileId: state.drawnTileId,
    actionNotice: state.actionNotice,
    onDraw: drawTile,
    onDiscard: discardTile,
    onAction: doAction,
    dice: state.dice,
    doorSeat: state.doorSeat,
    playerScores: state.playerScores,
    dealerConsecutive: state.roundInfo?.dealerConsecutive,
  };

  return (
    <div className="flex flex-col flex-1 h-dvh max-h-dvh overflow-hidden bg-[#0f2a1a] relative">
      {/* 手機直向：蓋轉向提示（牌桌照常掛著，連線不中斷） */}
      <PortraitHint label="離開房間" onClick={handleLeave} />

      {isMobileLandscape ? (
        <MjBoardMobile
          {...boardProps}
          roomCode={code}
          roundLabel={roundLabel}
          basePoints={state.roomSettings?.basePoints}
          fanPoints={state.roomSettings?.fanPoints}
          onLeave={handleLeave}
        />
      ) : (
      <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <button
          onClick={handleLeave}
          className="text-sm text-white/60 cursor-pointer active:text-[#f0d68a]"
        >
          離開
        </button>
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
        <div className="w-10" />
      </div>

      <MjBoard {...boardProps} />
      </>
      )}

      {/* Leave confirmation modal (requester side) */}
      {showLeaveConfirm && !state.leaveRequest && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-[60] px-4">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-[#f0d68a] font-bold text-lg text-center mb-2">離開房間？</h3>
            <p className="text-white/60 text-sm text-center mb-4">
              牌局尚未結束，需要其他 3 位玩家同意你才能離開。
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
            <p className="text-white/40 text-xs text-center mb-4">
              已同意: {state.leaveRequest.approvedCount ?? 0} / 3
            </p>
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
              <p className="text-white/60 text-sm mb-1">
                已同意: {state.leaveRequest.approvedCount ?? 0} / 3
              </p>
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

      {/* Celebration overlay — shown briefly on all 4 screens before settlement */}
      {celebrationMode && state.winner && state.winner.seat >= 0 && (
        <div
          className="absolute inset-0 z-[65] flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            background:
              celebrationMode === "zimo"
                ? "rgba(0,0,0,0.88)"
                : "rgba(0,0,0,0.82)",
            animation: `mj-win-flash ${celebrationMode === "zimo" ? 3500 : 2000}ms ease-out both`,
          }}
        >
          {/* Soft circular glow, sized larger than viewport so no rectangular
              edge artifact appears even at extreme aspect ratios. */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: "220vmax",
              height: "220vmax",
              background:
                celebrationMode === "zimo"
                  ? "radial-gradient(circle, rgba(255,215,0,0.55) 0%, rgba(255,165,0,0.25) 18%, rgba(255,100,0,0.08) 30%, transparent 45%)"
                  : "radial-gradient(circle, rgba(201,169,110,0.4) 0%, rgba(201,169,110,0.12) 20%, transparent 40%)",
            }}
          />
          {/* Radiating rays (zimo only) — on a circular element with feathered
              mask so the rays fade to nothing before hitting any edge. */}
          {celebrationMode === "zimo" && (
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: "200vmax",
                height: "200vmax",
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(255,215,0,0.35) 15deg, transparent 30deg, transparent 45deg, rgba(255,215,0,0.35) 60deg, transparent 75deg, transparent 90deg, rgba(255,215,0,0.35) 105deg, transparent 120deg, transparent 135deg, rgba(255,215,0,0.35) 150deg, transparent 165deg, transparent 180deg, rgba(255,215,0,0.35) 195deg, transparent 210deg, transparent 225deg, rgba(255,215,0,0.35) 240deg, transparent 255deg, transparent 270deg, rgba(255,215,0,0.35) 285deg, transparent 300deg, transparent 315deg, rgba(255,215,0,0.35) 330deg, transparent 345deg)",
                WebkitMaskImage:
                  "radial-gradient(circle, black 0%, black 14%, transparent 28%)",
                maskImage:
                  "radial-gradient(circle, black 0%, black 14%, transparent 28%)",
                animation: "mj-win-rotate 3500ms linear",
              }}
            />
          )}
          {/* Sparkles (zimo only) */}
          {celebrationMode === "zimo" &&
            Array.from({ length: 24 }).map((_, i) => {
              const angle = (i * 15 * Math.PI) / 180;
              const dist = 40 + (i % 5) * 10;
              const tx = Math.cos(angle) * dist;
              const ty = Math.sin(angle) * dist;
              return (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background:
                      i % 3 === 0 ? "#fbbf24" : i % 3 === 1 ? "#fde68a" : "#FFD700",
                    boxShadow: "0 0 20px rgba(255,215,0,1)",
                    animation: `mj-sparkle 1800ms ease-out ${i * 50}ms infinite`,
                    transform: `translate(${tx}vw, ${ty}vh)`,
                  }}
                />
              );
            })}
          {/* Main text */}
          <div
            className="relative text-center"
            style={{ animation: "mj-win-zoom 1200ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both" }}
          >
            <p
              className={`font-black tracking-[0.3em] leading-none ${
                celebrationMode === "zimo" ? "text-[14vw]" : "text-[9vw]"
              }`}
              style={{
                color: celebrationMode === "zimo" ? "#fff8dc" : "#fde68a",
                textShadow:
                  celebrationMode === "zimo"
                    ? "0 0 50px #FFD700, 0 0 100px #FFA500, 0 0 150px #FF6347, 0 4px 12px rgba(0,0,0,0.6)"
                    : "0 0 30px rgba(201,169,110,0.9), 0 0 60px rgba(201,169,110,0.5), 0 3px 8px rgba(0,0,0,0.5)",
                fontFamily: "serif",
              }}
            >
              {flowerWinName ?? (celebrationMode === "zimo" ? "自摸" : "胡")}
            </p>
            <p
              className="mt-4 text-2xl font-bold"
              style={{
                color: celebrationMode === "zimo" ? "#f0d68a" : "#e8c97a",
                textShadow: "0 0 20px rgba(240,214,138,0.7)",
                animation: "mj-win-fade-in 800ms ease-out 400ms both",
              }}
            >
              {state.winner.name}
            </p>
            <p
              className="mt-1 text-sm font-bold tracking-wider"
              style={{
                color: "#fde68a",
                animation: "mj-win-fade-in 800ms ease-out 700ms both",
              }}
            >
              共 {state.winner.score.totalFan} 台
            </p>
          </div>
          <style jsx>{`
            @keyframes mj-win-flash {
              0% { opacity: 0; }
              10% { opacity: 1; }
              85% { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes mj-win-rotate {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            @keyframes mj-win-zoom {
              0% { transform: scale(0) rotate(-15deg); opacity: 0; }
              60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
              100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes mj-sparkle {
              0% { transform: translate(0, 0) scale(0); opacity: 0; }
              30% { opacity: 1; }
              100% { transform: translate(var(--tx, 20vw), var(--ty, -20vh)) scale(1.5); opacity: 0; }
            }
            @keyframes mj-win-fade-in {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* 結算浮層：桌機和手機橫向同一個樣式（老闆選定手機版），桌機只是放大 */}
      {isFinished && state.winner && (
        <MjResultMobile
          desktop={!isMobileLandscape}
          tingSeats={state.tingSeats}
          eyeSeats={state.eyeSeats}
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
