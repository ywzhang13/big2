// 如來神掌 v4.1 的手和雲（老闆 2026-11-06 生圖）：清雜點、只取手本體做掌形凹陷、雲的光暈調成暖金。手機（-m）、電腦（-d）各一組。
// 用法：node scripts/gen-rulai-v4-assets.mjs <手.png> <雲.png>；之後跑 node scripts/asset-hashes.mjs --write。長期快取素材不能同檔名換內容，要換就改 VERSION。
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [HAND, CLOUD] = process.argv.slice(2);
if (!HAND || !CLOUD) throw new Error("用法：node scripts/gen-rulai-v4-assets.mjs <手.png> <雲.png>");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/mahjong-fx/zimo/rulai");
const V = "v4";
const raw = async (s) => { const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const toSharp = (r) => sharp(r.d, { raw: { width: r.w, height: r.h, channels: 4 } });
const webp = (s, q, f) => s.webp({ quality: q, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, f));
// ---- 手：低透明度的雜點清掉，再把面積很小的孤立色塊（金屑、紅點）去掉 ----
const hand = await raw(sharp(HAND));
for (let i = 3; i < hand.d.length; i += 4) if (hand.d[i] < 24) hand.d[i - 3] = hand.d[i - 2] = hand.d[i - 1] = hand.d[i] = 0;
{ const { w, h, d } = hand, lab = new Int32Array(w * h), st = []; let id = 0;
  for (let p = 0; p < w * h; p++) { if (!d[p * 4 + 3] || lab[p]) continue; id++; const pix = [p]; lab[p] = id; st.push(p);
    while (st.length) { const q = st.pop(), x = q % w, y = (q / w) | 0; for (const n of [q - 1, q + 1, q - w, q + w]) { if (n < 0 || n >= w * h || lab[n] || !d[n * 4 + 3]) continue; if ((n === q - 1 && x === 0) || (n === q + 1 && x === w - 1)) continue; lab[n] = id; st.push(n); pix.push(n); } }
    if (pix.length < 400) for (const q of pix) d[q * 4] = d[q * 4 + 1] = d[q * 4 + 2] = d[q * 4 + 3] = 0; } }
// 底部收邊：最下面 4% 漸淡到 0，不會有切口
{ const { w, h, d } = hand, f0 = Math.round(h * 0.96); for (let y = f0; y < h; y++) { const k = 1 - (y - f0) / (h - f0); for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = Math.round(d[(y * w + x) * 4 + 3] * k * k); } }
// 手本體的輪廓（原圖座標，照實際手形描；祥雲、金屑不算）
const BODY = [[232, 1300], [180, 1060], [120, 840], [70, 660], [25, 540], [30, 492], [80, 478], [140, 520], [235, 610], [318, 668], [345, 600], [352, 300], [372, 120], [425, 78], [488, 100], [505, 300], [520, 430], [534, 300], [540, 60], [600, 18], [662, 52], [680, 300], [700, 425], [712, 300], [728, 110], [785, 78], [845, 115], [862, 300], [880, 450], [905, 300], [925, 245], [975, 232], [1018, 272], [1022, 450], [1030, 640], [1012, 860], [985, 1060], [930, 1300]];
const W0 = hand.w, H0 = hand.h;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W0}" height="${H0}"><polygon points="${BODY.map((p) => p.join(",")).join(" ")}" fill="#fff"/></svg>`;
const poly = (await sharp(Buffer.from(svg)).blur(6).extractChannel(0).raw().toBuffer());
const body = Buffer.alloc(W0 * H0); for (let p = 0; p < W0 * H0; p++) body[p] = Math.round((hand.d[p * 4 + 3] * poly[p]) / 255);
// 掌形凹陷（取代播放時烘圖）：外圈金邊＋內側深色＋手背裂紋透一點光
const crater = async (S) => {
  const w = Math.round((S * W0) / H0), m = await sharp(body, { raw: { width: W0, height: H0, channels: 1 } }).resize(w, S).extractChannel(0).raw().toBuffer();
  const rim = await sharp(m, { raw: { width: w, height: S, channels: 1 } }).blur(S * 0.02).extractChannel(0).raw().toBuffer();
  const lum = await sharp(hand.d, { raw: { width: W0, height: H0, channels: 4 } }).resize(w, S).removeAlpha().greyscale().extractChannel(0).raw().toBuffer();
  const o = Buffer.alloc(w * S * 4);
  for (let i = 0; i < w * S; i++) {
    const inA = m[i] / 255, edge = Math.max(0, rim[i] / 255 - inA * 0.9), y = Math.floor(i / w) / S, crack = inA * Math.max(0, lum[i] / 255 - 0.78) * 4;
    const dr = 6 + 32 * y, dg = 3 + 15 * y, db = 2;
    const r = dr * inA + 255 * (edge + crack), g = dg * inA + 190 * edge + 220 * crack, b = db * inA + 70 * edge + 120 * crack, a = Math.min(1, inA * 0.95 + edge * 1.4);
    o[i * 4] = Math.min(255, r / Math.max(a, 1e-3)); o[i * 4 + 1] = Math.min(255, g / Math.max(a, 1e-3)); o[i * 4 + 2] = Math.min(255, b / Math.max(a, 1e-3)); o[i * 4 + 3] = Math.round(a * 255);
  }
  return sharp(o, { raw: { width: w, height: S, channels: 4 } });
};
// ---- 雲：高彩度的黃綠光暈轉成暖金；灰雲不動 ----
const cl = await raw(sharp(CLOUD));
for (let i = 0; i < cl.d.length; i += 4) { const r = cl.d[i], g = cl.d[i + 1], b = cl.d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 40 && (mx - mn) / mx > 0.35 && g > r * 0.82) cl.d[i + 1] = Math.round(r * 0.8); }
const report = [];
for (const [dev, hh, cw, cs, q] of [["m", 840, 768, 640, 72], ["d", 1120, 1152, 1024, 80]]) {
  const hw = Math.round((hh * W0) / H0);
  await webp(toSharp(hand).resize(hw, hh, { kernel: "lanczos3" }), q, `rulai-hand-${V}-${dev}.webp`);
  await webp(toSharp(cl).resize(cw, Math.round((cw * cl.h) / cl.w)), q - 8, `rulai-clouds-${V}-${dev}.webp`);
  await webp(await crater(cs), q - 10, `rulai-crater-${V}-${dev}.webp`);
}
for (const f of ["hand", "clouds", "crater"]) for (const dev of ["m", "d"]) { const p = path.join(OUT, `rulai-${f}-${V}-${dev}.webp`), i = await sharp(p).metadata(); report.push(`${path.basename(p)} ${i.width}×${i.height} ${((await import("node:fs")).statSync(p).size / 1024).toFixed(0)}KB`); }
console.log(report.join("\n"));
