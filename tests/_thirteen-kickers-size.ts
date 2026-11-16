// 十三支計分引擎：補小測〈測試覆蓋審查〉留下的兩類細項（老柯 2026-11-16）。原本這兩類都擠在 _thirteen-coverage.ts 的同一個斷言裡，
// 這裡拆成每一種情況各自一個斷言，任何一種壞掉都會單獨亮紅燈。
//   A. 同牌型比到後面幾張才分勝負：一對、同花一對的第一和第二踢腳，三條的第一踢腳，同花和烏龍的第 2～5 張
//   B. 送出檢查：頭／中／尾道各自多一張、少一張、空陣列 → bad_size 和中文提示
// A 的每一組：兩手只差在「要測的那一張」，前面各張都一樣；雙向都比（a>b、b<a），再確認把那一張換成一樣大時就打平，
// 證明勝負真的是由那一張決定。
// 牌的來源：一對、同花、烏龍兩手共用同一個 used（同一局裡真的拿得到）；同花一對、三條兩手各用自己的 used——
// 65 張裡同點數只有 5 張、同點數黑桃只有 2 張，同一局裡兩家不可能都有同點數的三條或同點數的黑桃對，這裡只驗引擎的比較邏輯。
import { parseCards, type Card } from "../lib/thirteen/cards";
import { validateSubmission } from "../lib/thirteen/arrange";
import { CAT, compareValue, evalFive, evalThree, type HandValue } from "../lib/thirteen/hand";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const sign = (n: number) => Math.sign(n);

/** 兩手（shared＝同一局拿得到，共用 used）比較：[a 的牌型, b 的牌型, a 比 b, b 比 a, a 比「把決勝張換成一樣」的 tie] */
function duel(eval_: (c: Card[]) => HandValue, a: string, b: string, tie: string, shared: boolean) {
  const used = new Set<string>();
  const va = eval_(parseCards(a, used));
  const vb = eval_(parseCards(b, shared ? used : new Set()));
  const vt = eval_(parseCards(tie, new Set()));
  return [va.cat, vb.cat, sign(compareValue(va, vb)), sign(compareValue(vb, va)), sign(compareValue(va, vt))];
}

// ===== A. 踢腳／中間各張決定勝負 =====
const CASES: [string, (c: Card[]) => HandValue, number, string, string, string, boolean][] = [
  // [說明, 評估函式, 牌型, 大的那手, 小的那手, 和大的那手打平的一手（決勝張換成一樣大、其他花色不同）, 同一局拿得到]
  ["一對（中尾道）：對子相同，第一踢腳 K＞Q 決定", evalFive, CAT.PAIR, "9H 9D KC 5S 3H", "9C 9S QD 5H 3D", "9H 9D KS 5C 3C", true],
  ["一對（中尾道）：對子、第一踢腳相同，第二踢腳 7＞6 決定", evalFive, CAT.PAIR, "9H 9D KC 7S 3H", "9C 9S KD 6H 3D", "9H 9D KS 7C 3C", true],
  ["一對（頭道三張）：對子相同，第一踢腳 K＞Q 決定", evalThree, CAT.PAIR, "9H 9D KC", "9C 9S QD", "9H 9D KS", true],
  ["同花一對：對子相同，第一踢腳 K＞Q 決定", evalFive, CAT.FLUSH_PAIR, "9S 9S KS 5S 3S", "9S 9S QS 5S 3S", "9S 9S KS 5S 3S", false],
  ["同花一對：對子、第一踢腳相同，第二踢腳 7＞6 決定", evalFive, CAT.FLUSH_PAIR, "9S 9S KS 7S 3S", "9S 9S KS 6S 3S", "9S 9S KS 7S 3S", false],
  ["三條（中尾道）：三條相同，第一踢腳 K＞Q 決定", evalFive, CAT.THREE_KIND, "9H 9D 9C KS 3H", "9S 9S 9H QD 3D", "9H 9D 9C KH 3C", false],
  ["同花：第 1 張相同，第 2 張 Q＞J 決定", evalFive, CAT.FLUSH, "AH QH 8H 5H 2H", "AD JD 8D 5D 2D", "AC QC 8C 5C 2C", true],
  ["同花：前 2 張相同，第 3 張 9＞8 決定", evalFive, CAT.FLUSH, "AH QH 9H 5H 2H", "AD QD 8D 5D 2D", "AC QC 9C 5C 2C", true],
  ["同花：前 3 張相同，第 4 張 6＞5 決定", evalFive, CAT.FLUSH, "AH QH 9H 6H 2H", "AD QD 9D 5D 2D", "AC QC 9C 6C 2C", true],
  ["同花：前 4 張相同，最後一張 3＞2 決定", evalFive, CAT.FLUSH, "AH QH 9H 6H 3H", "AD QD 9D 6D 2D", "AC QC 9C 6C 3C", true],
  ["烏龍（中尾道）：第 1 張相同，第 2 張 Q＞J 決定", evalFive, CAT.HIGH, "AH QD 8C 5S 2H", "AD JC 8H 5H 2D", "AC QH 8D 5D 2C", true],
  ["烏龍（中尾道）：前 2 張相同，第 3 張 9＞8 決定", evalFive, CAT.HIGH, "AH QD 9C 5S 2H", "AD QC 8H 5H 2D", "AC QH 9D 5D 2C", true],
  ["烏龍（中尾道）：前 3 張相同，第 4 張 6＞5 決定", evalFive, CAT.HIGH, "AH QD 9C 6S 2H", "AD QC 9H 5H 2D", "AC QH 9D 6D 2C", true],
  ["烏龍（中尾道）：前 4 張相同，最後一張 3＞2 決定", evalFive, CAT.HIGH, "AH QD 9C 6S 3H", "AD QC 9H 6H 2D", "AC QH 9D 6D 3C", true],
  ["烏龍（頭道三張）：第 1 張相同，第 2 張 Q＞J 決定", evalThree, CAT.HIGH, "AH QD 2C", "AD JC 2H", "AC QH 2D", true],
  ["烏龍（頭道三張）：前 2 張相同，最後一張 3＞2 決定", evalThree, CAT.HIGH, "AH QD 3C", "AD QC 2H", "AC QH 3D", true],
];
for (const [msg, ev, cat, a, b, tie, shared] of CASES) {
  eq(duel(ev, a, b, tie, shared), [cat, cat, 1, -1, 0], `${msg}（${a} ＞ ${b}；換成一樣大就打平）`);
}

// ===== B. 送出檢查：每一道各自多一張、少一張、空陣列 =====
{
  // 發給這位玩家 14 張（多出 1 張是「他自己的牌」），讓「多一張」只錯在張數，不會被 not_your_card 先擋下
  const pick = (ranks: string) => parseCards(ranks);
  const front = pick("2H 3D 4C"), middle = pick("6H 6D 8C 9S TH"), back = pick("QH QD QC 5S 5H"), spare = pick("7C");
  const dealt = [...front, ...middle, ...back, ...spare];
  const ids = (xs: Card[]) => xs.map((c) => c.id);
  const good = { front: ids(front), middle: ids(middle), back: ids(back) };
  const base = validateSubmission(dealt.slice(0, 13), good);
  eq(base.ok, true, "送出檢查基準：頭 3、中 5、尾 5、不倒水 → 通過（下面每一項都只改一道的張數）");

  const MSG = "頭道要 3 張、中道和尾道各 5 張";
  const rowName = { front: "頭道", middle: "中道", back: "尾道" } as const;
  for (const row of ["front", "middle", "back"] as const) {
    const n = good[row].length;
    const variants: [string, string[]][] = [
      [`多一張（${n + 1} 張）`, [...good[row], spare[0].id]],
      [`少一張（${n - 1} 張）`, good[row].slice(0, -1)],
      ["空陣列（0 張）", []],
    ];
    for (const [label, cards] of variants) {
      const r = validateSubmission(dealt, { ...good, [row]: cards });
      eq(r.ok ? { ok: true } : { ok: false, error: r.error, message: r.message }, { ok: false, error: "bad_size", message: MSG },
        `送出檢查：${rowName[row]}${label}，其他兩道正確 → bad_size，提示「${MSG}」`);
    }
  }
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
