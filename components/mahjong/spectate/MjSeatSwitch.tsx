"use client";

// 觀戰、回放共用的視角切換（小宜〈觀戰與回放-視角切換設計規格-2026-11-13〉）：四家常駐平鋪、點一下就換，
// 不用展開選單；放在牌桌外的控制區（正常文件流），不蓋任何牌。固定照東、南、西、北排，風位綁真實座位。
// collapsible（手機觀戰，老闆 2026-11-14）：不再佔底部一整條，也不寫「觀戰中」；只是一顆「視角・○○」小鈕，
// 由觀戰頁放進被看那家名牌列（聊天鈕旁邊）。按下去四家在同一列、鈕的左邊橫向展開，底邊貼齊名牌列底（不蓋手牌），
// 選好、點旁邊、按 Esc、轉向就收回，焦點回到視角鈕。回放、桌機不傳就和原本一樣四家平鋪。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { seatWindChar } from "../seatWind";
import "./seatSwitch.css";

export interface SeatOption {
  seat: number;
  name: string;
  /** 不能切過去的原因（例如觀戰還沒同意）；有值就停用，並把原因寫在按鈕上 */
  disabledReason?: string;
  /** 名字下面的小字（例如回放裡的「自己」），不影響能不能按 */
  note?: string;
}

const ORDER = ["東", "南", "西", "北"];
/** 收合式選了別家：觀戰頁換視角時牌桌（連同名牌列上的視角鈕）會先拿掉再畫，畫回來時把焦點放回視角鈕。
 *  只在選完後幾秒內有效：切換被拒絕、關房、離頁沒有重畫時自動作廢，不會在之後別的時候突然搶焦點（審伯 2026-11-14 建議） */
let refocusUntil = 0;
const REFOCUS_MS = 5000;

export default function MjSeatSwitch({ mode, options, current, onSelect, doorSeat, dealerSeat, compact, collapsible, boundLeft }: {
  mode: "觀戰中" | "回放中";
  options: SeatOption[];
  current: number | null;
  onSelect: (seat: number) => void;
  /** 風位：開門那家是東（和牌桌名牌同一條規則）；還不知道（例如視角載入中）就照座位順序、不顯示風位 */
  doorSeat?: number;
  dealerSeat?: number;
  compact?: boolean;
  /** 收合式：平常只顯示「視角・目前那家」，按下去才展開四家 */
  collapsible?: boolean;
  /** 收合式展開時，選單往左最多到哪裡（畫面座標；例如手牌左緣＝安全區內）；選單寬度限制在這裡到視角鈕之間 */
  boundLeft?: () => number;
}) {
  const known = dealerSeat != null;
  const wind = (s: number) => (known ? seatWindChar(s, doorSeat, dealerSeat!) : "");
  const list = [...options].sort((a, b) => (known ? ORDER.indexOf(wind(a.seat)) - ORDER.indexOf(wind(b.seat)) : a.seat - b.seat));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // 收合式展開時：點這一塊以外的地方、按 Esc、轉向就收回
  useEffect(() => {
    if (!collapsible || !open) return;
    const down = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    const resize = () => setOpen(false); // 轉向、改尺寸：先收回
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, [collapsible, open]);
  // 收合式選好一家：收回，焦點回到「視角」鈕（選項按鈕會被拿掉，鍵盤使用者不會失去位置）
  const pick = (seat: number) => {
    if (collapsible) { setOpen(false); toggleRef.current?.focus(); if (seat !== current) refocusUntil = Date.now() + REFOCUS_MS; }
    if (seat !== current) onSelect(seat);
  };
  useEffect(() => {
    if (!collapsible || !refocusUntil) return;
    const due = Date.now() <= refocusUntil;
    refocusUntil = 0;
    if (due) toggleRef.current?.focus();
  }, [collapsible]);
  // 展開時：選單寬度不超過「左界～視角鈕」，長名字＋未同意原因也不會撐出安全區（審伯 2026-11-14）
  const [maxW, setMaxW] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!collapsible || !open) return;
    const t = toggleRef.current?.getBoundingClientRect();
    if (t) setMaxW(Math.max(120, t.left - 6 - ((boundLeft?.() ?? 0) + 4)));
  }, [collapsible, open, boundLeft]);
  const cur = options.find((o) => o.seat === current);

  // 單選群組：左右方向鍵在可以切換的選項間移動並切換
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    e.stopPropagation(); // 回放頁的方向鍵是上一步／下一步，在這裡按時不要觸發
    const step = e.key === "ArrowRight" ? 1 : -1;
    for (let k = 1; k <= list.length; k++) {
      const j = (i + step * k + list.length) % list.length;
      if (!list[j].disabledReason) { refs.current[j]?.focus(); if (list[j].seat !== current) onSelect(list[j].seat); return; } // 方向鍵：切換但不收回
    }
  };

  const buttons = list.map((o, i) => {
    const on = o.seat === current;
    const w = wind(o.seat);
    return (
      <button
        key={o.seat}
        ref={(el) => { refs.current[i] = el; }}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={`切換至${w ? `${w}風，` : ""}${o.name}${o.note ? `（${o.note}）` : ""}${o.disabledReason ? `，${o.disabledReason}` : ""}`}
        title={o.name}
        tabIndex={on || (current == null && i === 0) ? 0 : -1}
        disabled={!!o.disabledReason}
        className={`mss-btn${on ? " on" : ""}`}
        onClick={() => pick(o.seat)}
        onKeyDown={(e) => onKey(e, i)}
        data-seat-switch-seat={o.seat}
      >
        <span className="l1">
          {on && <span aria-hidden className="ck">✓</span>}
          {w && <span className="w">{w}</span>}
          <span className="n">{o.name}</span>
        </span>
        {(o.disabledReason ?? o.note) && <span className="l2">{o.disabledReason ?? o.note}</span>}
      </button>
    );
  });

  // 收合式：名牌列上的一顆小鈕＋同一列展開的四家
  if (collapsible) {
    return (
      <span ref={rootRef} className={`mss-pick${open ? " open" : ""}`} data-seat-switch>
        <button ref={toggleRef} type="button" className="mss-toggle" aria-expanded={open} aria-haspopup="true" title={cur?.name}
          onClick={() => setOpen(!open)} data-seat-switch-toggle>
          <span className="lb">視角</span>
          {cur && <><span aria-hidden className="dot">・</span><span className="n">{cur.name}</span></>}
          <span aria-hidden className="car">{open ? "▸" : "◂"}</span>
        </button>
        {open && <span className="mss-group" role="radiogroup" aria-label="切換視角" style={maxW ? { maxWidth: maxW } : undefined}>{buttons}</span>}
      </span>
    );
  }

  return (
    <div ref={rootRef as React.RefObject<HTMLDivElement>} className={`mss${compact ? " c" : ""}`} data-seat-switch>
      <span className="mss-mode">{mode}</span>
      <div className="mss-group" role="radiogroup" aria-label="切換視角">{buttons}</div>
    </div>
  );
}
