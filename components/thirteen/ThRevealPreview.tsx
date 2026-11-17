"use client";
// 十三支亮牌預覽（app/thirteen/preview/reveal）：假資料直接播 ThReveal，按確認後（over＝最後一局）進總結算；不接 API
import { useEffect, useState } from "react";
import { preloadRevealFx } from "./ThRevealFx";
import ThReveal from "./ThReveal";
import { ThFinalResult } from "./ThResult";
import type { ThReveal as Reveal } from "./revealTimeline";
import type { ThGameView } from "./useThirteenRoom";
import "./thRoom.css";

const NAMES = ["老闆", "小明", "阿明", "小華"];

export default function ThRevealPreview({ rv }: { rv: Reveal }) {
  // 特效圖都載好才開始播（預覽站第一次打開，圖還在下載）
  const [startAt, setStartAt] = useState<number | null>(null);
  useEffect(() => { void preloadRevealFx().then(() => setStartAt(Date.now() + 400)); }, []);
  const [done, setDone] = useState(false);
  const view: ThGameView = {
    status: "playing", code: "0000", sv: 0, phase: "revealed", handNo: 1, settings: { arrangeSec: 60, totalHands: rv.over ? 1 : 8 },
    serverNow: 0, arrangeDeadline: null, players: NAMES.map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })),
    me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv,
  };
  if (done && rv.over) {
    return (
      <div className="th-table">
        <div className="th-felt" />
        <ThFinalResult players={NAMES.map((playerName, seat) => ({ seat, playerName, totalScore: rv.playerScores[seat] }))} mySeat={0} hands={1}
          stats={rv.stats.map((st, seat) => ({ guns: st.guns, gunned: st.gunned, homeRuns: st.homeRun ? 1 : 0, homeRunned: st.homeRunned ? 1 : 0, total: rv.playerScores[seat] }))} onLobby={() => location.reload()} />
      </div>
    );
  }
  if (startAt === null) return <div className="th-table" data-testid="th-loading"><div className="th-felt" /></div>;
  return <ThReveal view={view} rv={rv} startAt={startAt} confirmBy={null} confirmed={done} confirmLabel={rv.over ? "看總結算" : "確認"} onConfirm={() => setDone(true)} />;
}
