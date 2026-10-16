"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { MjFlowerFx as Fx } from "@/hooks/useMahjong";
import MjTile from "./MjTile";

const GAP = 8; // 和名牌的距離
const EDGE = 4; // 離畫面邊緣至少留這麼多

/**
 * 補花特效（小宜 2026-10-16）：補花那一家的名牌旁冒出金色小膠囊（花牌最多 3 張＋N、「補花」），1 秒後往上飄走。
 * 自己＝名牌上方、對家＝右邊（手機在整列牌背和花的右邊，放不下才退回名牌下方）、左家＝右邊、右家＝左邊。掛在 body，才不會被牌桌的 overflow:hidden 切掉
 */
function Pill({ fx, mySeat, desk }: { fx: Fx; mySeat: number; desk: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // 畫面出來前量名牌（data-fx-seat）和膠囊大小，算出膠囊中心點；開局時牌桌剛換上來、名牌位置還會動，
  // 所以播放期間每一格都重算，膠囊跟著名牌走。
  // 膠囊大小用 offsetWidth／offsetHeight：動畫第一格是 scale(.6)，getBoundingClientRect 會量小 40%
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const plateEl = document.querySelector(`[data-fx-seat="${fx.seat}"]`);
      if (!plateEl) return;
      const plate = plateEl.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const pos = (fx.seat - mySeat + 4) % 4; // 0 自己、1 右家（下家）、2 對家、3 左家（上家）
      let x = plate.left + plate.width / 2;
      let y = plate.top + plate.height / 2;
      if (pos === 0) y = plate.top - GAP - h / 2;
      else if (pos === 2) {
        // 手機對家那一列是「名牌｜牌背｜花」，緊貼名牌右邊會蓋到牌背，所以放在整列最右邊的右側
        const row = plateEl.closest(".mjm-top");
        const right = row ? Math.max(...[...row.children].map((c) => c.getBoundingClientRect().right)) : plate.right;
        x = right + GAP + w / 2;
        if (x + w / 2 > window.innerWidth - EDGE) {
          x = plate.left + plate.width / 2;
          y = plate.bottom + GAP + h / 2;
        }
      }
      else if (pos === 3) x = plate.right + GAP + w / 2;
      else x = plate.left - GAP - w / 2;
      x = Math.min(Math.max(x, w / 2 + EDGE), window.innerWidth - w / 2 - EDGE);
      y = Math.min(Math.max(y, h / 2 + EDGE), window.innerHeight - h / 2 - EDGE);
      el.style.setProperty("--ffx-x", `${x}px`);
      el.style.setProperty("--ffx-y", `${y}px`);
    };
    place();
    let raf = requestAnimationFrame(function tick() {
      place();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [fx.seat, mySeat]);

  const [tw, th] = desk ? [26, 35] : [18, 24];
  const more = fx.tiles.length - 3;
  return (
    <div
      ref={ref}
      className={`mjm-flowerfx ${desk ? "desk" : ""}`}
      style={{ "--ffx-delay": `${fx.delay}s` } as React.CSSProperties}
      data-flower-fx-seat={fx.seat}
      aria-hidden
    >
      <span className="tiles">
        {fx.tiles.slice(0, 3).map((t) => (
          <MjTile key={t.id} tile={t} width={tw} height={th} />
        ))}
        {more > 0 && <span className="more">+{more}</span>}
      </span>
      <span className="lb">補花</span>
    </div>
  );
}

export default function MjFlowerFx({ fx, mySeat, desk }: { fx: Fx[]; mySeat: number; desk: boolean }) {
  if (fx.length === 0 || mySeat < 0) return null;
  return createPortal(
    <>
      {fx.map((f) => (
        <Pill key={f.key} fx={f} mySeat={mySeat} desk={desk} />
      ))}
    </>,
    document.body,
  );
}
