// 十三支 v4 以後：黑桃同花順大於鐵支（老闆 2026-11-23）
//   大小：五龍 > 彩金鐵支 > 非黑桃同花順 > 黑桃同花順 > 鐵支 > 彩金葫蘆 > 葫蘆 > …；加分 bonusOf 不變；legacy 舊規則不受影響
//   S1 同一道：黑桃同花順贏鐵支（A 的鐵支也輸給最小的黑桃同花順）
//   S2 黑桃同花順輸給非黑桃同花順（最小的非黑桃同花順贏最大的黑桃同花順）
//   S3 黑桃同花順輸給彩金鐵支
//   S4 倒水：中墩黑桃同花順＋尾墩鐵支要算倒水（v4）；反過來（中鐵支＋尾黑桃同花順）合法
//   S5 推薦排法：同時有黑桃同花順和鐵支 → 尾墩黑桃同花順、中墩鐵支
//   S6 舊規則房：黑桃的同花順就是同花順，照樣大於鐵支、中墩同花順＋尾墩鐵支照樣倒水
import { makeCard, type Card } from "../lib/thirteen/cards";
import { CAT, compareValue, evalFive, evalThree, type HandRule } from "../lib/thirteen/hand";
import { autoArrange, checkArrangement } from "../lib/thirteen/arrange";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const R: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
let n = 0;
const c = (s: string): Card => makeCard(s[0] as Card["suit"], R[s.slice(1)] ?? Number(s.slice(1)), (n++ % 2 + 1) as 1 | 2);
const cards = (s: string) => s.split(" ").map(c);
const hand = (f: string, m: string, b: string) => ({ front: cards(f), middle: cards(m), back: cards(b) });
const NOL: HandRule = { lucky: null }, L5: HandRule = { lucky: 5 };
const v = (s: string, r: HandRule = NOL) => evalFive(cards(s), r);
const cmp = (a: string, b: string, r: HandRule = NOL) => Math.sign(compareValue(v(a, r), v(b, r)));

const SPADE_LOW = "SA S2 S3 S4 S5", SPADE_MID = "S5 S6 S7 S8 S9", SPADE_HIGH = "ST SJ SQ SK SA";
// S1
eq([v(SPADE_MID).cat, v("C9 D9 H9 S9 C3").cat, cmp(SPADE_MID, "C9 D9 H9 S9 C3"), cmp(SPADE_LOW, "CA DA HA SA C3"), cmp("CA DA HA SA C3", SPADE_LOW)],
  [CAT.SPADE_STRAIGHT_FLUSH, CAT.FOUR_KIND, 1, 1, -1],
  "S1 同一道：黑桃同花順贏鐵支；最小的黑桃同花順（A2345）也贏 A 的鐵支");
// S2
eq([v("H2 H3 H4 H5 H6").cat, cmp(SPADE_HIGH, "HA H2 H3 H4 H5"), cmp(SPADE_MID, "D5 D6 D7 D8 D9")],
  [CAT.STRAIGHT_FLUSH, -1, -1],
  "S2 黑桃同花順輸給非黑桃同花順：最大的黑桃同花順輸給最小的紅心同花順；同樣 5～9 也輸");
// S3
eq([v("C5 D5 H5 S5 C2", L5).cat, cmp(SPADE_HIGH, "C5 D5 H5 S5 C2", L5), cmp(SPADE_HIGH, "C5 D5 H5 S5 C2", NOL)],
  [CAT.LUCKY_FOUR, -1, 1],
  "S3 黑桃同花順輸給彩金鐵支（彩金 5 的 5555）；沒有彩金牌時 5555 只是鐵支，黑桃同花順贏");
// S4
{
  const r = (x: ReturnType<typeof checkArrangement>) => (x.ok ? "ok" : x.error);
  const a = hand("C2 D3 H7", SPADE_MID, "C9 D9 H9 S9 C3"); // 中黑桃同花順、尾鐵支
  const b = hand("C2 D3 H7", "C9 D9 H9 S9 C3", SPADE_MID); // 中鐵支、尾黑桃同花順
  eq([r(checkArrangement(a, NOL)), r(checkArrangement(a, L5)), r(checkArrangement(b, NOL))], ["foul_middle_back", "foul_middle_back", "ok"],
    "S4 倒水：中墩黑桃同花順＋尾墩鐵支是倒水（有沒有彩金牌都是）；中墩鐵支＋尾墩黑桃同花順合法");
}
// S5
{
  const h = cards("S5 S6 S7 S8 S9 CA DA HA SA C2 D3 H7 CJ");
  const a = autoArrange(h, NOL);
  eq([evalFive(a.back, NOL).cat, evalFive(a.middle, NOL).cat, evalThree(a.front, NOL).cat, checkArrangement(a, NOL).ok],
    [CAT.SPADE_STRAIGHT_FLUSH, CAT.FOUR_KIND, CAT.HIGH, true],
    "S5 推薦排法：同時有黑桃同花順和 A 鐵支 → 尾墩黑桃同花順、中墩鐵支（照新大小，不倒水）");
}
// S6
{
  const a = hand("C2 D3 H7", SPADE_MID, "C9 D9 H9 S9 C3");
  eq([v(SPADE_MID, "legacy").cat, cmp(SPADE_LOW, "CA DA HA SA C3", "legacy"), checkArrangement(a, "legacy").ok],
    [CAT.STRAIGHT_FLUSH, 1, false],
    "S6 舊規則房不變：黑桃的同花順就是同花順、大於鐵支，中墩同花順＋尾墩鐵支倒水");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
