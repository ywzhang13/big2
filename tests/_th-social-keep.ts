// 十三支換畫面不重裝互動元件（阿妍〈十三支丟道具沒反應〉2026-11-27）：原本牌桌掛在頁面最外層、亮牌掛在 ThReveal 裡面，
// 位置不同 → 從等人牌桌進到亮牌、亮牌進到結算時 ThSocial／SocialFxMenu 整個拆掉重裝：正在播的特效被清掉、打開的選單消失、亮牌中排隊的特效被丟掉。
// 改法：每個畫面都回傳「<>畫面 + ThSocial key="th-social"</>」（React 靠 key 認出同一個）；ThReveal 只往上報階段；結算改成 enabled=false 不卸載。
// 這裡沒有 React 掛載環境，用原始碼檢查結構（瀏覽器實測見 big2-th-fxkeep/.tmp/fxkeep/）
import { readFileSync } from "node:fs";
export {};
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const page = readFileSync("app/thirteen/page.tsx", "utf8");
const reveal = readFileSync("components/thirteen/ThReveal.tsx", "utf8");
const social = readFileSync("components/thirteen/ThSocial.tsx", "utf8");
const fx = readFileSync("components/social/SocialFxMenu.tsx", "utf8");

// 1. 頁面：ThSocial 有固定的 key，理牌、牌桌、亮牌三條路都在頁面這一層掛、而且是「片段的子元素」
ok(/<ThSocial key="th-social"/.test(page), "S1 ThSocial 有固定 key（th-social）：換畫面時 React 認得是同一個，不重裝");
ok(/\{social\("arrange"\)\}/.test(page) && /\{social\("table"\)\}/.test(page) && /\{show\.final \? null : social\(rs\.phase, rs\.hold\)\}/.test(page),
  "S2 理牌、牌桌、亮牌三個畫面都在頁面這一層掛 ThSocial（亮牌不再掛在 ThReveal 裡面）");
ok(!/\bsocial=\{/.test(page) && /onSocial=\{show\.final \? undefined : \(s\) => setRevealSocial/.test(page), "S3 頁面不再把 social 交給 ThReveal 畫，改收 ThReveal 報上來的階段");
// 亮牌那一條也要回傳片段（根節點和牌桌、理牌一樣是 Fragment，React 才會比對子元素的 key）
ok(/return \(<>\s*<ThReveal key=\{show\.key\}/.test(page), "S4 亮牌畫面回傳片段 <><ThReveal …/>{social}</>，跟牌桌、理牌同一種根節點");

// 2. ThReveal：只往上報、不畫互動元件；只在階段或 hold 變了才報
ok(!/social\?\.\(/.test(reveal) && !/<ThSocial/.test(reveal), "S5 ThReveal 不再畫互動元件");
ok(/onSocial\?: \(s: \{ phase: "table" \| "result"; hold: boolean \}\) => void/.test(reveal) && /\[socialPhase, socialHold\]\);/.test(reveal),
  "S6 ThReveal 用 onSocial 往上報（牌桌／結算、牌型大字播放中），只在變了的時候報");

// 3. ThSocial：結算也掛著 SocialFxMenu，只是不能丟
ok(/\(phase === "table" \|\| phase === "result"\) && \(/.test(social) && /enabled=\{!guest && phase === "table"\}/.test(social),
  "S7 結算時 SocialFxMenu 照樣掛著（正在播的、排隊的特效播完），只是 enabled＝false 不能丟");

// 4. SocialFxMenu 本身的規則沒變：卸載才清特效層；enabled 關掉時收起選單；hold 結束才播排著的
ok(/return \(\) => \{ abortFx\(\); setFxLayer\(null\); \};/.test(fx) && /useLayoutEffect\(\(\) => \(\) => menu\.reset\(\), \[menu, hand, enabled\]\)/.test(fx)
  && /if \(holdRef\.current \|\| !pending\.current\.length\) return;/.test(fx), "S8 SocialFxMenu 規則照舊（麻將、大老二沒用它，行為不變）");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
