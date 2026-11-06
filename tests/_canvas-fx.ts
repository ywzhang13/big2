// 櫻花紛飛畫布引擎（lib/mahjong/fx/canvasFx.ts；小宜規格第 3、5、6 節）：用假的 canvas 記下每一次畫圖
//   C1 上限：手機 240 片、電腦 414 片；倍率手機 ≤1.5、電腦 ≤2
//   C2 畫面只由時間決定：同一個 ms 畫兩次，畫圖指令完全一樣
//   C3 紛飛段花瓣鋪滿全畫面（四個象限都有）
//   C4 四家風向不同
//   C5 閃光：全畫面閃只在主擊後 210ms 內
//   C6 不用 filter、shadowBlur
//   C7 自動降級 100% → 60% → 40%；切背景的大間隔不算
//   C8 順風推只在主擊後 220ms；暗幕播到結束都留著；牌和大字 3.04 秒起淡出
//   C9 收尾：畫布寬高歸 0；花瓣表還沒載好也能畫
//   C10 runSakura：全程只有一個 rAF 迴圈、不叫 element.animate；播完、跳過、卸載都放掉畫布和圖片，舞台復位，stop 可重複呼叫
//   C10b 播完、跳過都放掉內部的光暈畫布；stop 之後不再碰畫布
//   C12 櫻花不走 CSS 動畫：大字不掛小花瓣和掃光（共 11 個動畫來源）、樣式表關掉暗幕牌大字名字的動畫（真實瀏覽器的 getAnimations() 量測在預覽站驗收腳本）
//   C13 舊版櫻花 6 個素材 URL 留著：上線當下還開著舊頁面的玩家會載這些檔，刪掉會 404，舊頁面退回金色或破圖（審伯 2026-11-05）
//   C11 牌、大字的樣子：主擊前看不到，登場有過衝，定位後沒有 transform；減少動態只有透明度
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZimoTitle from "../components/mahjong/ZimoTitle";
import { frameGovernor, makePetals, runSakura, SAKURA_LIMIT, SAKURA_TL, SakuraCanvas, sakuraDim, sakuraFadeOut, sakuraPush, sakuraStillPose, sakuraTilePose, sakuraTitlePose } from "../lib/mahjong/fx/canvasFx";

const results: string[] = [];
const ok = (c: boolean, msg: string) => results.push(`${c ? "✅" : "❌"} ${msg}`);

type Call = [string, ...unknown[]];
function fakeCtx() {
  const calls: Call[] = [], props: Record<string, unknown> = {};
  const rec = (name: string) => (...a: unknown[]) => { calls.push([name, ...a.map((v) => (typeof v === "object" ? "obj" : v))]); };
  const base: Record<string, unknown> = { calls, props, createRadialGradient: () => ({ addColorStop() {} }) };
  return new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : rec(k)),
    set: (t, k: string, v) => { props[k] = v; calls.push([`set:${k}`, typeof v === "object" ? "obj" : v]); return true; },
  }) as unknown as CanvasRenderingContext2D & { calls: Call[]; props: Record<string, unknown> };
}
function fakeCanvas() { const ctx = fakeCtx(); return { width: 0, height: 0, style: {}, getContext: () => ctx, ctx } as unknown as HTMLCanvasElement & { ctx: ReturnType<typeof fakeCtx> }; }
const baked: HTMLCanvasElement[] = [];
(globalThis as unknown as { document: unknown }).document = { createElement: () => { const c = fakeCanvas(); baked.push(c); return c; } };
const sheet = { naturalWidth: 384 } as HTMLImageElement;
const geo = (rel: number, mobile = true) => ({ W: mobile ? 844 : 1440, H: mobile ? 390 : 900, u: mobile ? 390 : 892.8, px: mobile ? 422 : 720, py: mobile ? 273 : 630, rel, mobile });
const make = (rel = 0, mobile = true, dpr = 3) => { const cv = fakeCanvas(); const f = new SakuraCanvas(cv, geo(rel, mobile), dpr); f.setSheet(sheet); return { cv, f, x: cv.ctx }; };

// C1
ok(makePetals(390, 0, SAKURA_LIMIT.mobile.petals).length === 144, "C1 手機 144 片（2026-11-07 老闆試做版：花瓣叢照片比單片花瓣大，片數降到約 6 成）");
ok(makePetals(892, 0, SAKURA_LIMIT.desktop.petals).length === 248, "C1 電腦 248 片");
{ const m = make(0, true, 3), d = make(0, false, 3); ok(m.cv.width === Math.round(844 * 1.5), "C1 手機倍率上限 1.5"); ok(d.cv.width === 1440 * 2, "C1 電腦倍率上限 2"); }
{ const { f, x } = make(); f.draw(2400); const n = x.calls.filter((c) => c[0] === "drawImage").length; ok(f.lastCount <= 144 && f.lastCount >= 120 && n <= 149, `C1 一格的花瓣數在上限內（${f.lastCount} 片）`); }
// C2
{ const { f, x } = make(); f.draw(1700); const a = JSON.stringify(x.calls); x.calls.length = 0; f.draw(1700); ok(a === JSON.stringify(x.calls), "C2 同一個時間畫兩次完全一樣"); }
// C3、C4
const spots = (rel: number, ms: number) => { const { f, x } = make(rel); f.draw(ms); const dpr = 1.5; return x.calls.filter((c) => c[0] === "setTransform" && c[1] !== dpr).map((c) => [Number(c[5]) / dpr, Number(c[6]) / dpr]); };
for (const rel of [0, 1, 2, 3]) {
  const pts = spots(rel, 2500).filter(([X, Y]) => X >= 0 && X <= 844 && Y >= 0 && Y <= 390);
  const q = [0, 1, 2, 3].map((k) => pts.filter(([X, Y]) => (X < 422 ? 0 : 1) + (Y < 195 ? 0 : 2) === k).length);
  ok(q.every((n) => n >= pts.length * 0.12), `C3 視角 ${rel} 紛飛段四個象限都有花瓣（${q.join("、")}）`);
}
{ const dirs = [0, 1, 2, 3].map((rel) => { const a = spots(rel, 300), b = spots(rel, 500), n = Math.min(a.length, b.length); let dx = 0, dy = 0, c = 0; for (let i = 0; i < n; i++) { const X = b[i][0] - a[i][0], Y = b[i][1] - a[i][1]; if (Math.abs(X) < 200 && Math.abs(Y) < 200) { dx += X; dy += Y; c++; } } return [dx / c, dy / c]; });
  ok(dirs[0][0] > 0 && dirs[1][0] < 0 && dirs[3][0] > 0 && dirs[2][1] > 0, `C4 風向：自己往右、下家往左、上家往右、對家往下（${dirs.map((d) => d.map((v) => v.toFixed(1)).join("/")).join("，")}）`); }
// C5、C6
{ const flashAt = (ms: number) => { const { f, x } = make(); f.draw(ms); return x.calls.some((c) => c[0] === "fillRect"); };
  ok(!flashAt(SAKURA_TL.hit - 1) && flashAt(SAKURA_TL.hit) && flashAt(SAKURA_TL.hit + 200) && !flashAt(SAKURA_TL.hit + 211), "C5 全畫面閃只在主擊後 210ms 內"); }
{ const { f, x } = make(); for (const ms of [100, 600, 1000, 1200, 1500, 2500, 3300]) f.draw(ms); ok(!("filter" in x.props) && !("shadowBlur" in x.props), "C6 不用 filter、shadowBlur"); }
// C7
{ const g = frameGovernor(); let s = 1; for (let i = 0; i < 20; i++) s = g(16); ok(s === 1, "C7 順的時候不降"); for (let i = 0; i < 20; i++) s = g(40); ok(s === 0.6, "C7 連續 20 格超過 28ms 降到 60%"); for (let i = 0; i < 20; i++) s = g(40); ok(s === 0.4, "C7 再超過降到 40%"); }
{ const g = frameGovernor(); let s = 1; for (let i = 0; i < 40; i++) s = g(i % 2 ? 1000 : 16); ok(s === 1, "C7 切背景的大間隔不算"); }
{ const { f } = make(); f.draw(2400); const full = f.lastCount; f.scale = 0.4; f.draw(2400); ok(f.lastCount < full * 0.5, `C7 降級後花瓣變少（${full} → ${f.lastCount}）`); }
// C8
ok(sakuraPush(SAKURA_TL.hit - 1, 0, true) === 0 && sakuraPush(SAKURA_TL.hit + 110, 0, true) > 4 && sakuraPush(SAKURA_TL.hit + 220, 0, true) === 0, "C8 順風推只在主擊後 220ms");
ok(sakuraPush(SAKURA_TL.hit + 110, 1, true) < 0 && Math.abs(sakuraPush(SAKURA_TL.hit + 110, 3, false)) > 7, "C8 方向跟著風、電腦 7.5px");
ok(sakuraDim(0) === 0 && Math.abs(sakuraDim(3400) - 0.58) < 1e-9, "C8 暗幕 0 開始、到結束都留著 0.58");
ok(sakuraFadeOut(3040) === 1 && sakuraFadeOut(3400) === 0, "C8 牌和大字 3.04 秒起淡出");
ok(SAKURA_TL.total === 3400 && SAKURA_TL.hit === 1120 && SAKURA_TL.tile === 1420 && SAKURA_TL.zimo === 1880 && SAKURA_TL.name === 2120, "C8 時間軸照規格");
// C9
{ const { f, cv } = make(); f.draw(1000); f.destroy(); ok(cv.width === 0 && cv.height === 0, "C9 收尾後畫布寬高歸 0"); }
{ const cv = fakeCanvas(); const f = new SakuraCanvas(cv, geo(0), 2); let threw = false; try { f.draw(1500); } catch { threw = true; } ok(!threw && f.lastCount === 0, "C9 花瓣表還沒載好也能畫"); }

// C10
{
  const loop = () => { let next: ((n: number) => void) | null = null, id = 0, pending = 0; return { raf: (f: (n: number) => void) => { next = f; pending++; return ++id; }, caf: () => { next = null; pending = 0; }, tick(n: number) { const f = next; next = null; pending = 0; f?.(n); }, get live() { return !!next; }, get pending() { return pending; } }; };
  // 元素沒有 animate 方法：程式一叫就會丟例外
  const el = () => ({ style: {} as Record<string, string> });
  const mk = (rm = false) => { const l = loop(), cv = fakeCanvas(), e = { dim: el(), tile: el(), tileIn: el(), title: el(), art: el(), back: el(), name: el(), stage: el() }; const r = runSakura({ cv, ...e } as never, geo(0), { dpr: 2, rm, zeroAt: 0, stageShadow: "S", raf: l.raf, caf: l.caf }); r.setSheet(sheet); return { l, cv, e, r }; };
  const a = mk(); ok(a.l.pending === 1 && a.cv.width > 0, "C10 開始後只排一格");
  let threw = false; try { for (let t = 16; t < 3400; t += 16) { a.l.tick(t); if (a.l.pending > 1) throw new Error("多排"); } } catch { threw = true; }
  ok(!threw, "C10 整段播放沒有 element.animate、一次只排一格");
  a.l.tick(1120 + 110); // 已過
  a.l.tick(3400); ok(!a.l.live && a.cv.width === 0 && a.cv.height === 0, "C10 播完：迴圈停、畫布歸 0");
  ok(a.e.tile.style.opacity === "0.000" && a.e.title.style.opacity === "0.000" && a.e.dim.style.opacity !== "0.000", "C10 播完：牌和大字透明、暗幕留著");
  const b = mk(); b.l.tick(SAKURA_TL.hit + 100); ok(!!b.e.stage.style.transform && b.e.stage.style.boxShadow === "S", "C10 推畫面時有位移和蓋邊陰影");
  b.r.stop(); b.r.stop(); ok(!b.l.live && b.cv.width === 0 && b.e.stage.style.transform === "" && b.e.stage.style.boxShadow === "", "C10 跳過（stop 兩次）：迴圈停、畫布歸 0、舞台復位");
  b.r.setSheet(sheet); ok(b.cv.width === 0, "C10 stop 之後才載好花瓣表：不會再畫");
  const c = mk(); c.l.tick(1000); c.r.stop(); c.l.tick(1016); ok(c.cv.width === 0 && !c.l.live, "C10 卸載後晚到的一格不會復活");
  const d = mk(true); for (let t = 16; t < 700; t += 16) d.l.tick(t); ok(!d.l.live && !d.e.stage.style.transform && !d.e.art.style.transform && d.e.dim.style.opacity === "0.580" && d.cv.width > 0, "C10 減少動態：淡入完就停、不推不動、暗幕 0.58、畫布留到卸載");
  d.r.stop(); ok(d.cv.width === 0, "C10 減少動態：卸載後畫布歸 0");
  // C10b
  baked.length = 0; const e = mk(); const glow = baked[0]; e.l.tick(1000); const glowW = glow.width; const n0 = e.cv.ctx.calls.length; e.r.stop(); e.r.setSheet(sheet); e.l.tick(1016);
  ok(glowW > 0 && glow.width === 0 && baked.length === 1, "C10b 跳過：光暈畫布也歸 0，沒有多建");
  ok(e.cv.ctx.calls.length === n0, "C10b stop 之後不再畫");
  baked.length = 0; const f = mk(); const g2 = baked[0]; f.l.tick(3400); ok(g2.width === 0, "C10b 播完：光暈畫布歸 0");
}
// C11
{ const b4 = sakuraTilePose(SAKURA_TL.tile - 1), mid = sakuraTilePose(SAKURA_TL.tile + 300), end = sakuraTilePose(SAKURA_TL.tile + 420);
  ok(b4.opacity === 0 && mid.opacity === 1 && /scale\(1\.[0-9]/.test(mid.transform) && end.transform === "none" && end.opacity === 1, `C11 牌：主擊前看不到、登場過衝、定位（${mid.transform}）`);
  const t0 = sakuraTitlePose(SAKURA_TL.zimo - 1), t1 = sakuraTitlePose(SAKURA_TL.zimo + 360);
  ok(t0.art.opacity === 0 && t1.art.opacity === 1 && t1.art.transform === "none" && t0.name === 0 && sakuraTitlePose(SAKURA_TL.name + 260).name === 1, "C11 大字、名字照時間軸出現");
  const s0 = sakuraStillPose(0), s1 = sakuraStillPose(620); ok(s0.base === 0 && s0.main === 0 && s1.base === 1 && s1.main === 1 && s1.name === 1, "C11 減少動態 0.62 秒內淡入完"); }

// C12
{ const html = (driven: boolean) => renderToStaticMarkup(createElement(ZimoTitle, { fx: "sakura", name: "測試", t: 1880, n: 2120, mobile: true, driven, src: "x.webp" }));
  const on = html(true), off = html(false);
  ok(!on.includes("zz-petal") && !on.includes("zz-hl") && !on.includes("zz-band") && on.includes("driven"), "C12 櫻花大字：沒有小花瓣、掃光");
  ok((off.match(/zz-petal/g) ?? []).length === 10 && off.includes("zz-hl"), "C12 反向：不是畫布版時才有 10 個小花瓣（測試真的抓得到）");
  const zf = readFileSync(new URL("../components/mahjong/zimoFx.css", import.meta.url), "utf8"), zt = readFileSync(new URL("../components/mahjong/zimoTitle.css", import.meta.url), "utf8");
  const off2 = (css: string, sel: string) => css.split("\n").some((l) => l.includes(sel) && /animation:\s*none/.test(l));
  ok(off2(zf, ".zfw.own.zf-sakura .zf-dim") && off2(zf, ".zfw.own.zf-sakura .zf-tile-in") && off2(zf, ".zfw.own.rm.zf-sakura .zf-tile"), "C12 樣式表關掉暗幕、牌的動畫（含減少動態）");
  ok(off2(zt, ".zz.driven .zz-art") && off2(zt, ".zz.driven .zz-back") && off2(zt, ".zz.driven .zz-name"), "C12 樣式表關掉大字、暗底、名字的動畫"); }

// C13
{ const manifest = JSON.parse(readFileSync(new URL("../scripts/immutable-assets.json", import.meta.url), "utf8")) as Record<string, string>;
  for (const f of ["branch-growth", "bud-opening", "bud", "halo", "impact-petal-burst", "petal-clusters"]) {
    const url = `/mahjong-fx/zimo/sakura/sakura-${f}.webp`;
    ok(existsSync(new URL(`../public${url}`, import.meta.url)) && !!manifest[url], `C13 舊頁面還要用的 ${url} 留著、在雜湊清單裡`);
  } }

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
