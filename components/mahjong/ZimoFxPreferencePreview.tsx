"use client";

import { useEffect, useRef, useState } from "react";
import MeteorFx, { preloadMeteorFx } from "./MeteorFx";
import ZimoFx, { preloadZimoFx } from "./ZimoFx";
import type { ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";

/**
 * 偏好頁的純特效舞台：固定以自己的座位看出去；第一次有音效、循環時靜音。
 * 只播一次（老闆 2026-10-31 回報風暴、冰封有時重播兩次、卡卡的）：原本一掛上就 run+1 讓特效馬上重掛一次，
 * 而且素材還沒下載就開播（風暴第一次掛上時 11 個檔只下載了 1 個）；切換特效時上一種播完排的重播計時也沒清掉。
 * 現在：換特效或按重播 → 先清掉計時、拿掉舞台上的特效 → 等這一種的圖、音效、大字都載好 → 才掛上一次；
 * 等的期間又換了別種，舊的那次就作廢。音量、靜音只影響下一次有沒有聲音，不會讓特效重來。
 */
export default function ZimoFxPreferencePreview({ fx, replay, muted, volume, name }: {
  fx: ZimoFxChoice; replay: number; muted: boolean; volume: number; name: string;
}) {
  /** 舞台上正在播的那一次：哪一種、第幾次（key）、有沒有聲音；null＝素材載入中 */
  const [play, setPlay] = useState<{ fx: ZimoFxChoice; n: number; audible: boolean } | null>(null);
  const [simplePhase, setSimplePhase] = useState(0);
  const loopRef = useRef<number | null>(null);
  const seq = useRef(0);
  const audibleNow = useRef(!muted && volume > 0);
  audibleNow.current = !muted && volume > 0;
  const isNew = fx !== "golden" && fx !== "meteor";

  const clearLoop = () => { if (loopRef.current !== null) { clearTimeout(loopRef.current); loopRef.current = null; } };
  /** 載好這一種再播一次；audible＝這一次要不要出聲（第一次跟著設定，循環重播都靜音） */
  const start = (which: ZimoFxChoice, audible: boolean) => {
    clearLoop();
    const my = ++seq.current;
    setPlay(null);
    setSimplePhase(0);
    const load = which === "meteor" ? preloadMeteorFx() : which === "golden" ? Promise.resolve(true) : preloadZimoFx(which);
    void load.then(() => { if (seq.current === my) setPlay({ fx: which, n: my, audible }); });
  };

  useEffect(() => {
    start(fx, audibleNow.current);
    return clearLoop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只有換特效、按重播才重來；音量、靜音不重播
  }, [fx, replay]);

  // 播完停 1.7 秒再靜音重播（同一時間只排一個）
  const done = () => { clearLoop(); loopRef.current = window.setTimeout(() => start(fx, false), 1700); };

  useEffect(() => {
    if (isNew || fx === "meteor" || !play) return;
    const show = window.setTimeout(() => setSimplePhase(1), 180);
    const loop = window.setTimeout(() => start(fx, false), 3200);
    return () => { clearTimeout(show); clearTimeout(loop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const cur = play && play.fx === fx ? play : null;
  return <div className={`mjp-fx-stage ${fx}`} data-prefs-fx-stage={fx}>
    <div className="mjp-fx-stage-inner" aria-hidden>
      {[0, 1, 2, 3].map((seat) => <i key={seat} className={`mjp-fx-anchor s${seat}`} data-fx-seat={seat} />)}
      {cur && (fx === "meteor" ? <MeteorFx key={`${fx}-${cur.n}`} seat={0} mySeat={0} mobile tile={null} name={name} embedded sound={cur.audible} onDone={done} /> :
      isNew ? <ZimoFx key={`${fx}-${cur.n}`} fx={fx} seat={0} mySeat={0} mobile tile={null} name={name} embedded sound={cur.audible} onDone={done} /> :
        <div className={`mjp-simple ${simplePhase ? "show" : ""}`} key={`${fx}-${cur.n}`}>
          <i /><b>自摸</b><span>{name}</span>
        </div>)}
    </div>
    <button type="button" className="mjp-replay" data-prefs-fx-replay onClick={() => start(fx, audibleNow.current)}>重新播放</button>
  </div>;
}
