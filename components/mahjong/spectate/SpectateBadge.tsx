import { EyeIcon } from "../MjIcons";

/** 名牌旁的被觀戰人數（小宜規格 5.7；老闆 2026-10-30 定案同桌每個人都看得到）。0 人不顯示 */
export default function SpectateBadge({ count, desk = false }: { count?: number; desk?: boolean }) {
  if (!count) return null;
  return (
    <span className={`spx-badge${desk ? " d" : ""}`} title={`${count} 人正在觀戰`} aria-label={`被 ${count} 人觀戰`} data-spectate-count={count}>
      <EyeIcon size={desk ? 14 : 12} />
      {count}
    </span>
  );
}
