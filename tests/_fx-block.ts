// 名牌選單的「關閉互動」（lib/mahjong/fx/block.ts；老闆 2026-10-21）：
//   不播某位玩家丟給自己的 5 種特效；只在這一房有效（房間、自己的玩家 id、座位一變就清空）；
//   別人之間互丟、自己丟出去的、沒關掉的玩家，都照常播
import { bindFxBlockRoom, isFxBlocked, setFxBlocked, shouldPlayFx } from "../lib/mahjong/fx/block";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const ME = 0;
const fx = (fromId: string, to: number) => ({ fromId, to });

bindFxBlockRoom("room-A|p0|0");
ok(shouldPlayFx(fx("p1", ME), ME), "B1 還沒關閉互動：阿明丟給我的照常播");
setFxBlocked("p1", true);
ok(!shouldPlayFx(fx("p1", ME), ME), "B2 關閉阿明的互動：阿明丟給我的不播（動畫和聲音都不播）");
ok(shouldPlayFx(fx("p2", ME), ME), "B3 沒關的阿華丟給我的：照常播");
ok(shouldPlayFx(fx("p1", 2), ME) && shouldPlayFx(fx("p0", 1), ME), "B4 阿明丟給別人、我丟給阿明：照常播（只擋丟給自己的）");
setFxBlocked("p1", false);
ok(shouldPlayFx(fx("p1", ME), ME), "B5 再把開關關掉：阿明丟給我的又照常播");
setFxBlocked("p1", true);
bindFxBlockRoom("room-A|p0|0");
ok(isFxBlocked("p1"), "B6 同一房、同一個座位重複綁定：不清空");
bindFxBlockRoom("room-B|p0|0");
ok(!isFxBlocked("p1") && shouldPlayFx(fx("p1", ME), ME), "B7 換房（同一個玩家 id、同一個座位）：清空，阿明的特效恢復播放");
setFxBlocked("p1", true);
bindFxBlockRoom("room-B|p0|2");
ok(!isFxBlocked("p1"), "B8 同一房換了座位（重新入座）：也清空");
setFxBlocked("p1", true);
bindFxBlockRoom(null);
ok(!isFxBlocked("p1"), "B9 離開牌桌：清空");
setFxBlocked("p1", true);
ok(!isFxBlocked("p1"), "B10 不在房裡時按開關：不記（不會帶到下一房）");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
