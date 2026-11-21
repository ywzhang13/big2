"use client";
// 三款遊戲共用的設定面板（小宜〈共用設定面板-設計說明 v1〉）：外框、聲音頁三款一樣；各遊戲只交「自己的分頁＋區塊資料」，由這裡用同一套區塊畫。
// 樣式 .gpp-*（gamePrefsPanel.css），數值照麻將的 .mjp-*；麻將的 MjPrefsPanel、.mjp-* 都不動（麻將另外一張卡才換）。
// 聲音設定直接讀寫麻將現有的那一份（lib/mahjong/prefs：登入 LINE 跟帳號、沒登入存這台 mj.prefs.v4），三款同步、伺服器不用改；
// 震動存在這台 gp.vibrate（./vibrate）。面板用 portal 掛在 body，不跟著牌桌縮放
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_PREFS, setPrefs, usePrefs } from "@/lib/mahjong/prefs";
import { CloseIcon, SpeakerIcon } from "@/components/mahjong/MjIcons";
import { canVibrate, setVibrateOn, useVibrateOn } from "./vibrate";
import "./gamePrefsPanel.css";

/** 色塊單選（十三支桌布、麻將牌背／桌布） */
export type SwatchSection = { kind: "swatch"; title?: string; value: string; onChange: (id: string) => void; options: { id: string; name: string; bg: string }[] };
/** 主題卡（麻將快速主題）：sw＝卡內 64×34 的色塊 */
export type ThemeSection = { kind: "theme"; title?: string; value: string | null; onChange: (id: string) => void; options: { id: string; name: string; sw: ReactNode }[] };
/** 圖卡單選（麻將自摸特效）：status 是第三行的狀態字 */
export type CardSection = {
  kind: "cards"; title?: string; value: string | null; onChange: (id: string) => void;
  /** 桌機一列幾張（預設 2；手機橫向固定 4）。麻將自摸特效 7～8 張用 4，兩列就放得下、不用捲 */
  cols?: number;
  options: { id: string; name: string; thumb: ReactNode; status?: { text: string; tone: "use" | "ready" | "lock" } }[];
};
/** 開關 */
export type SwitchSection = { kind: "switch"; title?: string; options: { id: string; name: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; note?: string }[] };
export type PrefsSection = SwatchSection | ThemeSection | CardSection | SwitchSection;

export interface PrefsTab {
  id: string;
  name: string;
  /** 排在「聲音」後面（預設排前面） */
  afterSound?: boolean;
  visible?: boolean;
  sections: PrefsSection[];
  /** 預覽（遊戲自己畫）：桌機在選項下面、手機橫向在右邊 196 寬 */
  preview?: ReactNode;
  previewCap?: string;
  /** 這一頁「回復預設」 */
  onReset?: () => void;
}

export const SOUND_TAB = "sound";

export default function GamePrefsPanel({ open, onClose, tabs, game }: {
  open: boolean; onClose: () => void; tabs: PrefsTab[];
  /** 哪一款遊戲（只用來標 data-gpp，測試和截圖認得） */
  game: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<GamePrefsCard onClose={onClose} tabs={tabs} game={game} />, document.body);
}

/** 面板本體（遮罩＋卡片）：GamePrefsPanel 用 portal 掛到 body；單獨匯出給測試在伺服器端畫（2026-11-21 小測要共用面板的自動測試） */
export function GamePrefsCard({ onClose, tabs, game }: { onClose: () => void; tabs: PrefsTab[]; game: string }) {
  const shown = tabs.filter((t) => t.visible !== false);
  const order = [...shown.filter((t) => !t.afterSound).map((t) => t.id), SOUND_TAB, ...shown.filter((t) => t.afterSound).map((t) => t.id)];
  // 打開時停在第一個分頁（十三支是外觀、大老二是聲音）：GameMenu 每次打開都重新掛這個元件，分頁從 order[0] 開始
  const [tab, setTab] = useState(order[0]);
  const cur = shown.find((t) => t.id === tab) ?? null;
  const name = (id: string) => (id === SOUND_TAB ? "聲音" : shown.find((t) => t.id === id)?.name ?? id);
  return (
    <div className="gpp-mask" onClick={onClose} data-gpp={game}>
      <div className={`gpp-card${cur?.preview ? "" : " sound"}`} role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()} data-gpp-tab={tab}>
        <div className="gpp-head">
          <b>設定</b>
          <div className="gpp-tabs" role="tablist" aria-label="設定分頁">
            {order.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} data-gpp-tab-btn={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name(id)}</button>
            ))}
          </div>
          <button type="button" className="gpp-x" aria-label="關閉" data-gpp-close onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="gpp-body" role="tabpanel">
          {cur ? cur.sections.map((s, i) => <Section key={i} s={s} />) : <SoundTab />}
        </div>
        {cur?.preview && (
          <div className="gpp-preview" aria-hidden>
            {cur.preview}
            {cur.previewCap && <div className="cap" data-gpp-cap>{cur.previewCap}</div>}
          </div>
        )}
        <div className="gpp-foot">
          <button type="button" className="gpp-reset" data-gpp-reset onClick={() => (cur ? cur.onReset?.() : resetSound())}>回復預設</button>
          <button type="button" className="gpp-done" data-gpp-done onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

/** 聲音頁「回復預設」：兩條音量、靜音、自動播放回預設，震動改回開 */
function resetSound() {
  const d = DEFAULT_PREFS;
  setPrefs({ voiceVol: d.voiceVol, voiceMuted: d.voiceMuted, fxVol: d.fxVol, fxMuted: d.fxMuted, autoVoice: d.autoVoice });
  setVibrateOn(true);
}

/** 聲音頁（三款一樣）：語音、互動音效兩條音量，最下面「收到語音時自動播放」和「震動」並排 */
function SoundTab() {
  const p = usePrefs();
  const vib = useVibrateOn();
  const can = canVibrate();
  return (
    <>
      <VolumeRow id="voice" label="語音" vol={p.voiceVol} muted={p.voiceMuted} onVol={(v) => setPrefs({ voiceVol: v })} onMute={(m) => setPrefs({ voiceMuted: m })} />
      <p className="gpp-cap">玩家傳的語音訊息。</p>
      <VolumeRow id="fx" label="互動音效" mark vol={p.fxVol} muted={p.fxMuted} onVol={(v) => setPrefs({ fxVol: v })} onMute={(m) => setPrefs({ fxMuted: m })} />
      <p className="gpp-cap">出牌聲、提醒聲、牌型配音、特效、互動道具。70% 是原本的大小，再往右會放大。</p>
      <div className="gpp-pair">
        <SwitchRow id="autovoice" name="收到語音時自動播放" on={p.autoVoice} onChange={(on) => setPrefs({ autoVoice: on })} />
        <SwitchRow id="vibrate" name="震動" on={vib && can} disabled={!can} note={can ? undefined : "這台裝置不支援震動"} onChange={setVibrateOn} />
      </div>
    </>
  );
}

/** 一條音量排成一行：名稱、拉霸（原生 range，鍵盤可調）、百分比、靜音鈕。靜音時拉霸停用、數值保留。mark＝70% 刻度（原本的大小） */
function VolumeRow({ id, label, vol, muted, mark, onVol, onMute }: {
  id: "voice" | "fx"; label: string; vol: number; muted: boolean; mark?: boolean; onVol: (v: number) => void; onMute: (m: boolean) => void;
}) {
  return (
    <div className={`gpp-vol${muted ? " muted" : ""}`} data-gpp-vol={id}>
      <span className="lb">{label}</span>
      <span className={`trk${mark ? " mark" : ""}`}>
        <input type="range" min={0} max={100} step={1} value={vol} aria-label={`${label}音量`} aria-disabled={muted} disabled={muted}
          data-gpp-range={id} style={{ "--p": `${vol}%` } as React.CSSProperties} onChange={(e) => onVol(Math.round(Number(e.target.value)))} />
      </span>
      <span className="pct" data-gpp-pct={id}>{vol}%</span>
      <button type="button" className={`gpp-mute${muted ? " on" : ""}`} aria-pressed={muted} data-gpp-mute={id} onClick={() => onMute(!muted)}>
        <SpeakerIcon muted={muted} />{muted ? "已靜音" : "靜音"}
      </button>
    </div>
  );
}

function SwitchRow({ id, name, on, onChange, disabled, note }: { id: string; name: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <div className={`gpp-row${disabled ? " off" : ""}`} data-gpp-switch-row={id}>
      <span className="lb">{name}{note && <small>{note}</small>}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={name} disabled={disabled} data-gpp-switch={id}
        className={`gpp-switch${on ? " on" : ""}`} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}

function Section({ s }: { s: PrefsSection }) {
  const title = s.title ? <div className="gpp-sec">{s.title}</div> : null;
  if (s.kind === "swatch") return (<>{title}
    <div className="gpp-sws">
      {s.options.map((o) => (
        <button key={o.id} type="button" title={o.name} aria-label={o.name} aria-pressed={s.value === o.id} data-gpp-pick={o.id}
          className={`gpp-sw${s.value === o.id ? " on" : ""}`} style={{ background: o.bg }} onClick={() => s.onChange(o.id)} />
      ))}
    </div></>);
  if (s.kind === "theme") return (<>{title}
    <div className="gpp-themes">
      {s.options.map((o) => (
        <button key={o.id} type="button" aria-pressed={s.value === o.id} data-gpp-pick={o.id} className={`gpp-theme${s.value === o.id ? " on" : ""}`} onClick={() => s.onChange(o.id)}>
          <span className="sw">{o.sw}</span>{o.name}
        </button>
      ))}
    </div></>);
  if (s.kind === "cards") return (<>{title}
    <div className="gpp-cards" style={s.cols ? ({ "--gpp-cols": s.cols } as React.CSSProperties) : undefined}>
      {s.options.map((o) => (
        <button key={o.id} type="button" aria-pressed={s.value === o.id} data-gpp-pick={o.id} className={`gpp-pick${s.value === o.id ? " on" : ""}`} onClick={() => s.onChange(o.id)}>
          <span className="th">{o.thumb}</span>{o.name}
          {o.status && <span className={`st ${o.status.tone}`}>{o.status.text}</span>}
        </button>
      ))}
    </div></>);
  return (<>{title}
    <div className="gpp-pair">
      {s.options.map((o) => <SwitchRow key={o.id} id={o.id} name={o.name} on={o.on} onChange={o.onChange} disabled={o.disabled} note={o.note} />)}
    </div></>);
}
