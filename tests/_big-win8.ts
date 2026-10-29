// 大牌新版（老闆 2026-10-25 定案；lib/mahjong/bigWin.ts 的 BIG_WIN8，畫面 components/mahjong/BigWin8Fx.tsx）：
//   N1 10 種都播新版：八台 7 種＋ 16 台以上 3 種（天胡、字一色、大四喜，同一天改；舊的 BigWinFx 拿掉）
//   N2 每一種的總長、畫面重擊點（音效的重擊點對在這裡）照試按台定案；重擊點都在大牌段裡面
//   N3 要下載的檔：圖、牌型名字型（16 台多一個「天胡字」）、專屬音效（觸控裝置手機加強版、其他一般版），檔案都真的在 public/ 裡；
//      八台一種最多 650KB（小宜八台規格第 4 節）；16 台一種最多 2.5MB、天胡 3MB（阿哲派工的素材目標）。一般牌局不下載，只有這一手是這一種時才下載
//   N4 MIGI 的牌型名只寫「MIGI」（計分名稱「地聽」不動）
//   N5 每一張大牌圖都登記在背景預熱的占位圖尺寸表（components/mahjong/fxWarmUp.tsx 的 ART_SIZE），而且尺寸和實際 WebP 檔一樣
//      （沒登記的話預熱時占位圖是 1×1，第一次播的解碼／上傳成本預熱不到；審伯 2026-10-29 嚦咕審查）
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIG_WIN8, BIG_WIN16_FONT, BIG_WIN_LIGU_FONT, BIG_WIN8_FONT, BIG_WIN_ORDER, bigWin8Files, pickBigWin, type BigWin8Theme } from "../lib/mahjong/bigWin";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// N1
eq(BIG_WIN_ORDER.every((d) => !!BIG_WIN8[d.theme]), true, "N1 11 種牌型都有新版的總長、重擊點、素材");
eq(Object.keys(BIG_WIN8).sort(), BIG_WIN_ORDER.map((d) => d.theme).sort(), "N1 新版剛好是這 11 種（沒有多出不會播的）");
eq(["天胡", "字一色", "大四喜"].map((n) => pickBigWin({ seat: 0, score: { fans: [{ name: n, value: n === "天胡" ? 24 : 16 }] } })!.theme), ["tianhu", "zi1se", "dasixi"], "N1 天胡、字一色、大四喜：挑出來的牌型都在新版裡");

// N2
const TIME: Record<BigWin8Theme, [number, number]> = { tianhu: [3250, 1820], zi1se: [2480, 1080], dasixi: [2560, 1050], dasanyuan: [2200, 820], xiaosixi: [2180, 740], qing1se: [2160, 780], wuanke: [2220, 760], ligu: [2250, 1120], baxian: [2360, 720], qiqiang1: [2180, 720], migi: [2120, 220] };
for (const [th, [ms, hit]] of Object.entries(TIME) as [BigWin8Theme, [number, number]][]) {
  eq([BIG_WIN8[th]?.ms, BIG_WIN8[th]?.hit], [ms, hit], `N2 ${th}：總長 ${ms}ms、重擊 ${hit}ms`);
}
eq(Object.values(BIG_WIN8).every((x) => x.hit > 0 && x.hit < x.ms - 1000), true, "N2 重擊點都在大牌段裡面，之後還留 1 秒以上給牌型名");

// N3
for (const th of Object.keys(BIG_WIN8) as BigWin8Theme[]) {
  for (const dev of ["pc", "mobile"] as const) {
    const f = bigWin8Files(th, dev);
    const top = BIG_WIN_ORDER.find((d) => d.theme === th)!.tier === "top";
    const files = [...f.art, f.font, ...(f.font16 ? [f.font16] : []), ...(f.fontLigu ? [f.fontLigu] : []), f.sfx];
    const missing = files.filter((u) => !existsSync(path.join(PUB, u)));
    const bytes = files.reduce((a, u) => a + (existsSync(path.join(PUB, u)) ? statSync(path.join(PUB, u)).size : 0), 0);
    const cap = th === "tianhu" ? 3 * 1024 * 1024 : top ? 2.5 * 1024 * 1024 : 650 * 1024;
    eq([missing, f.sfx.endsWith(`/${th}-${dev}.mp3`), f.font, f.font16, f.fontLigu, bytes <= cap], [[], true, BIG_WIN8_FONT, top ? BIG_WIN16_FONT : null, th === "ligu" ? BIG_WIN_LIGU_FONT : null, true],
      `N3 ${th}（${dev === "pc" ? "電腦一般版" : "手機加強版"}）：${files.length} 個檔都在、${Math.round(bytes / 1024)}KB（上限 ${Math.round(cap / 1024)}KB）`);
  }
}

// N4
eq(BIG_WIN_ORDER.find((d) => d.theme === "migi")!.title, "MIGI", "N4 MIGI 牌型名只寫「MIGI」");
eq(BIG_WIN_ORDER.find((d) => d.theme === "migi")!.fan, "地聽", "N4 計分名稱仍是「地聽」");

// N5
/** 讀 WebP 檔頭的寬高（VP8X／VP8L／VP8 三種格式） */
function webpSize(file: string): [number, number] | null {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return null;
}
// ART_SIZE 直接從原始碼讀（fxWarmUp.tsx 是前端元件檔，不為了測試多開匯出）
const warmSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "mahjong", "fxWarmUp.tsx"), "utf8");
const artBlock = warmSrc.slice(warmSrc.indexOf("const ART_SIZE"), warmSrc.indexOf("};", warmSrc.indexOf("const ART_SIZE")));
const ART_SIZE = Object.fromEntries([...artBlock.matchAll(/"?([\w-]+)"?:\s*\[(\d+),\s*(\d+)\]/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
const allArt = [...new Set(Object.values(BIG_WIN8).flatMap((x) => x.art))];
for (const f of allArt) {
  const key = f.replace(/\.webp$/, "");
  eq([ART_SIZE[key] ?? null, webpSize(path.join(PUB, "mahjong-fx", "bigwin8", f))], [webpSize(path.join(PUB, "mahjong-fx", "bigwin8", f)), webpSize(path.join(PUB, "mahjong-fx", "bigwin8", f))], `N5 ${f}：已登記在 ART_SIZE，尺寸和實際檔案一樣`);
}
eq(allArt.length > 0 && allArt.every((f) => !!ART_SIZE[f.replace(/\.webp$/, "")]), true, `N5 大牌設定裡的 ${allArt.length} 張圖全部在 ART_SIZE 裡`);

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
