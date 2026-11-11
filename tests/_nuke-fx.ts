// 核彈畫布引擎（lib/mahjong/fx/nukeFx.ts；專屬 jeff 門清一摸三，老闆 2026-11-10）：用假的 canvas 記下每一次畫圖
//   N1 手機同時粒子（碎片＋煙團＋金屑）72；畫布倍率手機 ≤1.5、電腦 ≤2
//   N2 畫面只由時間決定：同一個 ms 畫兩次，畫圖指令完全一樣
//   N3 人物站在落點的另一邊（不蓋住爆心）、腳貼畫面底、不超過畫面六成高
//   N4 播放中不用 filter、shadowBlur
//   N5 全畫面白閃只在命中前 30ms 到命中後 260ms 之間
//   N6 runNuke：全程一個 rAF、沒有 element.animate；開播前先試畫一格（第一次解碼不落在播放中）、時間零點在試畫之後；
//      播完、跳過都放掉畫布、舞台復位，stop 可重複呼叫
//   N7 減少動態：定格在爆完的畫面，不震不閃；卸載後畫布歸 0
//   N8 暗幕留到結束；牌 2.40、大字 2.78、名字 3.02 才出現；最後 0.4 秒才淡出
//   N9 手機素材實際量：下載 ≤1 MB、解碼 ≤14 MB；每張圖都登記在長期快取雜湊清單（音效出檔後也必須登記）
//   N10 核彈是「專屬特效」：只有 EXCLUSIVE_FX 指定的那個帳號能用（不是老闆），後台不能開通，走單一畫布路線，名稱「核彈」
//   N11 核彈 4.60 秒、主擊 1.80；其他特效的時間軸沒動
//   N12 蕈狀雲的柱頂夾在畫面內（原本固定 u*1.25 會整朵衝出畫面外，老闆 2026-11-10 改成夾住）
//   N13 常數和素材一致：NUKE_KIM_AR 就是人物圖的實際長寬比
//   N14 這一款不出「自摸的那張牌」和名字；「自摸」大字借如來神掌那張素材（長寬比也跟著它）
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ZFX_TL } from "../components/mahjong/ZimoFx";
import { ZIMO_TITLE_AR, zimoTitleArt } from "../components/mahjong/ZimoTitle";
import { RULAI_META } from "../lib/mahjong/fx/rulaiMeta";
import { NUKE_ART, NUKE_KIM_AR, NUKE_LIMIT, NUKE_MISSILE_AR, NUKE_STILL_MS, NUKE_TL, NukeCanvas, nukeCam, nukeDim, nukeShake, nukeTilePose, nukeTitlePose, runNuke } from "../lib/mahjong/fx/nukeFx";
import { fxShowsName, fxShowsTile, isCanvasFx, isZimoFxNew, ZIMO_FX_NEW } from "../lib/mahjong/winShow";
import { canUseExclusiveFx, EXCLUSIVE_FX, isExclusiveFx, isOwner, isSelectableZimoFx, isZimoFx } from "../lib/mahjong/zimoFx/rules";
import { fxName, ZIMO_FX_LIST } from "../lib/mahjong/zimoFxClient";

const results: string[] = [];
const ok = (c: boolean, msg: string) => results.push(`${c ? "✅" : "❌"} ${msg}`);

type Call = [string, ...unknown[]];
function fakeCtx() {
  const calls: Call[] = [], props: Record<string, unknown> = {};
  const drawn = new Set<unknown>();
  const imgs: { img: unknown; x: number; y: number; w: number; h: number }[] = [];
  const rec = (name: string) => (...a: unknown[]) => {
    if (name === "drawImage") { drawn.add(a[0]); imgs.push({ img: a[0], x: a[1] as number, y: a[2] as number, w: a[3] as number, h: a[4] as number }); }
    calls.push([name, ...a.map((v) => (typeof v === "object" ? "obj" : v))]);
  };
  const base: Record<string, unknown> = { calls, props, drawn, imgs, createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : rec(k)),
    set: (t, k: string, v) => { props[k] = v; calls.push([`set:${k}`, typeof v === "object" ? "obj" : v]); return true; },
  }) as unknown as CanvasRenderingContext2D & { calls: Call[]; props: Record<string, unknown>; drawn: Set<unknown>; imgs: { img: unknown; x: number; y: number; w: number; h: number }[] };
}
function fakeCanvas() { const ctx = fakeCtx(); return { width: 0, height: 0, style: {}, getContext: () => ctx, ctx } as unknown as HTMLCanvasElement & { ctx: ReturnType<typeof fakeCtx> }; }
const baked: (HTMLCanvasElement & { ctx: ReturnType<typeof fakeCtx> })[] = [];
(globalThis as unknown as { document: unknown }).document = { createElement: () => { const c = fakeCanvas(); baked.push(c); return c; } };
const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, complete: true }) as HTMLImageElement;
const art = () => ({ kim: img(1024, Math.round(1024 / NUKE_KIM_AR)), missile: img(1024, Math.round(1024 / NUKE_MISSILE_AR)) });
/** 手機 844×390、電腦 1440×900（同如來神掌的驗收尺寸）；px/py＝胡牌者的位置＝爆心 */
const geo = (rel: number, mobile = true) => ({ W: mobile ? 844 : 1440, H: mobile ? 390 : 900, u: mobile ? 390 : 892.8, px: mobile ? 422 : 720, py: mobile ? 273 : 630, rel, mobile });
const make = (rel = 0, mobile = true, dpr = 3, over: Partial<ReturnType<typeof geo>> = {}) => {
  const g = { ...geo(rel, mobile), ...over }, cv = fakeCanvas(), kim = art(), b0 = baked.length;
  const f = new NukeCanvas(cv, g, kim, dpr);
  return { cv, g, f, x: cv.ctx, kim: kim.kim, missile: kim.missile, smokeTex: baked[b0], fireTex: baked[b0 + 1] };
};
const T = NUKE_TL;
const NUKE_DIR = new URL("../public/mahjong-fx/zimo/nuke/", import.meta.url);

// N1
{
  const L = NUKE_LIMIT.mobile;
  ok(L.debris + L.smoke + L.sparks === 72, `N1 手機同時粒子 ${L.debris + L.smoke + L.sparks}（碎片 ${L.debris}＋煙 ${L.smoke}＋金屑 ${L.sparks}）`);
  baked.length = 0;
  const m = make(0, true, 3), d = make(0, false, 3);
  ok(baked.length === 4 && baked[0].width === NUKE_LIMIT.mobile.tex && baked[2].width === NUKE_LIMIT.desktop.tex,
    `N1 每個畫布只烘兩張紋理（手機 ${NUKE_LIMIT.mobile.tex}px、電腦 ${NUKE_LIMIT.desktop.tex}px）`);
  ok(m.cv.width === Math.round(844 * 1.5), "N1 手機倍率上限 1.5");
  ok(d.cv.width === 1440 * 2, "N1 電腦倍率上限 2");
  let max = 0;
  for (let ms = 0; ms < T.total; ms += 40) { m.f.draw(ms); max = Math.max(max, m.f.lastCount); }
  ok(max > 0 && max <= 120, `N1 每一格的零件數都在上限內（最多 ${max}）`);
}
// N2
{ const { f, x } = make(); for (const ms of [600, 1850, 2500, 3600]) { x.calls.length = 0; f.draw(ms); const a = JSON.stringify(x.calls); x.calls.length = 0; f.draw(ms); ok(a === JSON.stringify(x.calls), `N2 ${ms}ms 畫兩次完全一樣`); } }
// N3
{
  const rect = (px: number, mobile = true) => {
    const { cv, f, kim } = make(0, mobile, 2, { px });
    f.draw(T.hit + 400);
    return cv.ctx.imgs.find((d) => d.img === kim) ?? null;
  };
  const left = rect(200), right = rect(700), def = rect(422);
  const clear = (r: { x: number; w: number } | null, px: number) => !!r && (px < r.x || px > r.x + r.w);
  ok(clear(left, 200) && clear(right, 700) && clear(def, 422), "N3 爆心不在人物身上：落點偏左人站右、偏右人站左");
  ok(!!left && !!right && left.x > right.x, "N3 落點左右互換時人物真的換邊");
  const H = geo(0).H;
  ok(!!def && Math.abs(def.y + def.h - H * 0.99) < 2, `N3 腳貼畫面底（底邊 ${def ? (def.y + def.h).toFixed(0) : "?"}／${H}）`);
  ok(!!def && def.h <= H * 0.6, `N3 人物高度 ${def ? def.h.toFixed(0) : "?"} ≤ 畫面六成（${(H * 0.6).toFixed(0)}）`);
  const none = (() => { const { cv, f, kim } = make(); f.draw(T.enter - 1); return !cv.ctx.imgs.some((d) => d.img === kim); })();
  ok(none, "N3 登場時間（0.26 秒）之前不畫人物");
}
// N4
{ const { f, x } = make(); x.calls.length = 0; for (const k of Object.keys(x.props)) delete x.props[k]; for (const ms of [100, 600, 1200, 1790, 1810, 1900, 2400, 2800, 3600, 4400]) f.draw(ms); ok(!("filter" in x.props) && !("shadowBlur" in x.props), "N4 播放中不用 filter、shadowBlur"); }
// N5
{
  const flashAt = (ms: number) => { const { f, x } = make(); f.draw(ms); return x.calls.some((c) => c[0] === "set:fillStyle" && typeof c[1] === "string" && c[1].startsWith("rgba(255,250,235")); };
  ok(!flashAt(T.hit - 31) && flashAt(T.hit - 20) && flashAt(T.hit) && flashAt(T.hit + 200) && !flashAt(T.hit + 260), "N5 全畫面白閃只在命中前 30ms 到命中後 260ms");
}
// N6、N7
{
  const loop = () => { let next: ((n: number) => void) | null = null, id = 0, pending = 0; return { raf: (f: (n: number) => void) => { next = f; pending++; return ++id; }, caf: () => { next = null; pending = 0; }, tick(n: number) { const f = next; next = null; pending = 0; f?.(n); }, get live() { return !!next; }, get pending() { return pending; } }; };
  const el = () => ({ style: {} as Record<string, string> }); // 沒有 animate 方法：程式一叫就丟例外
  const mk = (rm = false) => { baked.length = 0; const l = loop(), cv = fakeCanvas(), e = { dim: el(), tile: el(), tileIn: el(), title: el(), art: el(), back: el(), name: el(), stage: el() }; const r = runNuke({ cv, ...e } as never, geo(0), art(), { dpr: 2, rm, zeroAt: () => 0, stageShadow: "S", raf: l.raf, caf: l.caf }); return { l, cv, e, r }; };
  const a = mk();
  ok(a.l.pending === 1 && a.cv.width > 0, "N6 開始後只排一格");
  let threw = false;
  try { for (let t = 16; t < T.total; t += 16) { a.l.tick(t); if (a.l.pending > 1) throw new Error("多排"); } } catch { threw = true; }
  ok(!threw, "N6 整段播放沒有 element.animate、一次只排一格");
  a.l.tick(T.total);
  ok(!a.l.live && a.cv.width === 0 && a.cv.height === 0 && baked.slice(-2).every((c) => c.width === 0), "N6 播完：迴圈停、畫布和烘好的紋理都歸 0");
  ok(a.e.tile.style.opacity === "0.000" && a.e.title.style.opacity === "0.000" && a.e.dim.style.opacity === "0.660", "N6 播完：牌和大字透明、暗幕留著");
  ok(a.e.stage.style.transform === "" && a.e.stage.style.transformOrigin === "", "N6 播完：舞台復位");
  {
    const used = art(), cv = fakeCanvas(), l = loop(), calls = cv.ctx.calls;
    let zero = -1;
    runNuke({ cv, dim: el(), tile: el(), tileIn: el(), title: el(), art: el(), back: el(), name: el(), stage: el() } as never, geo(0), used, { dpr: 2, rm: false, zeroAt: () => (zero = calls.length, 0), stageShadow: "S", raf: l.raf, caf: l.caf });
    const firstDraw = calls.findIndex((c) => c[0] === "drawImage");
    ok(firstDraw >= 0 && firstDraw < zero && calls[zero - 1][0] === "clearRect", "N6 開播前先試畫一格、畫面清乾淨才對時間零點");
    ok(cv.ctx.drawn.has(used.kim), "N6 試畫就用到人物素材：第一次解碼不會落在播放中");
  }
  const b = mk();
  b.l.tick(T.hit + 40);
  ok(!!b.e.stage.style.transform && b.e.stage.style.boxShadow === "S", "N6 主擊時牌桌有震、有蓋邊陰影");
  const n0 = b.cv.ctx.calls.length;
  b.r.stop(); b.r.stop();
  ok(!b.l.live && b.cv.width === 0 && b.e.stage.style.transform === "" && b.e.stage.style.boxShadow === "" && b.e.stage.style.transformOrigin === "", "N6 跳過（stop 兩次）：迴圈停、畫布歸 0、舞台復位");
  b.l.tick(T.hit + 60);
  ok(b.cv.ctx.calls.length === n0, "N6 stop 之後晚到的一格不再畫");
  const d = mk(true);
  for (let t = 16; t < 700; t += 16) d.l.tick(t);
  ok(!d.l.live && !d.e.stage.style.transform && !d.e.art.style.transform && d.e.dim.style.opacity === "0.660" && d.cv.width > 0, "N7 減少動態：淡入完就停、不推不動、畫布留到卸載");
  ok(nukeShake(NUKE_STILL_MS, true)[0] === 0 && NUKE_STILL_MS > T.hit + 260, "N7 定格的那一刻已經沒有震動、也沒有白閃");
  d.r.stop();
  ok(d.cv.width === 0, "N7 減少動態：卸載後畫布歸 0");
}
// N8
ok(nukeDim(0) === 0 && Math.abs(nukeDim(T.total) - 0.66) < 1e-9, "N8 暗幕 0 開始、到結束都留著");
ok(nukeTilePose(T.tile - 1).opacity === 0 && nukeTilePose(T.tile + 420).opacity === 1 && nukeTilePose(T.tile + 420).transform === "none", "N8 牌 2.40 秒才出現、定位後沒有 transform");
{
  const p0 = nukeTitlePose(T.zimo - 1), p1 = nukeTitlePose(T.zimo + 120), p2 = nukeTitlePose(T.zimo + 340);
  ok(p0.art.opacity === 0 && /translateY\(/.test(p1.art.transform) && p2.art.opacity === 1 && p2.art.transform === "none", `N8 大字 2.78 秒被爆風推上來（${p1.art.transform}）`);
  ok(nukeTitlePose(T.name - 1).name === 0 && nukeTitlePose(T.name + 260).name === 1, "N8 名字 3.02 秒");
}
ok(nukeTilePose(T.total - 401).opacity === 1 && nukeCam(T.hit + 460) === 1 && nukeCam(T.hit - 1) === 1, "N8 鏡頭只在主擊後頂一下（主擊前、0.46 秒後都是 1）");
{ const { f, x } = make(); x.calls.length = 0; f.draw(T.total); ok(f.lastCount === 0 && x.calls.every((c) => c[0] !== "fill" && c[0] !== "drawImage"), "N8 最後一格（4.60 秒）完全淡出、什麼都不畫"); }
// N12
{
  const stemTop = (over: Partial<ReturnType<typeof geo>> = {}) => {
    const { cv, f, g, smokeTex } = make(0, true, 2, over);
    f.draw(3600);
    // 煙團畫在 translate(cx, cy) 之後的區域座標（中心是 0,0），所以每一球的位置＝它前面那個 translate。
    // 焦痕、裂紋、衝擊環也會 translate，因此要照呼叫順序對到「這一次 drawImage 畫的是不是煙」。
    const tops: number[] = [];
    let ty = NaN, k = 0;
    for (const c of cv.ctx.calls) {
      if (c[0] === "translate") ty = c[2] as number;
      else if (c[0] === "drawImage") { if (cv.ctx.imgs[k]?.img === smokeTex) tops.push(ty); k++; }
    }
    return { n: tops.length, y: tops.length ? Math.min(...tops) : NaN, py: g.py };
  };
  const mid = stemTop(), high = stemTop({ py: 160 });
  ok(mid.n >= 6 && mid.y >= 0 && mid.y < mid.py, `N12 蕈狀雲是 ${mid.n} 球烘好的煙堆的，最高那球還在畫面內（y=${mid.y.toFixed(0)}，爆心 y=${mid.py}）`);
  ok(high.n >= 6 && high.y > -geo(0).u * 0.34, `N12 爆心很靠上時最高那球也不會衝太高（y=${high.y.toFixed(0)}）`);
}
// N9
{
  const manifest = JSON.parse(readFileSync(new URL("../scripts/immutable-assets.json", import.meta.url), "utf8")) as Record<string, string>;
  const mobile = NUKE_ART.map((n) => `nuke-${n}-m.webp`); // 大字借神掌那張（早就登記過），這裡只算這一款自己的素材
  let bytes = 0, px = 0;
  for (const f of mobile) { const p = new URL(f, NUKE_DIR); bytes += statSync(p).size; const m = await sharp(fileURLToPath(p)).metadata(); px += (m.width ?? 0) * (m.height ?? 0); }
  const bakedMb = NUKE_LIMIT.mobile.tex * NUKE_LIMIT.mobile.tex * 4 * 2 / 1048576; // 開播前烘的煙、火兩張
  const mb = px * 4 / 1048576 + bakedMb;
  ok(mb <= 14, `N9 手機解碼 ${mb.toFixed(2)} MB ≤ 14 MB（含烘的 ${bakedMb.toFixed(2)} MB；爆炸整段是程式畫的，沒有素材）`);
  ok(bytes <= 1_000_000, `N9 手機下載 ${(bytes / 1024).toFixed(0)} KB ≤ 1 MB`);
  const files = NUKE_ART.flatMap((n) => [`nuke-${n}-d.webp`, `nuke-${n}-m.webp`]);
  ok(files.every((f) => !!manifest[`/mahjong-fx/zimo/nuke/${f}`]), `N9 ${files.length} 張圖都在長期快取雜湊清單`);
  // 音效（zimo-nuke-pc／mobile.mp3）還沒出檔；一出檔就必須跟著登記，否則這一條會紅
  const sfx = ["/mahjong-fx/s/zimo-nuke-pc.mp3", "/mahjong-fx/s/zimo-nuke-mobile.mp3"];
  const onDisk = sfx.filter((u) => existsSync(new URL(`../public${u}`, import.meta.url)));
  ok(onDisk.every((u) => !!manifest[u]), onDisk.length ? `N9 音效 ${onDisk.length} 檔都已登記` : "N9 音效還沒出檔（載不到就靜音照播）；出檔後要跑 asset-hashes --write");
}
// N10
ok(!ZIMO_FX_LIST.some((f) => (f.code as string) === "nuke") && !isZimoFx("nuke"), "N10 核彈不在後台開通清單（開通全部不含）");
ok(isExclusiveFx("nuke") && isSelectableZimoFx("nuke"), "N10 核彈是專屬特效、被指定的帳號選得到");
{
  const owner = EXCLUSIVE_FX.nuke ?? "";
  ok(!!owner && !isOwner(owner), `N10 核彈專屬的是別的帳號、不是老闆（…${owner.slice(-4)}）`);
  ok(canUseExclusiveFx(owner, "nuke") && !canUseExclusiveFx("別人", "nuke") && !canUseExclusiveFx(null, "nuke"), "N10 只有那個帳號能用核彈");
}
ok(isZimoFxNew("nuke") && isCanvasFx("nuke") && fxName("nuke") === "核彈", "N10 走新特效、單一畫布路線，名稱核彈");
// N11
ok(ZFX_TL.nuke.total === 4600 && ZFX_TL.nuke.hit === 1800, "N11 核彈 4.60 秒、主擊 1.80");
ok(ZFX_TL.nuke.tile === 2400 && ZFX_TL.nuke.zimo === 2780 && ZFX_TL.nuke.name === 3020, "N11 核彈的牌、大字、名字時間和引擎一致");
ok(ZFX_TL.thunder.total === 3220 && ZFX_TL.frost.total === 2900 && ZFX_TL.sakura.total === 3400 && ZFX_TL.rulai.total === 4200, "N11 其他特效長度沒動");
// N13
{
  const m = await sharp(fileURLToPath(new URL("nuke-kim-d.webp", NUKE_DIR))).metadata();
  const kim = (m.width ?? 0) / (m.height ?? 1);
  ok(Math.abs(kim - NUKE_KIM_AR) < 0.002, `N13 NUKE_KIM_AR ${NUKE_KIM_AR} 就是人物圖的長寬比（${kim.toFixed(4)}）`);
  ok(!existsSync(new URL("nuke-title.webp", NUKE_DIR)), "N13 這一款沒有自己的大字素材（借神掌那張，不留沒人用的檔）");
  const mm = await sharp(fileURLToPath(new URL("nuke-missile-d.webp", NUKE_DIR))).metadata();
  const mAR = (mm.width ?? 0) / (mm.height ?? 1);
  ok(Math.abs(mAR - NUKE_MISSILE_AR) < 0.002, `N13 NUKE_MISSILE_AR ${NUKE_MISSILE_AR} 就是飛彈圖的長寬比（${mAR.toFixed(4)}）`);
  ok(mAR > 1.6, `N13 飛彈素材是轉正的（橫躺、彈頭朝右，長寬比 ${mAR.toFixed(2)}）`);
}
// N15 飛彈：飛行中畫素材、命中後就不畫；素材載不到也不會整個不見（退回向量彈體）
{
  const at = (ms: number) => { const { cv, f, missile } = make(0, true, 2); f.draw(ms); return cv.ctx.imgs.filter((d) => d.img === missile).length; };
  ok(at(T.launch - 1) === 0 && at((T.launch + T.hit) / 2) === 1 && at(T.hit + 10) === 0, "N15 飛彈只在發射到命中之間畫，一格一張");
  const cv = fakeCanvas(), g = geo(0);
  const f = new NukeCanvas(cv, g, { kim: img(1024, 1076) }, 2);  // 故意沒有飛彈素材
  f.draw((T.launch + T.hit) / 2);
  ok(cv.ctx.calls.some((c) => c[0] === "quadraticCurveTo"), "N15 飛彈素材載不到：退回向量彈體，不是空白");
}
// N14
{
  ok(!fxShowsTile("nuke") && !fxShowsName("nuke"), "N14 核彈不出自摸的那張牌、也不出名字");
  const others = ZIMO_FX_NEW.filter((f) => f !== "nuke");
  ok(others.every((f) => fxShowsTile(f) && fxShowsName(f)), `N14 其他 ${others.length} 種照舊出牌和名字`);
  const title = zimoTitleArt("nuke");
  ok(title === "/mahjong-fx/zimo/rulai/rulai-title.webp" && title === zimoTitleArt("rulai"), `N14 核彈的大字就是神掌那張（${title}）`);
  ok(ZIMO_TITLE_AR.nuke === RULAI_META.titleAR, `N14 大字長寬比跟著神掌（${ZIMO_TITLE_AR.nuke}）`);
}

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
