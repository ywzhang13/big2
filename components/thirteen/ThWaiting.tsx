"use client";
// 十三支等人：用三款共用的等人畫面（components/gameLobby，小宜〈共用開房流程 v1.1〉§7）
//   房號＋複製邀請連結、設定摘要（局數、理牌秒數、底分）、四列座位（大頭照、自己金色、「房主」）、房主滿 4 人開始、退出房間
import { WaitingRoom } from "@/components/gameLobby/GameLobby";
import type { ThWaitingView } from "./useThirteenRoom";

/** 設定摘要：舊房（伺服器補 baseScore 1）不顯示底分 */
export function waitingSummary(view: ThWaitingView): string[] {
  return [`${view.settings.totalHands}局`, `理牌 ${view.settings.arrangeSec} 秒`, ...(view.baseScore !== undefined && view.baseScore > 1 ? [`底分 ${view.baseScore}`] : [])];
}

export default function ThWaiting({ view, myPlayerId, onStart, onLeave }: {
  view: ThWaitingView;
  myPlayerId: string;
  onStart: () => Promise<{ ok: boolean; message?: string }>;
  onLeave: () => Promise<{ ok: boolean; message?: string }>;
}) {
  return (
    <WaitingRoom className="mjl" code={view.code} inviteUrl={typeof window === "undefined" ? `/thirteen#room=${view.code}` : `${window.location.origin}/thirteen#room=${view.code}`}
      summary={waitingSummary(view)} isHost={view.hostId === myPlayerId} onStart={onStart} onLeave={onLeave}
      seats={view.seats.map((s) => ({ seat: s.seat, name: s.name, avatarUrl: s.avatarUrl ?? null, me: s.playerId === myPlayerId, host: s.playerId === view.hostId }))} />
  );
}
