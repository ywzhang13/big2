// 十三支神獸牌背：慢速載入中跨過桌機斷點／切換款式（審伯〈十三支亮版浮雕v4與牌背-初審〉R2，老馬 2026-11-26）
// 規則：畫面上的牌背只能換成「已經載好的那個網址」；載失敗維持原本的牌背；過時的回呼不能蓋掉最後一次選擇
export {}; // 讓 tsc 把這支當模組（top-level await、和其他測試的同名變數不衝突）
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

// 替身：matchMedia（可手動切換桌機／手機並觸發 change）、Image（手動決定載好或失敗）、畫面上的兩張牌背
const listeners: (() => void)[] = [];
const mq = { matches: false, addEventListener: (_t: string, f: () => void) => void listeners.push(f) };
const setDesktop = (d: boolean) => { mq.matches = d; listeners.forEach((f) => f()); };
(globalThis as unknown as { window: unknown }).window = { matchMedia: () => mq, addEventListener: () => {} }; // 預載整副（warmImages）等 load 事件，這裡不觸發

type FakeImg = { src: string; onload: null | (() => void); onerror: null | (() => void) };
const loads: FakeImg[] = [];
(globalThis as unknown as { Image: unknown }).Image = class { src = ""; onload: null | (() => void) = null; onerror: null | (() => void) = null; constructor() { loads.push(this as FakeImg); } };
/** 讓「網址是 url、還沒結束」的那筆下載完成（成功或失敗） */
const finish = (url: string, okLoad = true) => {
  const i = loads.findIndex((x) => x.src === url);
  if (i < 0) throw new Error(`沒有在載 ${url}`);
  const [img] = loads.splice(i, 1);
  (okLoad ? img.onload : img.onerror)?.();
};
const pending = (name: string) => loads.some((x) => x.src.includes(name));

const imgs = [0, 1].map(() => { const a: Record<string, string> = { src: "/tiles/thirteen/card-back.v2.m.webp" }; return { a, getAttribute: (k: string) => a[k] ?? null, setAttribute: (k: string, v: string) => { a[k] = v; } }; });
(globalThis as unknown as { document: unknown }).document = { querySelectorAll: (q: string) => imgs.filter((i) => (q.includes("card-back") || q.includes('card-"') ? i.a.src.includes("/tiles/thirteen/card-back") : false)) };
const shown = () => imgs[0].a.src;

const art = await import("../components/thirteen/cardArt");
const D = "/tiles/thirteen";

// S1 手機→桌機：手機的青龍牌背還沒載好就放大到桌機
art.setBackFelt("green");
ok(pending("card-back-dragon.v1.m.webp"), "S1a 手機：先在背景載手機版青龍牌背");
setDesktop(true);
finish(`${D}/card-back-dragon.v1.m.webp`);
ok(!shown().includes("dragon") && !art.CARD_BACK_SRC.includes("dragon"),
  "S1b 載好時已經是桌機：不換上還沒載好的桌機圖（審伯重現的 loaded＝.m、displayed＝桌機圖不會再發生）");
ok(pending("card-back-dragon.v1.webp"), "S1c 改載桌機版青龍牌背");
finish(`${D}/card-back-dragon.v1.webp`);
ok(art.CARD_BACK_SRC === `${D}/card-back-dragon.v1.webp` && imgs.every((i) => i.a.src === art.CARD_BACK_SRC), "S1d 桌機版載好才換上，畫面和 CARD_BACK_SRC 都是載好的那個網址");

// S2 桌機→手機：已經顯示神獸牌背，縮到手機
setDesktop(false);
ok(shown() === `${D}/card-back-dragon.v1.webp` && art.CARD_BACK_SRC === `${D}/card-back-dragon.v1.webp`, "S2a 縮到手機的當下：手機版還沒載好，畫面維持原本的桌機牌背");
finish(`${D}/card-back-dragon.v1.m.webp`);
ok(shown() === `${D}/card-back-dragon.v1.m.webp` && art.CARD_BACK_SRC === shown(), "S2b 手機版載好才換上");

// S3 載入途中切換款式：只採用最後一次
art.setBackFelt("wine");
art.setBackFelt("gray");
finish(`${D}/card-back-phoenix.v1.m.webp`);
ok(shown() === `${D}/card-back-dragon.v1.m.webp`, "S3a 朱雀晚到的回呼作廢（最後選的是白虎）");
finish(`${D}/card-back-tiger.v1.m.webp`);
ok(shown() === `${D}/card-back-tiger.v1.m.webp` && art.__backFelt() === "gray", "S3b 白虎載好才換上");

// S4 載入途中切款式又跨斷點：載好的尺寸不對就重載，晚到的舊款不蓋掉
art.setBackFelt("blue");
setDesktop(true);
finish(`${D}/card-back-tortoise.v1.m.webp`);
ok(shown() === `${D}/card-back-tiger.v1.m.webp`, "S4a 玄武手機版晚到（已經是桌機、也已經改載桌機版）：不換");
finish(`${D}/card-back-tortoise.v1.webp`);
ok(shown() === `${D}/card-back-tortoise.v1.webp` && art.__backFelt() === "blue", "S4b 玄武桌機版載好才換上");

// S5 載失敗：維持原本的牌背
art.setBackFelt("green");
finish(`${D}/card-back-dragon.v1.webp`, false);
ok(shown() === `${D}/card-back-tortoise.v1.webp` && art.__backFelt() === "blue", "S5 新牌背載失敗：維持原本的玄武牌背");

// S6 切去別款又切回目前這款：還在載的別款作廢
art.setBackFelt("wine");
art.setBackFelt("blue");
finish(`${D}/card-back-phoenix.v1.webp`);
ok(shown() === `${D}/card-back-tortoise.v1.webp` && art.__backFelt() === "blue", "S6 切朱雀又切回玄武：朱雀晚到的回呼作廢，維持玄武");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
if (failed) process.exit(1);
