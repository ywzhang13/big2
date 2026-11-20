"use client";
// 右上角房卡張數（小宜〈房卡 v1.2〉2-1）：頭像左邊；小牌圖示＋數字，沒有字；負數紅色寫「−12」；不能點。
// 老闆、遊客（balance＝null）、還沒讀到：不顯示
import type { MyCards } from "./client";
import { fmtCards } from "./client";
import "./roomCard.css";

export default function RoomCardChip({ me }: { me: MyCards | null }) {
  if (!me || me.isOwner || me.balance === null) return null;
  const b = me.balance;
  return (
    <span className={`rc-chip${b < 0 ? " neg" : b === 0 ? " zero" : ""}`} data-rc-chip={b} aria-label={`房卡 ${b} 張`}>
      <svg className="rc-ico" width="14" height="16" viewBox="0 0 14 16" aria-hidden>
        <rect x="1" y="1" width="12" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 4.6 9.4 8 7 11.4 4.6 8Z" fill="currentColor" />
      </svg>
      {fmtCards(b)}
    </span>
  );
}
