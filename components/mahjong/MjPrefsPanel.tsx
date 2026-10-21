"use client";

import { useEffect, useState } from "react";
import MjTile from "./MjTile";
import type { Tile } from "@/lib/mahjong/tiles";
import { BACKS, FELTS, THEMES, DEFAULT_PREFS, usePrefs, setPrefs, type BackId, type FeltId } from "@/lib/mahjong/prefs";

const PREVIEW_TILES: Tile[] = [
  { id: -11, suit: "m", rank: 5, display: "五萬" },
  { id: -12, suit: "p", rank: 7, display: "七筒" },
  { id: -13, suit: "s", rank: 3, display: "三條" },
  { id: -14, suit: "z", rank: 5, display: "中" },
];

/** 偏好設定面板（小宜規格 2026-10-20）：這次只有「外觀」（聲音、互動分頁之後再上）。
 *  只換牌背、桌布；牌面一律原本的白色（老闆 2026-10-22），沒有牌面底色。
 *  改了立刻生效；點遮罩、✕、「完成」或 Esc 關閉 */
export default function MjPrefsPanel() {
  const [open, setOpen] = useState(false);
  const prefs = usePrefs();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("mj-open-prefs", onOpen);
    return () => window.removeEventListener("mj-open-prefs", onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const themeOn = THEMES.find((t) => t.back === prefs.back && t.felt === prefs.felt)?.id;

  return (
    <div className="mjp-mask" onClick={close} data-prefs-panel>
      <div className="mjp-card" role="dialog" aria-modal="true" aria-label="偏好設定" onClick={(e) => e.stopPropagation()}>
        <div className="mjp-head">
          <b>偏好設定</b>
          <button type="button" className="mjp-x" aria-label="關閉" onClick={close}>✕</button>
        </div>
        <div className="mjp-body">
          <div className="mjp-sec">快速主題</div>
          <div className="mjp-themes">
            {THEMES.map((t) => (
              <button key={t.id} type="button" data-prefs-theme={t.id} className={`mjp-theme ${themeOn === t.id ? "on" : ""}`}
                onClick={() => setPrefs({ back: t.back, felt: t.felt })}>
                <span className="sw" style={{ background: `linear-gradient(145deg, ${FELTS[t.felt].table[0]}, ${FELTS[t.felt].table[2]})` }}>
                  <i style={{ background: `linear-gradient(180deg, ${BACKS[t.back].c.join(",")})` }} />
                  <i style={{ background: "#fff" }} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
          <div className="mjp-sec">牌背顏色</div>
          <div className="mjp-sws">
            {(Object.keys(BACKS) as BackId[]).map((id) => (
              <button key={id} type="button" data-prefs-back={id} title={BACKS[id].name} aria-label={BACKS[id].name} aria-pressed={prefs.back === id}
                className={`mjp-sw ${prefs.back === id ? "on" : ""}`}
                style={{ background: `linear-gradient(180deg, ${BACKS[id].c.join(",")})` }} onClick={() => setPrefs({ back: id })} />
            ))}
          </div>
          <div className="mjp-sec">桌布</div>
          <div className="mjp-sws">
            {(Object.keys(FELTS) as FeltId[]).map((id) => (
              <button key={id} type="button" data-prefs-felt={id} title={FELTS[id].name} aria-label={FELTS[id].name} aria-pressed={prefs.felt === id}
                className={`mjp-sw ${prefs.felt === id ? "on" : ""}`}
                style={{ background: `linear-gradient(145deg, ${FELTS[id].table.join(",")})` }} onClick={() => setPrefs({ felt: id })} />
            ))}
          </div>
        </div>
        <div className="mjp-preview" aria-hidden>
          <div className="felt">
            <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} />)}</div>
            <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} faceDown />)}</div>
          </div>
          <div className="cap" data-prefs-cap>{BACKS[prefs.back].name}／{FELTS[prefs.felt].name}</div>
        </div>
        <div className="mjp-foot">
          <button type="button" className="mjp-reset" onClick={() => setPrefs({ back: DEFAULT_PREFS.back, felt: DEFAULT_PREFS.felt })}>回復預設</button>
          <button type="button" className="mjp-done" onClick={close}>完成</button>
        </div>
      </div>
    </div>
  );
}
