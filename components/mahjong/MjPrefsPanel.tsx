"use client";

import { useEffect, useState } from "react";
import MjTile from "./MjTile";
import type { Tile } from "@/lib/mahjong/tiles";
import { BACKS, FELTS, THEMES, DEFAULT_PREFS, usePrefs, setPrefs, type BackId, type FeltId } from "@/lib/mahjong/prefs";
import { CloseIcon, SpeakerIcon } from "./MjIcons";

const PREVIEW_TILES: Tile[] = [
  { id: -11, suit: "m", rank: 5, display: "五萬" },
  { id: -12, suit: "p", rank: 7, display: "七筒" },
  { id: -13, suit: "s", rank: 3, display: "三條" },
  { id: -14, suit: "z", rank: 5, display: "中" },
];

/** 設定面板（小宜〈偏好設定面板〉＋〈設定整併與雙音量及關閉互動〉）：「外觀」「聲音」兩個分頁（標題列中間）。
 *  每個分頁在手機橫向都不用捲動就放得下（老闆 2026-10-21：不要原生捲動軸）；預覽只在「外觀」分頁。
 *  外觀只換牌背、桌布；牌面一律原本的白色（老闆 2026-10-22），沒有牌面底色。
 *  聲音：語音、互動音效各一條 0～100 拉霸＋靜音鈕（靜音時拉霸停用、數值保留），加「收到語音時自動播放」。
 *  改了立刻生效；點遮罩、關閉鈕、「完成」或 Esc 關閉 */
export default function MjPrefsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"look" | "sound">("look");
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
      <div className={`mjp-card ${tab}`} role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="mjp-head">
          <b>設定</b>
          <div className="mjp-tabs" role="tablist" aria-label="設定分頁">
            {([["look", "外觀"], ["sound", "聲音"]] as const).map(([id, name]) => (
              <button key={id} type="button" role="tab" id={`mjp-tab-${id}`} aria-selected={tab === id} aria-controls="mjp-body" data-prefs-tab={id}
                className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}</button>
            ))}
          </div>
          <button type="button" className="mjp-x" aria-label="關閉" onClick={close}><CloseIcon /></button>
        </div>
        <div className="mjp-body" id="mjp-body" role="tabpanel" aria-labelledby={`mjp-tab-${tab}`} data-prefs-body={tab}>
          {tab === "look" ? (<>
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
          </>) : (<>
          <VolumeRow id="voice" label="語音" vol={prefs.voiceVol} muted={prefs.voiceMuted}
            onVol={(v) => setPrefs({ voiceVol: v })} onMute={(m) => setPrefs({ voiceMuted: m })} />
          <p className="mjp-cap">控制語音訊息播放音量。</p>
          <div className="mjp-row">
            <span className="lb">收到語音時自動播放</span>
            <button type="button" role="switch" aria-checked={prefs.autoVoice} aria-label="收到語音時自動播放" data-prefs-autovoice className={`mjp-switch ${prefs.autoVoice ? "on" : ""}`}
              onClick={() => setPrefs({ autoVoice: !prefs.autoVoice })}>
              <i />
            </button>
          </div>
          <VolumeRow id="fx" label="互動音效" vol={prefs.fxVol} muted={prefs.fxMuted}
            onVol={(v) => setPrefs({ fxVol: v })} onMute={(m) => setPrefs({ fxMuted: m })} />
          <p className="mjp-cap">愛心、鈔票、雞蛋、水桶、拳擊及未來的出牌配音。</p>
          </>)}
        </div>
        {tab === "look" && <div className="mjp-preview" aria-hidden>
          <div className="felt">
            <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} />)}</div>
            <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} faceDown />)}</div>
          </div>
          <div className="cap" data-prefs-cap>{BACKS[prefs.back].name}／{FELTS[prefs.felt].name}</div>
        </div>}
        <div className="mjp-foot">
          {/* 回復預設：只回復目前這個分頁的設定 */}
          <button type="button" className="mjp-reset" data-prefs-reset onClick={() => setPrefs(tab === "look"
            ? { back: DEFAULT_PREFS.back, felt: DEFAULT_PREFS.felt }
            : { voiceVol: DEFAULT_PREFS.voiceVol, voiceMuted: DEFAULT_PREFS.voiceMuted, fxVol: DEFAULT_PREFS.fxVol, fxMuted: DEFAULT_PREFS.fxMuted, autoVoice: DEFAULT_PREFS.autoVoice })}>回復預設</button>
          <button type="button" className="mjp-done" onClick={close}>完成</button>
        </div>
      </div>
    </div>
  );
}

/** 一組音量：名稱、目前百分比、0～100 拉霸（原生 range，鍵盤方向鍵、PageUp／Down、Home／End 都能調）、靜音鈕。
 *  靜音時拉霸停用、數值保留；取消靜音回到原本的大小 */
function VolumeRow({ id, label, vol, muted, onVol, onMute }: {
  id: "voice" | "fx"; label: string; vol: number; muted: boolean; onVol: (v: number) => void; onMute: (m: boolean) => void;
}) {
  return (
    <div className={`mjp-vol ${muted ? "muted" : ""}`} data-prefs-vol={id}>
      <div className="top">
        <span className="lb">{label}</span>
        <span className="pct" data-prefs-pct={id}>{vol}%</span>
      </div>
      <div className="ctl">
        <input type="range" min={0} max={100} step={1} value={vol} aria-label={`${label}音量`} aria-disabled={muted} disabled={muted}
          data-prefs-range={id} style={{ "--p": `${vol}%` } as React.CSSProperties}
          onChange={(e) => onVol(Math.round(Number(e.target.value)))} />
        <button type="button" className={`mjp-mute ${muted ? "on" : ""}`} aria-pressed={muted} data-prefs-mute={id} onClick={() => onMute(!muted)}>
          <SpeakerIcon muted={muted} />
          {muted ? "已靜音" : "靜音"}
        </button>
      </div>
    </div>
  );
}
