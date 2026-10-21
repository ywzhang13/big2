// 點名牌丟特效的選單（lib/mahjong/fx/menu.ts）：審伯 2026-10-21 兩項必修＋老闆 2026-10-21「選單要在名牌旁邊，不要在海底」。
//   G  只有 LINE 登入、已入座的人能用；訪客、觀戰者、結算畫面都不行
//   R  結算、換局、卸載（都走 reset）：選單和提示立刻清空、4 秒收起的 interval 和提示的 timeout 都取消，送出中的結果作廢
//   I  原本的行為不變：4 秒沒操作收起、有操作重新算、提示 1.8 秒消失、再點同一家收起
//   P  位置：貼在名牌旁邊（≤ 8px）、箭頭朝名牌、不進海底（牌桌）、不超過牌桌底（下面是動作列和手牌）、不超出畫面
// 用假時鐘跑，計時器有沒有被取消看得到。
import { MENU_GAP, MENU_IDLE_MS, NOTE_MS, TICK_MS, canUseFx, createFxMenu, placeFxMenu, relOf, type Box, type FxMenuClock, type FxRel } from "../lib/mahjong/fx/menu";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

/** 假時鐘：advance(ms) 依時間順序觸發到期的計時器；live() 是還沒取消的計時器數 */
function fakeClock() {
  let t = 1_000_000, seq = 0;
  const timers = new Map<number, { at: number; every: number; f: () => void }>();
  const add = (f: () => void, ms: number, every: number) => { timers.set(++seq, { at: t + ms, every, f }); return seq as unknown as ReturnType<typeof setTimeout>; };
  const del = (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); };
  const clock: FxMenuClock = { now: () => t, setInterval: (f, ms) => add(f, ms, ms), clearInterval: del, setTimeout: (f, ms) => add(f, ms, 0), clearTimeout: del };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, x] = next;
      t = x.at;
      if (x.every) x.at += x.every; else timers.delete(id);
      x.f();
    }
    t = end;
  };
  return { clock, advance, live: () => timers.size };
}

// ---------- G 誰能用 ----------
ok(canUseFx({ guest: false, mySeat: 2, suspended: false }), "G1 LINE 登入、已入座、打牌中：可以打開選單和送出");
ok(!canUseFx({ guest: true, mySeat: 2, suspended: false }), "G2 訪客已入座：不能用");
ok(!canUseFx({ guest: false, mySeat: -1, suspended: false }), "G3 觀戰者（沒有座位）：不能用");
ok(!canUseFx({ guest: false, mySeat: 2, suspended: true }), "G4 結算畫面：不能用");
ok(!canUseFx({ guest: true, mySeat: -1, suspended: true }), "G5 訪客觀戰、結算中：不能用");

// ---------- R 結算、換局、卸載 ----------
{
  const c = fakeClock(), m = createFxMenu(c.clock);
  let renders = 0; m.subscribe(() => renders++);
  m.toggle(1); m.flash("對方剛被打過，還要 8 秒");
  ok(m.get().target === 1 && m.get().note !== null && m.pending().tick && m.pending().note && c.live() === 2, "R1 選單開著、提示顯示中：interval 和 timeout 都在跑");
  const same = m.guard();
  const before = renders;
  m.reset();
  ok(m.get().target === null && m.get().note === null && renders === before + 1, "R2 reset（進結算／換局／卸載）：選單和提示立刻清空，只通知畫面一次");
  ok(!m.pending().tick && !m.pending().note && c.live() === 0, "R3 reset 之後沒有任何計時器還在跑");
  ok(!same(), "R4 reset 之前送出、之後才回來的結果：判定作廢，不會在新局冒出提示");
  m.flash("送出失敗");
  ok(m.get().note === null && c.live() === 0, "R5 選單收起後才回來的提示：不顯示、不開新計時器");
  c.advance(MENU_IDLE_MS * 3);
  ok(m.get().target === null && renders === before + 1, "R6 時間再往後走：舊選單不會自己冒出來，也沒有再通知畫面");
  m.toggle(2);
  ok(m.get().target === 2 && m.get().note === null && m.guard()(), "R7 新的一局照常點名牌打開，沒有上一局的提示");
  m.reset(); m.reset();
  ok(c.live() === 0 && m.get().target === null, "R8 連續 reset（卸載時再收一次）不會出錯");
}

// ---------- I 原本的行為 ----------
{
  const c = fakeClock(), m = createFxMenu(c.clock);
  m.toggle(3);
  c.advance(MENU_IDLE_MS - TICK_MS);
  ok(m.get().target === 3, "I1 沒到 4 秒：選單還開著");
  m.touch();
  c.advance(MENU_IDLE_MS - TICK_MS);
  ok(m.get().target === 3, "I2 有操作就重新算 4 秒");
  c.advance(TICK_MS * 3);
  ok(m.get().target === null && c.live() === 0, "I3 4 秒沒操作：自己收起，interval 也停了");
  m.toggle(3); m.flash("冷卻中，還要 3 秒");
  c.advance(NOTE_MS + 1);
  ok(m.get().note === null && m.get().target === 3 && !m.pending().note, "I4 提示 1.8 秒後消失，選單還開著");
  const n0 = m.get().now;
  c.advance(TICK_MS);
  ok(m.get().now > n0, "I5 選單開著時冷卻倒數每 200ms 更新");
  m.toggle(3);
  ok(m.get().target === null && c.live() === 0, "I6 再點同一家：收起，計時器都停");
  m.toggle(1); m.toggle(2);
  ok(m.get().target === 2 && c.live() === 1, "I7 換點另一家：選單換人，interval 只有一個");
  m.close();
  ok(m.get().target === null && c.live() === 0, "I8 點選單外面（close）：收起，計時器都停");
}

// ---------- P 位置（三種尺寸都用預覽站量到的真實名牌和牌桌位置） ----------
type Case = { size: string; vw: number; vh: number; table: Box; plates: Record<FxRel, Box>; col: [number, number]; row: [number, number] };
const B = (l: number, t: number, r: number, b: number): Box => ({ left: l, top: t, right: r, bottom: b });
const cases: Case[] = [
  { size: "844×390", vw: 844, vh: 390, table: B(98, 40, 746, 251), plates: { 3: B(4, 119, 64, 173), 2: B(331, 6, 400, 32), 1: B(780, 107, 840, 161) }, col: [52, 236], row: [270, 60] },
  { size: "667×375", vw: 667, vh: 375, table: B(98, 40, 569, 242), plates: { 3: B(4, 102, 64, 156), 2: B(242, 6, 311, 32), 1: B(603, 102, 663, 156) }, col: [52, 236], row: [270, 60] },
  { size: "1440×900", vw: 1440, vh: 900, table: B(270, 158, 1170, 716), plates: { 3: B(8, 429, 82, 477), 2: B(683, 60, 757, 108), 1: B(1358, 412, 1432, 460) }, col: [68, 310], row: [300, 70] },
];
const NAME: Record<FxRel, string> = { 3: "左家", 2: "對家", 1: "右家" };
for (const k of cases) {
  for (const rel of [3, 2, 1] as FxRel[]) {
    const pl = k.plates[rel], [w, h] = rel === 2 ? k.row : k.col;
    const p = placeFxMenu(rel, pl, k.table, w, h, k.vw, k.vh);
    const m = B(p.left, p.top, p.left + w, p.top + h);
    const gap = p.side === "l" ? m.left - pl.right : p.side === "r" ? pl.left - m.right : m.top - pl.bottom;
    const facing = rel === 3 ? p.side === "l" : rel === 1 ? p.side === "r" : true;
    const arrowOnPlate = p.side === "t" ? p.left + p.arrow >= pl.left && p.left + p.arrow <= pl.right : p.top + p.arrow >= pl.top && p.top + p.arrow <= pl.bottom;
    const inScreen = m.left >= 0 && m.top >= 0 && m.right <= k.vw && m.bottom <= k.vh;
    const intoSea = Math.max(0, Math.min(m.right, k.table.right) - Math.max(m.left, k.table.left)) > 0 && Math.max(0, Math.min(m.bottom, k.table.bottom) - Math.max(m.top, k.table.top)) > 0
      ? (rel === 3 ? m.right - k.table.left : rel === 1 ? k.table.right - m.left : m.bottom - k.table.top) : 0;
    const center = { x: (k.table.left + k.table.right) / 2, y: (k.table.top + k.table.bottom) / 2 };
    const farFromCenter = m.right < center.x - 120 || m.left > center.x + 120 || m.bottom < center.y - 40;
    ok(gap >= 0 && gap <= MENU_GAP + 1 && facing && arrowOnPlate,
      `P ${k.size} ${NAME[rel]}：選單貼在名牌旁邊（間距 ${Math.round(gap)}px）、箭頭指在名牌範圍內（${p.side}）`);
    // 提示：左右家放名牌下面（和名牌同寬）；對家放名牌另一側（選單在右就放左邊、往左長）
    const n = p.note;
    const noteOk = rel === 2
      ? (n.align === "r" ? n.left <= pl.left && m.left >= pl.right : n.align === "l" ? n.left >= pl.right && m.right <= pl.left : n.top >= m.bottom)
      : n.top >= pl.bottom && (n.left + (n.width ?? 0) <= m.left - 2 || n.left >= m.right + 2);
    ok(noteOk, `P ${k.size} ${NAME[rel]}：提示（冷卻中、對方剛被打過）${rel === 2 ? "放在名牌另一側" : "放在名牌下面"}、不疊到選單`);
    ok(inScreen && m.bottom <= k.table.bottom && farFromCenter,
      `P ${k.size} ${NAME[rel]}：在畫面內、不低於牌桌底（不蓋動作列和手牌）、離海底中央遠（只壓到牌桌邊 ${Math.round(intoSea)}px）`);
  }
}
{
  // 844×390 對家：選單放名牌左邊會蓋到左上角的 ☰（6,4～42,40），要換到右邊
  const burger = B(6, 4, 42, 40), pl = B(309, 6, 378, 32); // 預覽站實際量到：名牌比較靠左時，放左邊會蓋到 ☰
  const p = placeFxMenu(2, pl, B(98, 40, 746, 251), 270, 60, 844, 390, [burger]);
  ok(p.side === "l" && p.left - pl.right <= MENU_GAP + 1 && p.left > burger.right, `P 844×390 對家：不蓋左上角的 ☰ 選單，改放名牌右邊（選單 x=${Math.round(p.left)}）`);
}
ok(relOf(3, 0) === 3 && relOf(1, 0) === 1 && relOf(2, 0) === 2 && relOf(0, 3) === 1 && relOf(2, 3) === 3, "P 座位換算：右家 1、對家 2、左家 3");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
