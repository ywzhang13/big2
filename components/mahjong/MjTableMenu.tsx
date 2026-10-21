"use client";

import { useState } from "react";
import { openPrefs } from "@/lib/mahjong/prefs";
import { GearIcon } from "./MjIcons";

/** 牌桌左上 ☰ 選單（手機、桌機共用；小宜〈設定整併與雙音量及關閉互動〉）：
 *  第一列「設定」（唯一的設定入口，右上齒輪和「偏好設定／聊天設定」兩列都拿掉了），下面是房號、圈局、底台、離開房間 */
export default function MjTableMenu({
  roomCode, roundLabel, basePoints, fanPoints, onLeave, desk = false,
}: {
  roomCode: string;
  roundLabel?: string;
  basePoints?: number;
  fanPoints?: number;
  onLeave: () => void;
  desk?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const d = desk ? " d" : "";
  return (
    <>
      <button type="button" className={`mjm-menu${d}`} aria-label="選單" aria-expanded={open} data-table-menu onClick={() => setOpen((o) => !o)}>
        <i /><i /><i />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setOpen(false)} />
          <div className={`mjm-menu-pop${d}`}>
            <button
              type="button"
              className="prefs"
              data-menu-settings
              onClick={() => {
                setOpen(false);
                openPrefs();
              }}
            >
              <GearIcon />
              設定
            </button>
            <span className="info">房號 {roomCode}</span>
            {roundLabel && <span className="info">{roundLabel}</span>}
            {basePoints != null && fanPoints != null && (
              <span className="info">底{basePoints} / 台{fanPoints}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
            >
              離開房間
            </button>
          </div>
        </>
      )}
    </>
  );
}
