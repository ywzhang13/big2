"use client";

import { useRouter } from "next/navigation";

export default function Lobby() {
  const router = useRouter();

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6 min-h-dvh">
      <div className="flex flex-col items-center gap-10 w-full max-w-md">
        {/* Title */}
        <div className="text-center">
          <div className="text-5xl mb-3">
            <span className="text-red-400">♥</span>
            <span className="text-white">♠</span>
            <span className="text-red-400">♦</span>
            <span className="text-white">♣</span>
          </div>
          <h1 className="text-5xl font-bold tracking-wider text-gold-light font-heading">
            阿瑋娛樂城
          </h1>
          <p className="text-white/50 mt-3 text-sm">多人線上桌遊平台</p>
        </div>

        {/* Game selection */}
        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={() => router.push("/big2")}
            className="w-full py-6 rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900
                       border-2 border-gold/40 text-white
                       cursor-pointer active:scale-95 transition-all duration-150
                       hover:border-gold hover:shadow-xl hover:shadow-emerald-500/20
                       text-left px-6"
          >
            <div className="flex items-center gap-4">
              <div className="text-4xl">
                <span className="text-red-400">♥</span>
                <span className="text-white">♠</span>
              </div>
              <div>
                <div className="text-2xl font-bold text-gold-light">大老二</div>
                <div className="text-xs text-white/60 mt-1">4 人撲克競技 · Big Two</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => router.push("/mahjong")}
            className="w-full py-6 rounded-2xl bg-gradient-to-br from-red-900 to-amber-900
                       border-2 border-gold/40 text-white
                       cursor-pointer active:scale-95 transition-all duration-150
                       hover:border-gold hover:shadow-xl hover:shadow-red-500/20
                       text-left px-6"
          >
            <div className="flex items-center gap-4">
              <div className="flex gap-0.5" style={{perspective:"200px"}}>
                {[
                  {text:"中", color:"#dc2626"},
                  {text:"發", color:"#15803d"},
                  {text:"", color:""},
                ].map((t, i) => (
                  <div key={i} className="w-10 h-14 rounded-md flex items-center justify-center relative"
                    style={{
                      background:"linear-gradient(145deg, #f5f0e0 0%, #e8dfc8 50%, #d4c9a8 100%)",
                      boxShadow:"2px 3px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.8), inset -1px -1px 0 rgba(0,0,0,0.1)",
                      border:"1px solid rgba(180,170,140,0.6)",
                      transform:`rotateY(${(i-1)*3}deg)`,
                    }}>
                    {t.text ? (
                      <span className="text-xl font-black" style={{color:t.color, fontFamily:"serif", textShadow:"0 1px 1px rgba(0,0,0,0.1)"}}>{t.text}</span>
                    ) : (
                      <div className="w-6 h-8 rounded-sm border-2 border-gray-300/60" />
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-2xl font-bold text-gold-light">台灣麻將</div>
                <div className="text-xs text-white/60 mt-1">16 張制 · 4 人桌遊</div>
              </div>
            </div>
          </button>
        </div>

        <p className="text-[10px] text-white/30 text-center">
          選擇遊戲開始遊玩 · 支援多人即時對戰
        </p>
      </div>
    </div>
  );
}
