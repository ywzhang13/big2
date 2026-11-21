"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { saveSeatKey, useGame, type Big2ConfirmInfo } from "@/hooks/useGame";
import StartConfirm, { secondsLeftOf } from "@/components/gameLobby/StartConfirm";
import { big2ConfirmNote, big2ConfirmSeats } from "@/hooks/big2StartConfirmView";
import { START_CONFIRM_MS } from "@/lib/lobby/startConfirm";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import Hand from "@/components/Hand";
import PlayArea from "@/components/PlayArea";
import PlayerSlot from "@/components/PlayerSlot";
import GameOver from "@/components/GameOver";
import RoomClosed from "@/components/RoomClosed";
import { closedFromResponse } from "@/hooks/roomClosed";
import type { Card as CardType } from "@/lib/constants";
import { calculateScore } from "@/lib/scoring";
import GameMenu from "@/components/gamePrefs/GameMenu";
import { useGamePrefsAccount, useSessionAuth } from "@/components/gamePrefs/accountBinding";
import { gameVibrate } from "@/components/gamePrefs/vibrate";

// Read room code from URL hash: #room=XXXX
function getRoomFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/^#room=(\d{4})$/);
  return match ? match[1] : null;
}

function getMyId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("big2_pid");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("big2_pid", id);
  }
  return id;
}

export default function Home() {
  // 共用設定（左上 ≡ →「設定」）跟著登入的人：LINE 帳號讀寫帳號的、訪客和沒登入用這台；換帳號、登出不殘留（同十三支、麻將）。
  // 只讀登入狀態，大老二沒有登入入口
  useGamePrefsAccount(useSessionAuth());
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 進頁時讀網址 #room= 只做一次，原本就這樣，不改時序
      setRoomCode(code);
      setScreen("room");
    }
    const stored = localStorage.getItem("big2_name");
    if (stored) {
      setName(stored);
      setNameReady(true);
    }

    const onHash = () => {
      const c = getRoomFromHash();
      if (c) { setRoomCode(c); setScreen("room"); }
      else { setScreen("home"); setRoomCode(""); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function handleCreate() {
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    localStorage.setItem("big2_name", name.trim());
    setNameReady(true);
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: getMyId() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "建立房間失敗"); return; }
      // Host also joins as a player（第一次入座的回應帶入座憑證 seatKey：存起來，開局、取消要用）
      const jr = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.code, playerId: getMyId(), name: name.trim() }),
      });
      saveSeatKey(await jr.json().catch(() => null));
      setRoomCode(data.code);
      setCreatedRoomId(data.roomId);
      setScreen("room");
      window.location.hash = `room=${data.code}`;
    } catch {
      setError("網路錯誤，請重試");
    }
  }

  async function handleJoin() {
    if (!joinCode || joinCode.length !== 4) { setError("請輸入4位數房間碼"); return; }
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    localStorage.setItem("big2_name", name.trim());
    setNameReady(true);
    try {
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode, playerId: getMyId(), name: name.trim() }),
      });
      const data = await res.json();
      saveSeatKey(data); // 第一次入座才有 seatKey
      // 410＝這場已結束：照樣進房間畫面，由房間顯示總結算
      if (!res.ok && res.status !== 410) { setError(data.message || data.error || "加入房間失敗"); return; }
      setRoomCode(joinCode);
      setCreatedRoomId(data.roomId ?? "");
      setScreen("room");
      window.location.hash = `room=${joinCode}`;
    } catch {
      setError("網路錯誤，請重試");
    }
  }

  // 開局後才用房號／連結進來、但不在這桌（陌生人、已退出的人）：回大老二大廳並顯示提示。
  // 用 useCallback 固定住，RoomView 的自動加入才不會每次重繪都重送
  const onJoinBlocked = useCallback((msg: string) => {
    setCreatedRoomId("");
    setError(msg);
    window.location.hash = "";
  }, []);

  function goHome() {
    window.location.href = "/";
  }

  function backToLobby() {
    window.location.href = "/";
  }

  // ─── Home / Create / Join screens ───
  if (screen !== "room") {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="text-center">
            <div className="text-5xl mb-2">
              <span className="text-red-400">&#9829;</span>
              <span className="text-white">&#9824;</span>
              <span className="text-red-400">&#9830;</span>
              <span className="text-white">&#9827;</span>
            </div>
            <h1 className="text-5xl font-bold tracking-wider text-gold-light font-heading">大老二</h1>
            <p className="text-white/50 mt-2 text-sm">Big Two &mdash; 4 Players</p>
          </div>

          {screen === "home" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <button onClick={() => { setScreen("create"); setError(""); }}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                建立房間
              </button>
              <button onClick={() => { setScreen("join"); setError(""); }}
                className="w-full py-4 rounded-2xl border-2 border-gold/60 text-gold-light font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:border-gold hover:bg-gold/5">
                加入房間
              </button>
              {/* 回到總大廳（跟十三支大廳一樣放在最下面）；以前退出房間回到這裡後沒有出口 */}
              <button onClick={goHome} className="mjl-foot" data-big2-home>返回首頁</button>
            </div>
          ) : screen === "create" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input type="text" maxLength={8} placeholder="你的暱稱" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <button onClick={handleCreate}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                建立房間
              </button>
              <button onClick={() => { setScreen("home"); setError(""); }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">
                返回
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input type="text" inputMode="numeric" maxLength={4} placeholder="房間碼 (4位數)" value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal placeholder:text-base outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <input type="text" maxLength={8} placeholder="你的暱稱" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <button onClick={handleJoin}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                加入遊戲
              </button>
              <button onClick={() => { setScreen("home"); setError(""); }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">
                返回
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
        </div>
      </div>
    );
  }

  // ─── Room ───
  return <RoomView code={roomCode} playerName={name} nameReady={nameReady} initialRoomId={createdRoomId}
    onSetName={(n) => { setName(n); setNameReady(true); localStorage.setItem("big2_name", n); }}
    onGoHome={goHome}
    // 等人時退出房間成功：清掉網址的 #room=、忘記剛建的房，回大老二大廳（重新整理也不會再進去）
    onLeft={() => { setCreatedRoomId(""); window.location.hash = ""; }}
    onJoinBlocked={onJoinBlocked} />;
}

// ─── Room Component ───
function RoomView({ code, playerName, nameReady, initialRoomId, onSetName, onGoHome, onLeft, onJoinBlocked }: {
  code: string; playerName: string; nameReady: boolean; initialRoomId: string;
  onSetName: (n: string) => void; onGoHome: () => void; onLeft: () => void; onJoinBlocked: (message: string) => void;
}) {
  const [localName, setLocalName] = useState(playerName);
  const [selectedCards, setSelectedCards] = useState<CardType[]>([]);
  const [playError, setPlayError] = useState("");

  const { state, isHost, startGame, confirmReady, cancelReady, refreshState, confirm, hasSeatKey, dealAndStart, continueGame, playCards, pass, isMyTurn, canPass, setRoomId, closed, markClosed, leaveWaiting } = useGame(
    code, nameReady ? playerName : ""
  );

  // 等人時「退出房間」（老闆 2026-10-24）：伺服器真的把你移出房間、空出座位，才回大廳；失敗留在原畫面並提示
  const [leaving, setLeaving] = useState(false);
  // 按開始沒開成的一句提示（例如沒有入座憑證：請他退出再入座），不跳錯誤畫面
  const [startMsg, setStartMsg] = useState("");
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

  // Pass roomId from create/join to the hook
  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
  }, [initialRoomId, setRoomId]);

  // When joining via hash link (no initialRoomId), call join API
  useEffect(() => {
    if (nameReady && playerName && code && !initialRoomId) {
      const pid = getMyId();
      fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: pid, name: playerName }),
      })
        .then(async (res) => {
          const data = await res.json();
          saveSeatKey(data); // 用連結第一次入座也有 seatKey（回來的人不會再給，留著原本的）
          if (res.status === 410) markClosed(closedFromResponse(data));
          else if (res.status === 409 && data.error === "game_in_progress") onJoinBlocked(data.message || "房間已開始遊戲，無法加入");
          else if (data.roomId) setRoomId(data.roomId);
        })
        .catch((err) => console.error("[big2] auto-join failed:", err));
    }
  }, [nameReady, playerName, code, initialRoomId, setRoomId, markClosed, onJoinBlocked]);

  // Auto-deal when all 4 players are ready is now handled by the backend
  // (the last confirmReady triggers deal automatically)
  const allReady = state.readyCheck && state.readyPlayers.size >= state.players.length && state.players.length === 4;
  useEffect(() => {
    if (allReady && state.status === "waiting") {
      // In API mode, dealAndStart is a no-op - the backend auto-deals
      // Keep this for backward compat in case needed
      const t = setTimeout(() => dealAndStart(), 500);
      return () => clearTimeout(t);
    }
  }, [allReady, state.status, dealAndStart]);

  // Vibrate when it becomes my turn（共用設定的「震動」關掉就不震，見 components/gamePrefs/vibrate.ts）
  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current && state.status === "playing") {
      gameVibrate(200);
    }
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, state.status]);

  const toggleCard = (card: CardType) => {
    setSelectedCards((prev) => prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card]);
    setPlayError("");
  };

  const selectedCombo = selectedCards.length > 0 ? detectCombo(selectedCards) : null;
  const isValidPlay = (() => {
    if (!selectedCombo || !isMyTurn) return false;
    if (state.lastPlay === null) {
      const isFirstTurn = state.players.every((p) => p.cardCount === 13);
      if (isFirstTurn && state.myHand.includes("3C") && !selectedCards.includes("3C")) return false;
      return true;
    }
    return beats(state.lastPlay.combo, selectedCombo);
  })();

  const handlePlay = () => {
    const result = playCards(selectedCards);
    if (result.success) { setSelectedCards([]); setPlayError(""); }
    else setPlayError(result.error || "無效的出牌");
  };

  const handlePass = () => { pass(); setSelectedCards([]); setPlayError(""); };

  const comboName = (type: string) => {
    const m: Record<string, string> = { single: "單張", pair: "對子", straight: "順子", fullHouse: "葫蘆", fourOfAKind: "鐵支", straightFlush: "同花順" };
    return m[type] || type;
  };

  const getOpponent = (offset: number) => {
    const seat = (state.mySeat + offset) % 4;
    return state.players.find((p) => p.seat === seat);
  };

  if (closed) return <RoomClosed info={closed} onGoHome={onGoHome} />;

  // Name input
  if (!nameReady) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-gold-light font-heading">加入房間 {code}</h2>
          <input type="text" maxLength={8} placeholder="你的暱稱" value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
          <button onClick={() => { if (localName.trim()) onSetName(localName.trim()); }}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                       cursor-pointer active:scale-95 transition-all duration-150">
            加入
          </button>
        </div>
      </div>
    );
  }

  // Lobby
  if (state.status === "waiting") {
    const isFull = state.players.length >= 4;
    const isInRoom = state.players.some((p) => p.id === state.myId);
    const roomFull = isFull && !isInRoom;

    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-gold-light font-heading">等待玩家加入</h2>

          {roomFull && (
            <div className="w-full rounded-2xl bg-red-500/20 border border-red-500/30 p-4 text-center fade-in">
              <p className="text-red-400 font-bold text-lg">房間已滿</p>
              <p className="text-red-300/70 text-sm mt-1">此房間已有 4 位玩家</p>
            </div>
          )}

          <div className="bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="text-4xl font-bold text-gold tracking-[0.3em] font-heading">{code}</p>
            <button onClick={() => {
              const base = window.location.origin + window.location.pathname;
              navigator.clipboard?.writeText(`${base}#room=${code}`);
            }} className="mt-2 text-xs text-white/40 cursor-pointer active:text-gold hover:text-white/60 transition-colors">
              點擊複製連結
            </button>
          </div>
          {/* 退出房間放在房間碼下面：手機橫向（390 高）不用捲就看得到 */}
          <div className="flex flex-col items-center gap-1 -mt-3">
            <button onClick={leaveRoom} disabled={leaving} data-big2-leave
              className="px-8 py-2 rounded-full border border-gold/40 text-gold-light font-bold text-sm
                         cursor-pointer active:scale-95 hover:bg-white/5 transition-all duration-150 disabled:opacity-50">
              {leaving ? "退出中…" : "退出房間"}
            </button>
            {leaveError && <p className="text-red-400 text-sm text-center" role="alert">{leaveError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              const isReady = player ? state.readyPlayers.has(player.id) : false;
              return (
                <div key={seat} className={`rounded-xl p-4 text-center transition-all duration-300 ${
                  isReady ? "bg-green-500/20 border border-green-500/40" :
                  player ? "bg-gold/20 border border-gold/30" : "bg-white/5 border border-white/10"
                }`}>
                  <p className="text-xs text-white/40 mb-1">座位 {seat + 1}</p>
                  {player ? (
                    <div>
                      <p className="font-bold text-gold-light">
                        {player.name}
                        {player.id === state.myId && " (你)"}
                        {player.id === state.hostId && " 👑"}
                      </p>
                      {state.readyCheck && (
                        <p className={`text-xs mt-1 font-bold ${isReady ? "text-green-400" : "text-white/30"}`}>
                          {isReady ? "✓ 準備好了" : "等待確認..."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-white/20">等待中...</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* 開局確認（老闆 2026-11-20）：房主按開始後蓋共用的 StartConfirm（四家小牌子、10 秒倒數、同意／房主取消）；
              四家都同意伺服器就發牌（畫面跟著狀態換成牌桌）；時間到沒到齊就回等人，上面一條提示誰沒按 */}
          <Big2StartConfirm players={state.players} myId={state.myId} isHost={isHost} canCancel={hasSeatKey} readyIds={state.readyPlayers}
            info={confirm} onAgree={confirmReady} onCancel={cancelReady} onTimeUp={refreshState} />

          {/* Start button (only when NOT in ready check) */}
          {!state.readyCheck && (
            isHost ? (
              <>
              <button onClick={async () => { setStartMsg(""); const r = await startGame(); if (!r.ok && r.message) setStartMsg(r.message); }} disabled={state.players.length !== 4} data-big2-start
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           disabled:opacity-30 disabled:cursor-not-allowed">
                {state.players.length === 4 ? "開始遊戲" : `等待玩家 (${state.players.length}/4)`}
              </button>
              {startMsg && <p className="text-amber-200/90 text-sm text-center -mt-3" role="status" data-big2-start-msg>{startMsg}</p>}
              </>
            ) : (
              <div className="w-full py-4 rounded-2xl bg-white/10 text-center">
                <p className="text-white/50 font-medium">
                  {state.players.length === 4 ? "等待房主開始遊戲" : `等待玩家 (${state.players.length}/4)`}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // Game Over
  if (state.status === "finished") {
    // Calculate losers' scores first
    const roundScores: Record<string, number> = {};
    let losersTotal = 0;
    state.players.forEach((p) => {
      const hand = (state.finishedHands || {})[p.id] || [];
      const score = calculateScore(hand);
      roundScores[p.id] = score;
      if (score < 0) losersTotal += score; // negative
    });
    // Winner gets absolute value of losers' total
    const winnerId = state.players.find((p) => p.finishOrder === 1)?.id;
    if (winnerId) roundScores[winnerId] = Math.abs(losersTotal);

    const results = state.players.map((p) => ({
      seat: p.seat, name: p.name,
      hand: (state.finishedHands || {})[p.id] || [],
      finishOrder: p.finishOrder ?? null,
      roundScore: roundScores[p.id] || 0,
      score: (state.scores[p.id] || 0) + (roundScores[p.id] || 0),
    }));
    return (
      <GameOver
        results={results}
        winnerLastPlay={state.winnerLastPlay}
        onGoHome={onGoHome}
        // 任何玩家都能按「同意下一局」（改為四家同意制，跟麻將一致）
        onPlayAgain={continueGame}
        myId={state.myId}
        readyIds={state.readyPlayers}
        totalPlayers={state.players.length}
      />
    );
  }

  // Playing
  const top = getOpponent(2);
  const left = getOpponent(3);
  const right = getOpponent(1);

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* 左上 ≡ →「設定」：三款共用的設定面板（小宜〈共用設定面板 v1〉），大老二目前只有聲音頁 */}
      <GameMenu game="big2" tabs={[]} />
      <div className="flex justify-center pt-safe px-4 py-2">
        {top && <PlayerSlot name={top.name} cardCount={top.cardCount} isCurrentTurn={state.currentTurn === top.seat} isFinished={top.isFinished} position="top" score={state.scores[top.id]} />}
      </div>

      <div className="flex-1 flex items-center px-2 min-h-0">
        <div className="w-16 flex-shrink-0">
          {left && <PlayerSlot name={left.name} cardCount={left.cardCount} isCurrentTurn={state.currentTurn === left.seat} isFinished={left.isFinished} position="left" score={state.scores[left.id]} />}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <PlayArea
            lastPlay={state.lastPlay ? { cards: state.lastPlay.cards, comboType: comboName(state.lastPlay.combo.type), playerName: state.lastPlay.playerName } : null}
            isNewRound={state.lastPlay === null} />
          {isMyTurn ? (
            <div className="px-4 py-1.5 rounded-full bg-gold/20 border border-gold/40 animate-pulse">
              <p className="text-sm font-bold text-gold-light">輪到你出牌</p>
            </div>
          ) : (
            <p className="text-xs text-white/50">
              等待 {state.players.find((p) => p.seat === state.currentTurn)?.name || "..."}
            </p>
          )}
          {/* 開局後沒有離開按鈕（老闆 2026-10-24：先說明，之後再考慮做投票離開） */}
          <p className="text-[10px] text-white/30" data-big2-noleave>開局中不能離開，打完這場才能離開</p>
        </div>
        <div className="w-16 flex-shrink-0">
          {right && <PlayerSlot name={right.name} cardCount={right.cardCount} isCurrentTurn={state.currentTurn === right.seat} isFinished={right.isFinished} position="right" score={state.scores[right.id]} />}
        </div>
      </div>

      <div className="pb-safe bg-black/30 backdrop-blur-sm rounded-t-2xl">
        <div className="h-7 flex items-center justify-between px-4">
          <span className="text-[10px] text-white/40">
            {playerName} · <span className={`font-bold ${state.myHand.length <= 3 ? "text-red-400" : "text-gold-light"}`}>{state.myHand.length}</span> 張
            {(state.scores[state.myId] ?? 0) !== 0 && (
              <span className={`ml-1.5 font-bold ${(state.scores[state.myId] || 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                {(state.scores[state.myId] || 0) > 0 ? "+" : ""}{state.scores[state.myId]}分
              </span>
            )}
          </span>
          <div>
            {selectedCombo && (
              <span className={`text-xs font-bold px-3 py-0.5 rounded-full ${isValidPlay ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                {comboName(selectedCombo.type)}{!isValidPlay && state.lastPlay ? " (打不過)" : ""}
              </span>
            )}
            {playError && <span className="text-xs text-red-400">{playError}</span>}
          </div>
        </div>
        <Hand cards={state.myHand} selectedCards={selectedCards} onToggleCard={toggleCard} />
        <div className="flex gap-3 px-4 py-3">
          <button onClick={handlePass} disabled={!canPass}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-bold text-sm
                       cursor-pointer active:scale-95 transition-all duration-150
                       disabled:opacity-30 disabled:cursor-not-allowed">
            Pass
          </button>
          <button onClick={handlePlay} disabled={!isValidPlay}
            className="flex-1 py-3 rounded-xl bg-gold text-felt font-bold text-sm
                       cursor-pointer active:scale-95 transition-all duration-150
                       disabled:opacity-30 disabled:cursor-not-allowed">
            出牌
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 開局確認（共用 StartConfirm；倒數照伺服器截止時間，到 0 讀一次狀態讓伺服器判斷） ───
function Big2StartConfirm({ players, myId, isHost, canCancel, readyIds, info, onAgree, onCancel, onTimeUp }: {
  /** canCancel：這個分頁有入座憑證（seatKey）才有「取消」 */
  players: { id: string; name: string; seat: number }[]; myId: string; isHost: boolean; canCancel: boolean; readyIds: Set<string>; info: Big2ConfirmInfo;
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
  const note = big2ConfirmNote(info.lastStartConfirm, !!sc, players, myId, isHost);
  // 確認中的勾：伺服器的 readyIds（state 和廣播都會更新 readyPlayers）
  const ready = sc ? new Set([...sc.readyIds, ...readyIds]) : readyIds;
  return (
    <>
      {note && <div className="stc-note" role="status" data-big2-start-note={info.lastStartConfirm?.reason}>{note}</div>}
      {sc && (
        // 「取消」只有拿得到入座憑證的房主才有（localStorage，重新整理也在）；沒有就等 10 秒自己作廢
        <StartConfirm seats={big2ConfirmSeats(players, ready, myId)} secondsLeft={secs} totalSeconds={START_CONFIRM_MS / 1000} isHost={isHost && canCancel} busy={busy} error={err}
          onAgree={() => void run(onAgree)} onCancel={() => void run(onCancel)} />
      )}
    </>
  );
}
