// 斗內金額（components/mahjong/MjDonate.tsx）：自摸次數 × 10（老闆 2026-10-21，原本固定 NT$50）。
// 卡片按鈕「斗內給阿瑋．NT$…」和感謝訊息「歡迎使用 LINE Pay 贊助阿瑋 NT$…」都用 donateAmount。
import { donateAmount } from "../components/mahjong/MjDonate";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

for (const [n, want] of [[1, 10], [3, 30], [7, 70], [12, 120]] as const) {
  ok(donateAmount(n) === want, `D${n} 自摸 ${n} 次 → NT$${donateAmount(n)}（應為 ${want}）`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
