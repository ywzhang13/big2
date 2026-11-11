// 核彈特效的人物四姿勢表（老闆 2026-11-11 出圖）。
//   node scripts/gen-nuke-poses.mjs ~/Desktop/人物4格.png [--grid 2x2]
// 輸出 public/mahjong-fx/zimo/nuke/nuke-kim-set-d.webp（每格 512px）與 -m.webp（每格 384px）。
//
// 為什麼要校正而不是直接切：AI 出的四張圖「看起來一致」，實測頭的大小會差到 26%、中心也會偏，
// 播放時換姿勢就會看到頭忽然脹大、整個人往旁邊跳。這支用「頭」當錨點把四格對齊：
//   ・頭頂＝每格最上面那條有內容的掃描線（手不會舉到頭頂上方，所以這條很可靠）
//   ・頭寬＝頭頂往下 60px 處、通過中線的那一段連續內容（避開舉起來的手和肩膀）
//   ・以頭寬的中位數為準縮放每一格，再平移讓頭頂和頭中心重合
// 校正後四格共用同一個錨點，特效裡換姿勢只會換表情和手，頭不會動。
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasRealAlpha, stripFakeChecker } from "./lib/unchecker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/zimo/nuke");
const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith("--"));
const gi = argv.indexOf("--grid");
const [COLS, ROWS] = (gi >= 0 ? argv[gi + 1] : "2x2").split("x").map(Number);
/** 每格輸出大小：電腦、手機 */
const CELL_D = 512, CELL_M = 384;
/** 量頭寬的位置：頭頂往下這麼多（以 512 格為準，其他尺寸等比） */
const HEAD_PROBE = 60;
const A_MIN = 24;

if (!SRC) { console.error("用法：node scripts/gen-nuke-poses.mjs <四姿勢表> [--grid 2x2]"); process.exit(2); }

const keyed = (await hasRealAlpha(SRC)) ? await sharp(SRC).ensureAlpha().png().toBuffer() : await stripFakeChecker(SRC);
const img = sharp(keyed);
const m = await img.metadata();
console.log(`來源：${SRC}（${m.width}×${m.height}，切 ${COLS}×${ROWS}）`);
if (m.width % COLS || m.height % ROWS) throw new Error(`格子對不齊：${m.width}×${m.height} 不能被 ${COLS}×${ROWS} 整除`);
const cw = m.width / COLS, chh = m.height / ROWS;

/** 量一格的錨點：頭頂 y、頭寬、頭中心 x（都用這一格自己的像素座標） */
function anchorOf(data, W, H) {
  const a = (x, y) => data[(y * W + x) * 4 + 3];
  let top = -1;
  for (let y = 0; y < H && top < 0; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (a(x, y) > 96) n++;   // 去背後邊緣會留一點很淡的雜訊，門檻要夠高
    if (n > W * 0.03) top = y;                           // 也要夠寬，單點雜訊不算
  }
  if (top < 0) throw new Error("這一格是空的");
  const probe = Math.min(H - 2, top + Math.round((HEAD_PROBE * H) / CELL_D));
  let cx = Math.round(W / 2);
  while (cx < W - 1 && a(cx, probe) <= A_MIN) cx++;   // 從中線往右找到頭
  let l = cx, r = cx;
  while (l > 0 && a(l - 1, probe) > A_MIN) l--;
  while (r < W - 1 && a(r + 1, probe) > A_MIN) r++;
  return { top, width: r - l, cx: (l + r) / 2 };
}

const cells = [];
for (let i = 0; i < COLS * ROWS; i++) {
  const buf = await img.clone()
    .extract({ left: (i % COLS) * cw, top: Math.floor(i / COLS) * chh, width: cw, height: chh })
    .raw().toBuffer();
  cells.push({ buf, a: anchorOf(buf, cw, chh) });
}
const widths = cells.map((c) => c.a.width).slice().sort((x, y) => x - y);
const target = widths[Math.floor(widths.length / 2)];
console.log("\n各格原始錨點（校正前）：");
cells.forEach((c, i) => console.log(`  ${i + 1}  頭頂 y=${String(c.a.top).padStart(3)}  頭寬 ${String(c.a.width).padStart(3)}  頭中心 x=${c.a.cx.toFixed(0)}`));
console.log(`基準頭寬 ${target}px（中位數）`);

// 校正：縮放到基準頭寬，再平移讓頭頂、頭中心對齊到同一個位置
const AIM_TOP = Math.round(CELL_D * 0.06), AIM_CX = CELL_D / 2;
mkdirSync(OUT, { recursive: true });
const normalized = [];
for (const [i, c] of cells.entries()) {
  const k = target / c.a.width;
  const w = Math.max(1, Math.round(cw * k * (CELL_D / cw))), h = Math.max(1, Math.round(chh * k * (CELL_D / chh)));
  const scaled = await sharp(c.buf, { raw: { width: cw, height: chh, channels: 4 } })
    .resize({ width: w, height: h, fit: "fill" }).png().toBuffer();
  const sx = Math.round(AIM_CX - (c.a.cx * k * CELL_D) / cw);
  const sy = Math.round(AIM_TOP - (c.a.top * k * CELL_D) / chh);
  // 平移可能是負的（要往左上挪），composite 不吃負座標：先四周墊一圈透明再裁出來
  const PAD = CELL_D;
  // 分兩次處理：sharp 的 extend／extract 在同一條 pipeline 裡的套用順序是固定的，串在一起不是想要的結果
  const padded = await sharp(scaled)
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const cell = await sharp(padded)
    .extract({ left: PAD - sx, top: PAD - sy, width: CELL_D, height: CELL_D })
    .png().toBuffer();
  const chk = anchorOf(await sharp(cell).raw().toBuffer(), CELL_D, CELL_D);
  console.log(`  ${i + 1} 校正後  頭頂 y=${String(chk.top).padStart(3)}  頭寬 ${String(chk.width).padStart(3)}  頭中心 x=${chk.cx.toFixed(0)}  （縮放 ${k.toFixed(3)}×）`);
  normalized.push(cell);
}
const spread = (f) => { const v = normalized.map((_, i) => i); return v; };
void spread;

for (const [suffix, cell] of [["d", CELL_D], ["m", CELL_M]]) {
  const parts = await Promise.all(normalized.map(async (b, i) => ({
    input: await sharp(b).resize({ width: cell, height: cell }).toBuffer(),
    left: (i % COLS) * cell, top: Math.floor(i / COLS) * cell,
  })));
  const file = path.join(OUT, `nuke-kim-set-${suffix}.webp`);
  const info = await sharp({ create: { width: COLS * cell, height: ROWS * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(file);
  console.log(`寫出 ${path.relative(ROOT, file)}（${info.width}×${info.height}，${(info.size / 1024).toFixed(0)} KB，解碼約 ${((info.width * info.height * 4) / 1048576).toFixed(1)} MB）`);
}
console.log(`\nNUKE_POSES = { cols: ${COLS}, rows: ${ROWS}, n: ${COLS * ROWS} }  ← 填進 lib/mahjong/fx/nukeFx.ts`);
console.log("記得跑：node scripts/asset-hashes.mjs --write");
