// 十三支大字特效置中（老馬 2026-11-22，老闆：全壘打背景只出現一半、整體往下；開始比牌偶爾偏到下面）：
// iPhone Safari 在動畫開始那一刻把 translate(-50%,-50%) 的百分比換成固定像素，圖還沒載完（或大小還在變）就偏。
// 開始比牌、牌型大字、全壘打背景／煙火／大字改成版面置中（flex 或鋪滿畫面＋object-fit: cover），動畫只縮放。
import { readFileSync } from "node:fs";
const css = readFileSync("components/thirteen/thReveal.css", "utf8");
const tsx = readFileSync("components/thirteen/ThRevealFx.tsx", "utf8");
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const kf = (name: string) => css.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
const rule = (sel: string) => css.match(new RegExp(`^${sel.replace(/[.*]/g, (c) => "\\" + c)} \\{[^}]*\\}`, "m"))?.[0] ?? "";
for (const n of ["th-start", "th-pat", "th-hr9-field", "th-hr9-fw", "th-hr9-word"]) {
  const k = kf(n);
  ok(!!k && !/translate\(-50%/.test(k), `C1 ${n}：動畫只縮放、不用 translate(-50%,-50%) 置中`);
}
ok(/display: flex; align-items: center; justify-content: center/.test(rule(".th-fx-start-at")) && /right: 0; bottom: 0/.test(rule(".th-fx-start-at")), "C2 開始比牌：外層鋪滿畫面、flex 置中");
ok(/display: flex; align-items: center; justify-content: center/.test(rule(".th-fx-pat-at")) && /className="th-fx-at th-fx-pat-at"/.test(tsx), "C3 牌型大字：外層（牌的中心點）flex 置中");
for (const s of [".th-hr9 .th-hr9-field", ".th-hr9 .th-hr9-fw"]) {
  const r = rule(s);
  ok(/width: 100%; height: 100%; object-fit: cover/.test(r) && /left: 0; top: 0/.test(r), `C4 ${s}：鋪滿畫面＋object-fit: cover（和原本「蓋滿、中心對中心」同一個結果）`);
}
ok(/display: flex; align-items: center; justify-content: center/.test(rule(".th-hr9-title")) && /left: 75vw; top: 50vh/.test(rule(".th-hr9-title")), "C5 全壘打大字：外層在 (0.75W, 0.50H)（2026-11-28 打者靠中間，大字讓開 3vw）、flex 置中");
ok(/\.th-hr9-batter \{ left: 10vw; bottom: -2vh;/.test(css) && /\.th-hr9-star \{ left: 64vw; top: 18vh;/.test(css) && /\.th-hr9-ballpath \{ --hl: 10vw; --hb: min\(92vh, 44vw\);[^}]*left: var\(--bx\); top: var\(--by\);/.test(css), "C6 打者靠中間（10vw，老闆 2026-11-28）、星星 64vw；球的起點跟著打者頭的右上方");
// 打槍、集氣（老馬 2026-11-22 第二段）：這幾張還是用 translate(-50%) 系列（槍口火光要對準噴口、要保留角度），改成寬高都寫明，圖沒載完也照對的大小算
ok(/className="th-fx th-fx-gun" style=\{\{ \.\.\.delay, width: g\.gunW, height: g\.gunH,/.test(tsx) && /gunH = gunW \* 131 \/ 256/.test(tsx), "C7 槍：寬高都寫明（高＝寬×131/256，素材比例）");
ok(/\.th-fx-muzzle-img \{ width: calc\(112px \* var\(--th-s, 1\)\); height: calc\(112px \* var\(--th-s, 1\) \* 232 \/ 336\);/.test(css), "C8 槍口火光：寬高都寫明（336:232）");
ok(/\.th-fx-charge \{[^}]*height: calc\(420px \* var\(--th-s, 1\) \* 893 \/ 1600\);/.test(css), "C9 集氣光：寬高都寫明（1600:893）");
ok(/className="th-fx th-fx-ready" style=\{\{ \.\.\.delay, height: h\.readyH, width: \(h\.readyH \* FX_AR\.hrready\[0\]\) \/ FX_AR\.hrready\[1\] \}\}/.test(tsx) && !/\.th-fx-ready \{[^}]*width: auto/.test(css), "C10 集氣人物：寬高都寫明（照 FX_AR 素材比例）");
ok(/\.th-hole, \.th-blk img\.th-hole \{ position: absolute; width: 58px; height: 58px;/.test(css) && /\.th-hole-big \{ position: absolute; width: 220px; height: 220px;/.test(css), "C11 彈孔：本來就寬高都有（58、220），不用改");
for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
