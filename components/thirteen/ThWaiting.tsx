"use client";
// 十三支等人：用三款共用的等人畫面（components/gameLobby，小宜〈共用開房流程 v1.1〉§7）
//   房號＋複製邀請連結、設定摘要（局數、理牌秒數、底分）、四列座位（大頭照、自己金色、「房主」）、房主滿 4 人開始、退出房間
// 開局確認（老闆 2026-11-20；老柯〈十三支開局確認 API〉）：房主按開始後蓋一層共用的 StartConfirm（四家小牌子、10 秒倒數、同意／取消），
//   四家都同意伺服器就發牌（畫面跟著狀態換成理牌）；時間到有人沒按就回等人，上面一條提示「○○ 沒按同意」，房主的開始鈕照常可以再按。
//   全部照 GET state 的 startConfirm、lastStartConfirm 畫（廣播只當「該重抓了」），重新整理也一樣
import { useEffect, useRef, useState } from "react";
import { WaitingRoom } from "@/components/gameLobby/GameLobby";
import StartConfirm, { type StartConfirmSeat } from "@/components/gameLobby/StartConfirm";
import { START_CONFIRM_MS } from "@/lib/lobby/startConfirm";
import type { ThWaitingView } from "./useThirteenRoom";

/** 設定摘要：舊房（伺服器補 baseScore 1）不顯示底分 */
export function waitingSummary(view: ThWaitingView): string[] {
  return [`${view.settings.totalHands}局`, `理牌 ${view.settings.arrangeSec} 秒`, ...(view.baseScore !== undefined && view.baseScore > 1 ? [`底分 ${view.baseScore}`] : [])];
}

/** 開局確認的四家小牌子：照座位順序，誰按了同意（readyIds） */
export function confirmSeats(view: ThWaitingView, myPlayerId: string): StartConfirmSeat[] {
  const ready = new Set(view.startConfirm?.readyIds ?? []);
  return [...view.seats].sort((a, b) => a.seat - b.seat).map((s) => ({ key: s.seat, name: s.name, ok: ready.has(s.playerId), me: s.playerId === myPlayerId }));
}

/** 剩幾秒（進位；不會小於 0）：截止時間是伺服器時間，換算時加上伺服器和本機的時差 */
export const secondsLeftOf = (deadline: number, localNow: number, clockSkew: number): number => Math.max(0, Math.ceil((deadline - (localNow + clockSkew)) / 1000));

/** 上一次開局沒開成的提示（lastStartConfirm）；沒有就是 null */
export function lastConfirmNote(view: ThWaitingView, myPlayerId: string): string | null {
  const last = view.lastStartConfirm;
  if (!last || view.startConfirm) return null;
  if (last.reason === "host") return "房主取消了開局";
  if (last.reason === "seats_changed") return "有人離開了，這次開局取消";
  if (last.reason === "suspended") return "有人帳號已暫停，不能開局";
  const names = last.missingIds.map((id) => (id === myPlayerId ? "你" : view.seats.find((s) => s.playerId === id)?.name)).filter((n): n is string => !!n);
  const who = names.length ? names.join("、") : "有人";
  return view.hostId === myPlayerId ? `${who} 沒按同意，可以再按一次開始遊戲` : `${who} 沒按同意，等房主重新開始`;
}

const NOOP = async () => ({ ok: true });
export default function ThWaiting({ view, myPlayerId, clockSkew = 0, onStart, onLeave, onAgree = NOOP, onCancel = NOOP, onTimeUp }: {
  view: ThWaitingView;
  myPlayerId: string;
  /** 伺服器時間 − 本機時間（毫秒） */
  clockSkew?: number;
  onStart: () => Promise<{ ok: boolean; message?: string }>;
  onLeave: () => Promise<{ ok: boolean; message?: string }>;
  /** 同意、取消都帶這一輪的確認編號（startConfirm.id） */
  onAgree?: (confirmId: string) => Promise<{ ok: boolean; message?: string }>;
  onCancel?: (confirmId: string) => Promise<{ ok: boolean; message?: string }>;
  /** 倒數到 0：請伺服器判斷（POST tick），回到等人或開局都照伺服器 */
  onTimeUp?: () => void;
}) {
  const sc = view.startConfirm ?? null;
  const isHost = view.hostId === myPlayerId;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [errO, setErr] = useState<{ deadline: number | null; msg: string } | null>(null); // 錯誤記著是哪一次確認的：換一次確認就不再顯示
  const firedFor = useRef<number | null>(null); // 同一個截止時間只叫一次 tick
  useEffect(() => {
    if (!sc) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [sc]);
  const secs = sc ? secondsLeftOf(sc.deadline, now, clockSkew) : 0;
  useEffect(() => {
    if (sc && secs === 0 && firedFor.current !== sc.deadline) { firedFor.current = sc.deadline; onTimeUp?.(); }
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
  const note = lastConfirmNote(view, myPlayerId);
  return (
    <>
      <WaitingRoom className="mjl" code={view.code} inviteUrl={typeof window === "undefined" ? `/thirteen#room=${view.code}` : `${window.location.origin}/thirteen#room=${view.code}`}
        summary={waitingSummary(view)} isHost={isHost} onStart={onStart} onLeave={onLeave}
        seats={view.seats.map((s) => ({ seat: s.seat, name: s.name, avatarUrl: s.avatarUrl ?? null, me: s.playerId === myPlayerId, host: s.playerId === view.hostId }))} />
      {note && <div className="stc-note" role="status" data-th-start-note={view.lastStartConfirm?.reason}>{note}</div>}
      {sc && (
        <StartConfirm seats={confirmSeats(view, myPlayerId)} secondsLeft={secs} totalSeconds={START_CONFIRM_MS / 1000} isHost={isHost} busy={busy} error={err}
          onAgree={() => void run(() => onAgree(sc.id))} onCancel={() => void run(() => onCancel(sc.id))} />
      )}
    </>
  );
}
