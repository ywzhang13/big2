// 十三支 v4 規則、彩金牌、沒用到的牌（老闆 2026-11-19 定案）。路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   W1 新開的房記 scoreRule "v5"（2026-11-20 起；牌型、彩金牌、加分和 v4 一樣，只改打槍）；開始理牌：四家（和不在桌上的人）都看得到彩金牌 luckyCard＝65 張發完剩下的那張；手牌照 A、2…K 排
//   W2 理牌階段：用別家身分讀狀態（玩家畫面、不在桌上的畫面），拿不到別人的任何一張牌，也沒有 unusedCards；公開頻道的開局廣播帶彩金牌、不帶任何手牌
//   W3 比牌後：reveal.unusedCards 每家 3 張＝那家發到的 16 張扣掉排出去的 13 張；reveal.luckyCard 同開局；每墩的牌照 A、2…K 排
//   W4 最後一局打完關房：410 回應的 record.finalHand 也有 unusedCards、luckyCard
//   W5 舊房（scoreRule "jia"、沒有 scoreRule）照原本的規則：亮牌內容回 scoreRule "jia"／"v1"；沒有彩金牌，剩下的那張哪裡都沒有
//   W6 v4 實打一局（指定發牌，彩金 5）：彩金衝三＋尾墩鐵支打槍三家＋全壘打 → +18／−6／−6／−6，scores × 底分 100；左欄明細沒有墩分（房間改成 v4，因為新房是 v5）
//   W7 同一副牌在 v5 房：彩金衝三各收 1、彩金分 +3／三家各 −1 → 合計一樣 +18／−6
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../support/thirteen-start-all"; // 開始＝房主發起＋其他三家同意（2026-11-20 起；確認本身見 flow-thirteen-start-confirm）
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { clock, dealer } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import { parseCards, sortCards, type Card } from "../../lib/thirteen/cards";
import type { HandRule } from "../../lib/thirteen/hand";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
clock.now = () => Date.parse("2026-11-19T12:00:00Z");
const realDeal = dealer.deal;
const deals: { hands: Card[][]; rest: Card[] }[] = [];
dealer.deal = () => deals.shift() ?? realDeal();
const PIDS = ["p0", "p1", "p2", "p3"];
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000f${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string, seat = true) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}${seat ? `&playerId=${as}` : ""}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
async function newRoom(edit?: string) {
  const c = (await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8 }, "p0")).body as { roomId: string; code: string };
  if (edit) await db.query(edit, [c.roomId]);
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.code, playerId: p, name: `玩家${i}` }, p);
  return c;
}
const dbState = async (roomId: string) => (await db.query<{ p: { seat: number; hand: Card[] }[]; r: Card[] }>(`select game_state->'players' p, game_state->'rest' r from th_rooms where id = $1`, [roomId])).rows[0];
const hands = async (roomId: string) => (await dbState(roomId)).p.sort((a, b) => a.seat - b.seat).map((x) => x.hand);
const restOf = async (roomId: string) => (await dbState(roomId)).r;
async function submitAll(roomId: string, rule?: HandRule) {
  const arr: Card[][] = [];
  for (const p of PIDS) {
    const v = (await state(roomId, p)).body;
    const a = autoArrange(v.me.hand as Card[], rule ?? { lucky: v.luckyCard?.rank ?? null });
    arr.push([...a.front, ...a.middle, ...a.back]);
    await post(submitRoute, { roomId, playerId: p, front: a.front.map((x) => x.id), middle: a.middle.map((x) => x.id), back: a.back.map((x) => x.id) }, p);
  }
  return arr;
}
const ids = (cs: Card[]) => cs.map((x) => x.id).sort();
const order = (cs: Card[]) => cs.map((x) => x.id);
const sortedOk = (cs: Card[]) => JSON.stringify(order(cs)) === JSON.stringify(order(sortCards(cs)));

// W1、W2
const c = await newRoom();
{
  const w = await state(c.roomId, "p0");
  const sentBefore = sent.length;
  await post(startRoute, { roomId: c.roomId, playerId: "p0" }, "p0");
  const hs = await hands(c.roomId), rest = await restOf(c.roomId);
  const v1 = (await state(c.roomId, "p1")).body, vOut = (await state(c.roomId, "p1", false)).body;
  const view1 = JSON.stringify(v1), viewOutside = JSON.stringify(vOut);
  const others = hs.filter((_, seat) => seat !== 1).flat().map((x) => x.id);
  const leaked = others.filter((id) => view1.includes(`"${id}"`) || viewOutside.includes(`"${id}"`));
  const startEv = sent.slice(sentBefore).find((e) => e.event === "th_hand_start");
  const startLeak = hs.flat().some((x) => JSON.stringify(startEv?.payload).includes(`"${x.id}"`));
  eq([w.body.settings?.scoreRule, w.body.luckyCard, v1.scoreRule, v1.phase, v1.reveal, rest.length, v1.luckyCard?.id, vOut.luckyCard?.id, (startEv?.payload as { luckyCard?: Card })?.luckyCard?.id, sortedOk(v1.me.hand), v1.me.hand[0].rank <= v1.me.hand[15].rank || v1.me.hand[0].rank === 14],
    ["v5", null, "v5", "arranging", null, 1, rest[0].id, rest[0].id, rest[0].id, true, true],
    "W1 新房記 scoreRule v5（等人時沒有彩金牌）；開始理牌：玩家畫面、不在桌上的畫面、公開頻道的開局廣播都有彩金牌＝剩下的那 1 張；手牌照 A、2…K 排");
  eq([view1.includes("unusedCards"), viewOutside.includes("unusedCards"), leaked.length, startLeak, hs.map((h) => h.length)], [false, false, 0, false, [16, 16, 16, 16]],
    "W2 理牌中用 1 號身分（玩家畫面、不在桌上的畫面）讀狀態：拿不到別家任何一張牌、沒有 unusedCards；開局廣播不帶任何手牌");
}
// W3
{
  const hs = await hands(c.roomId), rest = await restOf(c.roomId);
  const used = await submitAll(c.roomId);
  const rv0 = (await state(c.roomId, "p0")).body.reveal;
  const rv2 = (await state(c.roomId, "p2")).body.reveal;
  const want = hs.map((h, seat) => ids(h.filter((x) => !used[seat].some((u) => u.id === x.id))));
  const rowsSorted = rv0.arrangements.every((a: Record<string, Card[]>) => sortedOk(a.front) && sortedOk(a.middle) && sortedOk(a.back));
  eq([rv0.scoreRule, rv0.unusedCards?.map((u: Card[]) => u.length), rv0.unusedCards?.map(ids), JSON.stringify(rv2.unusedCards) === JSON.stringify(rv0.unusedCards), rv0.luckyCard?.id, rowsSorted, rv0.unusedCards.every(sortedOk)],
    ["v5", [3, 3, 3, 3], want, true, rest[0].id, true, true], "W3 比牌後 reveal.unusedCards 每家 3 張＝發到的 16 張扣掉排出去的 13 張（別家看到的一樣）；luckyCard 同開局；每墩、不用的牌都照 A、2…K 排");
}
// W4
{
  const c4 = await newRoom();
  await setTotalHands(db, c4.roomId, 1);
  await post(startRoute, { roomId: c4.roomId, playerId: "p0" }, "p0");
  const hs = await hands(c4.roomId), rest = await restOf(c4.roomId);
  const used = await submitAll(c4.roomId);
  const gone = await state(c4.roomId, "p0");
  const fh = gone.body.record?.finalHand;
  eq([gone.status, fh?.scoreRule, fh?.unusedCards?.map(ids), fh?.luckyCard?.id], [410, "v5", hs.map((h, seat) => ids(h.filter((x) => !used[seat].some((u) => u.id === x.id)))), rest[0].id],
    "W4 最後一局打完關房：410 回應的 finalHand 也有 unusedCards、luckyCard、scoreRule v5");
}
// W5
{
  const jia = await newRoom(`update th_rooms set game_state = jsonb_set(game_state, '{settings,scoreRule}', '"jia"') where id = $1`);
  const v1 = await newRoom(`update th_rooms set game_state = game_state #- '{settings,scoreRule}' where id = $1`);
  const got = [];
  for (const r of [jia, v1]) {
    const sentBefore = sent.length;
    await post(startRoute, { roomId: r.roomId, playerId: "p0" }, "p0");
    const rest = (await restOf(r.roomId))[0].id;
    const arranging = (await state(r.roomId, "p1")).body;
    await submitAll(r.roomId, "legacy");
    const after = (await state(r.roomId, "p0")).body;
    const leak = [arranging, after, sent.slice(sentBefore)].some((x) => JSON.stringify(x).includes(`"${rest}"`));
    got.push([after.reveal?.scoreRule, arranging.luckyCard, after.reveal?.luckyCard, leak]);
  }
  eq(got, [["jia", null, null, false], ["v1", null, null, false]], "W5 舊房照原本的規則：jia 房回 jia、沒有欄位的房回 v1；都沒有彩金牌，剩下的那張在狀態、亮牌、廣播裡都沒有");
}
// W6
{
  const p = (s: string) => parseCards(s);
  const p0 = p("5C 5D 5H 9C TD JH QS KS AH AD AC AS 2D 7D 8H 4C");
  const p1 = p("6C 6D 6H 7C 8D 9H TS JC KC KD KH 3S 3C 2H 4D QD");
  deals.push({ hands: [p0, p1, p1, p1], rest: p("5S") });
  const r = await newRoom(`update th_rooms set game_state = jsonb_set(game_state, '{settings,scoreRule}', '"v4"') where id = $1`); // 2026-11-20 起新房是 v5；這一項專測 v4 房
  await post(startRoute, { roomId: r.roomId, playerId: "p0" }, "p0");
  const lucky = (await state(r.roomId, "p0")).body.luckyCard;
  const pick = (h: Card[], s: string) => s.split(" ").map((k) => h.find((x) => x.id.startsWith(k[1] + k[0]))!.id);
  const s0 = await post(submitRoute, { roomId: r.roomId, playerId: "p0", front: pick(p0, "5C 5D 5H"), middle: pick(p0, "9C TD JH QS KS"), back: pick(p0, "AH AD AC AS 2D") }, "p0");
  const rs = [s0.status];
  for (const q of PIDS.slice(1)) rs.push((await post(submitRoute, { roomId: r.roomId, playerId: q, front: pick(p1, "6C 6D 6H"), middle: pick(p1, "7C 8D 9H TS JC"), back: pick(p1, "KC KD KH 3S 3C") }, q)).status);
  const rv = (await state(r.roomId, "p0")).body.reveal;
  const st0 = rv.stats[0];
  eq([lucky?.id, rs, rv.result.totals, rv.result.homeRun, rv.scores, [st0.rows, st0.bonuses, st0.gunPoints, st0.homeRunPoints, st0.total], rv.stats[1].rows, rv.rowDeltas],
    ["S51", [200, 200, 200, 200], [18, -6, -6, -6], 0, [1800, -600, -600, -600], [0, [{ name: "彩金衝三", points: 6 }, { name: "尾墩鐵支", points: 3 }], 3, 6, 18], 0,
      { front: [600, -200, -200, -200], middle: [0, 0, 0, 0], back: [300, -100, -100, -100] }],
    "W6 v4 實打（彩金 5）：0 號彩金衝三（贏三家各收 2）、中墩順子（一般牌型不算分）、尾墩鐵支（各收 1）、打三槍＋全壘打（各 2）→ +18／−6／−6／−6；scores × 底分 100；左欄沒有墩分；rowDeltas 只有加分");
}
// W7
{
  const p = (s: string) => parseCards(s);
  const p0 = p("5C 5D 5H 9C TD JH QS KS AH AD AC AS 2D 7D 8H 4C");
  const p1 = p("6C 6D 6H 7C 8D 9H TS JC KC KD KH 3S 3C 2H 4D QD");
  deals.push({ hands: [p0, p1, p1, p1], rest: p("5S") });
  const r = await newRoom();
  await post(startRoute, { roomId: r.roomId, playerId: "p0" }, "p0");
  const lucky = (await state(r.roomId, "p0")).body.luckyCard;
  const pick = (h: Card[], s: string) => s.split(" ").map((k) => h.find((x) => x.id.startsWith(k[1] + k[0]))!.id);
  const s0 = await post(submitRoute, { roomId: r.roomId, playerId: "p0", front: pick(p0, "5C 5D 5H"), middle: pick(p0, "9C TD JH QS KS"), back: pick(p0, "AH AD AC AS 2D") }, "p0");
  const rs = [s0.status];
  for (const q of PIDS.slice(1)) rs.push((await post(submitRoute, { roomId: r.roomId, playerId: q, front: pick(p1, "6C 6D 6H"), middle: pick(p1, "7C 8D 9H TS JC"), back: pick(p1, "KC KD KH 3S 3C") }, q)).status);
  const rv = (await state(r.roomId, "p0")).body.reveal;
  const st0 = rv.stats[0];
  eq([lucky?.id, rs, rv.result.totals, rv.result.homeRun, rv.scores, [st0.rows, st0.bonuses, st0.gunPoints, st0.homeRunPoints, st0.luckyPoints, st0.total], rv.stats[1].rows, rv.rowDeltas],
    ["S51", [200, 200, 200, 200], [18, -6, -6, -6], 0, [1800, -600, -600, -600], [0, [{ name: "彩金衝三", points: 3 }, { name: "尾墩鐵支", points: 3 }], 3, 6, 3, 18], 0,
      { front: [300, -100, -100, -100], middle: [0, 0, 0, 0], back: [300, -100, -100, -100] }],
    "W7 同一副牌在 v5 房（2026-11-20 新房）：彩金衝三照衝三各收 1、尾墩鐵支各收 1、打三槍＋全壘打、頭墩 3 張彩金點數 → 彩金分 +3（三家各 −1）→ 合計一樣 +18／−6；左欄多一行彩金分 3");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
