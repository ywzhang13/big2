// 如來神掌素材（小宜〈如來神掌 v3 金光裂紋〉第 4、6 節）：把老闆生成的 8 張原圖切好、壓好，再產生掌印、裂縫光暈。手機（-m）、電腦（-d）各一組，大字共用。
// 用法：node scripts/gen-rulai-assets.mjs <原圖資料夾>；之後跑 node scripts/asset-hashes.mjs --write。長期快取素材不能同檔名換內容，要換就改 VERSION。
// 原則：一律等比例縮放（只裁不拉）；黑底圖把亮度換成透明度，低於 FLOOR 的灰霧清成全透明；分格照實際內容切；寫出 lib/mahjong/fx/rulaiMeta.ts（比例、錨點、噴光點）。
import sharp from "sharp";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
if (!SRC) throw new Error("用法：node scripts/gen-rulai-assets.mjs <原圖資料夾>");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/zimo/rulai");
mkdirSync(OUT, { recursive: true });
const FLOOR = 14; // 黑底圖亮度低於這個（0～255）當純黑
const src = (n) => path.join(SRC, `${n}.png`);
const SIZE = {
  m: { hand: 896, cracks: 640, fis: [1024, 576], glow: [256, 144], jet: 192, ray: 384, rub: 128, dust: 160, q: { hand: 70, cracks: 44, fis: 53, jets: 54, rays: 49, rub: 56, dust: 44, print: 44, glow: 45 } },
  d: { hand: 1024, cracks: 1024, fis: [1536, 864], glow: [384, 216], jet: 256, ray: 512, rub: 192, dust: 256, q: { hand: 82, cracks: 72, fis: 72, jets: 72, rays: 72, rub: 78, dust: 66, print: 66, glow: 55 } },
};

async function raw(img) { const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; }
const toSharp = (r) => sharp(r.d, { raw: { width: r.w, height: r.h, channels: 4 } });
/** 黑底 → 透明：亮度換成透明度，顏色還原（lighter 疊加時和原圖同色） */
function blackToAlpha(r) {
  const o = Buffer.alloc(r.d.length);
  for (let i = 0; i < r.d.length; i += 4) {
    const m = Math.max(r.d[i], r.d[i + 1], r.d[i + 2]);
    if (m <= FLOOR) continue; // 留 0：全透明
    const a = Math.min(255, Math.round(((m - FLOOR) / (255 - FLOOR)) * 255)), k = 255 / m;
    o[i] = Math.min(255, r.d[i] * k); o[i + 1] = Math.min(255, r.d[i + 1] * k); o[i + 2] = Math.min(255, r.d[i + 2] * k); o[i + 3] = a;
  }
  return { d: o, w: r.w, h: r.h };
}
/** 非黑（或不透明）內容的外框 */
function bbox(r, x0 = 0, y0 = 0, x1 = r.w, y1 = r.h, test = (d, i) => d[i + 3] > 24) {
  let a = x1, b = y1, c = x0, e = y0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (test(r.d, (y * r.w + x) * 4)) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y; }
  return { x: a, y: b, w: c - a + 1, h: e - b + 1 };
}
const crop = (r, x, y, w, h) => { const o = Buffer.alloc(w * h * 4); for (let j = 0; j < h; j++) { const sy = y + j; if (sy < 0 || sy >= r.h) continue; const sx0 = Math.max(0, x), sx1 = Math.min(r.w, x + w); if (sx1 > sx0) r.d.copy(o, ((j * w) + (sx0 - x)) * 4, (sy * r.w + sx0) * 4, (sy * r.w + sx1) * 4); } return { d: o, w, h }; };
/** 四邊羽化：分格內容超出格子時不留硬切線 */
function feather(r, f = 0.1) { const o = Buffer.from(r.d), fx = r.w * f, fy = r.h * f; for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const k = Math.min(1, x / fx, (r.w - 1 - x) / fx, y / fy, (r.h - 1 - y) / fy); if (k < 1) o[(y * r.w + x) * 4 + 3] = Math.round(o[(y * r.w + x) * 4 + 3] * Math.max(0, k)); } return { d: o, w: r.w, h: r.h }; }
const webp = (img, q, file) => img.webp({ quality: q, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(path.join(OUT, file));
const fit = (r, w, h) => toSharp(r).resize(w, h, { fit: "fill", kernel: "lanczos3" }); // 呼叫前比例已算好，不會變形
const sheet = async (cells, cols, cw, ch) => { const rows = Math.ceil(cells.length / cols); return sharp({ create: { width: cols * cw, height: rows * ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(await Promise.all(cells.map(async (c, i) => ({ input: await c.png().toBuffer(), left: (i % cols) * cw, top: Math.floor(i / cols) * ch })))); };
/** 把一格內容等比例放進 cw×ch，置中（or 指定錨點），不拉伸 */
const inCell = async (r, b, cw, ch) => { const k = Math.min(cw / b.w, ch / b.h), w = Math.max(1, Math.round(b.w * k)), h = Math.max(1, Math.round(b.h * k)); return sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await toSharp(crop(r, b.x, b.y, b.w, b.h)).resize(w, h, { fit: "fill" }).png().toBuffer(), left: Math.round((cw - w) / 2), top: Math.round((ch - h) / 2) }]); };

// ---- 手：裁掉透明邊，比例照原圖 ----
const handR0 = await raw(sharp(src("金色佛光加持之手")));
{ for (let i = 3; i < handR0.d.length; i += 4) if (handR0.d[i] < 12) { handR0.d[i] = 0; handR0.d[i - 1] = 0; handR0.d[i - 2] = 0; handR0.d[i - 3] = 0; } }
const hb = bbox(handR0), handR = crop(handR0, hb.x, hb.y, hb.w, hb.h), handAR = hb.w / hb.h;
// ---- 手背透光裂紋、裂縫：中心對準 ----
const crR = blackToAlpha(await raw(sharp(src("黑暗中的金色能量裂痕"))));
const fisRaw = await raw(sharp(src("金色閃電裂痕爆發")));
// 裂縫的爆點（最亮區的重心）當中心；裁成 16:9，爆點放正中間（落點才會在裂縫中心）
let cx = 0, cy = 0, cn = 0; for (let y = 0; y < fisRaw.h; y++) for (let x = 0; x < fisRaw.w; x++) { const i = (y * fisRaw.w + x) * 4; if (fisRaw.d[i + 2] > 235) { cx += x; cy += y; cn++; } } cx /= cn; cy /= cn;
const fw0 = Math.floor(Math.min(cx, fisRaw.w - cx) * 2), fh0 = Math.floor(Math.min(fw0 * 9 / 16, Math.min(cy, fisRaw.h - cy) * 2)), fw1 = Math.round(fh0 * 16 / 9);
const fisA = blackToAlpha(crop(fisRaw, Math.round(cx - fw1 / 2), Math.round(cy - fh0 / 2), fw1, fh0));
// 噴光點：沿放射方向取 40 個亮點，分散在各個距離（座標以畫布中心為 0，單位＝裂縫圖寬／高）
const jetsPts = []; { const seen = []; const cand = []; for (let y = 8; y < fisA.h - 8; y += 6) for (let x = 8; x < fisA.w - 8; x += 6) { const i = (y * fisA.w + x) * 4; if (fisA.d[i + 3] > 215) cand.push([x, y]); }
  const R = (p) => Math.hypot(p[0] - fisA.w / 2, p[1] - fisA.h / 2); cand.sort((a, b) => R(a) - R(b));
  const minGap = fisA.w * 0.055; for (const p of cand) { if (R(p) < fisA.h * 0.08 || seen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minGap)) continue; seen.push(p); if (seen.length >= 40) break; }
  for (const p of seen) jetsPts.push({ x: +((p[0] / fisA.w) - 0.5).toFixed(4), y: +((p[1] / fisA.h) - 0.5).toFixed(4), a: +Math.atan2(p[1] - fisA.h / 2, p[0] - fisA.w / 2).toFixed(3) }); }
// ---- 分格：實際內容的外框 ----
const jetsA = blackToAlpha(await raw(sharp(src("四格金色光能爆發矩陣"))));
const raysA = blackToAlpha(await raw(sharp(src("四款金色能量光束特效"))));
const dustA = blackToAlpha(await raw(sharp(src("四團金色星塵雲霧"))));
const rubR = await raw(sharp(src("綠絨金裂桌板碎片素材表")));
for (let i = 3; i < rubR.d.length; i += 4) if (rubR.d[i] < 28) { rubR.d[i] = 0; rubR.d[i - 1] = 0; rubR.d[i - 2] = 0; rubR.d[i - 3] = 0; } // 透明邊的雜色清掉
const grid = (r, cols, rows, test) => { const a = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) a.push(bbox(r, Math.floor(i * r.w / cols), Math.floor(j * r.h / rows), Math.floor((i + 1) * r.w / cols), Math.floor((j + 1) * r.h / rows), test)); return a; };
const isOn = (d, i) => d[i + 3] > 40;
const jetB = grid(jetsA, 2, 2, isOn), rayB = grid(raysA, 2, 2, isOn), dustB = grid(dustA, 2, 2, isOn), rubB = grid(rubR, 4, 3, (d, i) => d[i + 3] > 60);
// 噴光的底部爆點（放格子裡當錨點）
const jetBase = jetB.map((b) => { let sx = 0, sy = 0, n = 0; for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = (y * jetsA.w + x) * 4; if (jetsA.d[i + 3] > 240 && y > b.y + b.h * 0.55) { sx += x; sy += y; n++; } } return { x: sx / n, y: sy / n }; });
const meta = { handAR: +handAR.toFixed(4), handAnchor: { x: 0.56, y: 0.66 }, fisAR: 16 / 9, jets: jetsPts };
for (const dev of ["m", "d"]) {
  const S = SIZE[dev], q = S.q;
  const hh = S.hand, hw = Math.round(hh * handAR);
  await webp(fit(handR, hw, hh), q.hand, `rulai-hand-${dev}.webp`);
  // 透光裂紋：放滿手（cover，不變形），用手的透明度裁切
  const cH = S.cracks, cW = Math.round(cH * handAR), maskB = await toSharp(handR).resize(cW, cH, { fit: "fill" }).extractChannel(3).raw().toBuffer();
  const side = Math.max(cW, cH), crFull = await raw(toSharp(crR).resize(side, side, { fit: "fill" }).extract({ left: Math.round((side - cW) / 2), top: Math.round((side - cH) / 2), width: cW, height: cH }));
  for (let i = 0; i < cW * cH; i++) crFull.d[i * 4 + 3] = Math.round((crFull.d[i * 4 + 3] * maskB[i]) / 255);
  await webp(toSharp(crFull), q.cracks, `rulai-hand-cracks-${dev}.webp`);
  // 掌印：手的輪廓發光（外暈＋淡淡的內部），程式產生
  // 手的透明度含外圍光暈，一路碰到圖邊；只拿手本體（光暈以內）算輪廓，圖邊再羽化，掌印才不會露出方形硬邊
  const solidB = Buffer.alloc(maskB.length); for (let i = 0; i < maskB.length; i++) solidB[i] = Math.round(255 * Math.min(1, Math.max(0, (maskB[i] - 110) / 90)));
  const blurA = await sharp(solidB, { raw: { width: cW, height: cH, channels: 1 } }).blur(cH * 0.02).extractChannel(0).raw().toBuffer();
  if (maskB.length !== cW * cH || blurA.length !== cW * cH) throw new Error("遮罩不是單通道");
  const pr = Buffer.alloc(cW * cH * 4);
  for (let i = 0; i < cW * cH; i++) { const inner = solidB[i] / 255, soft = blurA[i] / 255, edge = soft * (1 - inner * 0.82); pr[i * 4] = 255; pr[i * 4 + 1] = 196 + Math.round(40 * edge); pr[i * 4 + 2] = 92 + Math.round(90 * edge); const pa = Math.min(255, Math.round(255 * (edge * 1.5 + inner * 0.2))); pr[i * 4 + 3] = pa < 4 ? 0 : pa; }
  await webp(toSharp(feather({ d: pr, w: cW, h: cH }, 0.05)), q.print, `rulai-print-${dev}.webp`);
  const [fw, fh] = S.fis;
  await webp(fit(fisA, fw, fh), q.fis, `rulai-fissures-${dev}.webp`);
  // 裂縫光暈：同一張縮小再模糊、染金（程式畫時放大，本來就是軟的）
  const [gw, gh] = S.glow, gl = await raw(fit(fisA, gw, gh).blur(gh * 0.012));
  for (let i = 0; i < gl.d.length; i += 4) { gl.d[i] = 255; gl.d[i + 1] = 190; gl.d[i + 2] = 70; }
  await webp(toSharp(gl), q.glow, `rulai-fis-glow-${dev}.webp`);
  // 噴光：每格 3:2（原圖比例），不是正方形；底部爆點對準格子中央偏下（S.jet＝格高）
  const jh = S.jet, jw = Math.round(jh * 1.5), jetCells = [];
  for (let n = 0; n < 4; n++) { const cell = { w: Math.floor(jetsA.w / 2), h: Math.floor(jetsA.h / 2) }, b = jetB[n], base = jetBase[n], x0 = Math.round(base.x - cell.w / 2), y0 = Math.round(base.y - cell.h * 0.88); jetCells.push(toSharp(feather(crop(jetsA, x0, y0, cell.w, cell.h))).resize(jw, jh, { fit: "fill" })); void b; }
  await webp(await sheet(jetCells, 2, jw, jh).then((s) => s.png().toBuffer()).then((b) => sharp(b)), q.jets, `rulai-light-jets-${dev}.webp`);
  // 光束：起點在左，高度依內容裁（每格 3:1），不拉伸
  const rw = S.ray, rh = Math.round(rw / 3), rayCells = [];
  for (let n = 0; n < 4; n++) { const b = rayB[n], ch = Math.round(b.w / 3); rayCells.push(toSharp(feather(crop(raysA, b.x, Math.round(b.y + b.h / 2 - ch / 2), b.w, ch), 0.06)).resize(rw, rh, { fit: "fill" })); }
  await webp(await sheet(rayCells, 2, rw, rh).then((s) => s.png().toBuffer()).then((b) => sharp(b)), q.rays, `rulai-light-rays-${dev}.webp`);
  // 碎片 12 塊：照實際外框放進正方形格子，比例不變
  const rubCells = []; for (let n = 0; n < 12; n++) rubCells.push(await inCell(rubR, rubB[n], S.rub, S.rub));
  await webp(await sheet(rubCells, 4, S.rub, S.rub).then((s) => s.png().toBuffer()).then((b) => sharp(b)), q.rub, `rulai-rubble-${dev}.webp`);
  // 塵雲 4 團：格子 3:2
  const dh = S.dust, dw = Math.round(dh * 1.5), dustCells = []; for (let n = 0; n < 4; n++) dustCells.push(await inCell(feather(dustA, 0), dustB[n], dw, dh));
  await webp(await sheet(dustCells, 2, dw, dh).then((s) => s.png().toBuffer()).then((b) => sharp(b)), q.dust, `rulai-dust-${dev}.webp`);
}
// 大字：裁掉透明邊，不超過 900×450
const tR = await raw(sharp(src("熾金自摸書法標誌"))); for (let i = 3; i < tR.d.length; i += 4) if (tR.d[i] < 16) { tR.d[i] = 0; tR.d[i - 1] = 0; tR.d[i - 2] = 0; tR.d[i - 3] = 0; }
const tb = bbox(tR), tk = Math.min(900 / tb.w, 450 / tb.h), tw = Math.round(tb.w * tk), th = Math.round(tb.h * tk);
await webp(toSharp(crop(tR, tb.x, tb.y, tb.w, tb.h)).resize(tw, th, { fit: "fill", kernel: "lanczos3" }), 66, "rulai-title.webp");
meta.titleAR = +(tb.w / tb.h).toFixed(4);
writeFileSync(path.join(ROOT, "lib/mahjong/fx/rulaiMeta.ts"), `// scripts/gen-rulai-assets.mjs 產生，不要手改。\nexport const RULAI_META = ${JSON.stringify(meta)} as const;\n`);
// 報表：下載量、解碼後大小
const names = ["hand", "hand-cracks", "print", "fissures", "fis-glow", "light-jets", "light-rays", "rubble", "dust"];
for (const dev of ["m", "d"]) { let kb = 0, mb = 0; const rows = []; for (const f of [...names.map((n) => `rulai-${n}-${dev}.webp`), "rulai-title.webp"]) { const p = path.join(OUT, f), s = statSync(p).size, i = await sharp(p).metadata(); kb += s; mb += i.width * i.height * 4; rows.push(`${f} ${i.width}×${i.height} ${(s / 1024).toFixed(0)}KB`); }
  console.log(`${dev}：下載 ${(kb / 1024).toFixed(0)} KB、解碼 ${(mb / 1048576).toFixed(2)} MB\n  ${rows.join("\n  ")}`); }
console.log("手", hb, "AR", handAR.toFixed(3), "裂縫中心", cx.toFixed(0), cy.toFixed(0), "裁", fw1, fh0, "噴光點", jetsPts.length, "噴光底", jetBase.map((b) => [Math.round(b.x), Math.round(b.y)]), "\n光束框", rayB, "\n碎片框", rubB.map((b) => `${b.x},${b.y} ${b.w}×${b.h}`).join(" | "));
