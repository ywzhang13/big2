// 觸控裝置特效零件的可見時段（iPhone 閃退修正 2026-11-04）：時段外隱藏、不佔圖層緩衝；算錯會讓零件該出現時看不到，所以要測
import { partWindow, type Pose } from "../components/mahjong/fxParts";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const p = (o: number): Pose => ({ x: 0, y: 0, s: 1, o });

let w = partWindow([[0, p(0)], [1000, p(0)], [1200, p(1)], [1500, p(1)], [1800, p(0)]], 2600);
check(w?.show === 850 && w.hide === 1800, "W1 淡入前一個姿勢提早 150ms 露出，淡出完才隱藏");
w = partWindow([[0, p(1)], [500, p(0)]], 2600);
check(w?.show === 0 && w.hide === 500, "W2 一開始就看得到：不用等");
w = partWindow([[0, p(0)], [1800, p(0)], [2000, p(1)]], 2600);
check(w?.show === 1650 && w.hide === 2600, "W3 到最後都看得到：播完才隱藏");
w = partWindow([[0, p(0)], [100, p(1)], [200, p(0)], [900, p(0.5)], [1000, p(0)]], 2600);
check(w?.show === 0 && w.hide === 1000, "W4 中間透明又出現：整段都留著，不會中途消失");
check(partWindow([[0, p(0)], [100, p(0)]], 2600) === null, "W5 全程透明：回 null");

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
