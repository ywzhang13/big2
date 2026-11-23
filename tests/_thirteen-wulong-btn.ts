// 十三支理牌快捷鈕「五龍」（老馬 2026-11-23，老闆：按鈕沒有做五龍的）
//   W1 SHORTCUTS 最前面是五龍、排在同花順前面
//   W2 手上有五張同點數 → 找到 1 組，就是那五張
//   W3 六張同點數（測試造的，正常牌只有五張）→ 去重後只輪一個核心
//   W4 兩組五龍 → 兩組都找到，最大的在前
//   W5 沒有五張同點數 → 空陣列（按鈕不能按）
import { makeCard, parseCards, type Card } from "../lib/thirteen";
import { findCombos, SHORTCUTS } from "../components/thirteen/shortcuts";

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const ids = (cs: Card[]) => cs.map((c) => c.id).sort().join(",");

ok(SHORTCUTS[0]?.kind === "fiveKind" && SHORTCUTS[0]?.label === "五龍" && SHORTCUTS[1]?.kind === "straightFlush",
  "W1 快捷鈕最前面是「五龍」，接著是同花順");

// 五張 A（四花色＋第二副黑桃）＋ 8 張雜牌
const fiveA = parseCards("AS AS AH AD AC");
const hand = [...fiveA, ...parseCards("KC QD 9S 7H 5C 4D 3S 2H")];
let r: Card[][] = [];
try { r = findCombos(hand, "fiveKind"); } catch { r = []; }
ok(r.length === 1 && ids(r[0]) === ids(fiveA), "W2 有五張同點數：找到 1 組，就是那五張 A");

const six = [...parseCards("9S 9S 9H 9D 9C"), makeCard("H", 9, 2), ...parseCards("KC QD 7S 5H 4C 3D 2S")];
try { r = findCombos(six, "fiveKind"); } catch { r = []; }
ok(r.length === 1 && r[0].length === 5 && r[0].every((c) => c.rank === 9), "W3 六張同點數：去重後只輪一個核心（一組五張 9）");

const two = [...parseCards("KS KS KH KD KC"), ...parseCards("5S 5S 5H 5D 5C"), ...parseCards("AH 3D 2C")];
try { r = findCombos(two, "fiveKind"); } catch { r = []; }
ok(r.length === 2 && r.every((g) => g.length === 5) && r[0].every((c) => c.rank === 13) && r[1].every((c) => c.rank === 5), "W4 兩組五龍：兩組都找到，K 在前、5 在後");

const none = parseCards("AS AH AD AC KS KH KD QS QH JS TS 9S 8S");
try { r = findCombos(none, "fiveKind"); } catch { r = [[]]; }
ok(Array.isArray(r) && r.length === 0, "W5 沒有五張同點數（只有鐵支）：空陣列，按鈕不能按");

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
