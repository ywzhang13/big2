"use client";

// 吃碰槓宣告提示（小宜 2026-10-17 方向 C「吃碰區原地閃」）：剛吃碰槓的那一副亮金框，旁邊彈一顆「碰 小林」標籤，0.75 秒淡掉。
// 掛在 body（position: fixed，不被牌桌的 overflow 切掉）、pointer-events: none（不擋吃碰槓胡過的按鈕）。
// 位置從畫面上那一家的吃碰區量（[data-claim-seat] 的最後一副）。自己那一家的吃碰區在資訊列裡，上面是動作列、下面是手牌：
// 金框不外擴、標籤小一號、橫向貼在那一副的右邊。
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const WORD: Record<string, string> = { chi: "吃", pong: "碰", kong: "槓", concealed_kong: "暗槓", add_kong: "加槓" };

export default function MjClaimFx({
  notice,
  name,
  mySeat,
  desk = false,
}: {
  notice: { seat: number; type: string; key?: number } | null;
  name: string;
  mySeat: number;
  desk?: boolean;
}) {
  const haloRef = useRef<HTMLSpanElement>(null);
  const tagRef = useRef<HTMLSpanElement>(null);
  const seat = notice?.seat;
  const key = notice?.key;
  // 畫面出來前量好那一副牌的位置，直接寫進樣式（和 DeclareFx 同一個做法）
  useLayoutEffect(() => {
    const halo = haloRef.current, tag = tagRef.current;
    if (seat == null || !halo || !tag) return;
    const group = document.querySelector(`[data-claim-seat="${seat}"]`);
    const r = (group?.lastElementChild ?? document.querySelector(`[data-fx-seat="${seat}"]`))?.getBoundingClientRect();
    const box = halo.parentElement as HTMLElement;
    if (!r) { box.style.display = "none"; return; }
    box.style.display = "";
    const self = seat === mySeat;
    const across = seat === (mySeat + 2) % 4;
    const grow = self ? 0 : 3;
    Object.assign(halo.style, { left: `${r.left - grow}px`, top: `${r.top - grow}px`, width: `${r.width + grow * 2}px`, height: `${r.height + grow * 2}px` });
    // 自己那一家：標籤貼在那一副的右邊；右邊放不下（電腦版吃碰區在資訊列最右邊）就改貼左邊
    const tagW = (tag.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    const selfRight = r.right + 6 + tagW <= window.innerWidth - 4;
    const [left, top, transform] = self
      ? selfRight ? [r.right + 6, r.top + r.height / 2, "translateY(-50%)"] : [r.left - 6, r.top + r.height / 2, "translate(-100%, -50%)"]
      : across
        ? [r.left + r.width / 2, r.bottom + 4, "translateX(-50%)"]
        : [r.left + r.width / 2, r.top - (desk ? 30 : 22), "translateX(-50%)"];
    Object.assign(tag.style, { left: `${left}px`, top: `${top}px`, transform });
  }, [seat, key, mySeat, desk]);
  if (!notice || typeof document === "undefined") return null;
  const self = notice.seat === mySeat;
  return createPortal(
    <div key={notice.key} className={`mjm-claimfx${desk ? " desk" : ""}`} aria-hidden data-claim-fx={notice.seat}>
      <span ref={haloRef} className="halo" />
      {/* 外層負責定位（translate），內層跑動畫（scale），兩個 transform 才不會互相蓋掉 */}
      <span ref={tagRef} className="tagpos">
        <span className={`tag${self ? " small" : ""}`}>
          <b>{WORD[notice.type] ?? notice.type}</b>
          <span>{name}</span>
        </span>
      </span>
    </div>,
    document.body,
  );
}
