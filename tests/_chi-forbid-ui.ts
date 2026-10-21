// 吃牌限制的前端（lib/mahjong/chiForbid.ts、components/mahjong/MjHand.tsx；老闆 2026-10-21）：
//   伺服器給的 chiForbidden（牌型字串，例如 "s5"）→ 手牌裡那幾張變暗、標記不能打；只在輪到我打牌時；沒有限制就和原本一樣
//   （伺服器端的規則測試在 tests/_chi-forbid.ts）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chiKinds, isChiForbidden } from "../lib/mahjong/chiForbid";
import MjHand from "../components/mahjong/MjHand";
import type { Tile } from "../lib/mahjong/tiles";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const T = (id: number, suit: Tile["suit"], rank: number): Tile => ({ id, suit, rank, display: `${rank}` });
// 老闆的例子：手上六七八條，用六、七條吃上家的五條 → 剩下的手牌裡有八條、五條（另一張）、九條、三萬
const hand = [T(1, "s", 8), T(2, "s", 5), T(3, "s", 9), T(4, "m", 3)];
const forbidden = ["s5", "s8"];

ok(chiKinds(["s5", "s8"]).join() === "s5,s8" && chiKinds(undefined).length === 0 && chiKinds("s5").length === 0 && chiKinds(["s5", 3, null]).join() === "s5", "U1 chiForbidden：只收字串陣列，其他格式當沒有限制");
ok(isChiForbidden(hand[0], forbidden) && isChiForbidden(hand[1], forbidden) && !isChiForbidden(hand[2], forbidden) && !isChiForbidden(hand[3], forbidden), "U2 五條、八條不能打；九條、三萬可以打");
ok(!isChiForbidden(hand[0], []), "U3 沒有限制（空陣列）：都可以打");

const html = (canDiscard: boolean, kinds: string[]) => renderToStaticMarkup(createElement(MjHand, { tiles: hand, canDiscard, onDiscard: () => {}, chiForbidden: kinds }));
const marked = (h: string) => (h.match(/data-chi-forbidden="1"/g) ?? []).length;
const dimmed = (h: string) => (h.match(/opacity:0\.35/g) ?? []).length;
const h1 = html(true, forbidden);
ok(marked(h1) === 2 && dimmed(h1) === 2, `U4 輪到我打牌、剛吃完：兩張不能打的牌變暗（標記 ${marked(h1)}、變暗 ${dimmed(h1)}）`);
const h2 = html(false, forbidden);
ok(marked(h2) === 0 && dimmed(h2) === 0, "U5 不是我打牌的時候：不變暗（照常能點牌查場上同一種牌）");
const h3 = html(true, []);
ok(marked(h3) === 0 && dimmed(h3) === 0, "U6 打出一張之後限制清掉：手牌恢復正常");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
