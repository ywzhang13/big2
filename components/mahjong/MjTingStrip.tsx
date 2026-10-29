"use client";
// 聽牌剩張（老闆 2026-10-29）：只顯示「小牌面＋數字」，不加說明文字；剩 0 張就顯示 0。點牌預覽和眼牌後常駐都放左下角、同一個樣式。
// 張數一律由 lib/mahjong/tingInfo.ts（老柯）算，這裡只負責畫。另附名牌頭像（LINE 頭像，沒有就顯示原本的風位圖示）
import { useState } from "react";
import MjTile from "./MjTile";
import { parseKey, WIND_NAMES, DRAGON_NAMES } from "@/lib/mahjong/tiles";
import type { WaitLeft } from "@/lib/mahjong/tingInfo";

const NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SUIT: Record<string, string> = { m: "萬", p: "筒", s: "條" };

/** 牌的短名：三萬、五筒、七條、東、中…… */
export function tileShortName(key: string): string {
  const { suit, rank } = parseKey(key);
  if (suit === "z") return [...WIND_NAMES, ...DRAGON_NAMES][rank - 1] ?? key;
  return `${NUM[rank] ?? rank}${SUIT[suit] ?? ""}`;
}

export function MjTingStrip({ waits, className, testId }: { waits: WaitLeft[]; className?: string; testId?: string }) {
  if (!waits.length) return null;
  return (
    <div className={`mjm-ting ${className ?? ""}`} data-ting-strip={testId}>
      {waits.map((w, i) => {
        const { suit, rank } = parseKey(w.key);
        // 用遊戲裡的牌面圖（小尺寸）＋張數，不用文字（老闆 2026-10-29）；牌名放在 aria-label
        return (
          // 剩 0 張：數字紅色、小牌面調暗，不加文字（老闆 2026-10-29）
          <span key={w.key} className={`it ${w.left === 0 ? "zero" : ""}`} data-ting-key={w.key} data-ting-left={w.left} aria-label={`${tileShortName(w.key)}${w.left}張`}>
            <MjTile tile={{ id: -9000 - i, suit, rank, display: tileShortName(w.key) }} width="var(--ting-tile-w)" height="var(--ting-tile-h)" />
            <b>{w.left}</b>
          </span>
        );
      })}
    </div>
  );
}

/** 名牌頭像（A 款風位側章，老闆 2026-10-29）：有 LINE 頭像＝左邊風位小方章＋圓形頭像並排、不重疊；
 *  訪客、沒頭像、圖片載入失敗 → 只顯示原本的風位圖示當頭像，風位不重複 */
export function MjAvatar({ url, fallback, size }: { url?: string | null; fallback: React.ReactNode; size: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!url || broken === url) return <>{fallback}</>;
  return (
    <span className="mjm-av" style={{ "--av": `${size}px` } as React.CSSProperties}>
      <span className="mjm-wseal">{fallback}</span>
      <span className="mjm-avatar" data-avatar>
        {/* 外部頭像網址（LINE CDN），不經過 next/image 最佳化 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(url)} />
      </span>
    </span>
  );
}
