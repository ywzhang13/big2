// 三款共用的設定面板 GamePrefsPanel（小測〈麻將共用設定面板證據驗收〉第 17 項，2026-11-21）：
//   P1 沒傳「桌機一列幾張」（cols）：圖卡區跟原本一樣（沒有額外樣式，CSS 預設一列 2 張）
//   P2 有傳 cols：照指定張數（--gpp-cols），手機橫向的規則照舊固定 4 張
//   P3 其他區塊（十三支的桌布色塊、麻將的快速主題）和分頁順序、聲音頁照舊
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const { GamePrefsCard } = await import("../components/gamePrefs/GamePrefsPanel");
type Tab = Parameters<typeof GamePrefsCard>[0]["tabs"][number];
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const draw = (tabs: Tab[], game = "test") => clean(renderToStaticMarkup(createElement(GamePrefsCard, { onClose: () => {}, tabs, game })));
const cards = (cols?: number): Tab => ({ id: "fx", name: "自摸特效", sections: [{ kind: "cards", cols, value: "a", onChange: () => {}, options: ["a", "b", "c"].map((id) => ({ id, name: id, thumb: null })) }] });

{
  const h = draw([cards()]);
  ok(/<div class="gpp-cards"><button/.test(h) && !/--gpp-cols/.test(h), "P1 沒傳 cols：圖卡區沒有額外樣式（和原本一樣）");
  const css = readFileSync("components/gamePrefs/gamePrefsPanel.css", "utf8");
  ok(/\.gpp-cards \{[^}]*grid-template-columns: repeat\(var\(--gpp-cols, 2\), minmax\(0, 1fr\)\)/.test(css), "P1b 桌機 CSS 預設一列 2 張（沒給 --gpp-cols 時）");
}
{
  const h = draw([cards(4)]);
  ok(/<div class="gpp-cards" style="--gpp-cols:4"><button/.test(h), "P2 cols＝4：圖卡區帶 --gpp-cols:4（桌機一列 4 張）");
  const css = readFileSync("components/gamePrefs/gamePrefsPanel.css", "utf8");
  const mobile = css.slice(css.indexOf("@media (max-height: 500px)"));
  ok(/\.gpp-cards \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(mobile), "P2b 手機橫向（高 ≤ 500）照舊固定一列 4 張，不看 cols");
}
{
  const felt: Tab = { id: "look", name: "外觀", sections: [{ kind: "swatch", title: "桌布", value: "green", onChange: () => {}, options: [{ id: "green", name: "深綠", bg: "#1f6b45" }, { id: "blue", name: "藍", bg: "#24507f" }] }], onReset: () => {} };
  const h = draw([felt], "thirteen");
  ok(/data-gpp="thirteen"/.test(h) && /data-gpp-tab-btn="look"[^>]*>外觀<\/button><button[^>]*data-gpp-tab-btn="sound"[^>]*>聲音/.test(h) && /class="gpp-sw on"[^>]*background:#1f6b45/.test(h) && /data-gpp-tab="look"/.test(h),
    "P3 十三支：外觀、聲音兩頁，打開停在外觀，桌布色塊照舊");
  const sound = draw([]);
  ok(/data-gpp-tab="sound"/.test(sound) && /data-gpp-vol="voice"/.test(sound) && /data-gpp-switch="vibrate"/.test(sound), "P3b 沒有自己的分頁（大老二）：只有聲音頁");
  const fx = { ...cards(4), afterSound: true };
  const mj = draw([felt, fx], "mahjong");
  const order = ["look", "sound", "fx"].map((id) => mj.indexOf(`data-gpp-tab-btn="${id}"`));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "P3c 麻將：外觀、聲音、自摸特效（afterSound 排在聲音後面）");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
