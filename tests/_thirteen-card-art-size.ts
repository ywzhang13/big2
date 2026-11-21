// 十三支牌圖跟著手機／桌機尺寸切換（審伯〈第一把效能改善-初審〉R1）：同一頁不重新整理，跨過桌機斷點（寬 ≥1100 且高 ≥700）時，
// 牌面、金卡、牌背都要換成目前尺寸的圖（手機 .m.webp 小圖、桌機原圖），畫面上已經畫好的牌也要跟著換，不能等下一個遊戲事件。
// 這裡沒有瀏覽器：用假的 matchMedia（可以切換 matches、會通知 change）和假的 document（幾張 img）跑真的 cardArt.ts。
import type { Card } from "../lib/thirteen";
type Listener = () => void;
const listeners: Listener[] = [];
const mq = { matches: false, media: "", addEventListener: (_t: string, f: Listener) => { listeners.push(f); }, removeEventListener() {}, addListener: (f: Listener) => { listeners.push(f); }, removeListener() {} };
const fakeImg = (src: string) => ({ src, getAttribute(this: { src: string }) { return this.src; }, setAttribute(this: { src: string }, _k: string, v: string) { this.src = v; } });
const imgs = [
  fakeImg("/tiles/thirteen/card-front-spade-a.v4.m.webp"),
  fakeImg("/tiles/thirteen/card-front-heart-7.gold.v1.m.webp"),
  fakeImg("/tiles/thirteen/card-back.v2.m.webp"),
  fakeImg("/home/home-big2.webp"), // 不是十三支牌圖：不能動
];
const g = globalThis as unknown as Record<string, unknown>;
g.window = { matchMedia: () => mq };
g.document = { querySelectorAll: () => imgs, readyState: "complete" };

const art = await import("../components/thirteen/cardArt");
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const card = { id: "SA1", suit: "S", rank: 14, deck: 1 } as Card, seven = { id: "H71", suit: "H", rank: 7, deck: 1 } as Card;
const flip = (desk: boolean) => { mq.matches = desk; listeners.forEach((f) => f()); };
const snap = () => ({ face: art.cardSrc(card), gold: art.cardSrc(seven, 7), back: art.CARD_BACK_SRC, dom: imgs.map((i) => i.src) });

let s = snap();
ok(s.face.endsWith("spade-a.v4.m.webp") && s.gold.endsWith("heart-7.gold.v1.m.webp") && s.back.endsWith("card-back.v2.m.webp"), "C1 手機開頁：牌面、金卡、牌背都用 .m 小圖");
flip(true); s = snap();
ok(s.face.endsWith("spade-a.v4.webp") && s.gold.endsWith("heart-7.gold.v1.webp") && s.back.endsWith("card-back.v2.webp"), `C2 手機 → 桌機：三種圖都換原圖（牌背 ${s.back}）`);
ok(s.dom[0].endsWith("spade-a.v4.webp") && s.dom[1].endsWith("heart-7.gold.v1.webp") && s.dom[2].endsWith("card-back.v2.webp") && s.dom[3] === "/home/home-big2.webp", "C3 手機 → 桌機：畫面上已經畫好的牌面、金卡、牌背跟著換，別的圖不動");
flip(false); s = snap();
ok(s.face.endsWith(".v4.m.webp") && s.gold.endsWith(".gold.v1.m.webp") && s.back.endsWith("card-back.v2.m.webp"), "C4 桌機 → 手機：三種圖都換回小圖");
ok(s.dom[0].endsWith(".v4.m.webp") && s.dom[1].endsWith(".gold.v1.m.webp") && s.dom[2].endsWith("card-back.v2.m.webp") && s.dom[3] === "/home/home-big2.webp", "C5 桌機 → 手機：畫面上的牌跟著換回小圖");
flip(true); flip(true); s = snap();
ok(s.dom[0].endsWith("spade-a.v4.webp") && !s.dom[0].includes(".m.m") && !s.dom[2].includes("..") , "C6 重複通知同一個尺寸：網址不會壞掉");
ok(art.deckSrcs([card]).every((u) => !u.includes(".m.webp")), "C7 桌機時預載清單（deckSrcs）也是原圖，和畫面一致");

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
