// 十三支亮牌預覽的牌局（強制觸發各種特效用，假資料、不碰資料庫）：自己（0 號）的三墩固定，其他三家從剩下的牌用固定種子洗、autoArrange 排，
// 找到第一個符合條件的種子（例如「自己打槍一家、沒有全壘打」）。結果用真的計分引擎算（scoreRound、revealOrder）
import { autoArrange, buildDeck, CAT_NAME, parseCards, revealOrder, scoreRound, type Arrangement } from "@/lib/thirteen";
import { handStats, insideHomeRunOf } from "@/lib/thirteen/flow";
import { gunsOf, patternFx, ROWS, type ThReveal } from "@/components/thirteen/revealTimeline";

type Case = { me: [string, string, string]; want: (rv: ThReveal) => boolean };
const hasFx = (rv: ThReveal, fx: string) => rv.arrangements.some((_, s) => ROWS.some((r) => patternFx(r, rv.result.values[s][r]) === fx));
export const CASES: Record<string, Case> = {
  // 一般局：沒有特效牌型、沒有打槍
  normal: { me: ["AS KH 2D", "3C 3D 7H 8S 9C", "5S 5H JD JC 4C"], want: (rv) => !gunsOf(rv.result).length && ROWS.every((r) => rv.arrangements.every((_, s) => !patternFx(r, rv.result.values[s][r]))) },
  chongsan: { me: ["8C 8D 8H", "2C 3D 4H 5S 6C", "4C 9C TC JC KC"], want: (rv) => hasFx(rv, "chongsan") && rv.result.homeRun === null },
  tiezhi: { me: ["AS KH QD", "7S 7H 7D 4S 4H", "9S 9H 9D 9C 2D"], want: (rv) => hasFx(rv, "tiezhi") && rv.result.homeRun === null },
  tonghuashun: { me: ["AD KS 2C", "TS TH TD 3S 3H", "5H 6H 7H 8H 9H"], want: (rv) => hasFx(rv, "tonghuashun") && rv.result.homeRun === null },
  wulong: { me: ["QS JH 3D", "KS KH KD 2S 2H", "AS AS AH AD AC"], want: (rv) => hasFx(rv, "wulong") && rv.result.homeRun === null },
  // 牌型特效的幾局都排除全壘打（一次只看一種）；打槍：自己三墩全贏某一家，但沒有全壘打
  gun: { me: ["JS JH 4D", "2C 5C 7C 9C QC", "8S 8H 8D 6C 6D"], want: (rv) => gunsOf(rv.result).some((g) => g.from === 0) && rv.result.homeRun === null },
  // 全壘打：衝三＋中墩鐵支＋尾墩同花順，三家都打槍
  homerun: { me: ["QS QH QD", "KS KH KD KC 3S", "4H 5H 6H 7H 8H"], want: (rv) => rv.result.homeRun === 0 },
  // 場內全壘打（老闆 2026-11-28）：自己被另外三家都打槍、沒有全壘打；ihrhr＝同一局也有人全壘打（先播場內全壘打、再播全壘打）
  insidehr: { me: ["2S 3H 5D", "2C 3D 6S 8H TC", "4D 5S 7C 9H JD"], want: (rv) => insideHomeRunOf(rv.result) === 0 && rv.result.homeRun === null },
  ihrhr: { me: ["2S 3H 5D", "2C 3D 6S 8H TC", "4D 5S 7C 9H JD"], want: (rv) => insideHomeRunOf(rv.result) === 0 && rv.result.homeRun !== null },
  // 同花一對（老闆 2026-11-18：比同花大，要寫「同花一對」）：自己中墩黑桃 9 9 K 5 3（加一色有兩張黑桃 9）
  flushpair: { me: ["AD KC 2H", "9S 9S KS 5S 3S", "JD JC JH 4C 4D"], want: (rv) => CAT_NAME[rv.result.values[0].middle.cat] === "同花一對" && rv.result.homeRun === null },
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildCase(name: string): ThReveal | null {
  const c = CASES[name];
  if (!c) return null;
  const used = new Set<string>();
  const [front, middle, back] = c.me.map((t) => parseCards(t, used));
  const mine: Arrangement = { front, middle, back };
  const ids = new Set([...front, ...middle, ...back].map((x) => x.id));
  const rest = buildDeck().filter((x) => !ids.has(x.id));
  for (let seed = 1; seed < 2000; seed++) {
    const rnd = seeded(seed);
    const deck = [...rest];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const arrangements = [mine, autoArrange(deck.slice(0, 13)), autoArrange(deck.slice(13, 26)), autoArrange(deck.slice(26, 39))];
    const result = scoreRound(arrangements);
    const rv: ThReveal = { handNo: 1, order: revealOrder(arrangements), arrangements, autoArranged: [], result, stats: handStats(result), playerScores: result.totals, over: false,
      revealedAt: null, settleAt: null, nextHandAt: null }; // 明細用伺服器同一個 handStats；時間由預覽頁自己給
    if (c.want(rv)) return rv;
  }
  return null;
}
