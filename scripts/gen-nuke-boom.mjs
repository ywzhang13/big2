// 核彈爆炸的序列幀（sprite sheet）處理器（老闆 2026-11-11 決定用序列幀）。
// 吃兩種輸入，輸出統一：
//   node scripts/gen-nuke-boom.mjs ~/Desktop/boom.png --grid 4x4      # 已經拼好的精靈表
//   node scripts/gen-nuke-boom.mjs ~/Desktop/boom-seq --grid 4x4      # 一整個資料夾的 PNG 序列（檔名排序）
// 輸出 public/mahjong-fx/zimo/nuke/nuke-boom-v2-d.webp（每格 384px）與 -m.webp（每格 256px），
// 檔名帶 v2：第一版素材已經進過分支歷史，長期快取規定同檔名不能換內容（tests/_immutable-history.ts 在守），
// 並印出要填進 lib/mahjong/fx/nukeFx.ts 的格數與每格大小。
//
// 為什麼要這支而不是直接丟圖進 public：
//   ・手機解碼量有上限（tests/_nuke-fx.ts N9 在守，目前 14 MB）。1024×1024 的手機表解碼約 4 MB 剛好，
//     2048×2048 就是 16 MB，直接爆表——所以手機版一定要另外縮一張。
//   ・長期快取（CLAUDE.md 的省量紀律）：同檔名換內容會讓老玩家一年看到舊圖，換素材一定要改檔名（-v2）。
//   ・順便擋掉最常見的三個坑：格子對不齊、整張沒有 alpha（黑底）、每一格沒有置中。
import sharp from "sharp";
import { hasRealAlpha, stripFakeChecker } from "./lib/unchecker.mjs";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/zimo/nuke");
const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith("--"));
const gi = argv.indexOf("--grid");
const [COLS, ROWS] = (gi >= 0 ? argv[gi + 1] : "4x4").split("x").map(Number);
/** 每格四周先裁掉幾個像素：有些生成器會在格與格之間畫出格線，不裁會跟著被當成內容 */
const ii = argv.indexOf("--inset");
const INSET = ii >= 0 ? Number(argv[ii + 1]) || 0 : 0;
/** 每格輸出大小：電腦、手機 */
const CELL_D = 384, CELL_M = 256;
const ALPHA_MIN = 8;

if (!SRC || !COLS || !ROWS) {
  console.error("用法：node scripts/gen-nuke-boom.mjs <精靈表或 PNG 序列資料夾> [--grid 4x4]");
  process.exit(2);
}


/** 把輸入整理成「每一格一張 buffer」 */
async function frames() {
  const st = statSync(SRC);
  if (st.isDirectory()) {
    const files = readdirSync(SRC).filter((f) => /\.(png|webp)$/i.test(f)).sort();
    if (!files.length) throw new Error(`${SRC} 裡沒有 png／webp`);
    console.log(`PNG 序列：${files.length} 張（${files[0]} … ${files.at(-1)}）`);
    return Promise.all(files.map(async (f) => {
      const p = path.join(SRC, f);
      return sharp((await hasRealAlpha(p)) ? p : await stripFakeChecker(p)).ensureAlpha().toBuffer();
    }));
  }
  // 沒有真的透明度 ＝ 八成是 AI 出的「假透明格」，先鍵掉再切
  const img = sharp((await hasRealAlpha(SRC)) ? SRC : await stripFakeChecker(SRC)).ensureAlpha();
  const m = await img.metadata();
  console.log(`精靈表：${SRC}（${m.width}×${m.height}，切 ${COLS}×${ROWS}）`);
  if (m.width % COLS || m.height % ROWS) {
    throw new Error(`格子對不齊：${m.width}×${m.height} 不能被 ${COLS}×${ROWS} 整除。請確認格數，或請出圖的人把邊界對齊`);
  }
  const cw = m.width / COLS, chh = m.height / ROWS;
  if (INSET) console.log(`每格四周各裁 ${INSET}px（去掉格線）`);
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      out.push(await img.clone().extract({
        left: c * cw + INSET, top: r * chh + INSET, width: cw - INSET * 2, height: chh - INSET * 2,
      }).toBuffer());
    }
  }
  return out;
}

const cells = await frames();
if (cells.length !== COLS * ROWS) {
  console.warn(`⚠️ 拿到 ${cells.length} 格，但 --grid 說是 ${COLS * ROWS} 格；以實際張數為準重排會比較安全`);
}

// ── 檢查：有沒有 alpha（黑底疊上去會看到方塊邊）、每一格是不是置中 ─────────────
{
  const mid = cells[Math.floor(cells.length / 2)];
  const { data, info } = await sharp(mid).raw().toBuffer({ resolveWithObject: true });
  let opaqueEdge = 0, minX = info.width, maxX = 0, minY = info.height, maxY = 0, any = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + 3];
      if (a <= ALPHA_MIN) continue;
      any++;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) opaqueEdge++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!any) throw new Error("中間那一格整格透明：格數或輸入八成不對");
  const frac = any / (info.width * info.height);
  if (frac > 0.985) console.warn("⚠️ 中間那一格幾乎整格不透明——這張可能是黑底而不是去背，疊上去會看到方塊邊");
  if (opaqueEdge > (info.width + info.height) * 0.1) console.warn("⚠️ 內容碰到格子邊界，播起來會被切掉；請出圖時每格留一點邊");
  const offX = (minX + maxX) / 2 / info.width - 0.5, offY = (minY + maxY) / 2 / info.height - 0.5;
  if (Math.abs(offX) > 0.08 || Math.abs(offY) > 0.08) {
    console.warn(`⚠️ 中間那一格沒有置中（偏 x ${(offX * 100).toFixed(1)}%、y ${(offY * 100).toFixed(1)}%）：播放時爆心會飄`);
  } else {
    console.log("置中、去背、邊界檢查：通過");
  }
}

// ── 輸出：重新拼成固定格子的表（電腦、手機各一張）────────────────────────────
mkdirSync(OUT, { recursive: true });
const n = cells.length;
const cols = COLS, rows = Math.ceil(n / COLS);
for (const [suffix, cell] of [["d", CELL_D], ["m", CELL_M]]) {
  const sheet = sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const parts = [];
  for (let i = 0; i < n; i++) {
    const buf = await sharp(cells[i]).resize({ width: cell, height: cell, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    parts.push({ input: buf, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  }
  const file = path.join(OUT, `nuke-boom-v2-${suffix}.webp`);
  const info = await sheet.composite(parts).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(file);
  const mb = (info.width * info.height * 4) / 1048576;
  console.log(`寫出 ${path.relative(ROOT, file)}（${info.width}×${info.height}，${(info.size / 1024).toFixed(0)} KB，解碼約 ${mb.toFixed(1)} MB）`);
  if (suffix === "m" && mb > 5) console.warn("⚠️ 手機版解碼超過 5 MB，N9 的 14 MB 上限會很緊；考慮減格數或縮小每格");
}
console.log(`\nNUKE_BOOM = { cols: ${cols}, rows: ${rows}, frames: ${n} }  ← 填進 lib/mahjong/fx/nukeFx.ts`);
console.log("記得跑：node scripts/asset-hashes.mjs --write");
