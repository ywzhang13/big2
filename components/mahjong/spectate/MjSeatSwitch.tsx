"use client";

// 觀戰、回放共用的視角切換（小宜〈觀戰與回放-視角切換設計規格-2026-11-13〉）：四家常駐平鋪、點一下就換，
// 不用展開選單；放在牌桌外的控制區（正常文件流），不蓋任何牌。固定照東、南、西、北排，風位綁真實座位。
// collapsible（手機觀戰，老闆 2026-11-13）：平常只有一顆「視角・○○」，按下去才在它下面長出四家；選好或點旁邊就收回，
// 收起時切換列只剩一條細列，牌桌多出高度。展開時切換列在版面上仍是收起時的高度（牌桌、手牌不動、不跳），
// 兩行面板貼底浮起、蓋住手牌下半部（小宜 2026-11-13）。回放、桌機不傳就和原本一樣四家平鋪。
import { useEffect, useRef, useState } from "react";
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

export default function MjSeatSwitch({ mode, options, current, onSelect, doorSeat, dealerSeat, compact, collapsible }: {
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
}) {
  const known = dealerSeat != null;
  const wind = (s: number) => (known ? seatWindChar(s, doorSeat, dealerSeat!) : "");
  const list = [...options].sort((a, b) => (known ? ORDER.indexOf(wind(a.seat)) - ORDER.indexOf(wind(b.seat)) : a.seat - b.seat));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** 展開時把切換列固定在收起時的高度（面板浮起來，不擠牌桌） */
  const [holdH, setHoldH] = useState<number | null>(null);
  const expanded = !collapsible || open;

  // 收合式展開時：點這一塊以外的地方、按 Esc、轉向就收回
  useEffect(() => {
    if (!collapsible || !open) return;
    const down = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    const resize = () => setOpen(false); // 轉向、改尺寸：固定住的高度不準了，先收回
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, [collapsible, open]);
  // 收合式選好一家：收回，焦點回到「視角」鈕（選項按鈕會被拿掉，鍵盤使用者不會失去位置）
  const pick = (seat: number) => { if (seat !== current) onSelect(seat); if (collapsible) { setOpen(false); toggleRef.current?.focus(); } };
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

  return (
    <div ref={rootRef} className={`mss${compact ? " c" : ""}${collapsible ? " fold" : ""}${collapsible && open ? " open" : ""}`} data-seat-switch
      style={collapsible && open && holdH ? { height: holdH } : undefined}>
      <Sheet on={!!collapsible}>
      <span className="mss-mode">{mode}</span>
      {collapsible && (
        <button ref={toggleRef} type="button" className="mss-toggle" aria-expanded={open} aria-haspopup="true" title={cur?.name}
          onClick={() => { if (!open) setHoldH(rootRef.current?.offsetHeight ?? null); setOpen(!open); }} data-seat-switch-toggle>
          <span className="lb">視角</span>
          {cur && <><span aria-hidden className="dot">・</span><span className="n">{cur.name}</span></>}
          <span aria-hidden className="car">{open ? "▴" : "▾"}</span>
        </button>
      )}
      {expanded && <div className="mss-group" role="radiogroup" aria-label="切換視角">
        {list.map((o, i) => {
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
        })}
      </div>}
      </Sheet>
    </div>
  );
}

/** 收合式才包一層（展開時這一層貼底浮起）；平鋪時不包，排版和原本完全一樣 */
function Sheet({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <div className="mss-sheet">{children}</div> : <>{children}</>;
}
