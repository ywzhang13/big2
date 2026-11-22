// 麻將手機版畫面（老馬 2026-11-22，老闆實機回報）：
//   ①胡、自摸（含八仙過海、七搶一）的黑底要蓋滿整個螢幕：原本 absolute 只鋪到牌桌頁的根容器，iPhone 的 body 留了瀏海、底部橫條的內距，
//     牌桌（.mjm-app）卻是 fixed 鋪滿整個螢幕，瀏海兩側和底部的牌桌露在黑底外面，看起來是一塊矩形
//   ②對家名牌下緣不能壓到海底金框：金框 .mjm-table 外面還有一圈往外 3px 的描邊，名牌下緣要離它 2px
import { readFileSync } from "node:fs";
import { holdStageForSegment, holdStage } from "../components/mahjong/fxWarmUp";
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const cele = readFileSync("components/mahjong/WinCelebration.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
ok(/data-win-cele\s+className="fixed inset-0 /.test(cele) && !/className="absolute inset-0 z-\[65\]/.test(cele), "W1 胡、自摸浮層 fixed 蓋滿整個螢幕（和隕石、大牌特效一樣），不是只鋪到牌桌頁的根容器");
const rowTop = Number(css.match(/--row-top: (\d+)px;/)?.[1]);
const plateGap = Number(css.match(/\.mjm-top \.gp \{ align-self: flex-end; margin-bottom: (\d+)px; \}/)?.[1] ?? 0);
const ring = Number(css.match(/\.mjm-table \{[^}]*box-shadow:[^;]*0 0 0 (\d+)px/)?.[1] ?? NaN);
// 對家名牌下緣＝第一列底（row-top）− margin-bottom；金框上緣＝第一列底＋2（實量 852/667/932/844 都是），外圈描邊再往外 ring px
const plateBottom = rowTop - plateGap, ringTop = rowTop + 2 - ring;
ok(Number.isFinite(ring) && ringTop - plateBottom >= 2 && plateBottom - 44 >= 10, `W2 對家名牌下緣（${plateBottom}）離金框外圈描邊（${ringTop}）≥ 2px，名牌上緣仍 ≥ 10（旗 top −10 不被切）`);
// ③ 審伯 R1：大牌、自摸特效播完自己那一段後還掛著（只留暗幕）、接著播胡／自摸浮層。牌桌根節點（[data-mt-stage]）如果還保留 will-change: transform，
//    會變成 fixed 子孫的包含塊，浮層黑底只鋪到根節點。用假的根節點實際跑一遍「掛上 → 播完 → 元件還沒卸下 → 浮層」
{
  const stage = { style: { willChange: "", boxShadow: "" } } as unknown as HTMLElement;
  const seg = holdStageForSegment(stage, "0 0 0 100vmax #000");
  const during = stage.style.willChange;
  seg.end(); // 自己那一段播完（元件還掛著）
  const atCele = stage.style.willChange;
  seg.dispose(); seg.end(); // 之後卸下、重複呼叫都不會出錯
  ok(during === "transform" && atCele === "" && stage.style.boxShadow === "", `W3 特效播放中根節點 will-change＝transform（${during}），播完交給浮層時已放掉（${atCele || "空"}），浮層 fixed 才蓋得滿螢幕`);
  // 隕石墊在大牌底下這種兩段同時掛著的情況：大牌播完放掉自己那一份，隕石還在播，根節點要維持 transform（holdStage 計數）
  const s2 = { style: { willChange: "", boxShadow: "" } } as unknown as HTMLElement;
  const big = holdStageForSegment(s2, "a"), meteor = holdStage(s2, "b");
  big.end(); const stillMeteor = s2.style.willChange; meteor();
  ok(stillMeteor === "transform" && s2.style.willChange === "", "W4 兩段特效同時掛著：大牌播完只放掉自己那一份，隕石播完才真的還原");
}
const big8 = readFileSync("components/mahjong/BigWin8Fx.tsx", "utf8"), zfx = readFileSync("components/mahjong/ZimoFx.tsx", "utf8");
ok(/const finish = \(\) => \{ if \(!ended\.current\) \{ ended\.current = true; seg\?\.end\(\);/.test(big8) && /seg = holdStageForSegment\(stage, BIG8_STAGE_SHADOW\)/.test(big8), "W5 大牌特效：播完（finish）先放掉根節點，再交給下一段");
ok(/ended\.current = true; segRef\.current\?\.end\(\); doneRef\.current\(false\);/.test(zfx) && /segRef\.current = seg;/.test(zfx), "W6 自摸特效：時間到先放掉根節點，再交給自摸浮層");
for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
