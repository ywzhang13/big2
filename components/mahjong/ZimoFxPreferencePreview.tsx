"use client";

import { useEffect, useRef, useState } from "react";
import MjTile from "./MjTile";
import ZimoFx from "./ZimoFx";
import type { Tile } from "@/lib/mahjong/tiles";
import type { ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";

const TILE: Tile = { id: -97, suit: "z", rank: 5, display: "中" };
const HAND: Tile[] = [
  { id: -91, suit: "m", rank: 3, display: "三萬" }, { id: -92, suit: "p", rank: 4, display: "四筒" },
  { id: -93, suit: "s", rank: 6, display: "六條" }, { id: -94, suit: "z", rank: 1, display: "東" },
];

/** 偏好頁的縮放手機牌桌：只載入目前選項；第一次有音效、循環時靜音。 */
export default function ZimoFxPreferencePreview({ fx, replay, muted, volume }: {
  fx: ZimoFxChoice; replay: number; muted: boolean; volume: number;
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
    <div className="mjp-phone" aria-hidden>
      <span className="mjp-seat top" data-fx-seat="2">阿華</span>
      <span className="mjp-seat left" data-fx-seat="3">小美</span>
      <span className="mjp-seat right" data-fx-seat="1">老闆</span>
      <span className="mjp-seat mine" data-fx-seat="0">我</span>
      <div className="mjp-wall">{HAND.map((tile) => <MjTile key={tile.id} tile={tile} width={20} height={28} faceDown />)}</div>
      <div className="mjp-myhand" data-mj-myhand>{HAND.map((tile) => <MjTile key={tile.id} tile={tile} width={24} height={33} />)}</div>
      {isNew ? <ZimoFx key={`${fx}-${run}`} fx={fx} seat={1} mySeat={0} mobile tile={TILE} name="老闆" embedded sound={audible}
        onDone={() => { loopRef.current = window.setTimeout(() => { setAudible(false); setRun((n) => n + 1); }, 1700); }} /> :
        <div className={`mjp-simple ${simplePhase ? "show" : ""}`} key={`${fx}-${run}`}>
          <i /><b>自摸</b><span>老闆</span>
        </div>}
    </div>
    <button type="button" className="mjp-replay" data-prefs-fx-replay onClick={again}>重新播放</button>
  </div>;
}
