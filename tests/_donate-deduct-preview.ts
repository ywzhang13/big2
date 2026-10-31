// 記一筆的抵扣預覽（前端 deductPreview）要和後端同一個公式（老闆 2026-10-31：剩的繼續欠、多的算打賞、一次 NT$10）
//   小宜規格 v2 3.9 的 5 種情況＋邊界
import { deductPreview } from "../lib/mahjong/zimoFxClient";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
eq(deductPreview(8, 50), { deducted: 5, remaining: 3, tip: 0 }, "D1 部分：應斗 80 斗 50 → 抵 5 次、剩 3 次");
eq(deductPreview(8, 55), { deducted: 5, remaining: 3, tip: 5 }, "D2 有零頭：應斗 80 斗 55 → 抵 5 次、剩 3 次、打賞 5");
eq(deductPreview(8, 80), { deducted: 8, remaining: 0, tip: 0 }, "D3 剛好：應斗 80 斗 80 → 歸零");
eq(deductPreview(8, 500), { deducted: 8, remaining: 0, tip: 420 }, "D4 超過：應斗 80 斗 500 → 歸零、打賞 420");
eq(deductPreview(0, 200), { deducted: 0, remaining: 0, tip: 200 }, "D5 沒有應斗：斗 200 → 全部打賞");
eq(deductPreview(17, 100), { deducted: 10, remaining: 7, tip: 0 }, "D6 老柯文件的例子：17 次斗 100 → 抵 10、剩 7");
eq(deductPreview(3, 9), { deducted: 0, remaining: 3, tip: 9 }, "D7 不滿 10 元：一次都抵不到，全部算打賞");
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
