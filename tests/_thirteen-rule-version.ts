// 十三支計分規則版本（審伯 2026-11-19 必修）：上線前就開的舊房照舊規則（特殊牌型那一道＝1＋加分），之後新開的房照甲案。
// 判斷方式：開房時在牌局設定記 settings.scoreRule = "jia"；設定裡沒有 scoreRule 的房（上線前開的）一律是舊規則 "v1"。
// 舊房整場都用舊規則（含上線後才亮牌的局），所以已存的總分和畫面上的每墩分數、明細永遠對得上。
//   R1 舊房打規則書範例 11：總分 +33／−13／−11／−9（舊規則）；rowDeltas 三墩加總＋打槍、全壘打＝總分；
//      明細 stats 加總＝總分；scored（底分 1）＝stats；亮牌內容和畫面狀態都標 scoreRule "v1"
//   R2 同一副牌在新房：甲案 +27／−11／−9／−7（同甲案驗證紀錄）；各項加總一樣對得上；標 scoreRule "jia"
//   R3 舊房「重新整理」（牌局狀態存進資料庫再讀回來，JSON 來回一次）：亮牌內容、畫面狀態完全一樣
//   R4 舊局的 stats 是改之前的程式存的（沒有 stats 欄位，要現算）：照舊規則補算，和總分對得上
import { parseCards } from "../lib/thirteen/cards";
import type { Arrangement } from "../lib/thirteen/arrange";
import { newRoomState, type ThirteenGameState, type ThirteenSettings } from "../lib/thirteen/db";
import { revealIfReady, revealPayload, scoreRuleOf, seatPlayers, startHand, viewFor } from "../lib/thirteen/flow";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
function players(rows: [string, string, string][]): Arrangement[] {
  const used = new Set<string>();
  return rows.map(([f, m, b]) => ({ front: parseCards(f, used), middle: parseCards(m, used), back: parseCards(b, used) }));
}
// 規則書範例 11（全壘打）
const EX11 = players([
  ["QH QD QS", "8H 8D 8S 4D 4H", "5C 5D 5H 5S 9C"],
  ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S AC"],
  ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"],
  ["6H 7H 8C", "AH AD 3S 4S KH", "TH TS QS QC 7S"],
]);
const seats = [0, 1, 2, 3].map((seat) => ({ id: `s${seat}`, room_id: "r", player_id: `p${seat}`, name: `玩家${seat}`, seat, user_id: null }));
function play(settings: ThirteenSettings): ThirteenGameState {
  const s = newRoomState(settings);
  seatPlayers(s, seats);
  startHand(s, 1_000);
  s.players.forEach((p, i) => { p.arrangement = EX11[i]; });
  if (!revealIfReady(s, 2_000)) throw new Error("沒有亮牌");
  return s;
}
/** 每家：rowDeltas 三墩＋（打槍＋全壘打）× 底分；stats 各項加總；scored 各項加總 */
function sums(s: ThirteenGameState) {
  const rv = revealPayload(s);
  const k = rv.baseScore;
  return [0, 1, 2, 3].map((seat) => {
    const st = rv.stats[seat], sc = st.scored;
    return [rv.rowDeltas.front[seat] + rv.rowDeltas.middle[seat] + rv.rowDeltas.back[seat] + (st.gunPoints + st.homeRunPoints) * k,
      st.rows + st.bonuses.reduce((a, b) => a + b.points, 0) + st.gunPoints + st.homeRunPoints,
      sc.rows + sc.bonuses.reduce((a, b) => a + b.points, 0) + sc.gunPoints + sc.homeRunPoints];
  });
}
const OLD: ThirteenSettings = { arrangeSec: 30, totalHands: 8 };                                    // 上線前開的房：沒有 baseScore、沒有 scoreRule
const NEW: ThirteenSettings = { arrangeSec: 30, totalHands: 8, baseScore: 100, scoreRule: "jia" };  // 上線後開的房

// R1
{
  const s = play(OLD);
  const rv = revealPayload(s);
  const t = rv.result.totals;
  eq([scoreRuleOf(OLD), t, rv.scores, sums(s), rv.scoreRule, viewFor(s, null, 3_000).scoreRule],
    ["v1", [33, -13, -11, -9], [33, -13, -11, -9], t.map((x) => [x, x, x]), "v1", "v1"],
    "R1 舊房（沒有 scoreRule）打範例 11：舊規則 +33／−13／−11／−9；每墩分數＋打槍全壘打、明細、乘底分明細三種加總都等於總分；標 scoreRule v1");
}
// R2
{
  const s = play(NEW);
  const rv = revealPayload(s);
  const t = rv.result.totals;
  eq([scoreRuleOf(NEW), t, rv.scores, sums(s), rv.scoreRule, viewFor(s, null, 3_000).scoreRule],
    ["jia", [27, -11, -9, -7], [2700, -1100, -900, -700], t.map((x) => [x * 100, x, x * 100]), "jia", "jia"],
    "R2 同一副牌在新房（scoreRule jia、底分 100）：甲案 +27／−11／−9／−7，三種加總都對得上；標 scoreRule jia");
}
// R3
{
  const s = play(OLD);
  const before = [revealPayload(s), viewFor(s, "p0", 3_000)];
  const reloaded = JSON.parse(JSON.stringify(s)) as ThirteenGameState;
  const after = [revealPayload(reloaded), viewFor(reloaded, "p0", 3_000)];
  eq(after, before, "R3 舊房重新整理（牌局狀態存進資料庫再讀回來）：亮牌內容、畫面狀態完全一樣");
}
// R4
{
  const s = play(OLD);
  delete s.hands[0].stats;   // 改之前的程式存的局：沒有 stats
  delete s.hands[0].scores;  //                    也沒有 scores
  eq([revealPayload(s).scores, sums(s)], [[33, -13, -11, -9], [33, -13, -11, -9].map((x) => [x, x, x])],
    "R4 舊局沒有存 stats、scores：照舊規則補算，和存下的總分對得上");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
