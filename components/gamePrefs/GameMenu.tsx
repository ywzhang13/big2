"use client";
// 三款共用的左上角 ≡ 選單（小宜〈共用設定面板 v1〉§8 入口）：≡ 36×36（左 6、上 4）→ 選單「⚙ 設定」→ 共用設定面板。
// 按鈕和下拉的外觀直接用麻將的 .mjm-menu、.mjm-menu-pop（只引用、不改）；位置由各遊戲傳 className 決定
import { useState } from "react";
import { GearIcon } from "@/components/mahjong/MjIcons";
import GamePrefsPanel, { type PrefsTab } from "./GamePrefsPanel";
import "./gamePrefsPanel.css";

export default function GameMenu({ game, tabs, className = "gpm" }: { game: string; tabs: PrefsTab[]; className?: string }) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  return (
    <div className={className} data-gpm={game}>
      <button type="button" className="mjm-menu" aria-label="選單" aria-expanded={menu} data-gpm-open onClick={() => setMenu((m) => !m)}>
        <i /><i /><i />
      </button>
      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setMenu(false)} />
          <div className="mjm-menu-pop">
            <button type="button" className="prefs" data-gpm-settings onClick={() => { setMenu(false); setPanel(true); }}><GearIcon />設定</button>
          </div>
        </>
      )}
      {panel && <GamePrefsPanel game={game} open onClose={() => setPanel(false)} tabs={tabs} />}
    </div>
  );
}
