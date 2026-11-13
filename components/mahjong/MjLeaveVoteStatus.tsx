"use client";
// 解散投票的計票狀態（老闆 2026-11-13：超過 3 分鐘沒操作的玩家不計票）。放在投票視窗裡，取代原本固定的「已同意 x / 3」。
//   ・每 5 秒讀一次 GET /api/mahjong/leave-vote（只讀，不算操作），顯示需要幾人同意、已同意幾人、哪幾位「不計票」
//   ・發起者那邊每 10 秒送一次「重新確認」：等待中有人變成閒置，就重新判斷能不能解散（結果沒變伺服器什麼都不存）
//   ・分頁在背景時兩個都暫停，回到前景立刻補讀一次
// 讀不到時退回原本的「已同意 x / 3」，不影響投票。
import { useEffect, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";

interface Status { active: boolean; needed?: number; approvedCount?: number; idleSeats?: { seat: number; name: string; idleSec: number }[]; idleAfterSec?: number }

export default function MjLeaveVoteStatus({ roomId, playerId, isRequester, fallbackApproved, tick }: {
  roomId: string; playerId: string; isRequester: boolean; fallbackApproved: number; tick: number;
}) {
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    if (!roomId || !playerId) return;
    let alive = true;
    let timers: ReturnType<typeof setInterval>[] = [];
    const q = `roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
    const pull = async () => {
      try {
        const r = await mjFetch(`/api/mahjong/leave-vote?${q}`);
        if (r.ok && alive) setSt(await r.json());
      } catch { /* 讀不到就維持上一次 */ }
    };
    // 重新確認只送出、不另外讀：下一次固定輪詢就會拿到新狀態（解散的話會收到房間關閉事件）
    const recheck = () => { void mjFetch("/api/mahjong/leave-vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId, playerId, check: true }) }).catch(() => {}); };
    const stop = () => { timers.forEach(clearInterval); timers = []; };
    const start = () => {
      stop();
      void pull();
      timers.push(setInterval(pull, 5000));
      if (isRequester) timers.push(setInterval(recheck, 10000));
    };
    // 背景分頁不輪詢；回到前景馬上補讀一次再繼續
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { alive = false; stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [roomId, playerId, isRequester, tick]);

  const needed = st?.active && typeof st.needed === "number" ? st.needed : 3;
  const approved = st?.active && typeof st.approvedCount === "number" ? st.approvedCount : fallbackApproved;
  const idle = st?.active ? st.idleSeats ?? [] : [];
  const mins = Math.round((st?.idleAfterSec ?? 180) / 60);
  return (
    <div data-leave-vote-status className="text-center">
      <p className="text-white/40 text-xs mb-1">已同意: {approved} / {needed}</p>
      {idle.length > 0 && (
        <ul className="mt-1 mb-2 space-y-1" aria-label="不計票的玩家">
          {idle.map((p) => (
            <li key={p.seat} data-leave-idle-seat={p.seat} className="inline-flex items-center gap-1.5 mx-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/15 text-[11px] text-white/55">
              <span className="text-white/75 max-w-[7em] truncate">{p.name}</span>
              <span>超過 {mins} 分鐘未操作，不計票</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
