"use client";
// 牌局左上角的設定（小宜 v7 §1，做法同麻將）：⚙ 打開面板 →「牌桌」四個色塊，點了馬上套用、記在本機
import { useState } from "react";
import { applyFelt, FELTS, loadFelt, type FeltKey } from "./feltTheme";
import "./thRoom.css"; // .th-menu 樣式（理牌預覽頁沒有載牌桌樣式）

export default function ThFeltMenu() {
  const [open, setOpen] = useState(false);
  const [felt, setFelt] = useState<FeltKey>("green");
  return (
    <div className="th-menu" data-th-menu>
      <button type="button" className="th-menu-btn" aria-label="設定" aria-expanded={open} data-th-menu-open onClick={() => { if (!open) setFelt(loadFelt()); setOpen(!open); }}>⚙</button>
      {open && (
        <div className="th-menu-panel" role="dialog" aria-label="設定">
          <div className="th-menu-ttl">牌桌</div>
          <div className="th-menu-felts">
            {FELTS.map((f) => (
              <button key={f.key} type="button" className={f.key === felt ? "is-on" : ""} data-th-felt-pick={f.key} aria-pressed={f.key === felt}
                onClick={() => { setFelt(f.key); applyFelt(f.key); }}>
                <i style={{ background: f.swatch }} /><span>{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
