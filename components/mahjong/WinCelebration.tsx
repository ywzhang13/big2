"use client";
import { useEffect, useRef } from "react";
import { stepPlay } from "./fxWarmUp";
// 現有的自摸／胡慶祝浮層（原本直接寫在 app/mahjong/page.tsx，2026-10-25 效能健檢時原封不動搬成元件，畫面、時間、樣式一個字都沒改），
// 頁面和特效預熱（components/mahjong/fxWarmUp.tsx）共用。mode：自摸／胡；flowerWinName：花胡的牌型名（八仙過海、七搶一，有就取代「自摸／胡」）
export default function WinCelebration({ mode: celebrationMode, flowerWinName, name, totalFan }: {
  mode: "zimo" | "ron"; flowerWinName?: string; name: string; totalFan: number;
}) {
  return (
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
          {name}
        </p>
        <p
          className="mt-1 text-sm font-bold tracking-wider"
          style={{
            color: "#fde68a",
            animation: "mj-win-fade-in 800ms ease-out 700ms both",
          }}
        >
          共 {totalFan} 台
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
  );
}

/** 預熱用（components/mahjong/fxWarmUp.tsx）：在看不見的容器裡把浮層整段（自摸 3.5 秒／胡 2 秒）一格一格走一遍，走完 onDone() */
export function WinCelebrationWarm({ mode, name, onDone }: { mode: "zimo" | "ron"; name: string; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });
  useEffect(() => {
    let alive = true;
    const root = ref.current;
    if (root) void stepPlay(root, mode === "zimo" ? 3500 : 2000, { alive: () => alive, shake: false }).then(() => { if (alive) doneRef.current(); });
    return () => { alive = false; };
  }, [mode]);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <WinCelebration mode={mode} name={name} totalFan={8} />
    </div>
  );
}

