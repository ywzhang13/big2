// 慢測（不在 npm test 裡，約 7 分半）：npm run test:slow
// 改到十三支排牌邏輯（lib/thirteen/arrange.ts 的 autoArrange）時一定要跑（阿哲 2026-11-18 裁定）。
//   S1 隨機 1 萬局（4 萬手 16 張）：自動排牌都不倒水、都是本人的 13 張、不重複
//      常規 npm test 裡的 tests/_thirteen-deal16.ts G5 只跑 1,000 局；這裡用同一個種子（20261118）跑完整 1 萬局，前 1,000 局和 G5 相同。
//   S2 tests/_thirteen-random.ts 跑 1 萬局（常規 npm test 只跑 1,000 局）：倒水、送出檢查、四家總分 0、亮牌順序、壞的送出都擋
import { deal, type Card } from "../../lib/thirteen/cards";
import { autoArrange, checkArrangement } from "../../lib/thirteen/arrange";

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);

const r = rng(20261118);
const start = Date.now();
let hands16 = 0, len16 = 0, bad = 0, notThirteen = 0, notMine = 0, threw = "", slowest = 0;
for (let g = 0; g < 10000; g++) {
  for (const h of deal(r).hands) {
    hands16++;
    if (h.length === 16) len16++;
    const t0 = performance.now();
    let a;
    try { a = autoArrange(h); } catch (e) { threw ||= (e as Error).message; bad++; continue; }
    slowest = Math.max(slowest, performance.now() - t0);
    const used = [...a.front, ...a.middle, ...a.back];
    if (used.length !== 13 || new Set(ids(used)).size !== 13) notThirteen++;
    if (used.some((c) => !h.includes(c))) notMine++;
    if (!checkArrangement(a).ok) bad++;
  }
}
const got = [hands16, len16, bad, notThirteen, notMine, threw];
const ok = JSON.stringify(got) === JSON.stringify([40000, 40000, 0, 0, 0, ""]);
const sec = ((Date.now() - start) / 1000).toFixed(0);
console.log(`${ok ? "✅" : "❌"} S1 隨機 1 萬局（4 萬手 16 張）：自動排牌都不倒水、都是本人的 13 張（倒水 ${bad}、張數不對 ${notThirteen}、混入別人的牌 ${notMine}；單手最慢 ${slowest.toFixed(1)} 毫秒；共 ${sec} 秒）${ok ? "" : `\n   預期=[40000,40000,0,0,0,""]\n   實際=${JSON.stringify(got)}`}`);

// S2：同一個行程裡把 _thirteen-random 的局數設成 1 萬再載入（設環境變數不用分 Mac／Windows 寫法）
process.env.THIRTEEN_RANDOM_N = "10000";
console.log("S2 tests/_thirteen-random.ts（1 萬局）：");
await import("../_thirteen-random");
if (!ok) process.exit(1);
