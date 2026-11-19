// 十三支結算到下一局（阿哲 2026-11-18 拍板）的 API：路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   N1 亮牌時伺服器給三個時間（伺服器毫秒）：revealedAt 亮牌、settleAt 結算面板出現（＝revealedAt＋演出長度）、
//      nextHandAt 自動開下一局（＝settleAt＋30 秒）；th_reveal 廣播和讀狀態都有
//   N2 有人沒按確認（3 號斷線：沒送出、沒按）：到 nextHandAt 前一毫秒還在結算；到 nextHandAt 就自動開下一局（斷線的人不卡局）
//   N3 四家都按確認：馬上開下一局，不用等 settleAt、nextHandAt
//   N4 每局統計：亮牌內容帶這局每家的明細（墩分、特殊加分、打槍、被打槍、全壘打、被全壘打、合計）；
//      讀狀態帶整場累計（每家打槍、被打槍、全壘打、被全壘打次數、總分）
//   N5 整場打完：對局紀錄（match_records.settings.stats）、th_room_closed 廣播、關房後 410 的紀錄三處，
//      每家打槍、被打槍、全壘打、被全壘打、總分五個欄位都逐項＝每局明細加總（小測 2026-11-18 補驗要求逐欄比對）
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { POST as nextRoute } from "../../app/api/thirteen/next-game/route";
import * as flow from "../../lib/thirteen/flow";
import { buildDeck, shuffle, type Card } from "../../lib/thirteen/cards";
import { autoArrange } from "../../lib/thirteen/arrange";
import { bonusOf, ROWS, type RoundResult } from "../../lib/thirteen/score";
import { DEFAULT_BASE_SCORE } from "../../lib/thirteen/db";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-18T12:00:00Z");
flow.clock.now = () => NOW;
const f = flow as unknown as { revealDurationMs?: (r: RoundResult) => number };
const PIDS = ["p0", "p1", "p2", "p3"];
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000a${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${as}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);
const submit = async (roomId: string, p: string, a: { front: Card[]; middle: Card[]; back: Card[] }) =>
  post(submitRoute, { roomId, playerId: p, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, p);

// 第 1 局固定發牌：0 號拿 5 張 A、5 張 K、5 張 Q、1 張 J → 頭墩 QQQ（衝三）、中墩 KKKKK（中墩五龍）、尾墩 AAAAA（尾墩五龍），三墩都贏 → 打槍三家＋全壘打
const deck = buildDeck();
const take = (want: string[]) => want.map((id) => deck.find((c) => c.id === id)!);
const strong = take(["SA1", "SA2", "HA1", "DA1", "CA1", "SK1", "SK2", "HK1", "DK1", "CK1", "SQ1", "SQ2", "HQ1", "DQ1", "CQ1", "SJ1"]);
let seed = 7; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const restDeck = shuffle(deck.filter((c) => !strong.includes(c)), rng);
const deals = [{ hands: [strong, restDeck.slice(0, 16), restDeck.slice(16, 32), restDeck.slice(32, 48)], rest: restDeck.slice(48) }];
const realDeal = flow.dealer.deal;
flow.dealer.deal = () => deals.shift() ?? realDeal();

const c = await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8 }, "p0");
await setTotalHands(db, c.body.roomId as string, 3); // 開房只能選 8／16／32；這裡照舊房的方式改成 3 局
const roomId = c.body.roomId as string;
for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
await post(startRoute, { roomId, playerId: "p0" }, "p0");
const handStatsSeen: { guns: number; gunned: number; homeRun: boolean; homeRunned: boolean; total: number }[][] = [];

// 第 1 局：0 號送出固定排法，1、2 號自動排法送出，3 號斷線（不送、不按）
const h0 = strong;
await submit(roomId, "p0", { front: h0.filter((x) => x.rank === 12).slice(0, 3), middle: h0.filter((x) => x.rank === 13), back: h0.filter((x) => x.rank === 14) });
for (const p of ["p1", "p2"]) await submit(roomId, p, autoArrange((await state(roomId, p)).body.me.hand));
NOW += 30_000; // 理牌截止：3 號代排、亮牌
sent.length = 0;
await post(tickRoute, { roomId, playerId: "p0" }, "p0");
const rev1 = sent.find((e) => e.event === "th_reveal")?.payload as Record<string, unknown> | undefined;
const v1 = (await state(roomId, "p1")).body;
{
  const result = (rev1?.result ?? v1.reveal?.result) as RoundResult;
  const d = f.revealDurationMs ? f.revealDurationMs(result) : null;
  // 照老闆定案的新節奏另外算一次（特效牌型、打槍組數、全壘打從結算結果數；別家隨機牌也可能有特效牌型）
  const specials = result ? result.values.reduce((n, v) => n + ROWS.filter((row) => bonusOf(row, v[row]) > 0).length, 0) : -1;
  const v8b = 20900 + specials * 300 + (result?.pairs.filter((p) => p.gunner !== null).length ?? 0) * 1500 + (result?.homeRun !== null ? 3200 : 0); // 老闆定案新節奏：20.9＋0.3×大牌＋1.5×槍＋3.2×全壘打
  eq([rev1?.revealedAt, rev1?.settleAt, rev1?.nextHandAt, v1.reveal?.revealedAt, v1.reveal?.settleAt, v1.nextHandAt, d],
    [NOW, NOW + v8b, NOW + v8b + 30_000, NOW, NOW + v8b, NOW + v8b + 30_000, v8b],
    `N1 亮牌：revealedAt＝亮牌時間、settleAt＝亮牌＋演出長度（這局 ${specials} 個特效牌型、三槍、全壘打＝${v8b / 1000} 秒，照新節奏另外算）、nextHandAt＝settleAt＋30 秒；廣播和讀狀態都有`);
  const st = (rev1?.stats ?? null) as { guns: number; gunned: number; homeRun: boolean; homeRunned: boolean; total: number; bonuses: { name: string; points: number }[] }[] | null;
  if (st) handStatsSeen.push(st);
  eq(st ? [st.map((x) => x.guns), st.map((x) => x.gunned), st.map((x) => x.homeRun), st.map((x) => x.homeRunned), st.map((x) => x.total), st[0].bonuses.map((b) => b.name).sort()] : null,
    [[3, 0, 0, 0], [0, 1, 1, 1], [true, false, false, false], [false, true, true, true], (rev1?.result as RoundResult | undefined)?.totals ?? [], ["中墩五龍", "尾墩五龍", "衝三"]],
    "N4 第 1 局的每家明細：0 號打槍 3 家＋全壘打，另外三家各被打槍 1 次、被全壘打；合計＝這局總分；0 號的加分項目是衝三、中墩五龍、尾墩五龍");
  // 0、1、2 號按確認，3 號斷線沒按
  for (const p of ["p0", "p1", "p2"]) await post(nextRoute, { roomId, playerId: p }, p);
  const nextAt = v1.nextHandAt as number;
  NOW = nextAt - 1;
  await post(tickRoute, { roomId, playerId: "p0" }, "p0");
  const before = (await state(roomId, "p0")).body;
  NOW = nextAt;
  await post(tickRoute, { roomId, playerId: "p0" }, "p0");
  const after = (await state(roomId, "p0")).body;
  eq([before.phase, before.handNo, after.phase, after.handNo], ["revealed", 1, "arranging", 2],
    "N2 3 號斷線沒按確認：到 nextHandAt 前一毫秒還在結算；到 nextHandAt 自動開第 2 局（斷線的人不卡局）");
}

// 第 2 局：四家都送出、四家都按確認 → 馬上開第 3 局
for (const p of PIDS) await submit(roomId, p, autoArrange((await state(roomId, p)).body.me.hand));
const v2 = (await state(roomId, "p0")).body;
if (v2.reveal?.stats) handStatsSeen.push(v2.reveal.stats);
{
  const revealedAt = v2.reveal?.revealedAt;
  for (const p of PIDS) await post(nextRoute, { roomId, playerId: p }, p);
  const after = (await state(roomId, "p0")).body;
  eq([v2.phase, revealedAt === NOW, after.phase, after.handNo, NOW < (v2.reveal?.settleAt ?? 0)], ["revealed", true, "arranging", 3, true],
    "N3 四家都按確認：馬上開第 3 局（還沒到結算面板出現的時間，也不用等 30 秒）");
  const mid = after.stats as { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }[] | undefined;
  const sum = (k: "guns" | "gunned") => [0, 1, 2, 3].map((s) => handStatsSeen.reduce((n, h) => n + h[s][k], 0));
  // 小測 2026-11-18 補驗：五個欄位都逐家比對（被全壘打也比；第 1 局有全壘打，所以 1～3 號的被全壘打不是 0）
  const homeRunnedSum = [0, 1, 2, 3].map((s) => handStatsSeen.filter((h) => h[s].homeRunned).length);
  // 每局明細 stats.total 是墩數；整場累計是分數＝墩數 × 底分（2026-11-19；這裡開房沒帶底分＝DEFAULT_BASE_SCORE）
  const totalSum = [0, 1, 2, 3].map((s) => handStatsSeen.reduce((n, h) => n + h[s].total, 0) * DEFAULT_BASE_SCORE);
  eq(mid ? [mid.map((x) => x.guns), mid.map((x) => x.gunned), mid.map((x) => x.homeRuns), mid.map((x) => x.homeRunned), mid.map((x) => x.total), homeRunnedSum.some((n) => n > 0)] : null,
    [sum("guns"), sum("gunned"), [0, 1, 2, 3].map((s) => handStatsSeen.filter((h) => h[s].homeRun).length), homeRunnedSum, totalSum, true],
    "N4 讀狀態（進行中）帶整場累計：每家打槍、被打槍、全壘打、被全壘打、總分五個欄位都＝前兩局每局明細逐家加總（這兩局有人被全壘打）");
  eq(totalSum, after.playerScores, "N4 整場累計的總分也＝讀狀態的累計分數 playerScores");
}

// 第 3 局（最後一局）：四家送出 → 亮牌就打完，寫紀錄、關房
for (const p of PIDS) await submit(roomId, p, autoArrange((await state(roomId, p)).body.me.hand));
{
  type MS = { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number };
  const closed = sent.find((e) => e.event === "th_room_closed")?.payload as { stats?: MS[] } | undefined;
  const rec = (await db.query<{ s: { stats?: MS[]; finalHand?: { stats?: unknown } } }>(`select settings s from match_records where room_id = $1`, [roomId])).rows[0]?.s;
  const recPlayers = (await db.query<{ seat: number; total_score: number }>(
    `select p.seat, p.total_score from match_record_players p join match_records r on r.id = p.match_id where r.room_id = $1 order by p.seat`, [roomId])).rows;
  const goneR = await state(roomId, "p0");
  if (rec?.finalHand?.stats) handStatsSeen.push(rec.finalHand.stats as never);
  // 期望值：三局每局明細逐家加總（五個欄位全部比，總分另外和對局紀錄的每家總分對）
  const expected = [0, 1, 2, 3].map((seat) => [
    handStatsSeen.reduce((n, h) => n + h[seat].guns, 0),
    handStatsSeen.reduce((n, h) => n + h[seat].gunned, 0),
    handStatsSeen.filter((h) => h[seat].homeRun).length,
    handStatsSeen.filter((h) => h[seat].homeRunned).length,
    handStatsSeen.reduce((n, h) => n + h[seat].total, 0) * DEFAULT_BASE_SCORE,
  ]);
  const cols = (xs: MS[] | undefined | null) => (xs ?? []).map((x) => [x.guns, x.gunned, x.homeRuns, x.homeRunned, x.total]); // 固定欄位順序（jsonb 存回來鍵會重排）
  eq([handStatsSeen.length, expected.some((e) => e[0] > 0), expected.some((e) => e[2] > 0), expected.map((e) => e[4]), cols(rec?.stats), cols(closed?.stats), goneR.status, cols(goneR.body.record?.stats)],
    [3, true, true, recPlayers.map((r) => r.total_score), expected, expected, 410, expected],
    "N5 整場打完：對局紀錄、th_room_closed 廣播、關房後 410 的紀錄三處，每家的打槍、被打槍、全壘打、被全壘打、總分五個欄位，都＝三局每局明細逐家加總（這場有打槍、有全壘打；總分也＝對局紀錄的每家總分）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
