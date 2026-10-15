// 上線「麻將一律要登入」時關掉上線前就有的麻將房（說明見 lib/records/legacy.ts）。
//
// 先列出（不改任何東西）：
//   node --env-file=.env.local --import ./scripts/ts-register.mjs scripts/close-legacy-mahjong-rooms.ts --before <新版上線的時間>
// 確認沒有人在打之後執行：
//   同上再加 --execute
// 清單裡有「可能有人在打」的房時，--execute 會拒絕；確定要關就再加 --force。
// --before：新版部署 Ready 的時間（ISO，例如 2026-10-16T10:30:00Z）；只看這之前建的房。
import { closeLegacyMahjongRooms, findLegacyMahjongRooms, formatLegacyReport } from "../lib/records/legacy";

const args = process.argv.slice(2);
const before = args[args.indexOf("--before") + 1];
if (!args.includes("--before") || !before || Number.isNaN(Date.parse(before))) {
  console.error("請用 --before <ISO 時間> 指定新版上線的時間，例如 --before 2026-10-16T10:30:00Z");
  process.exit(2);
}
const rooms = await findLegacyMahjongRooms(new Date(before).toISOString());
console.log(formatLegacyReport(rooms));

if (!args.includes("--execute")) {
  console.log("\n（只列出，沒有改任何東西。確認沒人在打後加 --execute 執行）");
  process.exit(0);
}
const result = await closeLegacyMahjongRooms(rooms, { force: args.includes("--force") });
if (result.refused) {
  console.log("\n⛔ 有可能有人在打的舊房，沒有執行。確認後要關就加 --force");
  process.exit(1);
}
console.log(`\n✅ 已關閉 ${result.closed.length} 間：${result.closed.join("、") || "（無）"}`);
if (result.skipped.length > 0) console.log(`⚠️ 跳過 ${result.skipped.length} 間（刪除前房間有新動作或資料庫錯誤）：${result.skipped.join("、")}`);
