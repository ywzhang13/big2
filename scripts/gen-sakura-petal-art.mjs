// 老闆提供「櫻花花瓣夢幻粒子素材集」（1448×1086，3 列×4 欄＝12 團花瓣叢，真透明背景）：
// 拆成單團、修掉幾乎透明但顏色飽和的紅／黃／紫雜點（用 premultiplied alpha 做縮放，不會在邊緣滲色），
// 做成和舊版 sakura-petals-v2-* 一樣的 6 欄×2 列拼圖（第 0 列清晰、第 1 列預先模糊），檔名換新（v3），
// 所以 ZimoFx.tsx／canvasFx.ts 完全不用改程式，只換 sheet 來源。
// 用法：node scripts/gen-sakura-petal-art.mjs <來源 png> [--preview]（--preview 只輸出 12 團總覽給人挑，不產生正式檔）
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
const PREVIEW = process.argv.includes("--preview");
if (!SRC) { console.error("用法：node scripts/gen-sakura-petal-art.mjs <來源 png> [--preview]"); process.exit(1); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/mahjong-fx/zimo/sakura");
mkdirSync(OUT, { recursive: true });

const ROWS = 3, COLS = 4, ALPHA_MIN = 40; // 真的花瓣內容的門檻；雜色點 alpha 通常只有 1～5，這個門檻就能把它們排除在裁切框外
const img = sharp(SRC).ensureAlpha();
const meta = await img.metadata();
const { data: raw, info } = await img.raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, CW = W / COLS, CH = H / ROWS;

/** 在格子裡找真正有內容的範圍（alpha > 門檻），裁切框只取這塊，雜色點（alpha≈1）天然被排除在外 */
function findBBox(cx0, cy0, cx1, cy1) {
  let minX = cx1, minY = cy1, maxX = cx0, maxY = cy0;
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    const a = raw[(y * W + x) * 4 + 3];
    if (a > ALPHA_MIN) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const clusters = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const cx0 = Math.round(c * CW), cy0 = Math.round(r * CH), cx1 = Math.round((c + 1) * CW), cy1 = Math.round((r + 1) * CH);
  const b = findBBox(cx0, cy0, cx1, cy1);
  const pad = Math.round(Math.max(b.w, b.h) * 0.04);
  clusters.push({ i: r * COLS + c, x: Math.max(cx0, b.x - pad), y: Math.max(cy0, b.y - pad), w: Math.min(cx1 - cx0, b.w + pad * 2), h: Math.min(cy1 - cy0, b.h + pad * 2) });
}

/** 裁切一團，premultiply alpha 後再縮放（RGB 先乘 alpha），縮放完再除回來：
 *  雜色點 alpha 只有 1/255，premultiply 後 RGB 幾乎是 0，縮放內插時貢獻的顏色也幾乎是 0，不會在邊緣滲出紅黃紫 */
async function extract(cl, size) {
  const region = await sharp(SRC).ensureAlpha().extract({ left: cl.x, top: cl.y, width: cl.w, height: cl.h }).raw().toBuffer({ resolveWithObject: true });
  const { data, info: ri } = region, n = ri.width * ri.height;
  const pm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = data[o + 3];
    pm[o] = (data[o] * a) / 255; pm[o + 1] = (data[o + 1] * a) / 255; pm[o + 2] = (data[o + 2] * a) / 255; pm[o + 3] = a;
  }
  const side = Math.max(ri.width, ri.height); // 裁成正方形畫布，內容置中，符合 cell×cell 的拼圖格規則
  const square = Buffer.alloc(side * side * 4);
  const resized = await sharp(pm, { raw: { width: ri.width, height: ri.height, channels: 4 } })
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw().toBuffer();
  resized.copy(square);
  const out = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const o = i * 4, a = square[o + 3];
    if (a > 0) { out[o] = Math.min(255, Math.round((square[o] * 255) / a)); out[o + 1] = Math.min(255, Math.round((square[o + 1] * 255) / a)); out[o + 2] = Math.min(255, Math.round((square[o + 2] * 255) / a)); }
    out[o + 3] = a;
  }
  return sharp(out, { raw: { width: side, height: side, channels: 4 } }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
}

if (PREVIEW) {
  const cell = 240, comp = [];
  for (const cl of clusters) { const buf = await (await extract(cl, cell)).png().toBuffer(); comp.push({ input: buf, left: (cl.i % COLS) * cell, top: Math.floor(cl.i / COLS) * cell }); }
  await sharp({ create: { width: cell * COLS, height: cell * ROWS, channels: 4, background: "#14140f" } }).composite(comp).png().toFile("/tmp/sakura-art-12.png");
  console.log("12 團總覽：/tmp/sakura-art-12.png（index 0~11，列先算：0-3 第一列、4-7 第二列、8-11 第三列）");
  process.exit(0);
}

// 挑 6 團（外觀差異大的，避免六個長得太像）：見下方 PICK，由人看過 12 團總覽後決定
const PICK = (process.env.PICK ?? "0,3,5,6,9,11").split(",").map(Number);
if (PICK.length !== 6) throw new Error("PICK 要 6 個 index");

for (const [name, cell] of [["sakura-petals-v3-m", 64], ["sakura-petals-v3-d", 96]]) {
  const comp = [];
  for (let col = 0; col < 6; col++) {
    const cl = clusters[PICK[col]];
    const clear = await (await extract(cl, cell)).webp({ quality: 92 }).toBuffer();
    comp.push({ input: clear, left: col * cell, top: 0 });
    const blurred = await (await extract(cl, cell)).blur(Math.max(0.6, cell * 0.035)).webp({ quality: 92 }).toBuffer();
    comp.push({ input: blurred, left: col * cell, top: cell });
  }
  const out = await sharp({ create: { width: cell * 6, height: cell * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).webp({ quality: 92 }).toBuffer();
  writeFileSync(path.join(OUT, `${name}.webp`), out);
  console.log(name, out.length, "bytes", "picks", PICK);
}
