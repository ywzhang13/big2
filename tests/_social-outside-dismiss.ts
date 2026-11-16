// 點聊天室外面就關（components/social/outsideDismiss.ts；老闆 2026-11-13：像 LINE，不要「收起」鈕）
// 重點：關閉的那一下（同一個手勢）整個被吃掉，牌桌收不到 → 不會誤打出一張牌、誤按吃碰。
// 審伯 2026-11-13 必修①：依手勢追蹤——長按放開的 click 也要吃掉；取消（pointercancel）後下一次獨立點擊要照常；結束、取消、卸載後監聽要拆乾淨。
// 用假的 window：先跑 window 捕獲階段的監聽（聊天室），沒被擋下才輪到「牌桌」（模擬 React 的 onClick 打牌）。
import { attachOutsideDismiss, CLICK_GAP_MS, insideAny, MAX_HOLD_MS } from "../components/social/outsideDismiss";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// ---- 假時鐘 ----
let t = 1000, tid = 0;
const timers = new Map<number, { at: number; f: () => void }>();
const advance = (ms: number) => {
  const end = t + ms;
  for (;;) {
    const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]); t = next[1].at; next[1].f();
  }
  t = end;
};

// ---- 假 window ----
type L = { type: string; fn: (e: Event) => void; capture: boolean };
function makeWin() {
  const ls: L[] = [];
  const cap = (o?: boolean | EventListenerOptions) => o === true || (typeof o === "object" && !!o.capture);
  return {
    ls,
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => void ls.push({ type, fn: fn as (e: Event) => void, capture: cap(o) }),
    removeEventListener: (type: string, fn: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => {
      const i = ls.findIndex((l) => l.type === type && l.fn === fn && l.capture === cap(o));
      if (i >= 0) ls.splice(i, 1);
    },
  };
}
type Win = ReturnType<typeof makeWin>;
const el = (marks: string[]) => ({ closest: (sel: string) => (sel.split(",").map((x) => x.trim()).some((x) => marks.includes(x)) ? {} : null) });
const tile = el(["[data-mj-tile]"]);
const panel = el(["[data-chat-panel]"]);
const log = el(["[data-chat-log]"]);
const INSIDE = "[data-chat-log], [data-chat-panel], [data-chat-btn]";

let discards = 0;
/** 送一個事件：window 捕獲監聽先跑，沒被 stopPropagation 才到牌桌；回傳牌桌有沒有收到 */
function fire(win: Win, type: string, target: unknown, pointerId?: number, key?: string): boolean {
  let stopped = false;
  const e = { type, target, key, pointerId, preventDefault: () => {}, stopPropagation: () => { stopped = true; }, stopImmediatePropagation: () => { stopped = true; } } as unknown as Event;
  for (const l of [...win.ls].filter((l) => l.type === type)) { l.fn(e); if (stopped) break; }
  if (!stopped && type === "click" && target === tile) discards++; // 牌桌的 onClick：打出這張牌
  return !stopped;
}
/** 滑鼠點一下（pointerdown → mousedown → pointerup → mouseup → click） */
const mouseTap = (win: Win, target: unknown, id = 1) => [
  fire(win, "pointerdown", target, id), fire(win, "mousedown", target), fire(win, "pointerup", target, id), fire(win, "mouseup", target), fire(win, "click", target, id),
];
/** 手指點一下（pointerdown → pointerup → 相容的 mousedown、mouseup → click） */
const touchTap = (win: Win, target: unknown, id = 7, holdMs = 0) => {
  const r = [fire(win, "pointerdown", target, id)];
  advance(holdMs);
  r.push(fire(win, "pointerup", target, id)); advance(5);
  r.push(fire(win, "mousedown", target), fire(win, "mouseup", target), fire(win, "click", target, id));
  return r;
};

function setup() {
  const win = makeWin();
  let closed = 0, recording = false;
  const detach = attachOutsideDismiss(win, {
    isInside: (x) => insideAny(x as EventTarget, INSIDE), onClose: () => { closed++; }, ignore: () => recording,
    now: () => t,
    setTimer: (f, ms) => { const id = ++tid; timers.set(id, { at: t + ms, f }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });
  return { win, detach, closed: () => closed, setRec: (v: boolean) => { recording = v; } };
}
/** React 的做法：按下 → onClose → 聊天室關掉、拆監聽（在放開之前） */
const closeOnDown = (s: ReturnType<typeof setup>) => s.detach();

// 1. 滑鼠點牌：聊天室關掉，那一下整個被吃掉
{
  discards = 0; timers.clear();
  const s = setup();
  const passed = mouseTap(s.win, tile);
  check(s.closed() === 1, "滑鼠點牌：聊天室關閉");
  check(passed.every((p) => !p) && discards === 0, "那一下的按下、相容事件、放開、click 都沒傳到牌桌，沒有誤打出牌");
  s.detach();
  check(s.win.ls.length === 0, "手勢結束、元件拆掉後：監聽全部拆乾淨");
}
// 2. 手指點牌，按下後聊天室馬上關掉（拆監聽），放開和 click 之後才到
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  advance(80);
  const rest = [fire(s.win, "pointerup", tile, 7), fire(s.win, "mousedown", tile), fire(s.win, "mouseup", tile), fire(s.win, "click", tile, 7)];
  check(rest.every((p) => !p) && discards === 0, "聊天室拆掉後才到的放開、click：照樣被吃掉，不會打出牌");
  check(s.win.ls.length === 0 && timers.size === 0, "吃到 click 後：監聽、計時器全部拆乾淨");
  touchTap(s.win, tile);
  check(discards === 1, "之後再點一次牌：正常打出");
}
// 3. 長按（超過舊版的 800ms）才放開：放開的 click 也要吃掉（審伯實測的漏洞）
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  advance(2500);
  const up = fire(s.win, "pointerup", tile, 7); advance(10);
  const click = fire(s.win, "click", tile, 7);
  check(!up && !click && discards === 0, "按住 2.5 秒才放開：放開和 click 都被吃掉，不會打出牌");
  check(s.win.ls.length === 0, "長按手勢結束後監聽拆乾淨");
}
// 4. 取消（pointercancel，例如變成捲動）：馬上結束，下一次獨立點擊照常（審伯實測的漏洞）
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  fire(s.win, "pointercancel", tile, 7);
  check(s.win.ls.length === 0 && timers.size === 0, "取消後：監聽、計時器馬上拆掉");
  const next = touchTap(s.win, tile, 8);
  check(next.every(Boolean) && discards === 1, "取消後下一次獨立點擊：正常打出，沒被吞");
}
// 5. 取消時聊天室還沒拆（還掛著）：一樣結束，之後外面再點一次才是新的關閉手勢
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  fire(s.win, "pointercancel", tile, 7);
  const passClick = fire(s.win, "click", tile, 9);
  check(passClick && discards === 1, "取消後還沒拆監聽時的獨立 click：照常傳到牌桌");
  s.detach();
  check(s.win.ls.length === 0, "卸載：監聽拆乾淨");
}
// 6. 放開後一直沒有 click（例如拖曳）：CLICK_GAP 後結束，之後點擊照常
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  fire(s.win, "pointerup", tile, 7);
  advance(CLICK_GAP_MS + 10);
  check(s.win.ls.length === 0 && timers.size === 0, "放開後沒等到 click：逾時自動拆掉監聽");
  touchTap(s.win, tile, 8);
  check(discards === 1, "之後的點擊照常傳到牌桌");
}
// 7. 按下後一直沒放開（例如手指滑出畫面）：保底時間後拆掉
{
  timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  advance(MAX_HOLD_MS + 10);
  check(s.win.ls.length === 0 && timers.size === 0, "一直沒放開：保底時間後監聽拆乾淨");
}
// 8. 別的手指／別的手勢的 click（pointerId 不同）：不吃
{
  discards = 0; timers.clear();
  const s = setup();
  fire(s.win, "pointerdown", tile, 7);
  closeOnDown(s);
  const other = fire(s.win, "click", tile, 3);
  check(other && discards === 1, "不是同一個手勢的 click：照常傳到牌桌");
  fire(s.win, "pointerup", tile, 7);
  check(!fire(s.win, "click", tile, 7), "同一個手勢自己的 click：照樣吃掉");
}
// 9. 卸載時沒有手勢：監聽立刻拆乾淨（不留吃事件的監聽）
{
  timers.clear();
  const s = setup();
  s.detach();
  check(s.win.ls.length === 0 && timers.size === 0, "沒有手勢就卸載：監聽立刻拆乾淨");
}
// 10. 點聊天室裡面、輸入面板：不關、不擋
{
  timers.clear();
  const s = setup();
  const a = touchTap(s.win, log), b = mouseTap(s.win, panel);
  check(s.closed() === 0 && a.every(Boolean) && b.every(Boolean), "點聊天室、輸入面板：不關、事件照常（可以打字、點快捷句）");
  s.detach();
}
// 11. 正在按住錄音：點別的地方不關、不擋
{
  discards = 0; timers.clear();
  const s = setup();
  s.setRec(true);
  touchTap(s.win, tile, 8);
  check(s.closed() === 0 && discards === 1, "按住錄音中：不關聊天室，也不擋牌桌");
  s.detach();
}
// 12. Esc 關閉（桌機鍵盤）
{
  const s = setup();
  fire(s.win, "keydown", tile, undefined, "Escape");
  check(s.closed() === 1, "按 Esc：聊天室關閉");
  fire(s.win, "keydown", tile, undefined, "a");
  check(s.closed() === 1, "其他按鍵不關");
  s.detach();
}
check(insideAny(panel as unknown as EventTarget, INSIDE) && !insideAny(tile as unknown as EventTarget, INSIDE) && !insideAny(null, INSIDE), "insideAny：聊天室元件算裡面、牌不算、沒有目標不算");

console.log(failed ? `❌ 失敗 ${failed} 項` : "全部通過");
process.exit(failed ? 1 : 0);
