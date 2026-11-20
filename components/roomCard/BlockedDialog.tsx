"use client";
// 被擋的視窗（小宜〈房卡 v1.2〉2-4、2-5；樣式沿用 .mjl-detail）：
//   帳號已暫停（開房、加入被伺服器擋下）：標題＋「暫停時間」一列＋「知道了」；不寫聯絡誰
//   不能開局（房主按開局、房裡有人被暫停）：標題＋房號、一人一列「座位 N　名字　帳號已暫停」、「知道了」
// 關閉：×、點遮罩、知道了、Esc
import { useEffect } from "react";
import { fmtAt, type Blocked } from "./client";
import "./roomCard.css";

export default function BlockedDialog({ blocked, onClose }: { blocked: Blocked | null; onClose: () => void }) {
  useEffect(() => {
    if (!blocked) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [blocked, onClose]);
  if (!blocked) return null;
  const title = blocked.kind === "suspended" ? "帳號已暫停" : "不能開局";
  return (
    <div className="mjl rc-dmask mjl-dmask" onClick={onClose} data-rc-blocked={blocked.kind}>
      <div className="mjl-detail rc-dlg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <b>{title}</b>
          <span className="sub">{blocked.kind === "players" && blocked.code ? `房 ${blocked.code}` : ""}</span>
          <button type="button" className="x" aria-label="關閉" onClick={onClose}>×</button>
        </div>
        <div className="bd">
          {blocked.kind === "suspended" ? (
            blocked.at !== null && <div className="rc-kv"><span>暫停時間</span><b>{fmtAt(blocked.at)}</b></div>
          ) : (
            blocked.players.map((p) => (
              <div key={p.seat} className="rc-kv" data-rc-blocked-seat={p.seat}><span>座位 {p.seat + 1}　{p.name}</span><b className="rc-red">帳號已暫停</b></div>
            ))
          )}
          <button type="button" className="mjl-btn primary rc-ok" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
