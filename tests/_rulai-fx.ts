// 如來神掌畫布引擎（lib/mahjong/fx/rulaiFx.ts；小宜〈如來神掌 v3 金光裂紋〉；老闆 2026-11-05）：用假的 canvas 記下每一次畫圖
//   R1 手機粒子上限 110；倍率手機 ≤1.5、電腦 ≤2
//   R2 畫面只由時間決定：同一個 ms 畫兩次，畫圖指令完全一樣
//   R3 手的倍率：抬高變大、砸下變小（1.75 → 1.14 → 2.45 → 1.03 → 1 → 1.7），砸下只有 120ms
//   R4 播放中不用 filter、shadowBlur
//   R5 全畫面閃光只在主擊後 90ms 內
//   R6 runRulai：全程一個 rAF、沒有 element.animate；播完、跳過都放掉畫布（含烘的小圖）、圖片參照，舞台復位，stop 可重複呼叫
//   R7 減少動態：不動、不推、不閃；卸載後畫布歸 0
//   R8 暗幕留到結束；牌 2.30、大字 2.62、名字 2.86 才出現；大字 3.84 秒起淡出
//   R9 手機素材實際量：解碼（含開播時烘的小圖）≤14 MB、下載 ≤1 MB；每張都登記在長期快取雜湊清單
//   R10 如來神掌不在「開通全部」清單、走單一畫布路線
//   R11 風暴大字從出現到結束約 1.3 秒，其他特效的時間軸沒動；神掌時間軸照規格
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ZFX_TL } from "../components/mahjong/ZimoFx";
import { RULAI_ART, RULAI_LIMIT, RULAI_TL, RulaiCanvas, rulaiCam, rulaiDim, rulaiFadeOut, rulaiHandScale, rulaiTilePose, rulaiTitlePose, runRulai, type RulaiArt } from "../lib/mahjong/fx/rulaiFx";
import { isCanvasFx, isZimoFxNew } from "../lib/mahjong/winShow";
import { fxName, ZIMO_FX_LIST } from "../lib/mahjong/zimoFxClient";

const results: string[] = [];
const ok = (c: boolean, msg: string) => results.push(`${c ? "✅" : "❌"} ${msg}`);

type Call = [string, ...unknown[]];
function fakeCtx() {
  const calls: Call[] = [], props: Record<string, unknown> = {};
  const rec = (name: string) => (...a: unknown[]) => { calls.push([name, ...a.map((v) => (typeof v === "object" ? "obj" : v))]); };
  const base: Record<string, unknown> = { calls, props, createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : rec(k)),
    set: (t, k: string, v) => { props[k] = v; calls.push([`set:${k}`, typeof v === "object" ? "obj" : v]); return true; },
  }) as unknown as CanvasRenderingContext2D & { calls: Call[]; props: Record<string, unknown> };
}
function fakeCanvas() { const ctx = fakeCtx(); return { width: 0, height: 0, style: {}, getContext: () => ctx, ctx } as unknown as HTMLCanvasElement & { ctx: ReturnType<typeof fakeCtx> }; }
const baked: HTMLCanvasElement[] = [];
(globalThis as unknown as { document: unknown }).document = { createElement: () => { const c = fakeCanvas(); baked.push(c); return c; } };
const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, complete: true }) as HTMLImageElement;
const art = () => Object.fromEntries(RULAI_ART.map((n) => [n, img(576, 384)])) as Record<RulaiArt, HTMLImageElement>;
const geo = (rel: number, mobile = true) => ({ W: mobile ? 844 : 1440, H: mobile ? 390 : 900, u: mobile ? 390 : 892.8, px: mobile ? 422 : 720, py: mobile ? 273 : 630, rel, mobile });
const make = (rel = 0, mobile = true, dpr = 3) => { const cv = fakeCanvas(); return { cv, f: new RulaiCanvas(cv, geo(rel, mobile), art(), dpr), x: cv.ctx }; };
const T = RULAI_TL;

// R1
{ const L = RULAI_LIMIT.mobile; ok(L.gold + L.fly + L.rubble + L.dust + L.jets === 110, "R1 手機同時粒子上限 110"); const m = make(0, true, 3), d = make(0, false, 3); ok(m.cv.width === Math.round(844 * 1.5), "R1 手機倍率上限 1.5"); ok(d.cv.width === 1440 * 2, "R1 電腦倍率上限 2"); }
{ const { f } = make(); let max = 0; for (let ms = 0; ms < T.total; ms += 40) { f.draw(ms); max = Math.max(max, f.lastCount); } ok(max > 0 && max <= 110, `R1 每一格的粒子都在上限內（最多 ${max}）`); }
// R2
{ const { f, x } = make(); for (const ms of [800, 1600, 2500]) { x.calls.length = 0; f.draw(ms); const a = JSON.stringify(x.calls); x.calls.length = 0; f.draw(ms); ok(a === JSON.stringify(x.calls), `R2 ${ms}ms 畫兩次完全一樣`); } }
// R3
ok(rulaiHandScale(0) === 1.75 && Math.abs(rulaiHandScale(T.lift) - 1.14) < 1e-9 && Math.abs(rulaiHandScale(T.slam - 0.001) - 2.45) < 1e-3, "R3 蓄力：1.75 → 1.14 → 2.45（抬高變大）");
ok(rulaiHandScale(T.hit) === 1.03 && rulaiHandScale(T.reveal) < 1.0001 && Math.abs(rulaiHandScale(T.reveal + 430) - 1.7) < 1e-9, "R3 砸中 1.03、定格後 1、抬手 1.7");
ok(T.hit - T.slam === 120, "R3 砸下只有 120ms");
ok(rulaiCam(0) === 1 && rulaiCam(T.total) >= 1 - 1e-9, "R3 鏡頭不會小於 1（不露出牌桌外）");
// R4
{ const { f, x } = make(); x.calls.length = 0; for (const k of Object.keys(x.props)) delete x.props[k]; for (const ms of [100, 600, 1200, 1450, 1520, 1800, 2200, 2700, 3500]) f.draw(ms); ok(!("filter" in x.props) && !("shadowBlur" in x.props), "R4 播放中不用 filter、shadowBlur"); }
// R5
{ const flashAt = (ms: number) => { const { f, x } = make(); f.draw(ms); return x.calls.some((c) => c[0] === "fillRect" && c[3] === 844); }; ok(!flashAt(T.hit - 1) && flashAt(T.hit) && flashAt(T.hit + 80) && !flashAt(T.hit + 91), "R5 全畫面閃光只在主擊後 90ms 內"); }
// R6、R7
{
  const loop = () => { let next: ((n: number) => void) | null = null, id = 0, pending = 0; return { raf: (f: (n: number) => void) => { next = f; pending++; return ++id; }, caf: () => { next = null; pending = 0; }, tick(n: number) { const f = next; next = null; pending = 0; f?.(n); }, get live() { return !!next; }, get pending() { return pending; } }; };
  const el = () => ({ style: {} as Record<string, string> }); // 沒有 animate 方法：程式一叫就丟例外
  const mk = (rm = false) => { baked.length = 0; const l = loop(), cv = fakeCanvas(), e = { dim: el(), tile: el(), tileIn: el(), title: el(), art: el(), back: el(), name: el(), stage: el() }; const r = runRulai({ cv, ...e } as never, geo(0), art(), { dpr: 2, rm, zeroAt: 0, stageShadow: "S", raf: l.raf, caf: l.caf }); return { l, cv, e, r, inner: [...baked] }; };
  const a = mk(); ok(a.l.pending === 1 && a.cv.width > 0 && a.inner.length === 5, "R6 開始後只排一格、烘 5 張小圖");
  let threw = false; try { for (let t = 16; t < T.total; t += 16) { a.l.tick(t); if (a.l.pending > 1) throw new Error("多排"); } } catch { threw = true; }
  ok(!threw, "R6 整段播放沒有 element.animate、一次只排一格");
  a.l.tick(T.total); ok(!a.l.live && a.cv.width === 0 && a.cv.height === 0 && a.inner.every((c) => c.width === 0), "R6 播完：迴圈停、畫布和小圖歸 0");
  ok(a.e.tile.style.opacity === "0.000" && a.e.title.style.opacity === "0.000" && a.e.dim.style.opacity === "0.800", "R6 播完：牌和大字透明、暗幕留著");
  ok(a.e.stage.style.transform === "" && a.e.stage.style.transformOrigin === "", "R6 播完：舞台復位");
  const b = mk(); b.l.tick(T.hit + 40); ok(!!b.e.stage.style.transform && b.e.stage.style.boxShadow === "S", "R6 主擊時牌桌有震、有蓋邊陰影");
  const n0 = b.cv.ctx.calls.length; b.r.stop(); b.r.stop(); ok(!b.l.live && b.cv.width === 0 && b.inner.every((c) => c.width === 0) && b.e.stage.style.transform === "" && b.e.stage.style.boxShadow === "", "R6 跳過（stop 兩次）：迴圈停、畫布歸 0、舞台復位");
  b.l.tick(T.hit + 60); ok(b.cv.ctx.calls.length === n0, "R6 stop 之後晚到的一格不再畫");
  const d = mk(true); for (let t = 16; t < 700; t += 16) d.l.tick(t); ok(!d.l.live && !d.e.stage.style.transform && !d.e.art.style.transform && d.e.dim.style.opacity === "0.800" && d.cv.width > 0, "R7 減少動態：淡入完就停、不推不動、畫布留到卸載");
  d.r.stop(); ok(d.cv.width === 0, "R7 減少動態：卸載後畫布歸 0");
}
// R8
ok(rulaiDim(0) === 0 && Math.abs(rulaiDim(T.total) - 0.8) < 1e-9, "R8 暗幕 0 開始、到結束都留著");
ok(rulaiTilePose(T.tile - 1).opacity === 0 && rulaiTilePose(T.tile + 200).opacity === 1 && rulaiTilePose(T.tile + 200).transform === "none", "R8 牌 2.30 秒才出現、定位後沒有 transform");
{ const a = rulaiTitlePose(T.zimo - 1), b = rulaiTitlePose(T.zimo + 60), c = rulaiTitlePose(T.zimo + 130); ok(a.art.opacity === 0 && /scale\(1\.[1-7]/.test(b.art.transform) && c.art.opacity === 1 && c.art.transform === "none", `R8 大字 2.62 秒蓋章（${b.art.transform}）`); ok(rulaiTitlePose(T.name - 1).name === 0 && rulaiTitlePose(T.name + 260).name === 1, "R8 名字 2.86 秒"); }
ok(rulaiFadeOut(T.total - 361) === 1 && rulaiFadeOut(T.total) === 0, "R8 牌和大字 3.84 秒起才淡出");
// R9
{ const manifest = JSON.parse(readFileSync(new URL("../scripts/immutable-assets.json", import.meta.url), "utf8")) as Record<string, string>;
  const files = [...RULAI_ART.map((n) => `rulai-${n}-m.webp`), "rulai-title.webp"];
  let bytes = 0, px = 0; for (const f of files) { const p = new URL(`../public/mahjong-fx/zimo/rulai/${f}`, import.meta.url); bytes += statSync(p).size; const m = await sharp(fileURLToPath(p)).metadata(); px += (m.width ?? 0) * (m.height ?? 0); }
  const bakedMb = (256 * 256 * 2 + 48 * 48 + 256 * 88 + (177 + 32) * (256 + 32)) * 4 / 1048576, mb = px * 4 / 1048576 + bakedMb, kb = bytes / 1024;
  ok(mb <= 14, `R9 手機解碼 ${mb.toFixed(2)} MB ≤ 14 MB（含開播時烘的 ${bakedMb.toFixed(2)} MB）`);
  ok(bytes <= 1_000_000, `R9 手機下載 ${kb.toFixed(0)} KB ≤ 1 MB（1,000,000 位元組）`);
  const all = [...files, ...RULAI_ART.map((n) => `rulai-${n}-d.webp`)].map((f) => `/mahjong-fx/zimo/rulai/${f}`).concat(["/mahjong-fx/s/zimo-rulai-pc.mp3", "/mahjong-fx/s/zimo-rulai-mobile.mp3"]);
  ok(all.every((u) => !!manifest[u]), `R9 ${all.length} 個素材、音效都在長期快取雜湊清單`); }
// R10
ok(!ZIMO_FX_LIST.some((f) => (f.code as string) === "rulai"), "R10 如來神掌不在開通清單（開通全部不含）");
ok(isZimoFxNew("rulai") && isCanvasFx("rulai") && isCanvasFx("sakura") && !isCanvasFx("storm") && fxName("rulai") === "如來神掌", "R10 走新特效、單一畫布路線，名稱如來神掌");
// R11
ok(ZFX_TL.storm.total - ZFX_TL.storm.zimo === 1300, `R11 風暴大字出現到結束 ${ZFX_TL.storm.total - ZFX_TL.storm.zimo}ms`);
ok(ZFX_TL.thunder.total === 3220 && ZFX_TL.frost.total === 2900 && ZFX_TL.blackhole.total === 2600 && ZFX_TL.sakura.total === 3400, "R11 其他特效長度沒動");
ok(ZFX_TL.rulai.total === 4200 && ZFX_TL.rulai.hit === 1500, "R11 神掌 4.20 秒、主擊 1.50");

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
