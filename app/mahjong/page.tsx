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
import MjFlowerFx from "@/components/mahjong/MjFlowerFx";
import MjTile from "@/components/mahjong/MjTile";
import type { Tile } from "@/lib/mahjong/tiles";
import RoomClosed from "@/components/RoomClosed";
import { closedFromResponse } from "@/hooks/roomClosed";
import MjGameOver from "@/components/mahjong/MjGameOver";
import MjFx from "@/components/mahjong/MjFx";
import { bigWinPlayed } from "@/lib/mahjong/bigWin";
import { preloadMeteorFx } from "@/components/mahjong/MeteorFx";
import { setBgWarmPaused } from "@/components/mahjong/FxBgWarm";
import { useWinShow, WinShowLayer } from "@/hooks/useWinShow";
import MjChat, { MjChatButton } from "@/components/mahjong/MjChat";
import { useTableSounds } from "@/hooks/useTableSounds";
import MjPrefsPanel from "@/components/mahjong/MjPrefsPanel";
import MjTableMenu from "@/components/mahjong/MjTableMenu";
import { SpectateManage, SpectateRequestCard, useSpectateManage } from "@/components/mahjong/spectate/SpectateHost";
import { bindPrefsAccount } from "@/lib/mahjong/prefs";

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
  // 偏好設定跟著登入的人：LINE 帳號用帳號的、訪客和沒登入用這台的；換帳號、登出就換主人（不沿用上一個帳號的顏色）
  const prefsUserId = auth.status === "in" ? auth.user?.id ?? null : null;
  const prefsGuest = !!auth.user?.isGuest;
  useEffect(() => {
    if (auth.status === "checking") return; // 還不知道是誰：先用這台的
    bindPrefsAccount(prefsUserId ? { id: prefsUserId, isGuest: prefsGuest } : null);
  }, [auth.status, prefsUserId, prefsGuest]);
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

  async function handleResume(code: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    const nm = name.trim() || Array.from(lineName).slice(0, 8).join("") || "玩家";
    mjStorage().setItem("mj_name", nm);
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
      <div className={`mjl mjl-lobby flex-1 bg-[#0f2a1a]${screen === "create" ? " is-create" : ""}`}>
        <PortraitHint label="返回首頁" onClick={goHome} />
        <AuthBar user={auth.user} onSignOut={auth.signOut} />
        <MjPrefsPanel />
        {auth.pairedAs !== null && <PairedNotice name={auth.pairedAs} onOk={auth.dismissPairedAs} onNotMe={auth.signOut} />}
        <Brand />
        <div className={`mjl-col${screen === "create" ? " mjl-form" : ""}`}>
          {screen === "home" ? (
            <div className="mjl-col fade-in">
              {myRoom && (
                <button onClick={() => handleResume(myRoom.code)} disabled={isSubmitting} className="mjl-btn resume">
                  {myRoom.status === "waiting" ? "你在房間等開局，" : "你有一局還沒打完，"}
                  <b>回到房間 {myRoom.code}</b>
                </button>
              )}
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
            <div className="mjl-create flex flex-col gap-4 w-full fade-in">
              <NameField value={name} onChange={editName} fromLine={nameSource === "line" && !auth.user.isGuest} />

              {/* 房間設定（手機橫向：左欄圈數＋底、右欄每台＋公式；桌機 mjl-cset 不影響排版，照舊一欄） */}
              <div className="mjl-cgrid flex flex-col gap-3">
                <div className="mjl-cset">

                {/* 圈數 Card */}
                <div className="mjl-card rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">圈數</span>
                    <span className="mjl-sub text-white/40 text-xs">每圈4局</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 4, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setTotalRounds(n)}
                        className={`mjl-opt py-2.5 rounded-xl text-base font-bold cursor-pointer transition-all duration-150 active:scale-95
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
                <div className="mjl-card rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">底</span>
                    <span className="mjl-sub text-white/40 text-xs">基本分</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[30, 50, 100, 200, 300, 500, 600, 1000].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBasePoints(n)}
                        className={`mjl-opt py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
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

                </div>

                <div className="mjl-cset">
                {/* 每台 Card */}
                <div className="mjl-card rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">每台</span>
                    <span className="mjl-sub text-white/40 text-xs">台數加成</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[10, 20, 30, 50, 100, 200].map((n) => (
                      <button
                        key={n}
                        onClick={() => setFanPoints(n)}
                        className={`mjl-opt py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
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
                <div className="mjl-formula rounded-xl px-4 py-3 flex items-center justify-center gap-2"
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
              </div>

              <button
                onClick={handleCreate}
                disabled={isSubmitting}
                className="mjl-go w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
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
                className="mjl-back text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
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
      accountId={auth.user.id}
      guest={!!auth.user.isGuest}
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
  nameFromLine,
  initialJoin,
  onSetName,
  onNameEdited,
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
  nameFromLine: boolean;
  initialJoin: MjJoinInfo | null;
  onSetName: (n: string) => void;
  onNameEdited: () => void;
  onAuthError: (status: 401 | 403, code?: string) => void;
  onGoHome: () => void;
  /** 等人時退出房間成功（回麻將大廳） */
  onLeft: () => void;
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
    leaveWaiting,
    roomId,
  } = useMahjong(code, nameReady ? playerName : "", onAuthError);

  // 等人時「退出房間」（老闆 2026-10-24）：伺服器真的把你移出房間、空出座位，才回大廳；失敗留在原畫面並提示
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const leaveRoom = async () => {
    if (leaving) return;
    setLeaving(true);
    setLeaveError("");
    const err = await leaveWaiting();
    setLeaving(false);
    if (err) setLeaveError(err);
    else onLeft();
  };

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showSpectateManage, setShowSpectateManage] = useState(false);
  // 觀戰（老馬 2026-10-30）：牌局進行中、我有座位、房間還開著才收申請、管觀戰；遊客房也照樣收（觀戰者一定是 LINE 登入，伺服器檢查）
  const spectateActive = !!roomId && state.status === "playing" && state.mySeat >= 0 && !closed;
  const spectateManage = useSpectateManage(roomId, state.myId, state.spectateTick, spectateActive);
  const isMobileLandscape = useMobileLandscape();

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
  useEffect(() => { if (meteorInRoom) void preloadMeteorFx(); }, [meteorInRoom]);


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
      <div className="mjl mjl-wait-page flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <PortraitHint label="退出房間" onClick={leaveRoom} />
        {/* 手機橫向：左欄房間碼、底台、退出；右欄四個座位和開始鈕（.mjw 的 grid，桌機照舊一欄） */}
        <div className="mjw flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="mjw-ttl text-xl font-bold text-[#f0d68a] font-heading">等待玩家加入</h2>

          {roomFull && (
            <div className="mjw-full w-full rounded-2xl bg-red-500/20 border border-red-500/30 p-4 text-center fade-in">
              <p className="text-red-400 font-bold text-lg">房間已滿</p>
              <p className="text-red-300/70 text-sm mt-1">此房間已有 4 位玩家</p>
            </div>
          )}

          {/* Room code */}
          <div className="mjw-code bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="mjw-num text-4xl font-bold text-[#C9A96E] tracking-[0.3em] font-heading">{code}</p>
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
            <div className="mjw-set bg-white/5 rounded-xl px-4 py-2.5 w-full">
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-white/40">{state.roomSettings.totalRounds}圈</span>
                <span className="text-white/40">底{state.roomSettings.basePoints}</span>
                <span className="text-white/40">台{state.roomSettings.fanPoints}</span>
              </div>
            </div>
          )}

          {/* Player seats */}
          <div className="mjw-seats grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              return (
                <div
                  key={seat}
                  className={`mjw-seat rounded-xl p-4 text-center transition-all duration-300 ${
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
              className="mjw-start w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                         cursor-pointer active:scale-95 transition-all duration-150
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {state.players.length === 4
                ? "開始遊戲"
                : `等待玩家 (${state.players.length}/4)`}
            </button>
          ) : (
            <div className="mjw-start w-full py-4 rounded-2xl bg-white/10 text-center">
              <p className="text-white/50 font-medium">
                {state.players.length === 4
                  ? "等待房主開始遊戲"
                  : `等待玩家 (${state.players.length}/4)`}
              </p>
            </div>
          )}

          <div className="mjw-back w-full flex flex-col items-center gap-1">
            <button
              onClick={leaveRoom}
              disabled={leaving}
              data-mj-leave
              className="w-full py-2.5 rounded-2xl border border-[#C9A96E]/40 text-[#f0d68a] text-sm font-bold
                         cursor-pointer active:scale-95 hover:bg-white/5 transition-all duration-150 disabled:opacity-50"
            >
              {leaving ? "退出中…" : "退出房間"}
            </button>
            {leaveError && <p className="text-red-300 text-xs text-center" role="alert">{leaveError}</p>}
          </div>
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

  // 打字聊天與語音訊息：LINE 登入、已入座才能發；輪到自己、可以吃碰槓胡時底板收起
  const chatCanSend = !guest && state.mySeat >= 0;
  const chatButton = <MjChatButton canSend={chatCanSend} desk={!isMobileLandscape} />;
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
    opponentHands: state.opponentHands,
    declareFx: state.declareFx,
    wallRemaining: state.wallRemaining,
    hasDrawn: state.hasDrawn,
    needsDraw,
    needsDiscard,
    isMyTurn,
    playerName,
    drawnTileId: state.drawnTileId,
    slowDraw: state.slowDraw,
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
        <MjBoardMobile
          {...boardProps}
          roomCode={code}
          roundLabel={roundLabel}
          basePoints={state.roomSettings?.basePoints}
          fanPoints={state.roomSettings?.fanPoints}
          onLeave={handleLeave}
          spectateMenu={spectateMenu}
        />
      ) : (
      <>
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
      </>
      )}

      {/* 補花特效：掛在 body，貼著補花那一家的名牌（桌機、手機共用） */}
      <MjFlowerFx fx={state.flowerFx} mySeat={state.mySeat} desk={!isMobileLandscape} />

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
