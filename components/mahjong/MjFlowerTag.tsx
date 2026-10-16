"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile from "./MjTile";

const EDGE = 6; // 展開面板離畫面邊緣、離膠囊的距離
const AUTO_CLOSE_MS = 3000;
const OPEN_EVENT = "mj-flowertag-open"; // 一次只開一個：開新的時通知其他膠囊收起來

/**
 * 花牌收合（小宜吃碰區 v2）：平時是一顆「花牌縮圖＋×N」膠囊，點一下在上方展開全部花牌。
 * 再點一次、點別處、Esc、3 秒、busy（輪到自己打牌／有吃碰槓胡按鈕）都會收起來。
 * 面板掛在 body（position: fixed），才不會被吃碰區、對家列的 overflow:hidden 切掉。
 */
export default function MjFlowerTag({
  flowers,
  name,
  w,
  h,
  popW,
  popH,
  busy,
}: {
  flowers: Tile[];
  name: string;
  w: number;
  h: number;
  popW: number;
  popH: number;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tagRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Math.random());
  const shown = open && !busy && flowers.length > 0;

  useEffect(() => {
    if (!shown) return;
    const id = idRef.current;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== id) setOpen(false); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!tagRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const timer = setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
    window.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  // 忙碌時（輪到自己打牌等）連「打開」的狀態也清掉，busy 結束後不會自己又跳出來
  useEffect(() => { if (busy) setOpen(false); }, [busy]);

  // 定位：水平置中對齊膠囊、放在上方；上面放不下就翻到下方；最後夾回畫面內
  useLayoutEffect(() => {
    if (!shown) return;
    const tag = tagRef.current, pop = popRef.current;
    if (!tag || !pop) return;
    const r = tag.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = r.top - EDGE - ph;
    if (top < EDGE) top = r.bottom + EDGE;
    top = Math.min(Math.max(top, EDGE), window.innerHeight - EDGE - ph);
    const left = Math.min(Math.max(r.left + r.width / 2 - pw / 2, EDGE), window.innerWidth - EDGE - pw);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }, [shown]);

  if (flowers.length === 0) return null;
  return (
    <>
      <button
        ref={tagRef}
        type="button"
        className={`mjm-flowertag ${shown ? "open" : ""}`}
        aria-label={`${name}的花 ${flowers.length} 張，點一下展開`}
        aria-expanded={shown}
        onClick={() => setOpen((v) => !v)}
      >
        <MjTile tile={flowers[0]} width={w} height={h} />
        <b>×{flowers.length}</b>
      </button>
      {shown &&
        createPortal(
          <div ref={popRef} className="mjm-flowerpop" role="dialog" style={{ left: -9999, top: -9999 }}>
            <span className="hd">{name}的花 · {flowers.length} 張</span>
            <div className="tiles">
              {flowers.map((f) => <MjTile key={f.id} tile={f} width={popW} height={popH} />)}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
