"use client";

import { useEffect, useRef, useState } from "react";
import MeteorFx from "./MeteorFx";
import ZimoFx from "./ZimoFx";
import type { ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";

/** 偏好頁的純特效舞台：固定以自己的座位看出去；第一次有音效、循環時靜音。 */
export default function ZimoFxPreferencePreview({ fx, replay, muted, volume, name }: {
  fx: ZimoFxChoice; replay: number; muted: boolean; volume: number; name: string;
}) {
  const [run, setRun] = useState(0);
  const [audible, setAudible] = useState(true);
  const [simplePhase, setSimplePhase] = useState(0);
  const loopRef = useRef<number | null>(null);
  const isNew = fx !== "golden" && fx !== "meteor";

  useEffect(() => {
    setRun((n) => n + 1);
    setAudible(!muted && volume > 0);
    setSimplePhase(0);
  }, [fx, replay, muted, volume]);

  useEffect(() => () => { if (loopRef.current !== null) clearTimeout(loopRef.current); }, []);

  useEffect(() => {
    if (isNew) return;
    const show = window.setTimeout(() => setSimplePhase(1), 180);
    const loop = window.setTimeout(() => { setSimplePhase(0); setAudible(false); setRun((n) => n + 1); }, 3200);
    return () => { clearTimeout(show); clearTimeout(loop); };
  }, [isNew, fx, run]);

  const again = () => { if (loopRef.current !== null) clearTimeout(loopRef.current); setAudible(!muted && volume > 0); setRun((n) => n + 1); };
  return <div className={`mjp-fx-stage ${fx}`} data-prefs-fx-stage={fx}>
    <div className="mjp-fx-stage-inner" aria-hidden>
      {[0, 1, 2, 3].map((seat) => <i key={seat} className={`mjp-fx-anchor s${seat}`} data-fx-seat={seat} />)}
      {fx === "meteor" ? <MeteorFx key={`${fx}-${run}`} seat={0} mySeat={0} mobile tile={null} name={name} embedded sound={audible}
        onDone={() => { loopRef.current = window.setTimeout(() => { setAudible(false); setRun((n) => n + 1); }, 1700); }} /> :
      isNew ? <ZimoFx key={`${fx}-${run}`} fx={fx} seat={0} mySeat={0} mobile tile={null} name={name} embedded sound={audible}
        onDone={() => { loopRef.current = window.setTimeout(() => { setAudible(false); setRun((n) => n + 1); }, 1700); }} /> :
        <div className={`mjp-simple ${simplePhase ? "show" : ""}`} key={`${fx}-${run}`}>
          <i /><b>自摸</b><span>{name}</span>
        </div>}
    </div>
    <button type="button" className="mjp-replay" data-prefs-fx-replay onClick={again}>重新播放</button>
  </div>;
}
