// 十三支亮牌到結算的時間、每局統計（阿哲 2026-11-18 拍板）。純函式，不連資料庫。
//   U1 亮牌演出長度（從開始比牌到結算面板出現）照小宜 v8-B 第 5 節（出牌放慢，2026-11-18）：
//      老闆 2026-11-18 定案（照參考影片，阿妍量測）：開始比牌 1.7 秒＋三墩各 6.0 秒（四家各出 1.5 秒、墩後不停）
//      ＋每個大牌多佔 0.3 秒＋每一槍 1.5 秒＋全壘打 3.2 秒＋結算面板前停 1.2 秒，即 20.9＋0.3×大牌＋1.5×槍＋3.2×全壘打。
//      案例：一般局 20.9 秒、一槍 22.4 秒、衝三＋尾墩鐵支（不打槍）21.5 秒、衝三＋尾墩鐵支＋三槍＋全壘打 29.2 秒
//   U2 隨機 2000 局：長度＝上面的 v8-B 公式（特效牌型、打槍組數、全壘打從結算結果另外數）；都不超過「最長演出」
//   U3 每局統計（每家）：墩分＋各特殊加分＋打槍分＋全壘打分＝這局總分；打槍、被打槍、全壘打、被全壘打的次數和結算結果一致
//   U4 特殊加分的項目名稱照 v5 結算明細：衝三、中墩鐵支、尾墩同花順…；拿到的是正、付的是負
import * as flow from "../lib/thirteen/flow";
import { buildDeck, parseCards, shuffle } from "../lib/thirteen/cards";
import { autoArrange, type Arrangement } from "../lib/thirteen/arrange";
import { bonusOf, ROWS, scoreRound, SCORING, type RoundResult } from "../lib/thirteen/score";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Stat = { rows: number; bonuses: { name: string; points: number }[]; guns: number; gunned: number; gunPoints: number; homeRun: boolean; homeRunned: boolean; homeRunPoints: number; total: number };
const f = flow as unknown as { revealDurationMs?: (r: RoundResult) => number; handStats?: (r: RoundResult) => Stat[]; NEXT_HAND_MAX_MS?: number; SETTLE_WAIT_MS?: number };
const dur = (r: RoundResult) => (f.revealDurationMs ? f.revealDurationMs(r) : null);
const arr = (front: string, middle: string, back: string): Arrangement => ({ front: parseCards(front), middle: parseCards(middle), back: parseCards(back) });

// U1：v8-B 的四個情況
{
  const SUITS = "SHDC";
  const rot = (ranks: string, k: number) => ranks.split(" ").map((r, j) => r + SUITS[(k + j) % 4]).join(" ");
  // 一般局：四家點數完全一樣、花色錯開（沒有同花、順子），每一墩都平手 → 沒有特效、沒有打槍
  const ties = [0, 1, 2, 3].map((k) => arr(rot("2 3 4", k), rot("5 6 7 8 T", k), rot("9 J Q K A", k)));
  // 一組打槍：只有 0 號三墩都贏 1 號，其他兩兩都有平手或互有輸贏
  const lv = { f1: "2C 3D 5H", f3: "2C 3D 6H", m1: "4C 5D 7H 8S 9C", m3: "4C 5D 7H 8S JC", b1: "6C 8D TH JS QC", b3: "6C 8D TH JS AC" };
  const oneGun = [arr(lv.f3, lv.m3, lv.b3), arr(lv.f1, lv.m1, lv.b1), arr(lv.f1, lv.m3, lv.b3), arr(lv.f3, lv.m1, lv.b1)];
  // v5 範例 11：0 號頭墩三條（衝三）、尾墩鐵支，三墩都贏另外三家（三組打槍＋全壘打）
  const big = [arr("QS QH QD", "KS KH KD 2C 2D", "9S 9H 9D 9C 3S"), ...[1, 2, 3].map((k) => arr(rot("2 3 4", k), rot("5 6 7 8 T", k), rot("6 8 J Q A", k)))];
  // 衝三＋尾墩鐵支、不打槍：0 號頭墩三條 Q、中墩三條 K、尾墩鐵支；另外三家中墩順子贏 0 號的中墩
  //   → 0 號對每一家都是兩贏一輸，另外三家彼此全平手，沒有打槍
  const fxNoGun = [arr("QS QH QD", "KS KH KD 2C 3D", "9S 9H 9D 9C 3S"), ...[1, 2, 3].map((k) => arr(rot("2 3 4", k), rot("5 6 7 8 9", k), rot("T J Q K A", k)))];
  const rs = [ties, oneGun, fxNoGun, big].map(scoreRound);
  const specialsOf = (r: RoundResult) => r.values.reduce((n, v) => n + ROWS.filter((row) => bonusOf(row, v[row]) > 0).length, 0);
  eq([rs.map(specialsOf), rs.map((r) => r.pairs.filter((p) => p.gunner !== null).length), rs.map((r) => r.homeRun), rs.map(dur)],
    [[0, 0, 2, 2], [0, 1, 0, 3], [null, null, null, 0], [20900, 22400, 21500, 29200]],
    "U1 亮牌演出長度（老闆定案新節奏）：一般局 20.9 秒、一槍 22.4 秒、衝三＋尾墩鐵支 21.5 秒、衝三＋尾墩鐵支＋三槍＋全壘打 29.2 秒");
  eq([f.SETTLE_WAIT_MS, f.NEXT_HAND_MAX_MS], [30000, 66700],
    "U1 結算面板出現後等 30 秒；亮牌到開下一局最長 66.7 秒（四家三墩都是特效牌型、六槍、全壘打）");
}

// U2、U3、U4：隨機 2000 局
{
  let seed = 1118; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let durBad = 0, overMax = 0, sumBad = 0, countBad = 0, nameBad = 0, guns = 0, homeRuns = 0, bonusSeen = 0;
  const NAMES = new Set(["衝三", "中墩鐵支", "中墩同花順", "中墩五龍", "尾墩鐵支", "尾墩同花順", "尾墩五龍"]);
  for (let g = 0; g < 2000; g++) {
    const d = shuffle(buildDeck(), rng);
    const r = scoreRound([0, 1, 2, 3].map((i) => autoArrange(d.slice(i * 16, i * 16 + 16))));
    const specials = r.values.reduce((n, v) => n + ROWS.filter((row) => bonusOf(row, v[row]) > 0).length, 0);
    const g6 = r.pairs.filter((p) => p.gunner !== null).length;
    guns += g6; if (r.homeRun !== null) homeRuns++;
    const expect = 20900 + specials * 300 + g6 * 1500 + (r.homeRun !== null ? 3200 : 0); // 老闆定案新節奏
    if (dur(r) !== expect) durBad++;
    if ((dur(r) ?? 0) + 30000 > (f.NEXT_HAND_MAX_MS ?? 0)) overMax++;
    const st = f.handStats ? f.handStats(r) : null;
    if (!st) { sumBad++; continue; }
    st.forEach((x, seat) => {
      const total = x.rows + x.bonuses.reduce((n, b) => n + b.points, 0) + x.gunPoints + x.homeRunPoints;
      if (total !== r.totals[seat] || x.total !== r.totals[seat]) sumBad++;
      const gunsBy = r.pairs.filter((p) => p.gunner === seat).length;
      const gunnedBy = r.pairs.filter((p) => p.gunner !== null && p.gunner !== seat && (p.a === seat || p.b === seat)).length;
      if (x.guns !== gunsBy || x.gunned !== gunnedBy || x.gunPoints !== (gunsBy - gunnedBy) * SCORING.GUN_PENALTY
        || x.homeRun !== (r.homeRun === seat) || x.homeRunned !== (r.homeRun !== null && r.homeRun !== seat)) countBad++;
      for (const b of x.bonuses) { bonusSeen++; if (!NAMES.has(b.name) || b.points === 0) nameBad++; }
    });
  }
  eq([durBad, overMax], [0, 0], "U2 隨機 2000 局：演出長度都等於新公式 20.9＋0.3×大牌＋1.5×槍＋3.2×全壘打（特效牌型、打槍組數、全壘打另外數），也都不超過最長演出＋30 秒");
  eq([sumBad, countBad, guns > 100, homeRuns > 0], [0, 0, true, true],
    `U3 隨機 2000 局（打槍 ${guns} 組、全壘打 ${homeRuns} 次）：每家「墩分＋特殊加分＋打槍分＋全壘打分」＝這局總分；打槍、被打槍、全壘打、被全壘打次數都和結算一致`);
  eq([bonusSeen > 0, nameBad], [true, 0], `U4 特殊加分項目（共 ${bonusSeen} 筆）名稱都是 v5 結算明細的名稱（衝三、中墩鐵支、尾墩同花順…），沒有 0 分的空項目`);
}

// U5 舊局（改新節奏之前就亮牌的局）：伺服器存的 settleAt／nextHandAt 照舊用，不會用新公式重算而提早或延後開局
{
  const g = flow as unknown as { revealPayload: (s: unknown) => { settleAt: number | null; nextHandAt: number | null }; shouldStartNext: (s: unknown, now: number) => boolean };
  const T = 1_800_000_000_000;
  const ties = [0, 1, 2, 3].map((k) => arr(["2S 3H 4D", "2H 3D 4C", "2D 3C 4S", "2C 3S 4H"][k], ["5S 6H 7D 8C TS", "5H 6D 7C 8S TH", "5D 6C 7S 8H TD", "5C 6S 7H 8D TC"][k], ["9S JH QD KC AS", "9H JD QC KS AH", "9D JC QS KH AD", "9C JS QH KD AC"][k]));
  const result = scoreRound(ties);
  const oldSettle = T + 12500, oldNext = oldSettle + 30000; // 舊公式（dd0602a，每家 0.6 秒）一般局 12.5 秒
  const s = { phase: "revealed", handNo: 1, settings: { totalHands: 8 }, hands: [{ handNo: 1, result }], playerScores: result.totals, nextReady: [],
    players: ties.map((a, seat) => ({ seat, arrangement: a, autoArranged: false })), revealedAt: T, settleAt: oldSettle, nextHandAt: oldNext };
  const p = g.revealPayload(s);
  eq([p.settleAt, p.nextHandAt, g.shouldStartNext(s, oldNext - 1), g.shouldStartNext(s, oldNext), dur(result)],
    [oldSettle, oldNext, false, true, 20900],
    "U5 舊局：已存的 settleAt、nextHandAt 照原值回傳，到原本的 nextHandAt 就開下一局（新公式這局是 20.9 秒，但不拿來重算舊局）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
