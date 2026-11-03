// 收掉 Web Animation（記憶體累積修正 2026-11-04）：iOS Safari 要連 effect、timeline 一起切斷才回收得掉，少一項就又會累積，所以要測
import { disposeAnim } from "../components/mahjong/fxParts";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

let cancels = 0;
const a = { effect: {}, timeline: {}, cancel() { cancels++; check(this.effect !== null && this.timeline !== null, "D1 先取消、才切斷（否則元素停不回原樣）"); } };
disposeAnim(a as unknown as Animation);
check(cancels === 1, "D2 有取消動畫");
check(a.effect === null, "D3 切斷 effect");
check(a.timeline === null, "D4 切斷 timeline");

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
