"use client";
// 十三支亮牌整段（小宜 v5）：開始比牌 → 三墩輪流翻＋牌型徽章＋牌型特效 → 打槍 → 全壘打 → 本局結算（確認倒數到伺服器的 nextHandAt，30 秒）。
// 時間軸起點 startAt（本機時間）由頁面給：一般局用伺服器的亮牌時間換算（四家同步、重新整理接著播），整場最後一局用第一次看到的時間
import { useEffect, useMemo, useRef, useState } from "react";
import ThTable from "./ThTable";
import ThRevealFx from "./ThRevealFx";
import { ThRoundResult } from "./ThResult";
import { buildTimeline, frameAt, allOpen, type ThReveal as Reveal } from "./revealTimeline";
import type { ThGameView } from "./useThirteenRoom";
import "./thReveal.css";
import { shouldAutoConfirm } from "./roomScreen";

/** 本局結算確認鈕的倒數（v5 §5） */
export const CONFIRM_MS = 30_000; // 老柯 4b25124：結算面板出現後 30 秒（＝nextHandAt）沒人按也開下一局

export default function ThReveal({ view, rv, startAt, confirmBy, confirmed, sending = false, error = null, onConfirm, confirmLabel }: {
  view: ThGameView;
  rv: Reveal;
  startAt: number;
  /** 最晚這個時間（本機）自動確認：伺服器到點就會自己開下一局，倒數不能比它長；null＝只看 8 秒 */
  confirmBy: number | null;
  confirmed: boolean;
  /** 確認送出中、失敗原因（審伯必修 1：失敗要顯示、可以重按） */
  sending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const tl = useMemo(() => buildTimeline(rv), [rv]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const t = now - startAt;
  const frame = t >= tl.end ? allOpen() : frameAt(tl, Math.max(0, t));
  const panelAt = startAt + tl.end;
  const autoAt = Math.min(panelAt + CONFIRM_MS, confirmBy ?? Infinity);
  const secondsLeft = Math.max(0, Math.ceil((autoAt - now) / 1000));
  const showPanel = t >= tl.end;

  // 倒數到了自動確認；失敗（斷線、伺服器拒絕）隔 3 秒再試，不會卡在「已確認」
  const lastAuto = useRef<number | null>(null);
  useEffect(() => {
    if (showPanel && shouldAutoConfirm({ now, autoAt, confirmed, sending, lastAutoAt: lastAuto.current })) { lastAuto.current = now; onConfirm(); }
  }, [showPanel, confirmed, sending, now, autoAt, onConfirm]);

  const names = [0, 1, 2, 3].map((s) => view.players.find((p) => p.seat === s)?.name ?? "");
  return (
    <>
      <ThTable view={view} now={now} clockSkew={0} reveal={{ rv, frame }} />
      {!showPanel && <ThRevealFx active={frame.active} t={Math.max(0, t)} mySeat={view.me?.seat ?? 0} />}
      {showPanel && (
        <ThRoundResult rv={rv} names={names} mySeat={view.me?.seat ?? 0} secondsLeft={secondsLeft} confirmed={confirmed} sending={sending} error={error}
          onConfirm={onConfirm} confirmLabel={confirmLabel} />
      )}
    </>
  );
}
