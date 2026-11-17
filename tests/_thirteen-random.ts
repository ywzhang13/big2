// 十三支計分引擎：隨機牌局（固定亂數種子，每次跑都一樣）。常規 npm test 跑 1,000 局；
//   1 萬局是慢測（npm run test:slow 會設 THIRTEEN_RANDOM_N=10000 再跑這支），改到排牌邏輯時要跑（阿哲 2026-11-18 裁定）。
//   每局：65 張不重複也不遺漏（4 家各 13＋剩 13）；四家自動排牌都不倒水、都通過送出檢查；四家總分 0；
//   另外隨機切三道（不一定合法）檢查倒水判斷和送出檢查一致；壞的送出（重複 id、別人的牌、張數錯）一定被擋。
import { deal } from "../lib/thirteen/cards";
import { autoArrange, checkArrangement, validateSubmission } from "../lib/thirteen/arrange";
import { scoreRound, revealOrder } from "../lib/thirteen/score";
import { CAT } from "../lib/thirteen/hand";

let seed = 13131313;
const rng = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const N = Number(process.env.THIRTEEN_RANDOM_N ?? 1000);
// 局數一定要是正整數：負數、0、空字串、非數字、小數、無限大都直接失敗，不要跑 0 局卻顯示全綠（審伯 2026-11-18 建議）
if (!Number.isSafeInteger(N) || N <= 0) { console.log(`❌ THIRTEEN_RANDOM_N 要是正整數，收到「${process.env.THIRTEEN_RANDOM_N}」`); process.exit(1); }
const fails: string[] = [];
let badCards = 0, fouled = 0, rejected = 0, nonZero = 0, homeRuns = 0, guns = 0, fiveKinds = 0, randomFoul = 0, mismatch = 0, badSubmitLeak = 0;
const ids = (xs: { id: string }[]) => xs.map((c) => c.id);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const { hands, rest } = deal(rng);
  const all = [...hands.flat(), ...rest].map((c) => c.id);
  if (all.length !== 65 || new Set(all).size !== 65 || hands.some((h) => h.length !== 16) || rest.length !== 1) badCards++; // 2026-11-18 每人 16 張、剩 1 張
  const arr = hands.map(autoArrange);
  arr.forEach((a, s) => {
    if (!checkArrangement(a).ok) fouled++;
    const v = validateSubmission(hands[s], { front: ids(a.front), middle: ids(a.middle), back: ids(a.back) });
    if (!v.ok) rejected++;
    const used = [...ids(a.front), ...ids(a.middle), ...ids(a.back)];
    if (new Set(used).size !== 13 || used.some((id) => !hands[s].some((c) => c.id === id))) badCards++;
    if (a.back.length === 5 && checkArrangement(a).ok && (checkArrangement(a) as { values: { back: { cat: number } } }).values.back.cat === CAT.FIVE_KIND) fiveKinds++;
  });
  const r = scoreRound(arr);
  if (r.totals.reduce((x, y) => x + y, 0) !== 0) nonZero++;
  if (r.homeRun !== null) homeRuns++;
  guns += r.pairs.filter((p) => p.gunner !== null).length;
  const order = revealOrder(arr);
  for (const row of ["front", "middle", "back"] as const) if (order[row].flat().sort().join() !== "0,1,2,3") mismatch++;

  // 隨機切三道：倒水判斷和送出檢查要一致
  const h = [...hands[0]].sort(() => rng() - 0.5);
  const rand = { front: h.slice(0, 3), middle: h.slice(3, 8), back: h.slice(8) };
  const c = checkArrangement(rand);
  const v = validateSubmission(hands[0], { front: ids(rand.front), middle: ids(rand.middle), back: ids(rand.back) });
  if (!c.ok) randomFoul++;
  if (c.ok !== v.ok) mismatch++;
  // 壞的送出一定擋：重複 id、拿別人的牌、張數錯
  const good = { front: ids(arr[0].front), middle: ids(arr[0].middle), back: ids(arr[0].back) };
  const dup = validateSubmission(hands[0], { ...good, front: [good.front[0], good.front[0], good.front[2]] });
  const steal = validateSubmission(hands[0], { ...good, back: [...good.back.slice(0, 4), hands[1][0].id] });
  const size = validateSubmission(hands[0], { ...good, front: good.front.slice(0, 2) });
  if (dup.ok || steal.ok || size.ok || (!dup.ok && dup.error !== "duplicate_card") || (!steal.ok && steal.error !== "not_your_card") || (!size.ok && size.error !== "bad_size")) badSubmitLeak++;
}
const ms = Date.now() - t0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) fails.push(msg);
}
check(badCards === 0, `${N} 局：65 張不重複也不遺漏（每家 16、剩 1），自動排牌用的 13 張都是自己的牌（問題 ${badCards}）`);
check(fouled === 0 && rejected === 0, `${N * 4} 手自動排牌：倒水 ${fouled} 手、送出檢查不通過 ${rejected} 手`);
check(nonZero === 0, `${N} 局四家總分都是 0（不是 0 的 ${nonZero} 局）`);
check(mismatch === 0, `亮牌順序每道剛好 4 家各一次；隨機切法的倒水判斷和送出檢查一致（不一致 ${mismatch}）`);
check(badSubmitLeak === 0, `壞的送出全部擋下：重複 id → duplicate_card、別人的牌 → not_your_card、張數錯 → bad_size（漏擋 ${badSubmitLeak}）`);
check(randomFoul > N / 2, `隨機切三道大多會倒水，確認倒水檢查有在作用（${randomFoul}／${N}）`);
console.log(`統計：打槍 ${guns} 組、全壘打 ${homeRuns} 局、尾道五龍 ${fiveKinds} 手；耗時 ${ms} ms`);
if (fails.length) process.exit(1);
