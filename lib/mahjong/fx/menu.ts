// 點名牌丟特效的選單狀態（開給誰、提示文字）和它的兩個計時器（4 秒沒操作收起、提示 1.8 秒消失）。
// 不放在 React state 裡：結算、換局、卸載時 reset() 一次清空狀態、取消全部計時器，也能在 node 測試裡用假時鐘驗證（tests/_fx-menu.ts）。

export const MENU_IDLE_MS = 4000; // 選單 4 秒沒操作就收起
export const NOTE_MS = 1800; // 提示（冷卻中、對方剛被打過…）顯示多久
export const TICK_MS = 200; // 選單開著時，冷卻倒數多久更新一次

/** 只有 LINE 登入、已入座的玩家能丟；訪客、觀戰者（mySeat < 0）、結算畫面都不行（審伯 2026-10-21） */
export function canUseFx({ guest, mySeat, suspended }: { guest: boolean; mySeat: number; suspended: boolean }): boolean {
  return !guest && mySeat >= 0 && !suspended;
}

export type FxMenuState = { target: number | null; note: string | null; now: number };

type Timer = ReturnType<typeof setTimeout>;
export type FxMenuClock = {
  now: () => number;
  setInterval: (f: () => void, ms: number) => Timer;
  clearInterval: (t: Timer) => void;
  setTimeout: (f: () => void, ms: number) => Timer;
  clearTimeout: (t: Timer) => void;
};
const realClock: FxMenuClock = {
  now: () => Date.now(),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (t) => clearInterval(t),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t),
};

export function createFxMenu(clock: FxMenuClock = realClock) {
  let state: FxMenuState = { target: null, note: null, now: clock.now() };
  let touched = 0; // 最後一次操作選單的時間
  let tick: Timer | undefined;
  let noteTimer: Timer | undefined;
  let epoch = 0; // 每次 reset 加一：送出途中換局，回來的結果不顯示
  const subs = new Set<() => void>();

  const set = (patch: Partial<FxMenuState>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };
  const stopTick = () => { if (tick !== undefined) clock.clearInterval(tick); tick = undefined; };
  const stopNote = () => { if (noteTimer !== undefined) clock.clearTimeout(noteTimer); noteTimer = undefined; };

  const close = () => {
    stopTick();
    stopNote();
    if (state.target !== null || state.note !== null) set({ target: null, note: null });
  };

  return {
    get: () => state,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    /** 點名牌：沒開就開給他，已經開給他就收起 */
    toggle(seat: number) {
      if (state.target === seat) return close();
      stopNote();
      touched = clock.now();
      set({ target: seat, note: null, now: touched });
      if (tick === undefined) {
        tick = clock.setInterval(() => {
          const n = clock.now();
          if (n - touched > MENU_IDLE_MS) close();
          else set({ now: n });
        }, TICK_MS);
      }
    },
    close,
    /** 在選單上有操作：4 秒重新算，冷卻倒數馬上更新 */
    touch() {
      if (state.target === null) return;
      touched = clock.now();
      set({ now: touched });
    },
    flash(text: string) {
      if (state.target === null) return; // 選單已經收起（或換局了）：不顯示
      stopNote();
      set({ note: text });
      noteTimer = clock.setTimeout(() => { noteTimer = undefined; set({ note: null }); }, NOTE_MS);
    },
    /** 結算、換局、卸載：選單和提示立刻清空，所有計時器取消，送出中的結果作廢 */
    reset() {
      epoch++;
      close();
    },
    /** 送出前呼叫，拿到的函式在結果回來時判斷「還是同一個局面、選單沒被 reset」 */
    guard() {
      const e = epoch;
      return () => e === epoch;
    },
    /** 測試用：還有哪些計時器在跑 */
    pending: () => ({ tick: tick !== undefined, note: noteTimer !== undefined }),
  };
}

export type FxMenu = ReturnType<typeof createFxMenu>;

// ---------- 選單位置（老闆 2026-10-21：要貼在名牌旁邊，不要跑到海底） ----------
// 牌桌（data-mj-table）就是海底：選單不往裡面放。左右家：直排、貼在名牌朝牌桌那一側；對家：橫排、貼在名牌左右（牌牆、花牌區可以蓋）。
// 下緣不超過牌桌底（下面是動作列、打出鈕、吃碰胡、自己的手牌）；不超出畫面。名牌和選單之間有小箭頭指著名牌。

export const MENU_GAP = 7; // 選單邊緣到名牌 ≤ 8px（箭頭在這段空隙裡）
const EDGE = 4; // 離畫面邊緣

export type Box = { left: number; top: number; right: number; bottom: number };
/** 被點的人在我的哪一邊：1＝右家（下家）、2＝對家、3＝左家（上家） */
export type FxRel = 1 | 2 | 3;
export const relOf = (seat: number, mySeat: number) => ((((seat - mySeat) % 4) + 4) % 4) as 0 | FxRel;
/** 左右家直排、對家橫排 */
export const isColumn = (rel: FxRel) => rel !== 2;

export type FxMenuPlace = {
  left: number;
  top: number;
  /** 箭頭在選單的哪一邊（朝著名牌）：l 左、r 右、t 上 */
  side: "l" | "r" | "t";
  /** 箭頭沿著那一邊的位置（px，從選單左上算） */
  arrow: number;
  /** 提示文字放哪：名牌下面（左右家）或名牌另一側（對家），不放進海底 */
  note: { left: number; top: number; width?: number; align: "c" | "l" | "r" };
};

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** avoid：不能蓋的按鈕（手機左上角的 ☰ 選單） */
export function placeFxMenu(rel: FxRel, plate: Box, table: Box, w: number, h: number, vw: number, vh: number, avoid: Box[] = []): FxMenuPlace {
  const cx = (plate.left + plate.right) / 2, cy = (plate.top + plate.bottom) / 2;
  const T = EDGE, B = Math.min(table.bottom, vh - EDGE), L = EDGE, R = vw - EDGE;
  const vTop = clamp(cy - h / 2, T, Math.max(T, B - h));
  const besideRight = { left: plate.right + MENU_GAP, top: vTop, side: "l" as const };
  const besideLeft = { left: plate.left - MENU_GAP - w, top: vTop, side: "r" as const };
  const below = { left: clamp(cx - w / 2, L, R - w), top: plate.bottom + MENU_GAP, side: "t" as const };
  // 左家放右邊、右家放左邊；對家：右邊、左邊、下面，挑在畫面內、蓋到海底最少的
  const cands = rel === 3 ? [besideRight] : rel === 1 ? [besideLeft] : [besideRight, besideLeft, below];
  const box = (c: { left: number; top: number }) => ({ left: c.left, top: c.top, right: c.left + w, bottom: c.top + h });
  const fits = (c: { left: number; top: number }) =>
    c.left >= L && c.left + w <= R && c.top >= T && c.top + h <= B && avoid.every((a) => overlap(box(c), a) === 0);
  const pick = cands.filter(fits).sort((a, b) => overlap(box(a), table) - overlap(box(b), table))[0] ?? cands[0];
  const left = clamp(pick.left, L, Math.max(L, R - w)), top = clamp(pick.top, T, Math.max(T, B - h));
  const arrow = pick.side === "t" ? clamp(cx - left, 12, w - 12) : clamp(cy - top, 12, h - 12);
  let note: FxMenuPlace["note"];
  if (rel !== 2) {
    // 和名牌同寬、對齊名牌：在名牌那一欄裡，不會疊到旁邊的直排選單
    note = { left: plate.left, top: plate.bottom + 6, width: plate.right - plate.left, align: "c" };
  } else if (pick.side === "l") note = { left: plate.left - 6, top: cy, align: "r" }; // 選單在名牌右邊：提示放名牌左邊
  else if (pick.side === "r") note = { left: plate.right + 6, top: cy, align: "l" };
  else note = { left: clamp(cx - 80, L, R - 160), top: top + h + 6, width: 160, align: "c" };
  return { left, top, side: pick.side, arrow, note };
}
