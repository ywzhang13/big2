"use client";

import { useEffect, useState } from "react";
import MjTile from "./MjTile";
import ZimoFxPreferencePreview from "./ZimoFxPreferencePreview";
import type { Tile } from "@/lib/mahjong/tiles";
import { BACKS, FELTS, THEMES, DEFAULT_PREFS, usePrefs, setPrefs, type BackId, type FeltId } from "@/lib/mahjong/prefs";
import { CloseIcon, SpeakerIcon } from "./MjIcons";
import { getMyFx, rejectedSelected, selectMyFx, type MyZimoFx, type ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";

type FxChoice = ZimoFxChoice;

const FX_CARDS: { code: FxChoice; name: string; art?: string }[] = [
  { code: "golden", name: "金色自摸" },
  { code: "meteor", name: "隕石", art: "/mahjong-fx/meteor/meteor-title.webp" },
  { code: "thunder", name: "雷霆", art: "/mahjong-fx/zimo/thunder/thunder-title.webp" },
  { code: "storm", name: "風暴", art: "/mahjong-fx/zimo/storm/storm-title.webp" },
  { code: "frost", name: "冰封", art: "/mahjong-fx/zimo/frost/frost-title.webp" },
  { code: "blackhole", name: "黑洞", art: "/mahjong-fx/zimo/blackhole/blackhole-title.webp" },
  { code: "sakura", name: "櫻花", art: "/mahjong-fx/zimo/sakura/sakura-title.webp" },
];

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
 *  改了立刻生效；點遮罩、關閉鈕、「完成」或 Esc 關閉。
 *  「自摸特效」分頁（老馬 2026-10-31，小宜〈自摸特效庫與斗內系統〉5）：打開面板時問一次伺服器，有開通的特效才出現；
 *  點卡片＝預覽（先顯示特效名稱，新特效素材到了再換成真的動畫），按「套用」才改設定。老闆：不顯示到期、說明文字 */
export default function MjPrefsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"look" | "sound" | "fx">("look");
  const prefs = usePrefs();
  const [fx, setFx] = useState<MyZimoFx | null>(null); // null＝沒登入 LINE、沒開通或取不到：不顯示分頁
  const [pick, setPick] = useState<FxChoice | null>(null);
  const [replay, setReplay] = useState(0);
  const [fxBusy, setFxBusy] = useState(false);
  const [fxErr, setFxErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getMyFx().then((r) => {
      if (!alive) return;
      const signedIn = r.ok;
      setFx(signedIn ? r.data : null);
      setPick(signedIn ? r.data.selected ?? "golden" : null);
      if (!signedIn) setTab((t) => (t === "fx" ? "look" : t));
    });
    return () => { alive = false; };
  }, [open]);

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
  const isGranted = (choice: FxChoice) => !!fx && choice in fx.available;
  const selectedChoice: FxChoice = fx?.selected ?? "golden";
  const apply = async () => {
    if (!pick || !isGranted(pick) || fxBusy) return;
    setFxBusy(true); setFxErr(false);
    const r = await selectMyFx(pick);
    setFxBusy(false);
    if (r.ok) { setFx((cur) => (cur ? { ...cur, selected: r.data.selected } : cur)); return; }
    // 被拒（這段時間剛好過期、被收回）：照伺服器說的改回目前實際套用的那一種，畫面不停在被拒的那張；再重抓一次開通清單
    const now = rejectedSelected(r);
    if (now) {
      setFx((cur) => (cur ? { ...cur, selected: now } : cur));
      setPick(now);
      void getMyFx().then((g) => { if (g.ok) setFx(g.data); });
      return;
    }
    setFxErr(true);
  };

  return (
    <div className="mjp-mask" onClick={close} data-prefs-panel>
      <div className={`mjp-card ${tab}`} role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="mjp-head">
          <b>設定</b>
          <div className="mjp-tabs" role="tablist" aria-label="設定分頁">
            {([["look", "外觀"], ["sound", "聲音"], ...(fx ? [["fx", "自摸特效"]] as const : [])] as const).map(([id, name]) => (
              <button key={id} type="button" role="tab" id={`mjp-tab-${id}`} aria-selected={tab === id} aria-controls="mjp-body" data-prefs-tab={id}
                className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}</button>
            ))}
          </div>
          <button type="button" className="mjp-x" aria-label="關閉" onClick={close}><CloseIcon /></button>
        </div>
        <div className="mjp-body" id="mjp-body" role="tabpanel" aria-labelledby={`mjp-tab-${tab}`} data-prefs-body={tab}>
          {tab === "fx" && fx ? (
          <div className="mjp-fxs" data-prefs-fx-list>
            {FX_CARDS.map(({ code, name, art }) => {
              const granted = isGranted(code);
              const current = selectedChoice === code;
              return <button key={code} type="button" data-prefs-fx={code} aria-pressed={pick === code}
                // 沒開通的只能預覽：點了是灰色虛線框（peek），不會變成和「選中／使用中」一樣的金框；「使用中」只照伺服器回傳的 selected
                className={`mjp-fx ${pick === code ? (granted ? "on" : "peek") : ""} ${granted ? "granted" : "locked"}`}
                onClick={() => { setPick(code); setReplay((n) => n + 1); setFxErr(false); }}>
                <span className={`mjp-fx-thumb ${code === "golden" ? "gold" : ""}`}>
                  {art && <img src={art} alt="" />}
                </span>
                <span>{name}</span>
                <span className={current ? "use" : granted ? "ready" : "lock"} data-prefs-fx-state={code}>
                  {current ? "使用中" : granted ? "可使用" : "僅預覽"}
                </span>
              </button>
            })}
          </div>
          ) : tab === "look" ? (<>
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
        {tab === "fx" && pick && <div className="mjp-preview" aria-live="polite">
          <ZimoFxPreferencePreview fx={pick} replay={replay} muted={prefs.fxMuted} volume={prefs.fxVol} name={fx?.displayName ?? "LINE 使用者"} />
        </div>}
        <div className="mjp-foot">
          {tab === "fx" ? (
            <button type="button" className="mjp-apply" data-prefs-fx-apply disabled={!pick || !isGranted(pick) || fxBusy || selectedChoice === pick} onClick={apply}>
              {fxErr ? "套用失敗，再試一次" : selectedChoice === pick ? "使用中" : pick && isGranted(pick) ? "套用" : "尚未開通"}
            </button>
          ) : (
          /* 回復預設：只回復目前這個分頁的設定 */
          <button type="button" className="mjp-reset" data-prefs-reset onClick={() => setPrefs(tab === "look"
            ? { back: DEFAULT_PREFS.back, felt: DEFAULT_PREFS.felt }
            : { voiceVol: DEFAULT_PREFS.voiceVol, voiceMuted: DEFAULT_PREFS.voiceMuted, fxVol: DEFAULT_PREFS.fxVol, fxMuted: DEFAULT_PREFS.fxMuted, autoVoice: DEFAULT_PREFS.autoVoice })}>回復預設</button>
          )}
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
