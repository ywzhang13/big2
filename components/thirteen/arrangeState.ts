// 十三支理牌畫面的狀態與操作（純函式，ThArrange.tsx 用、tests/_thirteen-arrange.ts 測）。
// 牌型、倒水、推薦排法一律呼叫計分引擎 lib/thirteen；這裡只管「哪張牌在哪」和送出鎖定。
import {
  autoArrange, bonusOf, CAT, CAT_NAME, checkArrangement, compareValue, evalFive, evalRow, evalThree,
  type Arrangement, type Card, type Row,
} from "@/lib/thirteen";
import { findCombos, type ShortcutKind } from "./shortcuts";

export const ROWS: Row[] = ["front", "middle", "back"];
export const ROW_NAME: Record<Row, string> = { front: "頭墩", middle: "中墩", back: "尾墩" };
export const ROW_SIZE: Record<Row, number> = { front: 3, middle: 5, back: 5 };
export const HAND = "hand" as const;
export type Zone = Row | typeof HAND;
export type Rows = Record<Row, string[]>;
export const EMPTY_ROWS: Rows = { front: [], middle: [], back: [] };
export const byRank = (a: Card, b: Card) => a.rank - b.rank || a.suit.localeCompare(b.suit) || a.deck - b.deck;

export interface DragInfo {
  ids: string[];
  from: Zone;
  /** 按下去的那張 */
  id: string;
  pointerId: number;
  x0: number; y0: number;
  x: number; y: number;
  moving: boolean;
  over: { zone: Zone; cardId?: string } | null;
}

export interface ArrangeState {
  cards: Card[];
  rows: Rows;
  selected: string[];
  cycle: { kind: ShortcutKind; idx: number } | null;
  notice: string | null;
  drag: DragInfo | null;
  /** 送出的排法；null＝還沒送出。只會被設定一次 */
  submitted: Arrangement | null;
}

export type ArrangeAction =
  | { type: "tapHand"; id: string }
  | { type: "tapRow"; row: Row }
  | { type: "clearRow"; row: Row }
  | { type: "shortcut"; kind: ShortcutKind; label: string }
  | { type: "reset" }
  | { type: "swapRows" }
  | { type: "recommend" }
  | { type: "dragStart"; id: string; from: Zone; pointerId: number; x: number; y: number }
  | { type: "dragMove"; pointerId: number; x: number; y: number; over: { zone: Zone; cardId?: string } | null }
  /** 放開：over 是放開位置底下的墩（元件用最後一次移動的座標查 DOM，iOS 觸控的 pointerup 座標可能是 0,0） */
  | { type: "dragEnd"; pointerId: number; over: { zone: Zone; cardId?: string } | null }
  | { type: "dragCancel" }
  | { type: "submit" }
  /** 倒數到 0：排好且不倒水就照目前的送出，否則用引擎的 autoArrange */
  | { type: "timeout" };

export const initArrange = (cards: Card[]): ArrangeState => ({ cards, rows: EMPTY_ROWS, selected: [], cycle: null, notice: null, drag: null, submitted: null });

// ---- 從狀態算出來的東西（畫面和測試共用） ----
export function derive(s: ArrangeState) {
  const byId = new Map(s.cards.map((c) => [c.id, c]));
  const placed = new Set([...s.rows.front, ...s.rows.middle, ...s.rows.back]);
  const hand = s.cards.filter((c) => !placed.has(c.id)).sort(byRank);
  const rowCards = (r: Row) => s.rows[r].map((id) => byId.get(id)!).sort(byRank);
  const arrangement: Arrangement = { front: rowCards("front"), middle: rowCards("middle"), back: rowCards("back") };
  const full = (r: Row) => s.rows[r].length === ROW_SIZE[r];
  const check = hand.length === 0 ? checkArrangement(arrangement) : null;
  // 兩墩都排滿就先比（引擎 compareValue），不用等 13 張都放好才提示倒水
  const foulMB = full("middle") && full("back") && compareValue(evalFive(arrangement.middle), evalFive(arrangement.back)) > 0;
  const foulFM = full("front") && full("middle") && compareValue(evalThree(arrangement.front), evalFive(arrangement.middle)) > 0;
  return { byId, placed, hand, arrangement, full, check, foulMB, foulFM };
}

/** 一墩排滿時的標籤：牌型和加分都由引擎判斷（evalRow、bonusOf）。頭墩三條顯示「衝三」 */
export function rowLabel(row: Row, cards: Card[]): string | null {
  if (cards.length !== ROW_SIZE[row]) return null;
  const v = evalRow(cards);
  const bonus = bonusOf(row, v);
  const name = row === "front" && v.cat === CAT.THREE_KIND ? "衝三" : CAT_NAME[v.cat];
  return bonus ? `${name} +${bonus}` : name;
}

const idsOf = (a: Arrangement): Rows => ({ front: a.front.map((c) => c.id), middle: a.middle.map((c) => c.id), back: a.back.map((c) => c.id) });

/** 把 ids 放進 to（墩或手牌）。墩放不下時只留提示，不動牌 */
function moveTo(s: ArrangeState, ids: string[], to: Zone): ArrangeState {
  if (to !== HAND) {
    const incoming = ids.filter((id) => !s.rows[to].includes(id));
    if (s.rows[to].length + incoming.length > ROW_SIZE[to]) return { ...s, notice: `${ROW_NAME[to]}只能放 ${ROW_SIZE[to]} 張` };
  }
  const rows: Rows = { front: s.rows.front.filter((id) => !ids.includes(id)), middle: s.rows.middle.filter((id) => !ids.includes(id)), back: s.rows.back.filter((id) => !ids.includes(id)) };
  if (to !== HAND) rows[to] = [...rows[to], ...ids];
  return { ...s, rows, selected: s.selected.filter((id) => !ids.includes(id)), cycle: null, notice: null };
}

/** 拖一張牌到滿的墩裡的某張牌上：兩張互換位置（a 原本在手牌時，b 回手牌） */
function swapCards(s: ArrangeState, a: string, b: string): ArrangeState {
  const rows: Rows = { front: [...s.rows.front], middle: [...s.rows.middle], back: [...s.rows.back] };
  const where = (id: string) => ROWS.find((r) => rows[r].includes(id));
  const ra = where(a), rb = where(b);
  if (!rb) return s;
  rows[rb][rows[rb].indexOf(b)] = a;
  if (ra) rows[ra][rows[ra].indexOf(a)] = b;
  return { ...s, rows, selected: s.selected.filter((id) => id !== a && id !== b), cycle: null, notice: null };
}

function submitWith(s: ArrangeState, a: Arrangement): ArrangeState {
  return { ...s, submitted: a, rows: idsOf(a), selected: [], cycle: null, notice: null, drag: null }; // 送出時清掉拖曳：之後放開也不會動到牌
}

export function arrangeReducer(s: ArrangeState, a: ArrangeAction): ArrangeState {
  // 送出後一律擋下（點選、拖曳、快捷鈕、對調、重新選牌、推薦、✕、再送出、時間到）：牌和送出內容一致，送出只發生一次
  if (s.submitted) return s.drag ? { ...s, drag: null } : s;
  switch (a.type) {
    case "tapHand":
      return { ...s, selected: s.selected.includes(a.id) ? s.selected.filter((x) => x !== a.id) : [...s.selected, a.id], cycle: null, notice: null };
    case "tapRow":
      if (s.selected.length === 0) return s;
      return moveTo(s, s.selected, a.row);
    case "clearRow":
      return moveTo(s, s.rows[a.row], HAND);
    case "shortcut": {
      const list = findCombos(derive(s).hand, a.kind);
      if (!list.length) return s;
      const idx = s.cycle?.kind === a.kind ? (s.cycle.idx + 1) % list.length : 0;
      const pick = list[idx];
      const target = (pick.length === 5 ? (["back", "middle"] as Row[]) : (["front", "middle", "back"] as Row[]))
        .find((r) => ROW_SIZE[r] - s.rows[r].length >= pick.length);
      return {
        ...s, selected: pick.map((c) => c.id), cycle: { kind: a.kind, idx },
        notice: `已選出一組${a.label}${target ? `，點「${ROW_NAME[target]}」放進去` : ""}${list.length > 1 ? `；再按一次「${a.label}」換下一組` : ""}`,
      };
    }
    case "reset":
      return { ...s, rows: EMPTY_ROWS, selected: [], cycle: null, notice: null };
    case "swapRows":
      return { ...s, rows: { ...s.rows, middle: s.rows.back, back: s.rows.middle }, notice: null };
    case "recommend":
      return { ...s, rows: idsOf(autoArrange(s.cards)), selected: [], cycle: null, notice: null };
    case "dragStart": {
      // 拖的是已選取的手牌：整組一起拖（例如快捷鈕選出的一組）
      const ids = a.from === HAND && s.selected.includes(a.id) ? s.selected : [a.id];
      return { ...s, drag: { ids, from: a.from, id: a.id, pointerId: a.pointerId, x0: a.x, y0: a.y, x: a.x, y: a.y, moving: false, over: null } };
    }
    case "dragMove": {
      const d = s.drag;
      if (!d || d.pointerId !== a.pointerId) return s;
      const moving = d.moving || Math.hypot(a.x - d.x0, a.y - d.y0) > 6;
      return { ...s, drag: { ...d, x: a.x, y: a.y, moving, over: moving ? a.over : null } };
    }
    case "dragCancel":
      return s.drag ? { ...s, drag: null } : s;
    case "dragEnd": {
      const d = s.drag;
      if (!d || d.pointerId !== a.pointerId) return s;
      const base = { ...s, drag: null };
      if (!d.moving) {
        // 沒有移動＝點一下。點墩裡的牌：手上有選牌＝放進這一墩；沒有選牌＝這張退回手牌
        if (d.from === HAND) return arrangeReducer(base, { type: "tapHand", id: d.id });
        if (base.selected.length) return arrangeReducer(base, { type: "tapRow", row: d.from });
        return moveTo(base, [d.id], HAND);
      }
      const over = a.over;
      if (!over || (over.zone === d.from && (!over.cardId || over.zone === HAND))) return base;
      const toRow = over.zone === HAND ? null : over.zone;
      if (toRow && d.ids.length === 1 && over.cardId && over.cardId !== d.id && base.rows[toRow].length === ROW_SIZE[toRow]) return swapCards(base, d.id, over.cardId);
      return moveTo(base, d.ids, over.zone);
    }
    case "submit": {
      const v = derive(s);
      if (!v.check?.ok) return s;
      return submitWith(s, v.arrangement);
    }
    case "timeout": {
      const v = derive(s);
      return submitWith(s, v.check?.ok ? v.arrangement : autoArrange(s.cards));
    }
  }
}
