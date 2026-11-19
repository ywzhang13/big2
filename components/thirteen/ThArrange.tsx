"use client";
// 十三支理牌畫面（小宜〈十三支-畫面設計說明-v2〉③ 理牌）。
// 牌型、倒水、推薦排法一律用計分引擎 lib/thirteen；所有改牌的操作都在 arrangeState.ts 的 reducer（送出後一律擋下），
// 這個元件只管畫面、查拖曳放開的位置、倒數，以及送出時呼叫一次 onSubmit。
// 操作：點選（點手牌選取→點墩放入；點墩裡的牌退回）和拖曳（手牌↔墩、墩↔墩；拖到滿的墩的某張牌上＝兩張互換）。
// 拖曳用 Pointer Events，滑鼠和觸控同一套；牌加 touch-action:none，iPhone 上拖的時候畫面不會捲動。
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Arrangement, Card, Row } from "@/lib/thirteen";
import { cardSrc } from "./cardArt";
import { findCombos, SHORTCUTS, type ShortcutKind } from "./shortcuts";
import { arrangeReducer, derive, HAND, initArrange, ROW_NAME, ROW_SIZE, ROWS, rowLabel, type ArrangeAction, type Zone } from "./arrangeState";
import { preloadRevealFx } from "./ThRevealFx";
import ThFeltMenu from "./ThFeltMenu";
import { useStageScale } from "./stageScale";
import "./thArrange.css";
import { useArrangeRemind } from "./sfx";

export interface ThArrangeProps {
  /** 發到的手牌（加一色 16 張，挑 13 張排三墩） */
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
  const { byId, placed, hand, arrangement, full, allFull, check, foulMB, foulFM } = derive(state);
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
  useArrangeRemind(left, submitted); // 最後 10 秒每秒嗶一聲＋手機短震（照麻將太久沒出牌），送出後就停
  useEffect(() => { void preloadRevealFx(); }, []); // 理牌時先把亮牌要用的牌背、特效圖載好
  useStageScale();

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

  // ---- 提示文字（老闆 2026-11-18：操作提示字拿掉；倒水只留紅框和一句短提示；放不下這類操作回饋照舊） ----
  let hint = notice ?? "";
  let hintKind: "" | "bad" = notice ? "bad" : "";
  if (submitted) { hint = ""; hintKind = ""; }
  else if (foulMB) { hint = "倒水：中墩比尾墩大"; hintKind = "bad"; }
  else if (foulFM) { hint = "倒水：頭墩比中墩大"; hintKind = "bad"; }

  const canTake = (r: Row) => selected.length > 0 && ROW_SIZE[r] - rows[r].length >= selected.filter((id) => !rows[r].includes(id)).length;

  return (
    <div className={`th-arr${submitted ? " is-done" : ""}${drag?.moving ? " is-dragging" : ""}`}>
      <ThFeltMenu />{/* 左上角 ⚙ 換牌桌（和牌桌畫面同一個；v7 §1：理牌畫面底色跟著同一款） */}
      <div className="th-arr-stage">{/* 844×390 一塊，整塊等比放大置中（v8-A §1） */}
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

        <div className={`th-hand${drag?.moving && drag.over?.zone === HAND ? " is-target" : ""}`} data-zone={HAND} style={{ "--hand-n": hand.length } as React.CSSProperties}>
          {hand.map((c) => (
            <div
              key={c.id}
              className={`th-card th-card-hand${selected.includes(c.id) ? " is-sel" : ""}${dragging.has(c.id) ? " is-ghosted" : ""}${allFull ? " is-unused" : ""}`}
              data-th-unused={allFull ? "" : undefined}
              {...cardProps(c.id, HAND)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardSrc(c)} alt="" draggable={false} />
              {/* 三墩排滿：剩下的 3 張只變灰、不加字（老闆 2026-11-18），拖到墩裡的牌上還是可以互換 */}
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
          <b>{left}</b>{/* 小宜 v6：倒數下面的「時間到自動排」拿掉 */}
        </div>
        <button type="button" className={`th-btn${foulMB ? " is-alert" : ""}`} disabled={submitted || !(full("middle") && full("back"))} onClick={act({ type: "swapRows" })}>
          ⇅ 對調中尾墩
        </button>
        <button type="button" className="th-btn th-btn-gold" disabled={submitted} onClick={act({ type: "recommend" })}>
          推薦排法
        </button>
        <button type="button" className={`th-btn th-btn-submit${canSubmit ? " is-ready" : ""}`} disabled={!canSubmit} onClick={act({ type: "submit" })}>
          {submitted ? "已送出 ✓" : "送出"}{/* 倒水時按鈕變灰就好，字只留上面那一句短提示（老闆 2026-11-18） */}
        </button>
      </div>
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
