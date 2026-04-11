"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildTiles, shuffle, sortTiles, Tile, tileKey } from "@/lib/mahjong/tiles";
import { isWinningHand, findWaitingTiles } from "@/lib/mahjong/winCheck";

// Phase 1 demo: single-player practice mode
// Shows basic tile rendering + hand sorting + winning check
export default function MahjongPage() {
  const router = useRouter();
  const [hand, setHand] = useState<Tile[]>([]);
  const [dealt, setDealt] = useState(false);
  const [message, setMessage] = useState("");

  function dealNewHand() {
    const allTiles = buildTiles();
    const shuffled = shuffle(allTiles);
    // Deal 16 tiles (no flowers for practice)
    const nonFlower = shuffled.filter((t) => t.suit !== "f");
    const drawn = nonFlower.slice(0, 16);
    setHand(sortTiles(drawn));
    setDealt(true);
    setMessage("");
  }

  function checkWin() {
    if (hand.length !== 17) {
      setMessage(`需要 17 張牌才能胡（目前 ${hand.length} 張）`);
      return;
    }
    if (isWinningHand(hand)) {
      setMessage("🀄 恭喜！這是一副胡牌！");
    } else {
      setMessage("❌ 還沒胡牌");
    }
  }

  function checkWaiting() {
    if (hand.length !== 16) {
      setMessage(`需要 16 張牌才能聽牌（目前 ${hand.length} 張）`);
      return;
    }
    const waiting = findWaitingTiles(hand);
    if (waiting.length > 0) {
      setMessage(`🎯 聽: ${waiting.join(", ")}`);
    } else {
      setMessage("❌ 沒有聽牌");
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-white/60 cursor-pointer active:text-gold-light"
        >
          ← 返回大廳
        </button>
        <h1 className="text-lg font-bold text-gold-light font-heading">台灣麻將</h1>
        <div className="w-16" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">
        {/* Status */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gold-light mb-2">階段 1：基礎功能</h2>
          <p className="text-white/50 text-sm">
            目前支援：牌資料、洗牌、發 16 張、排序、胡牌/聽牌檢測
          </p>
          <p className="text-white/40 text-xs mt-1">完整對戰功能（抓打吃碰槓、台數計算）即將推出</p>
        </div>

        {/* Hand display */}
        {dealt && (
          <div className="w-full max-w-md">
            <p className="text-white/50 text-xs mb-2 text-center">你的手牌（{hand.length} 張）</p>
            <div className="flex flex-wrap justify-center gap-1 bg-[#0a1a10] p-3 rounded-2xl border border-white/10">
              {hand.map((t) => (
                <div
                  key={t.id}
                  className="min-w-[36px] h-[52px] rounded-md bg-white/95 text-[#1a1a1a]
                             flex items-center justify-center text-sm font-bold shadow-md"
                >
                  <span className={
                    t.suit === "z" && t.rank === 5 ? "text-red-600" :
                    t.suit === "z" && t.rank === 6 ? "text-green-700" :
                    t.suit === "m" || t.suit === "p" || t.suit === "s" ? "" : ""
                  }>
                    {t.display}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div className="bg-black/40 px-5 py-3 rounded-xl border border-gold/30">
            <p className="text-gold-light font-bold text-center">{message}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button
            onClick={dealNewHand}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                       cursor-pointer active:scale-95 transition-all"
          >
            {dealt ? "重新發牌" : "開始發牌（測試）"}
          </button>
          {dealt && (
            <>
              <button
                onClick={checkWaiting}
                className="w-full py-3 rounded-2xl bg-blue-600/80 text-white font-bold
                           cursor-pointer active:scale-95 transition-all"
              >
                檢查聽牌
              </button>
              <button
                onClick={checkWin}
                className="w-full py-3 rounded-2xl bg-red-600/80 text-white font-bold
                           cursor-pointer active:scale-95 transition-all"
              >
                檢查胡牌
              </button>
            </>
          )}
        </div>

        {/* Preview of coming features */}
        <div className="w-full max-w-md mt-4">
          <p className="text-[10px] text-white/30 text-center mb-2">即將推出</p>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-white/40">
            <div className="bg-white/5 rounded-lg p-2 text-center">4 人即時對戰</div>
            <div className="bg-white/5 rounded-lg p-2 text-center">吃碰槓動作</div>
            <div className="bg-white/5 rounded-lg p-2 text-center">補花系統</div>
            <div className="bg-white/5 rounded-lg p-2 text-center">30+ 台數計算</div>
            <div className="bg-white/5 rounded-lg p-2 text-center">聽牌提示</div>
            <div className="bg-white/5 rounded-lg p-2 text-center">結算畫面</div>
          </div>
        </div>
      </div>
    </div>
  );
}
