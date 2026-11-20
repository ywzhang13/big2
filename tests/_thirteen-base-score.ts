// 十三支底分（老闆 2026-11-19）：開房選 50／100／200／500，每局分數＝淨墩數 × 底分（打槍、全壘打、特殊牌型照舊算進淨墩數）。
//   B1 預設選項 30、50、100、200；isBaseScore 收 10～100000 的整數（老闆 2026-11-19 第二次：更大的用自訂）
//   B2 四種底分各打一局：本局分數 scores＝result.totals × 底分、累計 playerScores＝scores、四家總和 0；
//      result（墩數，給亮牌動畫）不乘；亮牌內容、畫面狀態都帶 baseScore 和 scores
//   B3 舊房（設定裡沒有 baseScore）：底分當 1，分數和改之前一樣（scores＝totals），畫面回 baseScore 1
//   B4 打兩局：累計＝兩局 scores 相加；history 每局帶 scores
//   B5 對局紀錄：settings 存 baseScore，四家 totalScore 是乘過底分的累計
//   B6 亮牌內容 rowDeltas（中央看板每墩加分，老馬 2026-11-19）：{ front, middle, back } 各 4 家＝每墩兩兩比的 ±(1＋加分) 加總 × 底分；
//      四種底分各一局：三墩加總＋打槍分（gunPoints × 底分）＋全壘打分（homeRunPoints × 底分）＝ scores；每墩四家合計 0
//      stats[].gunEach＝每一槍的分數＝GUN_PENALTY × 底分
//   B7 舊房（沒有 baseScore）：rowDeltas、gunEach 等同底分 1（rowDeltas＝墩數、gunEach＝GUN_PENALTY）
//   B8 stats[].scored（本局結算左欄明細的乘好版本）：墩分、每個特殊牌型加分、打槍分（淨）、打槍拿到、被打槍付出、全壘打分
//      每一項＝原本墩數 × 底分；墩分＋加分＋打槍淨分＋全壘打分＝scores[seat]；打槍拿到＋被打槍付出＝打槍淨分；
//      原本的 stats 和 result 維持墩數；舊房的 scored＝原本的墩數。要打到同時有人打槍又被打槍、和有全壘打的局（跑到為止，最多 3000 副）
import { BASE_SCORES, buildThirteenRecord, isBaseScore, newRoomState, type ThirteenGameState, type ThirteenSettings } from "../lib/thirteen/db";
import { autoArrange } from "../lib/thirteen/arrange";
import { handRuleFor, revealIfReady, revealPayload, seatPlayers, startHand, viewFor } from "../lib/thirteen/flow";
import { SCORING } from "../lib/thirteen/score";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

const seats = [0, 1, 2, 3].map((seat) => ({ id: `s${seat}`, room_id: "r", player_id: `p${seat}`, name: `玩家${seat}`, seat, user_id: null }));
function newGame(settings: ThirteenSettings): ThirteenGameState {
  const s = newRoomState(settings);
  seatPlayers(s, seats);
  return s;
}
/** 打一局：四家用推薦排法、亮牌。回傳這局的墩數（result.totals） */
function playHand(s: ThirteenGameState, now: number): number[] {
  startHand(s, now);
  for (const p of s.players) p.arrangement = autoArrange(p.hand, handRuleFor(s)); // 照房間規則排（v4 帶這一局的彩金牌；舊房用舊牌型排）
  if (!revealIfReady(s, now)) throw new Error("沒有亮牌");
  return s.hands[s.hands.length - 1].result.totals;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const times = (xs: number[], k: number) => xs.map((x) => x * k);

// B1
eq([...BASE_SCORES], [30, 50, 100, 200], "B1 底分預設選項是 30、50、100、200");
eq([30, 50, 100, 200, 10, 100000, 150, 999].map(isBaseScore), Array(8).fill(true), "B1 預設四種、自訂 10、100000、150、999 都接受");
eq([9, 100001, 12.5, "100", null, undefined, 0, -100, NaN, Infinity].map(isBaseScore), Array(10).fill(false),
  "B1 9、100001、12.5、字串 \"100\"、null、沒帶、0、負數、NaN、Infinity 都不接受");

// B2：四種底分各一局。每種多打幾副，至少要有一副墩數不是全 0，才看得出有乘
for (const base of [50, 100, 200, 500] as const) {
  let s: ThirteenGameState, totals: number[];
  let tries = 0;
  do { s = newGame({ arrangeSec: 30, totalHands: 8, baseScore: base }); totals = playHand(s, 1_000); tries++; } while (totals.every((x) => x === 0) && tries < 20);
  const h = s.hands[0];
  const rv = revealPayload(s);
  const v = viewFor(s, "p0", 2_000);
  eq({ scores: h.scores, playerScores: s.playerScores, sum: sum(h.scores ?? [1]), rvBase: rv.baseScore, rvScores: rv.scores, rvTotals: rv.result.totals,
    viewBase: v.baseScore, hist: v.history[0].scores },
  { scores: times(totals, base), playerScores: times(totals, base), sum: 0, rvBase: base, rvScores: times(totals, base), rvTotals: totals,
    viewBase: base, hist: times(totals, base) },
  `B2 底分 ${base}：本局分數＝墩數 × ${base}（墩數 ${JSON.stringify(totals)}），累計相同、四家總和 0；result 仍是墩數；亮牌和畫面都帶 baseScore`);
}

// B3：舊房（沒有 baseScore）
{
  let s: ThirteenGameState, totals: number[];
  let tries = 0;
  do { s = newGame({ arrangeSec: 30, totalHands: 8 }); totals = playHand(s, 1_000); tries++; } while (totals.every((x) => x === 0) && tries < 20);
  eq({ scores: s.hands[0].scores, playerScores: s.playerScores, rvBase: revealPayload(s).baseScore, viewBase: viewFor(s, null, 2_000).baseScore },
    { scores: totals, playerScores: totals, rvBase: 1, viewBase: 1 },
    "B3 舊房沒有 baseScore：底分當 1，分數＝墩數（和改之前一樣）");
  // 改之前存下來的局沒有 scores 欄位：畫面照墩數 × 1 補
  delete s.hands[0].scores;
  eq([viewFor(s, null, 2_000).history[0].scores, revealPayload(s).scores], [totals, totals], "B3 舊局沒有 scores 欄位：history、亮牌內容用墩數 × 1 補");
}

// B4：兩局累計
{
  const s = newGame({ arrangeSec: 30, totalHands: 8, baseScore: 200 });
  const t1 = playHand(s, 1_000);
  const t2 = playHand(s, 100_000);
  eq({ playerScores: s.playerScores, hist: viewFor(s, null, 200_000).history.map((h) => h.scores) },
    { playerScores: t1.map((x, i) => (x + t2[i]) * 200), hist: [times(t1, 200), times(t2, 200)] },
    "B4 底分 200 打兩局：累計＝兩局（墩數 × 200）相加，history 每局帶 scores");
}

// B5：對局紀錄
{
  const s = newGame({ arrangeSec: 30, totalHands: 8, baseScore: 500 });
  playHand(s, 1_000);
  const rec = buildThirteenRecord("r", "1234", s, "dissolved")!;
  eq({ base: (rec.settings as { baseScore?: number }).baseScore, totals: rec.players.map((p) => p.totalScore) },
    { base: 500, totals: s.playerScores }, "B5 對局紀錄 settings 存 baseScore 500，四家總分是乘過底分的累計");
  const old = newGame({ arrangeSec: 30, totalHands: 8 });
  playHand(old, 1_000);
  eq((buildThirteenRecord("r", "1234", old, "dissolved")!.settings as { baseScore?: number }).baseScore, 1, "B5 舊房的紀錄 baseScore 記 1");
}

// B6、B7：rowDeltas、gunEach。多打幾副，至少要有一副有打槍（打槍分不在三墩裡，要另外加回來才會等於 scores）
for (const base of [50, 100, 200, 500, undefined] as const) {
  const label = base === undefined ? "B7 舊房（底分當 1）" : `B6 底分 ${base}`;
  const k = base ?? 1;
  let sawGun = false, allOk = true, rowSumZero = true, tries = 0, gunEachOk = true;
  const bad: unknown[] = [];
  do {
    const s = newGame(base === undefined ? { arrangeSec: 30, totalHands: 8 } : { arrangeSec: 30, totalHands: 8, baseScore: base });
    playHand(s, 1_000);
    const rv = revealPayload(s);
    const rd = rv.rowDeltas;
    for (const row of ["front", "middle", "back"] as const) if (sum(rd[row]) !== 0) rowSumZero = false;
    for (let seat = 0; seat < 4; seat++) {
      const st = rv.stats[seat];
      const got = rd.front[seat] + rd.middle[seat] + rd.back[seat] + (st.gunPoints + st.homeRunPoints) * k;
      if (got !== rv.scores[seat]) { allOk = false; bad.push({ seat, rd: [rd.front[seat], rd.middle[seat], rd.back[seat]], st, score: rv.scores[seat] }); }
      if (st.gunEach !== SCORING.GUN_PENALTY * k) gunEachOk = false;
      // 每墩的墩數（不乘）× 底分＝rowDeltas
      if (rd.front[seat] + rd.middle[seat] + rd.back[seat] !== (st.rows + st.bonuses.reduce((n, b) => n + b.points, 0)) * k) { allOk = false; bad.push({ seat, rows: st.rows, bonuses: st.bonuses }); }
    }
    if (rv.stats.some((st) => st.guns > 0)) sawGun = true;
    tries++;
  } while (!sawGun && tries < 50);
  eq({ allOk, rowSumZero, gunEachOk, sawGun, bad: bad.slice(0, 2) }, { allOk: true, rowSumZero: true, gunEachOk: true, sawGun: true, bad: [] },
    `${label}：rowDeltas 三墩加總＋打槍、全壘打分 × ${k}＝scores，每墩四家合計 0；gunEach＝GUN_PENALTY × ${k}＝${SCORING.GUN_PENALTY * k}`);
}

// B8
for (const base of [50, 100, 200, 500, undefined] as const) {
  const label = base === undefined ? "B8 舊房（底分當 1）" : `B8 底分 ${base}`;
  const k = base ?? 1;
  const bad: unknown[] = [];
  let both = false, hr = false, bonus = false, tries = 0;
  do {
    const s = newGame(base === undefined ? { arrangeSec: 30, totalHands: 8 } : { arrangeSec: 30, totalHands: 8, baseScore: base });
    const totals = playHand(s, 1_000);
    const rv = revealPayload(s);
    const raw = s.hands[0].stats!;
    rv.stats.forEach((st, seat) => {
      const sc = st.scored, r = raw[seat];
      const want = { rows: r.rows * k, bonuses: r.bonuses.map((b) => ({ name: b.name, points: b.points * k })), gunPoints: r.gunPoints * k,
        shotPoints: r.guns * SCORING.GUN_PENALTY * k, shotByPoints: -r.gunned * SCORING.GUN_PENALTY * k, homeRunPoints: r.homeRunPoints * k,
        luckyPoints: (r.luckyPoints ?? 0) * k, total: rv.scores[seat] }; // v5 彩金分（2026-11-20）：也乘底分，左欄多一行
      const sumOk = sc.rows + sc.bonuses.reduce((n, b) => n + b.points, 0) + sc.gunPoints + sc.homeRunPoints + (sc.luckyPoints ?? 0) === rv.scores[seat]
        && sc.shotPoints + sc.shotByPoints === sc.gunPoints;
      const rawKept = st.rows === r.rows && st.gunPoints === r.gunPoints && st.total === totals[seat] && rv.result.totals[seat] === totals[seat];
      if (JSON.stringify(sc) !== JSON.stringify(want) || !sumOk || !rawKept) bad.push({ seat, sc, want, sumOk, rawKept });
      if (r.guns && r.gunned) both = true;
      if (r.homeRun) hr = true;
      if (r.bonuses.length) bonus = true;
    });
    tries++;
  } while (!(both && hr && bonus) && tries < 3000 && bad.length === 0);
  eq({ bad: bad.slice(0, 1), both, hr, bonus }, { bad: [], both: true, hr: true, bonus: true },
    `${label}：scored 每一項＝墩數 × ${k}、各項加總＝scores、打槍拿到＋被打槍付出＝打槍淨分；原本 stats／result 仍是墩數（涵蓋同時打槍又被打槍、全壘打、特殊加分）`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
