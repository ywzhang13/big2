"use client";

import { useState, useEffect, useRef } from "react";
import { useMahjong, getMjId } from "@/hooks/useMahjong";
import MjBoard from "@/components/mahjong/MjBoard";
import MjGameOver from "@/components/mahjong/MjGameOver";

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
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    localStorage.setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      const res = await fetch("/api/mahjong/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: myId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "建立房間失敗");
        return;
      }
      // Host also joins
      await fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.code, playerId: myId, name: name.trim() }),
      });
      setRoomCode(data.code);
      setCreatedRoomId(data.roomId);
      setScreen("room");
      window.location.hash = `room=${data.code}`;
    } catch {
      setError("網路錯誤，請重試");
    }
  }

  async function handleJoin() {
    if (!joinCode || joinCode.length !== 4) {
      setError("請輸入4位數房間碼");
      return;
    }
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
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
              <button
                onClick={handleCreate}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                建立房間
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
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                加入遊戲
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
    drawTile,
    discardTile,
    doAction,
    setRoomId,
  } = useMahjong(code, nameReady ? playerName : "");

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

  // Game Over
  if (state.status === "finished" && state.winner) {
    return <MjGameOver winner={state.winner} onGoHome={onGoHome} />;
  }

  // Playing
  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <button
          onClick={onGoHome}
          className="text-sm text-white/60 cursor-pointer active:text-[#f0d68a]"
        >
          離開
        </button>
        <h1 className="text-sm font-bold text-[#f0d68a] font-heading">
          台灣麻將 · {code}
        </h1>
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
        onDraw={drawTile}
        onDiscard={discardTile}
        onAction={doAction}
      />
    </div>
  );
}
