// 十三支四神獸桌布（老馬 2026-11-26，老闆定案；v2 重生圖）：四款對應、素材檔、底色、圖在牌面之後才載入；他家的牌背跟著桌布換
import { existsSync, readFileSync, statSync } from "node:fs";

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

// node 沒有 document／localStorage：給最小的替身，看 applyFelt 什麼時候把圖掛上去
const root = { dataset: {} as Record<string, string> };
// 畫面上已經畫好的兩張牌背（看切換時有沒有被換掉）
const imgs = [0, 1].map(() => { const a: Record<string, string> = { src: "/tiles/thirteen/card-back.v2.webp" }; return { a, getAttribute: (k: string) => a[k] ?? null, setAttribute: (k: string, v: string) => { a[k] = v; } }; });
(globalThis as unknown as { document: unknown }).document = { documentElement: root, images: [], querySelectorAll: (q: string) => (q.includes("card-back") ? imgs.filter((i) => i.a.src.includes("/tiles/thirteen/card-back")) : []) };
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };

const { FELTS, applyFelt, loadFelt } = await import("../components/thirteen/feltTheme");
const art = await import("../components/thirteen/cardArt");

const names = Object.fromEntries(FELTS.map((f) => [f.key, f.name]));
ok(names.green === "青龍" && names.wine === "朱雀" && names.gray === "白虎" && names.blue === "玄武",
  "F1 四款對應：深綠→青龍、酒紅→朱雀、石墨灰→白虎、午夜藍→玄武（key 沿用，玩家原本的選擇不用重選）");

mem.set("th_felt", "wine");
ok(loadFelt() === "wine", "F2 本機記的舊 key（wine）照樣讀得到，對到朱雀");

applyFelt("blue");
ok(root.dataset.thFelt === "blue" && root.dataset.thFeltImg === undefined, "F3 套用桌布的當下只換底色，圖還沒掛（不跟牌面搶下載）");
ok(art.CARD_BACK_SRC === "/tiles/thirteen/card-back.v2.webp", "B1 牌面還沒載完：牌背先用原本的 card-back.v2 頂著（第一把不多載、不會空白）");
await new Promise((r) => setTimeout(r, 50));
ok(root.dataset.thFeltImg === "1", "F4 等畫面上的牌面載完（whenScreenImagesLoaded）才掛 data-th-felt-img，這時才載桌布圖");
ok(art.CARD_BACK_SRC === "/tiles/thirteen/card-back-tortoise.v1.webp" && imgs.every((i) => i.a.src === art.CARD_BACK_SRC),
  "B2 牌面載完後牌背換成這款桌布（玄武）的神獸牌背，畫面上已經畫好的牌背也跟著換");
applyFelt("wine");
ok(art.CARD_BACK_SRC === "/tiles/thirteen/card-back-phoenix.v1.webp" && imgs.every((i) => i.a.src === art.CARD_BACK_SRC), "B3 之後切換桌布（朱雀）：牌背立刻跟著換");
for (const [k, b] of [["green", "dragon"], ["gray", "tiger"], ["blue", "tortoise"], ["wine", "phoenix"]] as const) {
  applyFelt(k);
  if (art.CARD_BACK_SRC !== `/tiles/thirteen/card-back-${b}.v1.webp`) results.push(`❌ B4 ${k} 對到的牌背錯了：${art.CARD_BACK_SRC}`);
}
ok(art.__backFelt() === "wine", "B4 四款都對到同一隻神獸的牌背（青龍→龍、白虎→虎、玄武→龜蛇、朱雀→鳳）");
ok(art.sizedCardUrl("/tiles/thirteen/card-back-tiger.v1.webp", false) === "/tiles/thirteen/card-back-tiger.v1.m.webp"
  && art.sizedCardUrl("/tiles/thirteen/card-back-tiger.v1.m.webp", true) === "/tiles/thirteen/card-back-tiger.v1.webp",
  "B5 神獸牌背跨過桌機斷點也會換成對的尺寸（.m ⇄ 原圖）");

const css = readFileSync("components/thirteen/thRoom.css", "utf8");
const hashes = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, string>;
for (const k of ["dragon", "phoenix", "tiger", "tortoise"]) {
  for (const suf of [".v2.webp", ".v2.m.webp"].map((x) => (k === "tiger" ? x.replace("v2", "v3") : x))) { // 白虎理牌換 v3（老闆 2026-11-26）
    const url = `/tiles/thirteen/th-felt-${k}${suf}`;
    const file = `public${url}`;
    const big = !suf.includes(".m.");
    ok(existsSync(file) && css.includes(`url("${url}")`) && !!hashes[url] && statSync(file).size < (big ? 160_000 : 40_000),
      `F5 ${k}${suf}：檔案在、CSS 有引用、登記在長期快取清單、${big ? "桌機版 < 160KB" : "手機版 < 40KB"}`);
  }
}
ok(/:root\[data-th-felt-img\]\s*\{\s*--th-felt-bg:\s*var\(--th-felt-img\) var\(--th-felt-pos, center top\) \/ cover no-repeat,\s*radial-gradient/.test(css),
  "F6 圖預設對齊上緣置中（v2 神獸頭在上緣中間偏右），下面墊同色系漸層：圖還沒載好時不會閃白");
ok(/:root\[data-th-felt="gray"\][^}]*th-felt-tiger\.v3\.m\.webp[^}]*--th-felt-pos: right top;/.test(css), "M0b 白虎 v3（2.16:1）靠右對齊：16:9 畫面裁左邊，虎頭落在倒數左邊");
ok(/@media \(min-width: 1100px\) and \(min-height: 700px\)\s*\{\s*:root \{ --th-felt-img: url\("\/tiles\/thirteen\/th-felt-dragon\.v2\.webp"\)/.test(css),
  "F7 桌機（寬 ≥1100 且高 ≥700）用大圖，其他用手機小圖");
ok(!css.includes("th-felt-suits"), "F8 舊的花色底紋不再疊在神獸圖上");
// 桌墊（打牌、亮牌畫面）：貼在舞台 .th-table 上、拉滿 100%×100%，舞台外用最外圈暗底；圖在牌面之後才掛
ok(!css.includes("th-felt-tiger.v2"), "M0 理牌的白虎換成 v3，舊的 v2 不再引用");
// 沒上線過的舊理牌圖（v1 四款、白虎 v2）不提交：不能留在長期快取清單，否則乾淨 checkout 會缺檔
for (const u of ["dragon.v1", "phoenix.v1", "tiger.v1", "tortoise.v1", "tiger.v2"].flatMap((b) => [`/tiles/thirteen/th-felt-${b}.webp`, `/tiles/thirteen/th-felt-${b}.m.webp`]))
  ok(!css.includes(u) && !hashes[u], `M7 舊理牌圖 ${u.split("/").pop()}：CSS 不引用、不登記長期快取`);
ok(/\.th-bg \{[^}]*background: var\(--th-mat-out/.test(css), "M1 牌桌／亮牌畫面舞台外是桌墊最外圈的暗底（--th-mat-out），不再是全版桌布");
ok(/\.th-bg > \.th-table::before \{[^}]*position: absolute; inset: 0; z-index: -1;[^}]*background: var\(--th-mat-bg\)/.test(css), "M2 桌墊掛在舞台 .th-table::before（壓在所有子元素底下、跟著舞台縮放）");
ok(/:root\[data-th-felt-img\] \{ --th-mat-bg: var\(--th-mat-img\) center \/ 100% 100% no-repeat,\s*radial-gradient/.test(css) && /:root \{ --th-mat-bg: radial-gradient/.test(css),
  "M3 桌墊圖在牌面載完（data-th-felt-img）才掛、拉滿舞台；之前是同色系漸層不閃白");
ok(/:root \{ --th-mat-out: #01321F;/.test(css) && /"wine"\] \{ --th-mat-out: #3D0107;/.test(css) && /"gray"\] \{ --th-mat-out: #26282D;/.test(css) && /"blue"\] \{ --th-mat-out: #00173B;/.test(css),
  "M5 舞台外圍色從 v4 亮版浮雕桌面最外 6px 取平均：青龍 #01321F、朱雀 #3D0107、白虎 #26282D、玄武 #00173B");
for (const k of ["dragon", "phoenix", "tiger", "tortoise"]) {
  for (const suf of [".v4.webp", ".v4.m.webp"]) {
    const url = `/tiles/thirteen/th-mat-${k}${suf}`;
    ok(existsSync(`public${url}`) && css.includes(`url("${url}")`) && !!hashes[url] && statSync(`public${url}`).size < (suf === ".v4.webp" ? 160_000 : 60_000),
      `M4 桌墊 ${k}${suf}（v4 亮版浮雕）：檔案在、CSS 有引用、登記長期快取、${suf === ".v4.webp" ? "< 160KB" : "< 60KB"}`);
  }
  for (const suf of [".v1.webp", ".v1.m.webp", ".v2.webp", ".v2.m.webp", ".v3.webp", ".v3.m.webp"]) {
    const url = `/tiles/thirteen/th-mat-${k}${suf}`;
    ok(!css.includes(url) && !hashes[url], `M6 舊桌墊 ${k}${suf}：CSS 不再引用、不登記長期快取（沒上線過、不提交）`);
  }
}
for (const b of ["dragon", "phoenix", "tiger", "tortoise"]) {
  for (const suf of [".v1.webp", ".v1.m.webp"]) {
    const url = `/tiles/thirteen/card-back-${b}${suf}`;
    ok(existsSync(`public${url}`) && !!hashes[url], `B6 ${b} 牌背${suf}：檔案在、登記在長期快取清單`);
  }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
