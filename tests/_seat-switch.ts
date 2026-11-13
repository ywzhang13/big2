// 觀戰、回放共用的四家視角切換（components/mahjong/spectate/MjSeatSwitch.tsx，小宜〈觀戰與回放-視角切換設計規格〉）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MjSeatSwitch from "../components/mahjong/spectate/MjSeatSwitch";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const noop = () => {};
const html = (props: Partial<Parameters<typeof MjSeatSwitch>[0]>) => renderToStaticMarkup(createElement(MjSeatSwitch, {
  mode: "觀戰中", current: 2, onSelect: noop,
  options: [{ seat: 0, name: "阿美" }, { seat: 1, name: "小林" }, { seat: 2, name: "老王" }, { seat: 3, name: "阿德" }],
  ...props,
}));
const seats = (h: string) => [...h.matchAll(/data-seat-switch-seat="(\d)"/g)].map((m) => Number(m[1]));
const label = (h: string, seat: number) => h.match(new RegExp(`aria-label="([^"]*)"[^>]*data-seat-switch-seat="${seat}"`))?.[1] ?? "";

// 排序：固定東南西北，風位綁真實座位（開門那家是東）
{
  const h = html({ doorSeat: 2, dealerSeat: 2 });
  check(JSON.stringify(seats(h)) === "[2,3,0,1]", "開門在座位 2：按鈕照東（座位2）南（3）西（0）北（1）排");
  check(label(h, 2) === "切換至東風，老王" && label(h, 1) === "切換至北風，小林", "讀屏名稱：切換至○風，完整名字");
  const h2 = html({ doorSeat: undefined, dealerSeat: 1 });
  check(JSON.stringify(seats(h2)) === "[1,2,3,0]", "沒有開門資料：以莊家當東（和牌桌名牌同一條規則）");
  const h3 = html({ doorSeat: undefined, dealerSeat: undefined });
  check(JSON.stringify(seats(h3)) === "[0,1,2,3]" && !/切換至.風/.test(h3), "還不知道風位（視角載入中）：照座位順序，不亂標風位");
}
// 目前視角：金框（on）＋勾號＋aria-checked；點目前這個不重載
{
  const h = html({ doorSeat: 0, dealerSeat: 0, current: 3 });
  const btn = h.match(/<button[^>]*data-seat-switch-seat="3"[^>]*>.*?<\/button>/)?.[0] ?? "";
  check(btn.includes('aria-checked="true"') && btn.includes("mss-btn on") && btn.includes("✓"), "目前在看的那家：選中樣式＋✓＋aria-checked");
  check((h.match(/aria-checked="true"/g) ?? []).length === 1, "同一時間只有一家是選中");
  check(h.includes('class="mss-mode">觀戰中<'), "旁邊顯示模式文字「觀戰中」");
}
// 停用：還沒同意的人不能按，按鈕上寫原因（不只靠顏色）；回放的「自己」是小字、可以按
{
  const h = html({ doorSeat: 0, dealerSeat: 0, options: [{ seat: 0, name: "阿美" }, { seat: 1, name: "小林", disabledReason: "未同意" }, { seat: 2, name: "老王" }, { seat: 3, name: "阿德", disabledReason: "等待回應" }] });
  const b1 = h.match(/<button[^>]*data-seat-switch-seat="1"[^>]*>.*?<\/button>/)?.[0] ?? "";
  check(b1.includes("disabled") && b1.includes("未同意") && label(h, 1).includes("未同意"), "還沒同意：停用、按鈕和讀屏都寫「未同意」");
  const r = html({ mode: "回放中", doorSeat: 0, dealerSeat: 0, options: [{ seat: 0, name: "阿美", note: "自己" }, { seat: 1, name: "小林" }, { seat: 2, name: "老王" }, { seat: 3, name: "阿德" }] });
  const b0 = r.match(/<button[^>]*data-seat-switch-seat="0"[^>]*>.*?<\/button>/)?.[0] ?? "";
  check(!b0.includes("disabled") && b0.includes("自己") && r.includes("回放中"), "回放：自己那家有「自己」小字、可以按，模式文字「回放中」");
}

// 收合式（手機觀戰，老闆 2026-11-14）：只是一顆「視角・目前那家」小鈕（放在名牌列），不寫「觀戰中」、不佔一整條；
// 四家要按下去才出現；回放、桌機不傳就照舊平鋪
{
  const h = html({ doorSeat: 2, dealerSeat: 2, current: 2, collapsible: true, compact: true });
  const tg = h.match(/<button[^>]*data-seat-switch-toggle[^>]*>.*?<\/button>/)?.[0] ?? "";
  check(!!tg && tg.includes("視角") && tg.includes("老王") && tg.includes('aria-expanded="false"'), "收起時：一顆「視角・老王」按鈕（目前看的那家），標成未展開");
  check(seats(h).length === 0 && !h.includes('role="radiogroup"'), "收起時：四家按鈕不畫");
  check(!h.includes("觀戰中") && !h.includes("mss-mode") && /^<span[^>]*class="mss-pick"/.test(h), "收起時：不寫「觀戰中」、不是整條切換列，只是一顆可以放進名牌列的小鈕");
  const flat = html({ doorSeat: 2, dealerSeat: 2, compact: true });
  check(seats(flat).length === 4 && !flat.includes("data-seat-switch-toggle") && flat.includes('class="mss-mode">觀戰中<'), "不傳 collapsible（回放、桌機觀戰）：照舊四家平鋪、寫「觀戰中」，沒有視角按鈕");
  const none = html({ current: null, collapsible: true });
  const tg2 = none.match(/<button[^>]*data-seat-switch-toggle[^>]*>.*?<\/button>/)?.[0] ?? "";
  check(tg2.includes("視角") && !tg2.includes("・"), "還沒選視角：按鈕只寫「視角」");
}

if (failed) process.exit(1);
