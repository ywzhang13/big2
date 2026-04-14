"use client";

import { useState, useEffect, useRef } from "react";
import { useMahjong, getMjId } from "@/hooks/useMahjong";
import MjBoard from "@/components/mahjong/MjBoard";
import MjGameOver from "@/components/mahjong/MjGameOver";
import MjTile from "@/components/mahjong/MjTile";

// Read room code from URL hash: #room=XXXX
function getRoomFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/^#room=(\d{4})$/);
  return match ? match[1] : null;
}

export default function MahjongPage() {
  const [screen, setScreen] = useState<"home" | "create" | "join" | "room">("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [nameReady, setNameReady] = useState(false);
  const [error, setError] = useState("");
  const [createdRoomId, setCreatedRoomId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Room settings
  const [totalRounds, setTotalRounds] = useState(1);
  const [basePoints, setBasePoints] = useState(100);
  const [fanPoints, setFanPoints] = useState(20);

  // Check hash on load
  useEffect(() => {
    const code = getRoomFromHash();
    if (code) {
      setRoomCode(code);
      setScreen("room");
    }
    const stored = localStorage.getItem("mj_name");
    if (stored) {
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

  async function handleCreate() {
    if (isSubmitting) return; // prevent double-click
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    setIsSubmitting(true);
    setError("");
    localStorage.setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      // Create room and join in parallel-safe sequence
      const res = await fetch("/api/mahjong/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: myId, totalRounds, basePoints, fanPoints }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "建立房間失敗");
        return;
      }
      // Host auto-joins (fire and forget — join is idempotent, can also happen on room enter)
      fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.code, playerId: myId, name: name.trim() }),
      }).catch(() => {});
      setRoomCode(data.code);
      setCreatedRoomId(data.roomId);
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
    localStorage.setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      const res = await fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode, playerId: myId, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "加入房間失敗");
        return;
      }
      setRoomCode(joinCode);
      setCreatedRoomId(data.roomId);
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

  // --- Home / Create / Join screens ---
  if (screen !== "room") {
    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-2">
              {[{t:"中",c:"#dc2626"},{t:"發",c:"#15803d"},{t:"",c:""}].map((x,i)=>(
                <div key={i} className="w-10 h-14 rounded-md flex items-center justify-center"
                  style={{background:"linear-gradient(145deg, #f5f0e0 0%, #e8dfc8 50%, #d4c9a8 100%)",boxShadow:"2px 3px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.8)",border:"1px solid rgba(180,170,140,0.6)"}}>
                  {x.t ? <span className="text-xl font-black" style={{color:x.c,fontFamily:"serif"}}>{x.t}</span>
                    : <div className="w-6 h-8 rounded-sm" style={{border:"2.5px solid #1a1a1a"}} />}
                </div>
              ))}
            </div>
            <h1 className="text-5xl font-bold tracking-wider text-[#f0d68a] font-heading">
              台灣麻將
            </h1>
            <p className="text-white/50 mt-2 text-sm">Taiwan Mahjong — 4 Players</p>
          </div>

          {screen === "home" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <button
                onClick={() => {
                  setScreen("create");
                  setError("");
                }}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                建立房間
              </button>
              <button
                onClick={() => {
                  setScreen("join");
                  setError("");
                }}
                className="w-full py-4 rounded-2xl border-2 border-[#C9A96E]/60 text-[#f0d68a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:border-[#C9A96E] hover:bg-[#C9A96E]/5"
              >
                加入房間
              </button>
              <button
                onClick={goHome}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors mt-2"
              >
                返回首頁
              </button>
            </div>
          ) : screen === "create" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input
                type="text"
                maxLength={8}
                placeholder="你的暱稱"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                           placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />

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
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl
                           tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal
                           placeholder:text-base outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />
              <input
                type="text"
                maxLength={8}
                placeholder="你的暱稱"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                           placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />
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
      </div>
    );
  }

  // --- Room ---
  return (
    <RoomView
      code={roomCode}
      playerName={name}
      nameReady={nameReady}
      initialRoomId={createdRoomId}
      onSetName={(n) => {
        setName(n);
        setNameReady(true);
        localStorage.setItem("mj_name", n);
      }}
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
  initialRoomId,
  onSetName,
  onGoHome,
}: {
  code: string;
  playerName: string;
  nameReady: boolean;
  initialRoomId: string;
  onSetName: (n: string) => void;
  onGoHome: () => void;
}) {
  const [localName, setLocalName] = useState(playerName);

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
    setRoomId,
  } = useMahjong(code, nameReady ? playerName : "");

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // When leave request is granted, all 4 players auto-return to lobby
  useEffect(() => {
    if (state.leaveResult === "granted") {
      const t = setTimeout(() => onGoHome(), 800);
      return () => clearTimeout(t);
    }
  }, [state.leaveResult, onGoHome]);

  // Detect win type for celebration overlay
  const isZimoWin =
    state.winner != null &&
    state.winner.seat >= 0 &&
    state.winner.score.fans.some((f) => f.name.includes("自摸"));
  const isRonWin =
    state.winner != null &&
    state.winner.seat >= 0 &&
    !isZimoWin;

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

  // Pass roomId from create/join to the hook
  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
  }, [initialRoomId, setRoomId]);

  // When joining via hash link (no initialRoomId), call join API
  useEffect(() => {
    if (nameReady && playerName && code && !initialRoomId) {
      const pid = getMjId();
      fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: pid, name: playerName }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.roomId) setRoomId(data.roomId);
        })
        .catch((err) => console.error("[mj] auto-join failed:", err));
    }
  }, [nameReady, playerName, code, initialRoomId, setRoomId]);

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

  // Name input (when joining via hash)
  if (!nameReady) {
    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-[#f0d68a] font-heading">加入房間 {code}</h2>
          <input
            type="text"
            maxLength={8}
            placeholder="你的暱稱"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                       placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
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
                navigator.clipboard?.writeText(`${base}#room=${code}`);
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
              const windChar = ["東", "南", "西", "北"][seat];
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
                    {windChar}風 · 座位 {seat + 1}
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

  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <button
          onClick={() => {
            // Mid-session (game active or finished-but-not-all-rounds-done) needs consent
            const inSession =
              state.status === "playing" ||
              (state.status === "finished" && state.roomSettings && !state.gameOver);
            if (inSession) {
              setShowLeaveConfirm(true);
            } else {
              onGoHome();
            }
          }}
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

      <MjBoard
        players={state.players}
        mySeat={state.mySeat}
        myHand={state.myHand}
        currentTurn={state.currentTurn}
        dealerSeat={state.dealerSeat}
        lastDiscard={state.lastDiscard}
        availableActions={state.availableActions}
        wallRemaining={state.wallRemaining}
        hasDrawn={state.hasDrawn}
        needsDraw={needsDraw}
        needsDiscard={needsDiscard}
        isMyTurn={isMyTurn}
        playerName={playerName}
        drawnTileId={state.drawnTileId}
        actionNotice={state.actionNotice}
        onDraw={drawTile}
        onDiscard={discardTile}
        onAction={doAction}
        dice={state.dice}
        doorSeat={state.doorSeat}
        playerScores={state.playerScores}
      />

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

      {/* Leave granted — brief overlay before auto return to lobby */}
      {state.leaveResult === "granted" && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[70]">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-6 max-w-sm text-center">
            <p className="text-[#f0d68a] font-bold text-lg mb-1">遊戲結束</p>
            <p className="text-white/60 text-sm">玩家已離開，返回大廳...</p>
          </div>
        </div>
      )}
      {/* Celebration overlay — shown briefly on all 4 screens before settlement */}
      {celebrationMode && state.winner && state.winner.seat >= 0 && (
        <div
          className="absolute inset-0 z-[65] flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            background:
              celebrationMode === "zimo"
                ? "radial-gradient(ellipse at center, rgba(255,215,0,0.4) 0%, rgba(0,0,0,0.88) 72%)"
                : "radial-gradient(ellipse at center, rgba(201,169,110,0.28) 0%, rgba(0,0,0,0.82) 70%)",
            animation: `mj-win-flash ${celebrationMode === "zimo" ? 3500 : 2000}ms ease-out both`,
          }}
        >
          {/* Radiating rays (zimo only, fancier) */}
          {celebrationMode === "zimo" && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,215,0,0.3) 15deg, transparent 30deg, transparent 45deg, rgba(255,215,0,0.3) 60deg, transparent 75deg, transparent 90deg, rgba(255,215,0,0.3) 105deg, transparent 120deg, transparent 135deg, rgba(255,215,0,0.3) 150deg, transparent 165deg, transparent 180deg, rgba(255,215,0,0.3) 195deg, transparent 210deg, transparent 225deg, rgba(255,215,0,0.3) 240deg, transparent 255deg, transparent 270deg, rgba(255,215,0,0.3) 285deg, transparent 300deg, transparent 315deg, rgba(255,215,0,0.3) 330deg, transparent 345deg, transparent 360deg)",
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
              {celebrationMode === "zimo" ? "自摸" : "胡"}
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

      {/* Game over overlay — stays on the board */}
      {isFinished && state.winner && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div
            className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl max-w-md w-full shadow-2xl flex flex-col"
            style={{ maxHeight: "92vh" }}
          >
          {/* Scrollable content */}
          <div className="mj-scroll overflow-y-auto p-5 flex-1">
            <style jsx>{`
              .mj-scroll {
                scrollbar-width: thin;
                scrollbar-color: rgba(201, 169, 110, 0.35) transparent;
              }
              .mj-scroll::-webkit-scrollbar {
                width: 6px;
              }
              .mj-scroll::-webkit-scrollbar-track {
                background: transparent;
                margin: 8px 0;
              }
              .mj-scroll::-webkit-scrollbar-thumb {
                background: linear-gradient(
                  180deg,
                  rgba(201, 169, 110, 0.55) 0%,
                  rgba(139, 105, 20, 0.55) 100%
                );
                border-radius: 4px;
                border: 1px solid rgba(201, 169, 110, 0.25);
              }
              .mj-scroll::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(
                  180deg,
                  rgba(240, 214, 138, 0.8) 0%,
                  rgba(201, 169, 110, 0.8) 100%
                );
              }
            `}</style>
            {state.winner.seat < 0 ? (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center text-2xl">
                  &#9940;
                </div>
                <h2 className="text-xl font-bold text-white/70">流局</h2>
                <p className="text-white/40 text-sm mt-1">牌牆摸完，無人胡牌</p>
              </div>
            ) : (
              <div className="text-center relative">
                {/* 自摸 glowing background animation */}
                {isZimoWin && (
                  <div
                    aria-hidden
                    className="absolute inset-0 -z-10 pointer-events-none"
                    style={{
                      background:
                        "radial-gradient(ellipse at center, rgba(255,215,0,0.35) 0%, rgba(255,165,0,0.15) 40%, transparent 75%)",
                      animation: "zimo-pulse 2s ease-in-out infinite",
                    }}
                  />
                )}
                <div
                  className="w-14 h-14 mx-auto mb-2 rounded-full flex items-center justify-center text-2xl"
                  style={{
                    background: isZimoWin
                      ? "radial-gradient(circle, #FFD700, #b8860b)"
                      : "radial-gradient(circle, #C9A96E, #8B6914)",
                    boxShadow: isZimoWin
                      ? "0 0 40px rgba(255,215,0,0.8), 0 0 80px rgba(255,165,0,0.4)"
                      : "0 0 20px rgba(201,169,110,0.4)",
                  }}
                >
                  胡
                </div>
                <h2
                  className="text-xl font-bold"
                  style={{
                    color: isZimoWin ? "#fff8dc" : "#f0d68a",
                    textShadow: isZimoWin
                      ? "0 0 20px #FFD700, 0 0 40px #FFA500"
                      : "none",
                  }}
                >
                  {state.winner.name} 胡牌！
                </h2>
                {/* 自摸 / 放槍 indicator with emphasis for 自摸 */}
                <p className={`mt-1 ${isZimoWin ? "text-xl font-black tracking-[0.4em]" : "text-sm"}`}>
                  {isZimoWin ? (
                    <span
                      style={{
                        color: "#fbbf24",
                        textShadow: "0 0 16px rgba(255,215,0,0.7)",
                      }}
                    >
                      自摸
                    </span>
                  ) : state.lastDiscard ? (
                    <span className="text-red-400">
                      {state.players.find((p) => p.seat === state.lastDiscard?.from)?.name} 放槍
                    </span>
                  ) : (
                    <span className="text-[#C9A96E]">自摸</span>
                  )}
                </p>
                <style jsx>{`
                  @keyframes zimo-pulse {
                    0%, 100% {
                      opacity: 0.6;
                      transform: scale(1);
                    }
                    50% {
                      opacity: 1;
                      transform: scale(1.1);
                    }
                  }
                `}</style>
                <p className="text-white/50 text-sm mt-1">
                  {state.winner.score.totalFan > 0 && (
                    <span>共 <span className="text-[#C9A96E] font-bold text-lg">{state.winner.score.totalFan}</span> 台</span>
                  )}
                </p>
              </div>
            )}

            {/* Combined: each player's hand + settlement delta + cumulative score */}
            {state.winner?.allHands && state.winner.allHands.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-white/40 text-xs font-bold tracking-wider text-center mb-2">各家結算</p>
                <div className="flex flex-col gap-1.5">
                  {state.winner.allHands
                    .sort((a, b) => a.seat - b.seat)
                    .map((h) => {
                      const delta = state.settlement?.deltas[h.seat] ?? 0;
                      const cumulative = state.playerScores?.[h.seat] ?? 0;
                      const isWin = state.winner!.seat === h.seat;
                      return (
                        <div
                          key={h.seat}
                          className={`rounded-lg p-2 ${
                            isWin
                              ? "bg-[#C9A96E]/15 border border-[#C9A96E]/30"
                              : "bg-white/5 border border-white/5"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[11px] text-white/70 font-bold">
                              {h.name}
                              {h.seat === state.mySeat && " (你)"}
                              {isWin && <span className="text-[#f0d68a] ml-1">胡</span>}
                            </span>
                            <div className="flex items-baseline gap-2">
                              {state.settlement && state.roomSettings && (
                                <span className={`text-sm font-bold ${
                                  delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-white/40"
                                }`}>
                                  {delta > 0 ? "+" : ""}{delta}
                                </span>
                              )}
                              {state.playerScores && state.roomSettings && (
                                <span className="text-[10px] text-white/40">
                                  總{cumulative >= 0 ? "+" : ""}{cumulative}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-[1px] items-end">
                            {h.hand.map((t) => (
                              <MjTile key={`h-${t.id}`} tile={t} tiny />
                            ))}
                            {h.revealed.length > 0 && (
                              <div className="ml-1 flex gap-1 items-end border-l border-white/10 pl-1">
                                {h.revealed.map((meld, mi) => (
                                  <div key={mi} className="flex gap-0">
                                    {meld.tiles.map((t) => (
                                      <MjTile
                                        key={`r-${mi}-${t.id}`}
                                        tile={t}
                                        tiny
                                        faceDown={meld.type === "concealed_kong"}
                                      />
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                            {h.flowers.length > 0 && (
                              <div className="ml-1 flex gap-[1px] items-end border-l border-white/10 pl-1">
                                {h.flowers.map((f) => (
                                  <MjTile key={`f-${f.id}`} tile={f} tiny />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
                {state.settlement && state.roomSettings && state.settlement.fanTotal > 0 && (
                  <p className="text-white/30 text-xs text-center mt-2">
                    底{state.roomSettings.basePoints} + {state.settlement.fanTotal}台 × {state.roomSettings.fanPoints} = {state.settlement.paymentPerPlayer}
                    {state.settlement.reason === "self_draw" ? " (×3)" : ""}
                  </p>
                )}
              </div>
            )}

            {/* Fan breakdown — below 各家結算 */}
            {state.winner && state.winner.seat >= 0 && state.winner.score.fans.length > 0 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-white/40 text-xs font-bold tracking-wider text-center mb-2">台數明細</p>
                {state.winner.score.fans.map((fan, i) => (
                  <div key={i} className="flex justify-between text-sm px-2 py-1">
                    <span className="text-white/70">{fan.name}</span>
                    <span className="text-[#C9A96E] font-bold">{fan.value} 台</span>
                  </div>
                ))}
              </div>
            )}

          </div>
          {/* Sticky bottom: Action buttons + Ready check (always visible) */}
          <div
            className="flex flex-col gap-3 p-4 border-t border-[#C9A96E]/20"
            style={{ background: "linear-gradient(180deg, rgba(26,20,8,0.7) 0%, rgba(26,20,8,1) 100%)" }}
          >
              {state.roomSettings && !state.gameOver && (
                <>
                  {/* Ready check — 4 player consent */}
                  <div className="rounded-xl bg-white/5 border border-[#C9A96E]/15 p-3">
                    <p className="text-[10px] text-white/40 text-center mb-2 font-bold tracking-wider">
                      四家同意後開始下一局 ({(state.nextGameReady?.length ?? 0)}/4)
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {state.players.map((p) => {
                        const isReady = state.nextGameReady?.includes(p.id) ?? false;
                        return (
                          <div
                            key={p.seat}
                            className={`text-center py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all ${
                              isReady
                                ? "bg-[#C9A96E]/30 text-[#f0d68a] border border-[#C9A96E]/50"
                                : "bg-white/5 text-white/40 border border-white/10"
                            }`}
                          >
                            <div>{isReady ? "✓" : "·"}</div>
                            <div className="truncate">{p.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* My ready button */}
                  {state.nextGameReady?.includes(state.myId) ? (
                    <div className="py-3 rounded-xl bg-white/10 text-center">
                      <p className="text-white/50 text-sm">已確認，等待其他玩家...</p>
                    </div>
                  ) : (
                    <button
                      onClick={nextGame}
                      className="py-3 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold
                        cursor-pointer active:scale-95 transition-all"
                    >
                      同意下一局
                    </button>
                  )}
                </>
              )}

              <button
                onClick={() => {
                  // When all rounds done OR solo lobby, leave directly.
                  // Mid-session (non-gameOver), require 3-player consent.
                  if (state.gameOver || !state.roomSettings) {
                    onGoHome();
                  } else {
                    setShowLeaveConfirm(true);
                  }
                }}
                className={`py-3 rounded-xl font-bold
                  cursor-pointer active:scale-95 transition-all
                  ${state.gameOver ? "bg-[#C9A96E] text-[#0f2a1a]" : "border border-white/15 text-white/60"}`}
              >
                {state.gameOver ? "結束 · 回大廳" : "回大廳（需同意）"}
              </button>
            </div>

            {/* Game over final standings — 總積分榜 */}
            {state.gameOver && state.playerScores && (
              <div
                className="mt-4 rounded-2xl p-4"
                style={{
                  background: "linear-gradient(145deg, rgba(201,169,110,0.15) 0%, rgba(201,169,110,0.03) 100%)",
                  border: "1.5px solid rgba(201,169,110,0.4)",
                  boxShadow: "0 4px 20px rgba(201,169,110,0.15)",
                }}
              >
                <div className="text-center mb-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full"
                    style={{ background: "rgba(201,169,110,0.2)" }}>
                    <span className="text-[#f0d68a] text-xs font-bold tracking-wider">
                      {state.roomSettings?.totalRounds}圈結束
                    </span>
                  </div>
                  <h2 className="text-xl font-bold mt-2" style={{
                    color: "#f0d68a",
                    textShadow: "0 0 20px rgba(240,214,138,0.4)",
                  }}>
                    總積分榜
                  </h2>
                </div>

                <div className="flex flex-col gap-1.5">
                  {[...state.players]
                    .sort((a, b) => (state.playerScores![b.seat]) - (state.playerScores![a.seat]))
                    .map((p, rank) => {
                      const score = state.playerScores![p.seat];
                      const rankColors = [
                        { bg: "linear-gradient(90deg, rgba(255,215,0,0.25) 0%, rgba(255,215,0,0.08) 100%)", border: "rgba(255,215,0,0.5)", label: "#FFD700", icon: "冠" },
                        { bg: "linear-gradient(90deg, rgba(192,192,192,0.2) 0%, rgba(192,192,192,0.05) 100%)", border: "rgba(192,192,192,0.45)", label: "#C0C0C0", icon: "亞" },
                        { bg: "linear-gradient(90deg, rgba(205,127,50,0.22) 0%, rgba(205,127,50,0.05) 100%)", border: "rgba(205,127,50,0.45)", label: "#CD7F32", icon: "季" },
                        { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", label: "#6b7280", icon: "殿" },
                      ];
                      const c = rankColors[rank] || rankColors[3];
                      return (
                        <div
                          key={p.seat}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                          style={{
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                          }}
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                            style={{
                              background: c.label,
                              color: rank < 3 ? "#1a1408" : "#fff",
                              boxShadow: rank === 0 ? "0 0 12px rgba(255,215,0,0.5)" : "none",
                            }}
                          >
                            {c.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">
                              {p.name}
                              {p.seat === state.mySeat && <span className="text-white/40 text-xs ml-1">(你)</span>}
                            </p>
                            <p className="text-[10px] text-white/40">
                              第 {rank + 1} 名
                            </p>
                          </div>
                          <span
                            className={`text-lg font-black ${
                              score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-white/50"
                            }`}
                          >
                            {score > 0 ? "+" : ""}{score}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
