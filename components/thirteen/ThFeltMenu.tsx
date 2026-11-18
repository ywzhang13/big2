"use client";
// 牌局左上角的選單與設定（老闆 2026-11-18：比照麻將）：≡ 選單 →「設定」→ 麻將同款設定面板（外觀／聲音兩頁）。
// 直接用麻將的樣式（globals.css 的 .mjm-menu、.mjm-menu-pop、.mjp-*），麻將元件本身不動。
// 外觀：桌布四款色塊，點了馬上套用、記在本機；聲音：音效開關。面板用 portal 掛在 body，不受牌桌縮放影響
import { useState } from "react";
import { createPortal } from "react-dom";
import { applyFelt, FELTS, loadFelt, type FeltKey } from "./feltTheme";
import { setSfxOn, sfxOn } from "./sfx";
import { CARD_BACK_SRC, cardSrc } from "./cardArt";
import { GearIcon, CloseIcon } from "@/components/mahjong/MjIcons";
import { makeCard } from "@/lib/thirteen";
import "./thRoom.css"; // .th-menu 位置（理牌預覽頁沒有載牌桌樣式）

/** 桌布色塊：和牌桌同一組中心色→邊緣色（thRoom.css 的 --th-c*） */
const FELT_SW: Record<FeltKey, [string, string, string]> = {
  green: ["#1F6B45", "#0F3D28", "#06180F"], blue: ["#24507F", "#12294A", "#070F1E"],
  wine: ["#7A2A3A", "#431520", "#190709"], gray: ["#4A4E55", "#26282D", "#0E0F11"],
};
const PREVIEW = [makeCard("S", 14, 1), makeCard("H", 13, 1)];

export default function ThFeltMenu() {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState<"look" | "sound">("look");
  const [felt, setFelt] = useState<FeltKey>("green");
  const [sound, setSound] = useState(true);
  const pickFelt = (k: FeltKey) => { setFelt(k); applyFelt(k); };
  const open = () => { setFelt(loadFelt()); setSound(sfxOn()); setMenu(false); setPanel(true); };
  return (
    <div className="th-menu" data-th-menu>
      <button type="button" className="mjm-menu th-menu-btn" aria-label="選單" aria-expanded={menu} data-th-menu-open onClick={() => setMenu((m) => !m)}>
        <i /><i /><i />
      </button>
      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setMenu(false)} />
          <div className="mjm-menu-pop th-menu-pop">
            <button type="button" className="prefs" data-th-menu-settings onClick={open}><GearIcon />設定</button>
          </div>
        </>
      )}
      {panel && typeof document !== "undefined" && createPortal(
        <div className="mjp-mask" onClick={() => setPanel(false)} data-th-prefs>
          <div className={`mjp-card ${tab}`} role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()}>
            <div className="mjp-head">
              <b>設定</b>
              <div className="mjp-tabs" role="tablist" aria-label="設定分頁">
                {([["look", "外觀"], ["sound", "聲音"]] as const).map(([id, name]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} data-th-prefs-tab={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}</button>
                ))}
              </div>
              <button type="button" className="mjp-x" aria-label="關閉" onClick={() => setPanel(false)}><CloseIcon /></button>
            </div>
            <div className="mjp-body" role="tabpanel">
              {tab === "look" ? (<>
                <div className="mjp-sec">桌布</div>
                <div className="mjp-sws">
                  {FELTS.map((f) => (
                    <button key={f.key} type="button" data-th-felt-pick={f.key} title={f.name} aria-label={f.name} aria-pressed={felt === f.key}
                      className={`mjp-sw ${felt === f.key ? "on" : ""}`} style={{ background: `linear-gradient(145deg, ${FELT_SW[f.key].join(",")})` }}
                      onClick={() => pickFelt(f.key)} />
                  ))}
                </div>
              </>) : (
                <div className="mjp-row">
                  <span className="lb">音效</span>
                  <button type="button" role="switch" aria-checked={sound} aria-label="音效" data-th-sfx-toggle className={`mjp-switch ${sound ? "on" : ""}`}
                    onClick={() => { setSound(!sound); setSfxOn(!sound); }}><i /></button>
                </div>
              )}
            </div>
            {tab === "look" && <div className="mjp-preview" aria-hidden>
              <div className="felt" style={{ background: `radial-gradient(ellipse at 50% 46%, ${FELT_SW[felt][0]}, ${FELT_SW[felt][1]} 60%, ${FELT_SW[felt][2]})` }}>
                <div className="row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={CARD_BACK_SRC} alt="" width={36} height={50} style={{ maxWidth: "none" }} />
                  {PREVIEW.map((c) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={c.id} src={cardSrc(c)} alt="" width={36} height={50} style={{ maxWidth: "none" }} />
                  ))}
                </div>
              </div>
              <div className="cap" data-th-prefs-cap>{FELTS.find((f) => f.key === felt)?.name}</div>
            </div>}
            <div className="mjp-foot">
              <button type="button" className="mjp-reset" onClick={() => (tab === "look" ? pickFelt("green") : (setSound(true), setSfxOn(true)))}>回復預設</button>
              <button type="button" className="mjp-done" onClick={() => setPanel(false)}>完成</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
