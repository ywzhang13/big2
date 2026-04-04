"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function handleCreate() {
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    const roomCode = genCode();
    localStorage.setItem("big2_name", name.trim());
    router.push(`/room/${roomCode}`);
  }

  function handleJoin() {
    if (!code || code.length !== 4) { setError("請輸入4位數房間碼"); return; }
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    localStorage.setItem("big2_name", name.trim());
    router.push(`/room/${code}`);
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        {/* Title */}
        <div className="text-center">
          <div className="text-5xl mb-2">
            <span className="text-red-400">♥</span>
            <span className="text-white">♠</span>
            <span className="text-red-400">♦</span>
            <span className="text-white">♣</span>
          </div>
          <h1 className="text-5xl font-bold tracking-wider text-gold-light">大老二</h1>
          <p className="text-white/50 mt-2 text-sm">Big Two - 4 Players</p>
        </div>

        {mode === "home" ? (
          <div className="flex flex-col gap-4 w-full fade-in">
            <button
              onClick={() => { setMode("create"); setError(""); }}
              className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg active:scale-95 transition-transform"
            >
              建立房間
            </button>
            <button
              onClick={() => { setMode("join"); setError(""); }}
              className="w-full py-4 rounded-2xl border-2 border-gold/60 text-gold-light font-bold text-lg active:scale-95 transition-transform"
            >
              加入房間
            </button>
          </div>
        ) : mode === "create" ? (
          <div className="flex flex-col gap-4 w-full fade-in">
            <input
              type="text"
              maxLength={8}
              placeholder="你的暱稱"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50"
            />
            <button
              onClick={handleCreate}
              className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg active:scale-95 transition-transform"
            >
              建立房間
            </button>
            <button onClick={() => { setMode("home"); setError(""); }} className="text-white/40 text-sm">返回</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full fade-in">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="房間碼 (4位數)"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal placeholder:text-base outline-none focus:ring-2 focus:ring-gold/50"
            />
            <input
              type="text"
              maxLength={8}
              placeholder="你的暱稱"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50"
            />
            <button
              onClick={handleJoin}
              className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg active:scale-95 transition-transform"
            >
              加入遊戲
            </button>
            <button onClick={() => { setMode("home"); setError(""); }} className="text-white/40 text-sm">返回</button>
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
      </div>
    </div>
  );
}
