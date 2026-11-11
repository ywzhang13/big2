// 核彈自摸特效（nuke，老闆 2026-11-10）的素材產生器。
// 兩張素材：Q 版金正恩去背圖（大笑、豎大拇指、中山裝）、Q 版核彈飛彈去背圖（老闆 2026-11-11 出圖）。
// 都是裁掉透明邊、縮成電腦／手機兩種尺寸、轉成 webp；大字借如來神掌那張，爆炸整段是程式畫的。
//   node scripts/gen-nuke-assets.mjs [人物圖] [--missile <飛彈圖>] [--preview]
//   預設 ~/Desktop/正恩.png 和 ~/Desktop/飛彈.png；--preview 另外寫一張預覽頁（在 public 外，見下）
// 飛彈圖會自動「轉正」成彈頭朝右：先用不透明像素的主軸算出它畫的方向，再用彈頭那端偏紅（R−G 最大）
//   決定是哪一頭，轉到 0 度輸出。這樣特效裡只要照飛行角度旋轉，不用為素材的姿勢多記一個偏移量。
// 爆炸整段（飛彈、火球、蕈狀雲、衝擊波、碎片、煙、地面焦痕、白閃）都是 lib/mahjong/fx/nukeFx.ts 程式畫的，不吃素材。
// 長期快取（lib/staticCache.ts 的 mahjong-fx）：換內容一定要改檔名或加版本號，改完跑 node scripts/asset-hashes.mjs --write。
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/zimo/nuke");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SRC = args[0] ?? path.join(os.homedir(), "Desktop", "正恩.png");
const mi = process.argv.indexOf("--missile");
const MISSILE_SRC = mi >= 0 && process.argv[mi + 1] && !process.argv[mi + 1].startsWith("--")
  ? process.argv[mi + 1] : path.join(os.homedir(), "Desktop", "飛彈.png");
const PREVIEW = process.argv.includes("--preview");

/** 電腦版寬度；手機版照 rulai 的比例縮到 0.75（rulai-hand 是 1024→768） */
const W_D = 1024, W_M = 768;
/** 去背圖邊緣常有幾乎全透明的雜點，門檻以下不算內容（和 gen-sakura-petal-art.mjs 同一個理由） */
const ALPHA_MIN = 12;

const img = sharp(SRC).ensureAlpha();
const meta = await img.metadata();
console.log(`來源：${SRC}（${meta.width}×${meta.height}）`);

// 裁掉四周的透明邊，角色才會填滿畫面；特效裡的位置、大小由程式算，素材留白只會讓人物變小
const trimmed = await img.trim({ threshold: ALPHA_MIN }).toBuffer({ resolveWithObject: true });
console.log(`去邊後：${trimmed.info.width}×${trimmed.info.height}`);

mkdirSync(OUT, { recursive: true });
const written = [];
for (const [suffix, w] of [["d", W_D], ["m", W_M]]) {
  const file = path.join(OUT, `nuke-kim-${suffix}.webp`);
  const info = await sharp(trimmed.data)
    .resize({ width: w, fit: "inside", withoutEnlargement: false })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(file);
  written.push({ file, info });
  console.log(`寫出 ${path.relative(ROOT, file)}（${info.width}×${info.height}，${(info.size / 1024).toFixed(0)} KB）`);
}

/** 人物在素材裡的長寬比：nukeFx 用它算畫面上要畫多大，不用每次量圖 */
console.log(`\nkimAR = ${(written[0].info.width / written[0].info.height).toFixed(4)}  ← 填進 lib/mahjong/fx/nukeFx.ts 的 NUKE_KIM_AR`);

// ── 飛彈：量出素材畫的方向，轉成彈頭朝右再輸出 ──────────────────────────────
{
  const src = sharp(MISSILE_SRC).ensureAlpha();
  const m0 = await src.metadata();
  console.log(`\n飛彈來源：${MISSILE_SRC}（${m0.width}×${m0.height}）`);
  // 量方向用縮圖就夠（快，而且雜點影響更小）
  const SMALL = 256;
  const { data, info } = await src.clone().resize({ width: SMALL, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  let n = 0, sx = 0, sy = 0;
  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      if (data[i + 3] < 64) continue;
      pts.push([x, y, data[i], data[i + 1]]);       // x, y, R, G
      sx += x; sy += y; n++;
    }
  }
  if (!n) throw new Error("飛彈圖整張都是透明的？");
  const mx = sx / n, my = sy / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [x, y] of pts) { const dx = x - mx, dy = y - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
  // 主軸：不透明像素散布最長的方向（只知道軸線，不知道頭尾）
  let ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  // 頭尾：彈頭那端偏紅（R−G 大），把紅的重心投影到軸上，落在負的那邊就把方向轉 180 度
  let red = 0;
  for (const [x, y, R, G] of pts) {
    const w = Math.max(0, R - G) ** 2;
    if (!w) continue;
    red += w * ((x - mx) * Math.cos(ang) + (y - my) * Math.sin(ang));
  }
  if (red < 0) ang += Math.PI;
  const deg = (ang * 180) / Math.PI;
  console.log(`量到的方向：${deg.toFixed(1)}°（0＝彈頭朝右），轉正 ${(-deg).toFixed(1)}°`);
  const upright = await src.rotate(-deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .trim({ threshold: ALPHA_MIN }).toBuffer({ resolveWithObject: true });
  console.log(`轉正去邊後：${upright.info.width}×${upright.info.height}`);
  const out = [];
  for (const [suffix, w] of [["d", W_D], ["m", W_M]]) {
    const file = path.join(OUT, `nuke-missile-${suffix}.webp`);
    const info2 = await sharp(upright.data).resize({ width: w, fit: "inside", withoutEnlargement: false })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(file);
    out.push({ file, info: info2 });
    written.push({ file, info: info2 });
    console.log(`寫出 ${path.relative(ROOT, file)}（${info2.width}×${info2.height}，${(info2.size / 1024).toFixed(0)} KB）`);
  }
  console.log(`missileAR = ${(out[0].info.width / out[0].info.height).toFixed(4)}  ← 填進 lib/mahjong/fx/nukeFx.ts 的 NUKE_MISSILE_AR`);
}

// 「自摸」大字不在這裡產：核彈借用如來神掌那張（老闆 2026-11-10，見 components/mahjong/ZimoTitle.tsx 的 zimoTitleArt）。

if (PREVIEW) {
  // 預覽頁一定寫在 public 外面：scripts/asset-hashes.mjs 會掃整個 public/mahjong-fx，
  // 留一張 html 在那裡會被當成「沒登記的長期快取素材」，npm test 就會失敗。
  const { writeFileSync, copyFileSync } = await import("node:fs");
  const dir = process.env.NUKE_PREVIEW_DIR || path.join(ROOT, ".preview");
  mkdirSync(dir, { recursive: true });
  for (const { file } of written) copyFileSync(file, path.join(dir, path.basename(file)));
  const p = path.join(dir, "nuke-preview.html");
  writeFileSync(p, `<!doctype html><meta charset="utf-8"><title>nuke 素材預覽</title>
<body style="margin:0;background:#141c26;display:flex;gap:32px;align-items:center;justify-content:center;height:100vh;overflow:hidden">
${written.map(({ file }) => `<img src="./${path.basename(file)}" style="max-height:92vh;max-width:44vw">`).join("\n")}
</body>`);
  console.log(`預覽：${path.relative(ROOT, p)}`);
}
