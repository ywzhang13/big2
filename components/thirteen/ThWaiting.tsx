"use client";
// 十三支等人：版面和按鈕直接沿用麻將的等人畫面（app/mahjong/page.tsx 的 .mjw 結構與樣式，老闆 2026-11-18 要三個遊戲同一套風格）
//   房間碼（點擊複製連結）、理牌秒數與局數（伺服器存的值）、四個座位、房主滿 4 人才能開始、退出房間
import { useState } from "react";
import type { ThWaitingView } from "./useThirteenRoom";
import { guarded } from "./roomScreen";

export default function ThWaiting({ view, myPlayerId, onStart, onLeave }: {
  view: ThWaitingView;
  myPlayerId: string;
  onStart: () => Promise<{ ok: boolean; message?: string }>;
  onLeave: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [msg, setMsg] = useState("");
  const isHost = view.hostId === myPlayerId;
  const n = view.seats.length;

  return (
    <div className="mjl mjl-wait-page flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6" data-th-waiting>
      <div className="mjw flex flex-col items-center gap-6 w-full max-w-sm">
        <h2 className="mjw-ttl text-xl font-bold text-[#f0d68a] font-heading">等待玩家加入</h2>
        <div className="mjw-code bg-white/10 rounded-2xl px-8 py-4 text-center">
          <p className="text-white/50 text-xs mb-1">房間碼</p>
          <p className="mjw-num text-4xl font-bold text-[#C9A96E] tracking-[0.3em] font-heading" data-testid="th-code">{view.code}</p>
          <button
            onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/thirteen#room=${view.code}`); setMsg("已複製連結"); }}
            className="mt-2 text-xs text-white/40 cursor-pointer active:text-[#C9A96E] hover:text-white/60 transition-colors"
          >
            {msg === "已複製連結" ? "已複製連結" : "點擊複製連結"}
          </button>
        </div>
        <div className="mjw-set bg-white/5 rounded-xl px-4 py-2.5 w-full">
          <div className="flex justify-center gap-6 text-sm">
            <span className="text-white/40">理牌 {view.settings.arrangeSec} 秒</span>
            <span className="text-white/40">{view.settings.totalHands}局</span>
          </div>
        </div>
        <div className="mjw-seats grid grid-cols-2 gap-3 w-full">
          {[0, 1, 2, 3].map((seat) => {
            const p = view.seats.find((s) => s.seat === seat);
            return (
              <div key={seat} data-th-seat={seat} data-empty={p ? undefined : ""}
                className={`mjw-seat rounded-xl p-4 text-center transition-all duration-300 ${p ? "bg-[#C9A96E]/20 border border-[#C9A96E]/30" : "bg-white/5 border border-white/10"}`}>
                <p className="text-xs text-white/40 mb-1">座位 {seat + 1}</p>
                {p ? (
                  <p className="font-bold text-[#f0d68a]">{p.name}{p.playerId === myPlayerId && " (你)"}{p.playerId === view.hostId && " *"}</p>
                ) : (
                  <p className="text-white/20">等待中...</p>
                )}
              </div>
            );
          })}
        </div>
        {isHost ? (
          <button
            data-th-start
            onClick={() => guarded(onStart, setBusy, setMsg, "開局失敗")} /* 網路例外也解除等待、顯示錯誤（審伯必修 3） */
            disabled={n !== 4 || busy}
            className="mjw-start w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg cursor-pointer active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {n === 4 ? "開始遊戲" : `等待玩家 (${n}/4)`}
          </button>
        ) : (
          <div className="mjw-start w-full py-4 rounded-2xl bg-white/10 text-center">
            <p className="text-white/50 font-medium">{n === 4 ? "等待房主開始遊戲" : `等待玩家 (${n}/4)`}</p>
          </div>
        )}
        <div className="mjw-back w-full flex flex-col items-center gap-1">
          <button
            data-th-leave
            onClick={() => guarded(onLeave, setLeaving, setMsg, "現在不能退出")}
            disabled={leaving}
            className="w-full py-2.5 rounded-2xl border border-[#C9A96E]/40 text-[#f0d68a] text-sm font-bold cursor-pointer active:scale-95 hover:bg-white/5 transition-all duration-150 disabled:opacity-50"
          >
            {leaving ? "退出中…" : "退出房間"}
          </button>
          {msg && msg !== "已複製連結" && <p className="text-red-300 text-xs text-center" role="alert">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
