"use client";

// 「這場已結束」：房間關閉後（打完、解散、重新整理、用房號加入已刪的房）顯示總輸贏和回大廳。
// 沒有總結算時只顯示標題。

import type { RoomClosedInfo } from "@/hooks/roomClosed";

export default function RoomClosed({ info, onGoHome }: { info: RoomClosedInfo; onGoHome: () => void }) {
  const rows = [...info.players].sort((a, b) => b.totalScore - a.totalScore);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: "radial-gradient(ellipse at center, #1a3f25 0%, #0f2a1a 60%, #091a10 100%)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-4 flex flex-col gap-3"
        style={{
          background: "linear-gradient(145deg, rgba(42,31,14,.96), rgba(15,14,8,.96))",
          border: "1px solid rgba(201,169,110,.45)",
          boxShadow: "0 8px 32px rgba(0,0,0,.6)",
          maxHeight: "100%",
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-lg font-bold text-[#f0d68a]">這場已結束</h2>
          {info.endReason === "dissolved" && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-white/70">中途解散</span>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col gap-1">
            {rows.map((p) => (
              <div key={p.seat} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5">
                <span className="text-sm font-bold text-white/80 truncate">{p.playerName}</span>
                <span
                  className="text-base font-black tabular-nums"
                  style={{ color: p.totalScore > 0 ? "#4ade80" : p.totalScore < 0 ? "#f87171" : "rgba(255,255,255,.5)" }}
                >
                  {p.totalScore > 0 ? "+" : ""}
                  {p.totalScore}
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onGoHome}
          className="h-11 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold active:scale-95 transition-all"
        >
          回大廳
        </button>
      </div>
    </div>
  );
}
