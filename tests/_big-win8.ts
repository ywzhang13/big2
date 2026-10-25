// 大牌新版（老闆 2026-10-25 定案；lib/mahjong/bigWin.ts 的 BIG_WIN8，畫面 components/mahjong/BigWin8Fx.tsx）：
//   N1 10 種都播新版：八台 7 種＋ 16 台以上 3 種（天胡、字一色、大四喜，同一天改；舊的 BigWinFx 拿掉）
//   N2 每一種的總長、畫面重擊點（音效的重擊點對在這裡）照試按台定案；重擊點都在大牌段裡面
//   N3 要下載的檔：圖、牌型名字型（16 台多一個「天胡字」）、專屬音效（觸控裝置手機加強版、其他一般版），檔案都真的在 public/ 裡；
//      八台一種最多 650KB（小宜八台規格第 4 節）；16 台一種最多 2.5MB、天胡 3MB（阿哲派工的素材目標）。一般牌局不下載，只有這一手是這一種時才下載
//   N4 MIGI 的牌型名只寫「MIGI」（計分名稱「地聽」不動）
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIG_WIN8, BIG_WIN16_FONT, BIG_WIN8_FONT, BIG_WIN_ORDER, bigWin8Files, pickBigWin, type BigWin8Theme } from "../lib/mahjong/bigWin";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// N1
eq(BIG_WIN_ORDER.every((d) => !!BIG_WIN8[d.theme]), true, "N1 10 種牌型都有新版的總長、重擊點、素材");
eq(Object.keys(BIG_WIN8).sort(), BIG_WIN_ORDER.map((d) => d.theme).sort(), "N1 新版剛好是這 10 種（沒有多出不會播的）");
eq(["天胡", "字一色", "大四喜"].map((n) => pickBigWin({ seat: 0, score: { fans: [{ name: n, value: n === "天胡" ? 24 : 16 }] } })!.theme), ["tianhu", "zi1se", "dasixi"], "N1 天胡、字一色、大四喜：挑出來的牌型都在新版裡");

// N2
const TIME: Record<BigWin8Theme, [number, number]> = { tianhu: [3250, 1820], zi1se: [2480, 1080], dasixi: [2560, 1050], dasanyuan: [2200, 820], xiaosixi: [2180, 740], qing1se: [2160, 780], wuanke: [2220, 760], baxian: [2360, 720], qiqiang1: [2180, 720], migi: [2120, 220] };
for (const [th, [ms, hit]] of Object.entries(TIME) as [BigWin8Theme, [number, number]][]) {
  eq([BIG_WIN8[th]?.ms, BIG_WIN8[th]?.hit], [ms, hit], `N2 ${th}：總長 ${ms}ms、重擊 ${hit}ms`);
}
eq(Object.values(BIG_WIN8).every((x) => x.hit > 0 && x.hit < x.ms - 1000), true, "N2 重擊點都在大牌段裡面，之後還留 1 秒以上給牌型名");

// N3
for (const th of Object.keys(BIG_WIN8) as BigWin8Theme[]) {
  for (const dev of ["pc", "mobile"] as const) {
    const f = bigWin8Files(th, dev);
    const top = BIG_WIN_ORDER.find((d) => d.theme === th)!.tier === "top";
    const files = [...f.art, f.font, ...(f.font16 ? [f.font16] : []), f.sfx];
    const missing = files.filter((u) => !existsSync(path.join(PUB, u)));
    const bytes = files.reduce((a, u) => a + (existsSync(path.join(PUB, u)) ? statSync(path.join(PUB, u)).size : 0), 0);
    const cap = th === "tianhu" ? 3 * 1024 * 1024 : top ? 2.5 * 1024 * 1024 : 650 * 1024;
    eq([missing, f.sfx.endsWith(`/${th}-${dev}.mp3`), f.font, f.font16, bytes <= cap], [[], true, BIG_WIN8_FONT, top ? BIG_WIN16_FONT : null, true],
      `N3 ${th}（${dev === "pc" ? "電腦一般版" : "手機加強版"}）：${files.length} 個檔都在、${Math.round(bytes / 1024)}KB（上限 ${Math.round(cap / 1024)}KB）`);
  }
}

// N4
eq(BIG_WIN_ORDER.find((d) => d.theme === "migi")!.title, "MIGI", "N4 MIGI 牌型名只寫「MIGI」");
eq(BIG_WIN_ORDER.find((d) => d.theme === "migi")!.fan, "地聽", "N4 計分名稱仍是「地聽」");

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
