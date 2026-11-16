"use client";
// 十三支理牌畫面（小宜〈十三支-畫面設計說明-v2〉③ 理牌）。
// 牌型、倒水、推薦排法一律用計分引擎 lib/thirteen；所有改牌的操作都在 arrangeState.ts 的 reducer（送出後一律擋下），
// 這個元件只管畫面、查拖曳放開的位置、倒數，以及送出時呼叫一次 onSubmit。
// 操作：點選（點手牌選取→點墩放入；點墩裡的牌退回）和拖曳（手牌↔墩、墩↔墩；拖到滿的墩的某張牌上＝兩張互換）。
// 拖曳用 Pointer Events，滑鼠和觸控同一套；牌加 touch-action:none，iPhone 上拖的時候畫面不會捲動。
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Arrangement, Card, Row } from "@/lib/thirteen";
import { CAT_NAME, evalRow } from "@/lib/thirteen";
import { cardSrc } from "./cardArt";
import { findCombos, SHORTCUTS, type ShortcutKind } from "./shortcuts";
import { arrangeReducer, derive, HAND, initArrange, ROW_NAME, ROW_SIZE, ROWS, rowLabel, type ArrangeAction, type Zone } from "./arrangeState";
import "./thArrange.css";

export interface ThArrangeProps {
  /** 發到的 13 張 */
  cards: Card[];
  /** 理牌截止時間（毫秒時間戳）。到了：排好且不倒水就照目前的送出，否則用引擎的 autoArrange 送出 */
  deadline: number;
  /** 送出（只會呼叫一次）。送出後畫面鎖住，不能再改 */
  onSubmit: (a: Arrangement) => void;
}

export default function ThArrange({ cards, deadline, onSubmit }: ThArrangeProps) {
  const [state, dispatch] = useReducer(arrangeReducer, cards, initArrange);
  // 正在拖的那根手指（或滑鼠）和最後一次移動的座標：在事件裡直接記，不等畫面更新
  const ptrRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { byId, placed, hand, arrangement, full, check, foulMB, foulFM } = derive(state);
  const { rows, selected, cycle, drag, notice } = state;
  const submitted = state.submitted !== null;
  const foulRows = new Set<Row>([...(foulMB ? (["middle", "back"] as Row[]) : []), ...(foulFM ? (["front", "middle"] as Row[]) : [])]);
  const canSubmit = !submitted && !!check?.ok;

  const combos = useMemo(() => {
    const out = {} as Record<ShortcutKind, Card[][]>;
    for (const s of SHORTCUTS) out[s.kind] = findCombos(hand, s.kind);
    return out;
    // hand 由 rows 決定；用 id 串當依賴，避免每次 render 都重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.map((c) => c.id).join(",")]);

  // ---- 倒數；時間到交給 reducer（排好不倒水就照目前的送出，否則 autoArrange） ----
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    if (submitted) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [submitted]);
  useEffect(() => { if (left === 0) dispatch({ type: "timeout" }); }, [left]);

  // ---- 送出：submitted 從 null 變成排法的那一次才呼叫 onSubmit（reducer 保證只會變一次） ----
  const sentRef = useRef(false);
  useEffect(() => {
    if (!state.submitted || sentRef.current) return;
    sentRef.current = true;
    onSubmit(state.submitted);
  }, [state.submitted, onSubmit]);

  // ---- 拖曳：DOM 查放開位置底下的墩，其餘交給 reducer ----
  function zoneAt(x: number, y: number): { zone: Zone; cardId?: string } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const z = el?.closest<HTMLElement>("[data-zone]");
    if (!z) return null;
    const cardEl = el?.closest<HTMLElement>("[data-card]");
    return { zone: z.dataset.zone as Zone, cardId: cardEl?.dataset.card };
  }
  const cardProps = (id: string, from: Zone) => ({
    "data-card": id,
    onPointerDown: (e: React.PointerEvent) => {
      if (submitted || (e.pointerType === "mouse" && e.button !== 0)) return;
      ptrRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      dispatch({ type: "dragStart", id, from, pointerId: e.pointerId, x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = ptrRef.current;
      if (!p || p.id !== e.pointerId) return;
      p.x = e.clientX; p.y = e.clientY;
      dispatch({ type: "dragMove", pointerId: e.pointerId, x: e.clientX, y: e.clientY, over: zoneAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const p = ptrRef.current;
      if (!p || p.id !== e.pointerId) return;
      ptrRef.current = null;
      // 放開的位置用最後一次 pointermove 記下的座標：iOS Safari 的觸控 pointerup 實測 clientX/Y 可能是 0,0。
      // 有沒有真的拖動（moving）由 reducer 判斷；沒拖動時 over 會被忽略、當成點一下
      dispatch({ type: "dragEnd", pointerId: e.pointerId, over: zoneAt(p.x, p.y) });
    },
    onPointerCancel: () => { ptrRef.current = null; dispatch({ type: "dragCancel" }); },
  });
  const act = (a: ArrangeAction) => () => dispatch(a);
  const dragging = drag?.moving ? new Set(drag.ids) : new Set<string>();

  // ---- 提示文字 ----
  let hint = notice ?? "點牌再點墩放入，或用下面的牌型快捷鈕";
  let hintKind: "" | "ok" | "bad" = "";
  const name = (r: Row) => CAT_NAME[evalRow(arrangement[r]).cat];
  if (submitted) { hint = "已送出 ✓ 等其他人理牌"; hintKind = "ok"; }
  else if (foulMB) { hint = `倒水：中墩（${name("middle")}）比尾墩（${name("back")}）大。按「對調中尾墩」就能修正`; hintKind = "bad"; }
  else if (foulFM) { hint = `倒水：頭墩（${name("front")}）比中墩（${name("middle")}）大。把頭墩換小，或把中墩換大`; hintKind = "bad"; }
  else if (check?.ok && !notice) { hint = "✓ 沒有倒水，可以送出"; hintKind = "ok"; }

  const canTake = (r: Row) => selected.length > 0 && ROW_SIZE[r] - rows[r].length >= selected.filter((id) => !rows[r].includes(id)).length;

  return (
    <div className={`th-arr${submitted ? " is-done" : ""}${drag?.moving ? " is-dragging" : ""}`}>
      <div className="th-arr-main">
        <div className="th-rows">
          {ROWS.map((r) => {
            const label = rowLabel(r, arrangement[r]);
            const over = drag?.moving && drag.over?.zone === r;
            return (
              <div key={r} className={`th-row th-row-${r}${foulRows.has(r) ? " is-foul" : ""}`}>
                <div className="th-row-name">
                  <span className="th-pill">{ROW_NAME[r]}</span>
                  {label && <span className={`th-type${foulRows.has(r) ? " is-foul" : ""}`}>{label}</span>}
                </div>
                <div
                  className={`th-slots${canTake(r) || over ? " is-target" : ""}`}
                  data-zone={r}
                  role="button"
                  aria-label={`放進${ROW_NAME[r]}`}
                  onClick={act({ type: "tapRow", row: r })}
                >
                  {Array.from({ length: ROW_SIZE[r] }, (_, i) => {
                    const c = arrangement[r][i];
                    if (!c) return <div key={`e${i}`} className="th-slot" />;
                    return (
                      <div key={c.id} className={`th-card th-card-row${dragging.has(c.id) ? " is-ghosted" : ""}`} {...cardProps(c.id, r)} onClick={(e) => e.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cardSrc(c)} alt="" draggable={false} />
                      </div>
                    );
                  })}
                </div>
                <div className="th-row-x">
                  {rows[r].length > 0 && !submitted && (
                    <button type="button" className="th-x" aria-label={`${ROW_NAME[r]}整墩退回`} onClick={act({ type: "clearRow", row: r })}>✕</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className={`th-hint${hintKind ? ` is-${hintKind}` : ""}`} role="status">{hint}</div>

        <div className={`th-hand${drag?.moving && drag.over?.zone === HAND ? " is-target" : ""}`} data-zone={HAND}>
          {hand.map((c) => (
            <div
              key={c.id}
              className={`th-card th-card-hand${selected.includes(c.id) ? " is-sel" : ""}${dragging.has(c.id) ? " is-ghosted" : ""}`}
              {...cardProps(c.id, HAND)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardSrc(c)} alt="" draggable={false} />
            </div>
          ))}
        </div>

        <div className="th-shortcuts">
          {SHORTCUTS.map((s) => (
            <button key={s.kind} type="button" className={`th-sc${cycle?.kind === s.kind ? " is-on" : ""}`} disabled={!combos[s.kind].length || submitted}
              onClick={act({ type: "shortcut", kind: s.kind, label: s.label })}>
              {s.label}
            </button>
          ))}
          <button type="button" className="th-sc th-sc-reset" disabled={submitted || (placed.size === 0 && selected.length === 0)} onClick={act({ type: "reset" })}>
            重新選牌
          </button>
        </div>
      </div>

      <div className="th-side">
        <div className={`th-timer${left <= 10 ? " is-low" : ""}`}>
          <b>{left}</b>
          <span>{submitted ? "已送出" : "時間到自動排"}</span>
        </div>
        <button type="button" className={`th-btn${foulMB ? " is-alert" : ""}`} disabled={submitted || !(full("middle") && full("back"))} onClick={act({ type: "swapRows" })}>
          ⇅ 對調中尾墩
        </button>
        <button type="button" className="th-btn th-btn-gold" disabled={submitted} onClick={act({ type: "recommend" })}>
          推薦排法
        </button>
        <button type="button" className={`th-btn th-btn-submit${canSubmit ? " is-ready" : ""}`} disabled={!canSubmit} onClick={act({ type: "submit" })}>
          {submitted ? "已送出 ✓" : foulRows.size ? "倒水，不能送出" : "送出"}
        </button>
      </div>

      {drag?.moving && (
        <div className="th-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          {drag.ids.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={cardSrc(byId.get(id)!)} alt="" draggable={false} style={{ transform: `translate(${i * 14}px, ${i * 2}px)` }} />
          ))}
        </div>
      )}
    </div>
  );
}
