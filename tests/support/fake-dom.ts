// 測試用的最小假 DOM：讓 lib/mahjong/fx/engine.ts（Web Animations、圖片池、Lottie）能在 node 裡跑。
// 動畫照 duration 用 setTimeout 結束、cancel 時 reject（ready 馬上好、startTime＝0，document.timeline 停在 0）；Lottie 只送 DOMLoaded、不送 complete（逼引擎走保險計時器）。
// 要在 import engine 之前呼叫 installFakeDom()（engine 載入時會看 document）。
type Anim = { finished: Promise<void>; ready: Promise<void>; startTime: number; cancel: () => void; done: boolean };
const live = new Set<Anim>();
/** 現在還在跑的假動畫數（測試用：中止後應該是 0） */
export const liveAnims = () => live.size;
function fakeAnim(ms: number): Anim {
  let ok!: () => void, bad!: (e: Error) => void;
  const a: Anim = { finished: new Promise<void>((r, j) => { ok = r; bad = j; }), ready: Promise.resolve(), startTime: 0, done: false, cancel: () => {} };
  a.finished.catch(() => {});
  const t = setTimeout(() => { if (a.done) return; a.done = true; live.delete(a); ok(); }, ms);
  a.cancel = () => { if (a.done) return; a.done = true; live.delete(a); clearTimeout(t); bad(new Error("AbortError")); };
  live.add(a);
  return a;
}
export type El = Record<string, unknown> & { children: El[]; parent: El | null };
export function el(): El {
  const own = new Set<Anim>();
  const e: El = {
    children: [], parent: null, style: {}, dataset: {}, offsetWidth: 10,
    complete: true, naturalWidth: 100, naturalHeight: 100,
    classList: { add() {}, remove() {} },
    decode: async () => {},
    addEventListener() {},
    appendChild(c: El) { c.parent?.children.splice(c.parent.children.indexOf(c), 1); c.parent = e; e.children.push(c); return c; },
    after() {},
    remove() { if (e.parent) { e.parent.children.splice(e.parent.children.indexOf(e), 1); e.parent = null; } },
    replaceChildren() { e.children.slice().forEach((c) => (c.remove as () => void)()); },
    animate(_f: unknown, o: { duration?: number }) { const a = fakeAnim(o.duration ?? 0); own.add(a); return a; },
    // 和瀏覽器一樣：subtree 只拿自己和底下子孫的動畫（同時播的幾則各有子圖層，不能拿到別則的）
    getAnimations(o?: { subtree?: boolean }): Anim[] {
      const mine = [...own].filter((a) => !a.done);
      return o?.subtree ? [...mine, ...e.children.flatMap((c) => (c.getAnimations as (o: { subtree: boolean }) => Anim[])({ subtree: true }))] : mine;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
  return e;
}
export function installFakeDom(extra: Record<string, unknown> = {}) {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.innerWidth = 844;
  g.innerHeight = 390;
  g.document = { hidden: false, head: el(), body: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, timeline: { currentTime: 0 } };
  g.Image = function Image() { return el(); };
  // Lottie：只送出 DOMLoaded，播放時不送 complete，逼引擎走「保險計時器」那條路
  g.lottie = { loadAnimation: () => ({ addEventListener: (ev: string, f: () => void) => { if (ev === "DOMLoaded") f(); }, setSpeed() {}, playSegments() {}, goToAndStop() {}, destroy() {} }) };
  g.fetch = extra.fetch ?? (async () => ({ ok: true, blob: async () => new Blob(["x"]), text: async () => JSON.stringify({ w: 700, h: 525, fr: 30, op: 121 }), arrayBuffer: async () => new ArrayBuffer(8) }));
}
