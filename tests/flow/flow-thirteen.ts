// 十三支遊戲流程 API（老柯 2026-11-16）：路由、流程、db 層都是真程式碼，資料庫是跑過真 migration 的 PGlite（tests/support/thirteen-pg.ts）；
// 只有登入（stub-auth）和廣播（stub-broadcast，記下每個事件送到哪個頻道）是替身。時間用 flow.clock 控制，發牌用 flow.dealer 指定。
//   L  開房、入座、開局（4 人才開、只有房主）
//   D  發牌：65 張安全洗牌、每人 13 張、手牌只送到本人的座位頻道
//   V  亮牌前偷看：別人的座位 403、觀戰／他家畫面看不到任何一張別人的牌、沒登入 401
//   X  送出檢查：倒水、張數、重複、非本人牌、替別人送 → 擋下＋中文提示；送出後不能改
//   T  截止時間：伺服器判定；截止後送出不收、系統代排；送出和代排同時發生只認一個；同一人同時送兩次只收一次
//   R  亮牌內容：翻牌順序、四家三墩、每對三墩勝負、打槍、全壘打、牌型加分、本局分、累計
//   N  多局累計、斷線（不按下一局）時間到自動開下一局
//   E  規則書 14 個範例經 API 算出的分數
//   Q  解散投票、整場打完寫紀錄關房、關房後讀狀態 410
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { POST as nextRoute } from "../../app/api/thirteen/next-game/route";
import { POST as leaveReqRoute } from "../../app/api/thirteen/leave-request/route";
import { POST as leaveVoteRoute } from "../../app/api/thirteen/leave-vote/route";
import { clock, dealer, NEXT_HAND_MS } from "../../lib/thirteen/flow";
import { publicChannel, privateChannel } from "../../lib/thirteen/server";
import { parseCards, type Card } from "../../lib/thirteen/cards";
import { autoArrange, type Arrangement } from "../../lib/thirteen/arrange";
import { revealOrder, scoreRound } from "../../lib/thirteen/score";
import { insertRoom } from "../../lib/thirteen/db";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-16T12:00:00Z");
clock.now = () => NOW;
const realDeal = dealer.deal;
const deals: { hands: Card[][]; rest: Card[] }[] = [];
dealer.deal = () => deals.shift() ?? realDeal();

const PIDS = ["p0", "p1", "p2", "p3"];
const uid = (i: number) => `00000000-0000-4000-8000-0000000000b${i}`;
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: uid(i), displayName: null, pictureUrl: null, isGuest: false }; });
tokens["tk-watch"] = { id: "00000000-0000-4000-8000-0000000000c9", displayName: null, pictureUrl: null, isGuest: false };
const OTHER = "00000000-0000-4000-8000-0000000000d1"; // 另一個帳號（S1 下一場拿同一個 playerId）
tokens["tk-other"] = { id: OTHER, displayName: null, pictureUrl: null, isGuest: false };
/** 不管物件鍵順序的比較字串（jsonb 存回來鍵會重排） */
const stable = (x: unknown): string => Array.isArray(x) ? `[${x.map(stable).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(x);
const auth = (as?: string): Record<string, string> => (as ? { authorization: `Bearer tk-${as}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, as?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(as) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as?: string, playerId?: string) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}${playerId ? `&playerId=${playerId}` : ""}`, { headers: auth(as) }));
  return { status: r.status, body: await r.json() };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);
const sub = (roomId: string, pid: string, a: Arrangement, as = pid) =>
  post(submitRoute, { roomId, playerId: pid, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, as);
const myHand = async (roomId: string, pid: string) => (await state(roomId, pid, pid)).body.me.hand as Card[];

/** 開房、四家入座、開局；回傳房間 id 和房號 */
async function newMatch(opts: { arrangeSec?: number; totalHands?: number } = {}) {
  const c = await post(createRoute, { hostId: "p0", arrangeSec: opts.arrangeSec ?? 30, totalHands: opts.totalHands ?? 3 }, "p0");
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  const st = await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  return { roomId: c.body.roomId as string, code: c.body.code as string, start: st };
}
/** 指定這一局四家的牌（rows＝四家的頭、中、尾；同一張牌可以出現在不同家，只為了重現規則書範例的兩人對比） */
function forceDeal(rows: [string, string, string][]) {
  const arr = rows.map(([f, m, b]) => { const used = new Set<string>(); return { front: parseCards(f, used), middle: parseCards(m, used), back: parseCards(b, used) }; });
  deals.push({ hands: arr.map((a) => [...a.front, ...a.middle, ...a.back]), rest: [] });
  return arr;
}
const evs = (from: number, name: string) => sent.slice(from).filter((e) => e.event === name);

// ---------- L 開房、入座、開局 ----------
{
  eq((await post(createRoute, { hostId: "p0", arrangeSec: 40, totalHands: 3 }, "p0")).body.error, "bad_arrange_sec", "L1 理牌時間不是 30／45／60 → 擋下");
  eq((await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 3 })).status, 401, "L2 沒登入不能開房");
  const c = await post(createRoute, { hostId: "p0", arrangeSec: 45, totalHands: 2 }, "p0");
  const roomId = c.body.roomId as string;
  for (const [i, p] of PIDS.slice(0, 3).entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  const notFull = await post(startRoute, { roomId, playerId: "p0" }, "p0");
  const j4 = await post(joinRoute, { code: c.body.code, playerId: "p3", name: "玩家3" }, "p3");
  const rejoin = await post(joinRoute, { code: c.body.code, playerId: "p1-new", name: "換裝置" }, "p1");
  const fifth = await post(joinRoute, { code: c.body.code, playerId: "p9", name: "第五人" }, "watch");
  const notHost = await post(startRoute, { roomId, playerId: "p1" }, "p1");
  const impostor = await post(startRoute, { roomId, playerId: "p0" }, "p1");
  const ok = await post(startRoute, { roomId, playerId: "p0" }, "p0");
  const again = await post(startRoute, { roomId, playerId: "p0" }, "p0");
  eq([c.status, notFull.body.error, j4.body.seat, j4.body.channel === privateChannel(roomId, c.body.code, "p3", uid(3)), rejoin.body.rejoined, rejoin.body.playerId, rejoin.body.seat,
    fifth.body.error, notHost.body.error, impostor.body.error, ok.status, again.body.error],
    [200, "not_full", 3, true, true, "p1", 1, "full", "not_host", "not_your_seat", 200, "started"],
    "L3 開房、入座（回本人座位頻道）、同帳號重連認回原座位、第五人擋下、3 人不能開、只有房主本人能開、開過不能再開");
  const dl = ok.body.arrangeDeadline - NOW;
  eq(dl, 45_000, "L4 理牌截止時間＝開局時間＋房間設定的 45 秒（伺服器時間）");
}

// ---------- D 發牌、V 亮牌前偷看 ----------
const m1 = await newMatch({ totalHands: 3 });
const m1Totals: number[][] = []; // 每一局四家的本局分（N2 逐家比對累計）
{
  const s0 = await state(m1.roomId, "p0", "p0");
  const hands: Card[][] = [];
  for (const p of PIDS) hands.push((await state(m1.roomId, p, p)).body.me.hand);
  const rest = (await db.query<{ r: Card[] }>(`select game_state->'rest' r from th_rooms where id = $1`, [m1.roomId])).rows[0].r;
  const all = [...hands.flat(), ...rest].map((c) => c.id);
  eq([hands.map((h) => h.length), rest.length, new Set(all).size, s0.body.phase, s0.body.handNo], [[16, 16, 16, 16], 1, 65, "arranging", 1],
    "D1 開局發牌：65 張、每人 16 張不重複，剩下 1 張留在伺服器（2026-11-18 加一色每人 16 張挑 13 張）");
  const deal = sent.filter((e) => e.event === "th_deal_hand");
  const lastDeal = deal.slice(-4);
  eq(lastDeal.map((e) => [e.channel === privateChannel(m1.roomId, m1.code, e.payload.playerId as string, uid(PIDS.indexOf(e.payload.playerId as string))), (e.payload.hand as Card[]).length]),
    PIDS.map(() => [true, 16]), "D2 每家的 16 張只送到自己的座位頻道");
  const pub = sent.filter((e) => e.channel === publicChannel(m1.code));
  const leakPub = pub.some((e) => all.some((id) => JSON.stringify(e.payload).includes(`"${id}"`)));
  eq([pub.some((e) => e.event === "th_hand_start"), leakPub, JSON.stringify(s0.body).includes(`"${rest[0].id}"`)], [true, false, false],
    "D3 公開頻道只說開局、不帶任何一張牌；剩下的 13 張不會出現在任何人的畫面");

  // 1 號先送出 → 0 號、觀戰都看不到 1 號的牌
  await sub(m1.roomId, "p1", autoArrange(hands[1]));
  const v0 = await state(m1.roomId, "p0", "p0");
  const others = hands.slice(1).flat().map((c) => c.id);
  const leak0 = others.filter((id) => JSON.stringify(v0.body).includes(`"${id}"`));
  const watch = await state(m1.roomId, "p2");     // 不帶座位的畫面（和被同意的觀戰者看到的一樣，觀戰流程見 flow-thirteen-room.ts）
  const leakW = hands.flat().filter((c) => JSON.stringify(watch.body).includes(`"${c.id}"`));
  const outsider = await state(m1.roomId, "watch"); // 沒被同意觀戰的外人（2026-11-18 起要先申請觀戰）
  eq([leak0, v0.body.players.map((p: { submitted: boolean }) => p.submitted), v0.body.reveal, watch.status, watch.body.me, leakW, outsider.status, outsider.body.error],
    [[], [false, true, false, false], null, 200, null, [], 403, "not_allowed"],
    "V1 亮牌前：0 號的畫面裡沒有任何一張別家的牌（只看得到 1 號已送出）；不帶座位的畫面一張都看不到；沒被同意觀戰的外人 403");
  const peek = await state(m1.roomId, "p0", "p1");
  eq([peek.status, peek.body.error, (await state(m1.roomId)).status, (await state(m1.roomId, undefined, "p0")).status],
    [403, "not_your_seat", 401, 401], "V2 拿別人的 playerId 讀狀態 403；沒登入 401");

  // ---------- X 送出檢查 ----------
  const h0 = hands[0];
  const good = autoArrange(h0);
  const foul = { ...good, middle: good.back, back: good.middle };
  const r1 = await sub(m1.roomId, "p0", foul);
  const r2 = await post(submitRoute, { roomId: m1.roomId, playerId: "p0", front: ids(good.front).slice(0, 2), middle: ids(good.middle), back: ids(good.back) }, "p0");
  const r3 = await post(submitRoute, { roomId: m1.roomId, playerId: "p0", front: [ids(good.front)[0], ...ids(good.front).slice(0, 2)], middle: ids(good.middle), back: ids(good.back) }, "p0");
  const r4 = await post(submitRoute, { roomId: m1.roomId, playerId: "p0", front: [hands[2][0].id, ...ids(good.front).slice(1)], middle: ids(good.middle), back: ids(good.back) }, "p0");
  const r5 = await sub(m1.roomId, "p2", autoArrange(hands[2]), "p0");
  const r6 = await post(submitRoute, { roomId: m1.roomId, playerId: "p0", front: "AS", middle: [], back: null }, "p0");
  eq([[r1.status, r1.body.error, r1.body.message], [r2.body.error, r2.body.message], r3.body.error, r4.body.error, [r5.status, r5.body.error], r6.body.error],
    [[400, "foul_middle_back", "倒水：中道不能比尾道大"], ["bad_size", "頭道要 3 張、中道和尾道各 5 張"], "duplicate_card", "not_your_card", [403, "not_your_seat"], "bad_input"],
    "X1 送出檢查：倒水、張數、同一張兩次、拿別家的牌、替別人送、格式不對 → 全部擋下");
  const okSub = await sub(m1.roomId, "p0", good);
  const change = await sub(m1.roomId, "p0", autoArrange([...h0].reverse()));
  const stored = (await state(m1.roomId, "p0", "p0")).body.me.arrangement as Arrangement;
  eq([okSub.status, change.status, change.body.error, change.body.message, ids(stored.front), ids(stored.back)],
    [200, 409, "already_submitted", "已經送出，不能再改", ids(good.front), ids(good.back)], "X2 送出後不能再改：第二次送出擋下，存的還是第一次的三墩");

  // ---------- T 截止時間 ----------
  const before = sent.length;
  NOW += 30_000; // 剛好到截止時間
  const late = await sub(m1.roomId, "p2", autoArrange(hands[2]));
  const after = await state(m1.roomId, "p2", "p2");
  eq([late.status, late.body.error, late.body.message, after.body.phase, after.body.reveal.autoArranged, evs(before, "th_auto_arranged").map((e) => e.payload.seats)],
    [409, "time_up", "理牌時間已到，系統已經幫你排好", "revealed", [2, 3], [[2, 3]]],
    "T1 截止時間一到（伺服器時間），送出不收；沒送出的 2、3 號由系統代排、直接亮牌（斷線的人也一樣，牌局不中斷）");

  // ---------- R 亮牌內容 ----------
  const rv = after.body.reveal;
  m1Totals.push(rv.result.totals);
  const view0 = (await state(m1.roomId, "p0", "p0")).body;
  eq([Object.keys(rv.order), rv.arrangements.length, rv.result.pairs.length, rv.result.totals.reduce((a: number, b: number) => a + b, 0),
    rv.playerScores, view0.playerScores],
    [["front", "middle", "back"], 4, 6, 0, rv.result.totals, rv.result.totals],
    "R1 亮牌後：每墩翻牌順序、四家三墩、6 組兩兩結算、本局四家合計 0、累計＝本局");
  eq(evs(before, "th_reveal").length === 1 && evs(before, "th_reveal")[0].channel === publicChannel(m1.code), true, "R2 亮牌內容走公開頻道送一次");
}

// ---------- T 送出和截止代排同時發生 ----------
{
  NOW += NEXT_HAND_MS; // 斷線（都沒按下一局）時間到 → 自動開第 2 局
  const s2 = await state(m1.roomId, "p0", "p0");
  eq([s2.body.handNo, s2.body.phase, s2.body.history.length], [2, "arranging", 1], "N1 亮牌後沒人按下一局，時間到也會自動開下一局（有人斷線不會卡住）");
  const h0 = s2.body.me.hand as Card[];
  const mine = autoArrange(h0);
  const deadline = s2.body.arrangeDeadline as number;
  NOW = deadline - 1;
  // 讓「送出」讀完狀態、要寫入的那一刻，時間剛好過截止、另一個請求先把代排寫進去
  const realFetch = globalThis.fetch;
  let intercepted = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!intercepted && init?.method === "PATCH" && String(input).includes("/th_rooms")) {
      intercepted = true;
      NOW = deadline;
      await post(tickRoute, { roomId: m1.roomId, playerId: "p1" }, "p1");
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const raced = await sub(m1.roomId, "p0", mine);
  globalThis.fetch = realFetch;
  const v = (await state(m1.roomId, "p0", "p0")).body;
  m1Totals.push(v.reveal.result.totals);
  const cum2 = v.playerScores;
  eq([intercepted, raced.status, raced.body.error, v.phase, v.reveal.autoArranged, ids(v.reveal.arrangements[0].front).join() === ids(autoArrange(h0).front).join()],
    [true, 409, "time_up", "revealed", [0, 1, 2, 3], true],
    "T2 送出和截止代排同時發生：代排先寫進去，送出那邊寫入衝突、重讀後已過截止 → 只認代排一個結果");
  eq(cum2, [0, 1, 2, 3].map((i) => m1Totals[0][i] + m1Totals[1][i]), "N4 第 2 局亮牌後，每一家的累計＝第 1 局＋第 2 局自己的本局分（逐家比對）");

  NOW += NEXT_HAND_MS;
  const s3 = (await state(m1.roomId, "p0", "p0")).body;
  const h = s3.me.hand as Card[];
  const a1 = autoArrange(h), a2 = autoArrange([...h].reverse());
  const both = await Promise.all([sub(m1.roomId, "p0", a1), sub(m1.roomId, "p0", a2)]);
  const st = (await state(m1.roomId, "p0", "p0")).body.me.arrangement as Arrangement;
  const winner = both[0].status === 200 ? a1 : a2;
  eq([both.map((b) => b.status).sort(), both.map((b) => b.body.error).filter(Boolean), ids(st.front).join() === ids(winner.front).join()],
    [[200, 409], ["already_submitted"], true], "T3 同一人同時送出兩次：只收一次，存的是成功的那一次");
}

// ---------- T 截止判斷本身（第二道防線）：就算沒先推進牌局，截止後的送出也不收 ----------
{
  const { submit: submitPure, seatPlayers: seatPure, startHand: startPure } = await import("../../lib/thirteen/flow");
  const { newRoomState } = await import("../../lib/thirteen/db");
  const st = newRoomState({ arrangeSec: 30, totalHands: 1 });
  seatPure(st, PIDS.map((p, i) => ({ id: `r${i}`, room_id: "x", player_id: p, name: p, seat: i, user_id: uid(i) })));
  startPure(st, 1_000_000);
  const a = autoArrange(st.players[0].hand);
  const idsOf = { front: ids(a.front), middle: ids(a.middle), back: ids(a.back) };
  const atDeadline = submitPure(st, 0, idsOf, st.arrangeDeadline!);
  const justBefore = submitPure(st, 0, idsOf, st.arrangeDeadline! - 1);
  eq([atDeadline, justBefore], [{ ok: false, error: "time_up", message: "理牌時間已到，系統已經幫你排好" }, { ok: true }],
    "T4 截止判斷本身：剛好到截止時間（伺服器時間）就不收，前 1 毫秒還收");
}

// ---------- N 多局累計、整場結束寫紀錄關房 ----------
{
  const rest3 = (await db.query<{ r: Card[] }>(`select game_state->'rest' r from th_rooms where id = $1`, [m1.roomId])).rows[0].r.map((c) => c.id);
  const dealt3 = (await db.query<{ h: Card[] }>(`select jsonb_path_query_array(game_state, '$.players[*].hand[*]') h from th_rooms where id = $1`, [m1.roomId])).rows[0].h.map((c) => c.id);
  const hands3 = (await db.query<{ p: { seat: number; hand: Card[] }[] }>(`select game_state->'players' p from th_rooms where id = $1`, [m1.roomId])).rows[0].p
    .sort((a, b) => a.seat - b.seat).map((x) => x.hand.map((c) => c.id).sort());
  const sentBefore3 = sent.length;
  for (const p of PIDS.slice(1)) await sub(m1.roomId, p, autoArrange(await myHand(m1.roomId, p)));
  const fin = (await state(m1.roomId, "p0", "p0"));
  const closedEv = sent.filter((e) => e.event === "th_room_closed").pop();
  const rec = (await db.query<{ game: string; end_reason: string; hands_played: number; settings: object }>(`select game, end_reason, hands_played, settings - 'finalHand' settings from match_records where room_id = $1`, [m1.roomId])).rows[0];
  const recP = (await db.query<{ seat: number; total_score: number; user_id: string }>(`select seat, total_score, user_id from match_record_players p join match_records r on r.id = p.match_id where r.room_id = $1 order by seat`, [m1.roomId])).rows;
  const gone = (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [m1.roomId])).rows[0].n;
  eq([fin.status, fin.body.error, fin.body.record?.endReason, rec, gone, (closedEv?.payload as { endReason: string })?.endReason],
    [410, "ended", "completed", { game: "thirteen", end_reason: "completed", hands_played: 3, settings: { arrangeSec: 30, totalHands: 3 } }, 0, "completed"],
    "Q1 第 3 局（最後一局）亮牌後自動寫對局紀錄並關房；之後讀狀態回 410 和總結算");
  const totals = recP.map((p) => p.total_score);
  const fh = fin.body.record?.finalHand ?? null; // 沒有最後一局（必修 4 沒修好）時下面的斷言會變紅，不會讓整支測試當掉
  m1Totals.push(fh?.result?.totals ?? [NaN, NaN, NaN, NaN]);
  eq([m1Totals.length, totals, recP.map((p) => p.user_id), fin.body.record.players.map((p: { totalScore: number }) => p.totalScore)],
    [3, [0, 1, 2, 3].map((i) => m1Totals[0][i] + m1Totals[1][i] + m1Totals[2][i]), PIDS.map((_, i) => uid(i)), totals],
    "N2 三局累計寫進紀錄：每一家的總分＝自己三局本局分的和（逐家比對）、帳號都記上");
  const fhIds = (fh?.arrangements ?? []).flatMap((a: Arrangement) => [...a.front, ...a.middle, ...a.back].map((c) => c.id));
  eq([fh?.handNo, fh?.over, Object.keys(fh?.order ?? {}).sort(), fh?.arrangements?.length, fh?.result?.pairs?.length, fh?.playerScores, fhIds.length,
    fhIds.every((id: string) => dealt3.includes(id)), fhIds.filter((id: string) => rest3.includes(id))],
    [3, true, ["back", "front", "middle"], 4, 6, totals, 52, true, []],
    "S4 關房後讀狀態（漏收廣播、重新整理）：410 的紀錄裡有完整的最後一局——四家三墩、翻牌順序、6 組結算、累計；只有發出去的 52 張，沒發出去的 13 張一張都沒有");
  // 小測：逐項比對最後一局的內容（不只看欄位和張數）
  const live = sent.slice(sentBefore3).find((e) => e.event === "th_reveal" && e.channel === publicChannel(m1.code))?.payload;
  const arrs = (fh?.arrangements ?? []) as Arrangement[];
  const perSeat = arrs.map((a) => [...a.front, ...a.middle, ...a.back].map((c) => c.id).sort());
  const recomputed = arrs.length === 4 ? scoreRound(arrs) : null;
  const { sv: _sv, ...liveReveal } = (live ?? {}) as Record<string, unknown>; // 即時廣播多帶存檔版本號 sv（前端補抓用），不屬於亮牌內容
  eq([!!live, typeof _sv, stable(fh) === stable(liveReveal)], [true, "number", true],
    "S4 紀錄裡的最後一局和當時即時廣播的亮牌（th_reveal，扣掉版本號 sv）逐欄一模一樣：三墩、翻牌順序、結算、累計、代排名單");
  // 2026-11-18 加一色每人 16 張：三墩是從自己 16 張裡挑的 13 張（另外 3 張不用）
  eq([perSeat.map((ids, i) => ids.length === 13 && new Set(ids).size === 13 && ids.every((id) => (hands3[i] as string[]).includes(id))), arrs.map((a) => [a.front.length, a.middle.length, a.back.length])],
    [[true, true, true, true], [[3, 5, 5], [3, 5, 5], [3, 5, 5], [3, 5, 5]]],
    "S4 每一家的三墩（頭 3、中 5、尾 5）共 13 張，全部是那一家這局發到的 16 張裡的牌，沒有混到別家的牌、沒有重複");
  eq([stable(fh?.result), stable(fh?.order)], [stable(recomputed), stable(arrs.length === 4 ? revealOrder(arrs) : null)],
    "S4 用紀錄裡的四家三墩重新給引擎算：6 組結算（每墩勝負、加分、打槍）、全壘打、本局分、翻牌順序都和紀錄裡的一模一樣");
}

// ---------- R／E 打槍、全壘打、規則書範例經 API ----------
type Ex = [string, string, string];
async function playExample(rows: Ex[]) {
  forceDeal(rows);
  const m = await newMatch({ totalHands: 5 });
  const arrs = rows.map(([f, mm, b]) => { const used = new Set<string>(); return { front: parseCards(f, used), middle: parseCards(mm, used), back: parseCards(b, used) }; });
  const rs = [];
  for (const [i, p] of PIDS.entries()) rs.push((await sub(m.roomId, p, arrs[i])).status);
  const v = (await state(m.roomId, "p0", "p0")).body;
  return { m, rs, rv: v.reveal };
}
const duel = async (a: Ex, b: Ex) => {
  const { rs, rv } = await playExample([a, b, a, b]);
  return rs.every((x) => x === 200) ? rv.result.pairs.find((p: { a: number; b: number }) => p.a === 0 && p.b === 1).points : `送出失敗 ${rs}`;
};
{
  const d: [Ex, Ex, number][] = [
    [["2C 7D 9H", "3H 3D 8C 8S KD", "4C 5D 6H 7S 8D"], ["5H 5C 2D", "TD TC 2H 4S 9C", "JS JH JC 3C 6D"], 1],
    [["QH QD 3C", "8H 8D 4C 4D 2S", "5C 6D 7H 8S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"], 4],
    [["QH QD QC", "8H 8D 8C 4D 4H", "5C 5D 5H 5S 9C"], ["JH TD 2C", "7C 7D 3H 5S KC", "9H 9D 6C 6S AC"], 8],
    [["2C 2D 9H", "7H 7D 7C 7S 3D", "AS AH AD AC 4H"], ["6H 6D 3C", "4S 5S 6S 7S 8S", "9D TD JD QD KD"], -13],
    [["AS AH KD", "3H 3D 3C 7S 8D", "4H 5D 6C 7H 8C"], ["AS AD KC", "2H 2D 2C 9S TD", "8S 9H TH JH QH"], 0],
    [["AS AH KD", "3H 3D 3C 7S 8D", "9C TC JC QD KH"], ["AS AD KC", "2H 2D 2C 9S TD", "8S 9H TH JH QH"], 2],
    [["2D 3D 5C", "9C 9D 4H 4C JD", "KS KS 9S 5S 2S"], ["2H 4D 6C", "TC TD 3S 3C QD", "AH QH JH 8H 3H"], -1],
    [["KH KD 2C", "QH QD QC 3H 3D", "AS AS AH AD AC"], ["JH JD 4C", "TS TH TD 5H 5D", "5S 6S 7S 8S 9S"], 8],
    [["2H 3D 7C", "9S 9S 9H 9D 9C", "TS TS TH TD TC"], ["QH QD 5C", "JH JD JC 6H 6D", "AS AH AD AC 8H"], 13],
    [["2C 3D 7H", "8H 8D 9C 9D KH", "AS 2S 3H 4D 5C"], ["4H 9H JC", "TC TD QC QD KD", "2H 3S 4S 5S 6C"], -4],
  ];
  const got = [];
  for (const [a, b] of d) got.push(await duel(a, b));
  eq(got, d.map((x) => x[2]), "E1 規則書範例 1～10（兩人對比）經 API 送出、伺服器結算，分數和規則書一致");

  const ex11 = await playExample([["QH QD QS", "8H 8D 8S 4D 4H", "5C 5D 5H 5S 9C"], ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S AC"], ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"], ["6H 7H 8C", "AH AD 3S 4S KH", "TH TS QS QC 7S"]]);
  const ex12 = await playExample([["KH KD 2C", "QH QD QC 3H 3D", "AS AH AD AC 4C"], ["2H 2D 9C", "TS TH TD TC JH", "5S 6S 7S 8S 9S"], ["3C 4D 6H", "JS JC 8D 8H 5C", "6S 6C 6D 7H 7D"], ["4H 5D 7C", "KS KC 9D 9H 2S", "8C 9S TS JD QS"]]);
  const ex13 = await playExample([["QH QD QS", "8H 8D 8C 8S 4D", "AS AS AH AD AC"], ["JH TD 2C", "7C 7D 3H 2S KC", "9H 9D 6C 6S QC"], ["2H 3D 4C", "TC TS 3C 9S KD", "JS JC JD 2D 6D"], ["6H 7H 5C", "KH KS 3S 4S 5D", "TH TS 7S 7S 9C"]]);
  const pr = (r: { result: { pairs: { a: number; b: number; points: number; gunner: number | null }[] } }) => r.result.pairs.map((p) => [p.a, p.b, p.points, p.gunner]);
  eq([ex11.rv.result.totals, ex11.rv.result.homeRun, pr(ex11.rv)],
    [[33, -13, -11, -9], 0, [[0, 1, 8, 0], [0, 2, 8, 0], [0, 3, 8, 0], [1, 2, -1, null], [1, 3, -1, null], [2, 3, -1, null]]],
    "E2／R3 範例 11 經 API：0 號打槍三家（每組 gunner＝0）＋全壘打（homeRun＝0）→ +33／−13／−11／−9");
  eq([ex12.rv.result.totals, ex12.rv.result.homeRun, pr(ex12.rv), ex12.rv.order],
    [[4, 30, -18, -16], null, [[0, 1, -8, null], [0, 2, 6, 0], [0, 3, 6, 0], [1, 2, 11, 1], [1, 3, 11, 1], [2, 3, -1, null]],
      { front: [[2], [3], [1], [0]], middle: [[2], [3], [0], [1]], back: [[3], [2], [0], [1]] }],
    "E3 範例 12 經 API：一般局 +4／+30／−18／−16、打槍兩組；亮牌順序每墩從最小到最大");
  const bonus = ex13.rv.result.pairs.find((p: { a: number; b: number }) => p.a === 0 && p.b === 1).rows;
  eq([ex13.rv.result.totals, ex13.rv.result.homeRun, [bonus.front.bonus, bonus.middle.bonus, bonus.back.bonus]],
    [[51, -19, -17, -15], 0, [2, 4, 4]], "E4／R4 範例 13 經 API：衝三 +2、中道鐵支 +4、尾道五龍 +4 的牌型加分都在結算裡，+51／−19／−17／−15");

  // 範例 14：倒水邊界經 API
  forceDeal([["AH AD KC", "AS AC KD QH JS", "2H 2D 2C 2S 5D"], ["3H 4D 6C", "7C 8D 9H JC QD", "3S 3C 5H 5C 6D"], ["2D 4C 7H", "8C 9D TH JD KH", "4S 4H 6S 6H 8S"], ["5D 7D 9S", "TC TD QS KS AH", "7S 9C JH QC KC"]]);
  const m14 = await newMatch({ totalHands: 2 });
  const h14 = await myHand(m14.roomId, "p0");
  const pick = (s: string) => s.split(" ").map((k) => h14.find((c) => c.id.startsWith(k[1] + k[0]))!.id); // 牌 id 是「花色＋點數＋第幾副」
  const bad = await post(submitRoute, { roomId: m14.roomId, playerId: "p0", front: pick("AH AD KC"), middle: pick("AS AC QH JS 5D"), back: pick("2H 2D 2C 2S KD") }, "p0");
  const okEq = await post(submitRoute, { roomId: m14.roomId, playerId: "p0", front: pick("AH AD KC"), middle: pick("AS AC KD QH JS"), back: pick("2H 2D 2C 2S 5D") }, "p0");
  eq([bad.body.error, okEq.status], ["foul_front_middle", 200], "E5 範例 14 經 API：頭道比中道大 → 倒水擋下；AA+K 對 AA+K+… 相等可以送出");
}

// ---------- Q 解散投票 ----------
{
  const m = await newMatch({ totalHands: 4 });
  for (const p of PIDS) await sub(m.roomId, p, autoArrange(await myHand(m.roomId, p))); // 打完第 1 局
  const req = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  const dup = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p1" }, "p1");
  const fake = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: true }, "p1");
  const no = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: false }, "p2");
  const after = (await state(m.roomId, "p0", "p0")).body.leaveRequest;
  eq([req.status, dup.body.error, fake.status, no.body.result, after], [200, "already_requested", 403, "denied", null],
    "Q2 解散投票：發起、不能重複發起、不能替別人投；有人不同意就取消");
  await post(leaveReqRoute, { roomId: m.roomId, playerId: "p1" }, "p1");
  const v1 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p0", approve: true }, "p0");
  const v2 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: true }, "p2");
  const still = (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [m.roomId])).rows[0].n;
  const v3 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: true }, "p3");
  const rec = (await db.query<{ end_reason: string; hands_played: number }>(`select end_reason, hands_played from match_records where room_id = $1`, [m.roomId])).rows[0];
  const ev = sent.filter((e) => e.event === "th_room_closed").pop();
  eq([v1.body.result, v2.body.approvedCount, still, v3.body.result, rec, (ev?.payload as { endReason: string }).endReason, (await state(m.roomId, "p0", "p0")).status],
    ["vote", 2, 1, "granted", { end_reason: "dissolved", hands_played: 1 }, "dissolved", 410],
    "Q3 四家都同意才解散（approvedCount＝其他三家裡已同意的人數，和麻將一樣不含發起人）：寫中途解散紀錄（只算打完的 1 局）並關房，之後讀狀態 410");
  // 一局都沒打完就解散：只關房、不寫紀錄
  const m2 = await newMatch({ totalHands: 2 });
  await post(leaveReqRoute, { roomId: m2.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2", "p3"]) await post(leaveVoteRoute, { roomId: m2.roomId, playerId: p, approve: true }, p);
  const r2 = (await db.query<{ n: number }>(`select (select count(*)::int from th_rooms where id = $1) + (select count(*)::int from match_records where room_id = $1) n`, [m2.roomId])).rows[0].n;
  eq([r2, (await state(m2.roomId, "p0", "p0")).status], [0, 404], "Q4 一局都沒打完就解散：只關房、不寫紀錄（之後讀狀態 404）");
}

// ---------- N 下一局：四家都按就開 ----------
{
  const m = await newMatch({ totalHands: 2 });
  for (const p of PIDS) await sub(m.roomId, p, autoArrange(await myHand(m.roomId, p)));
  const r = [];
  for (const p of PIDS.slice(0, 3)) r.push((await post(nextRoute, { roomId: m.roomId, playerId: p }, p)).body.handNo);
  const twice = await post(nextRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  const last = await post(nextRoute, { roomId: m.roomId, playerId: "p3" }, "p3");
  const v = (await state(m.roomId, "p3", "p3")).body;
  const h1 = v.history[0].totals;
  eq([r, twice.body.handNo, last.body.handNo, v.phase, v.me.hand.length, v.playerScores, v.history.length],
    [[1, 1, 1], 1, 2, "arranging", 16, h1, 1], "N3 亮牌後四家都按下一局才開（重複按不算兩次）；新的一局重新發 16 張、每一家的累計＝第 1 局自己的分數（逐家比對）");
}

// ---------- S1 座位頻道綁這一場和座位主人（審伯必修 1） ----------
{
  const OTHER = "00000000-0000-4000-8000-0000000000d1";
  // 審伯的情境：同一個房號、同一個 playerId，不同房間（下一場）或不同帳號 → 頻道都不一樣
  const a = privateChannel("00000000-0000-4000-9000-00000000000a", "1234", "p0", uid(0));
  const b = privateChannel("00000000-0000-4000-9000-00000000000b", "1234", "p0", OTHER);
  const sameUserNextMatch = privateChannel("00000000-0000-4000-9000-00000000000b", "1234", "p0", uid(0));
  eq([a === b, a === sameUserNextMatch, a === privateChannel("00000000-0000-4000-9000-00000000000a", "1234", "p0", uid(0))], [false, false, true],
    "S1 座位頻道綁房間 uuid 和帳號：房號、playerId 被下一場重用時頻道不同（舊場的人收不到新場手牌）；同一場同一帳號算出來一樣");
  // 實際兩場：上一場的座位頻道收不到這一場的任何一張手牌；重連拿到的頻道就是這場發牌的那個
  const mA = await newMatch({ totalHands: 2 });
  const oldCh = (await post(joinRoute, { code: mA.code, playerId: "p0", name: "玩家0" }, "p0")).body.channel;
  const before = sent.length;
  const mB = await newMatch({ totalHands: 2 });
  const rej = await post(joinRoute, { code: mB.code, playerId: "p0", name: "玩家0" }, "p0");
  const dealB = sent.slice(before).filter((e) => e.event === "th_deal_hand");
  eq([dealB.length, dealB.some((e) => e.channel === oldCh), rej.body.rejoined, dealB.find((e) => e.payload.playerId === "p0")?.channel === rej.body.channel],
    [4, false, true, true], "S1 實際兩場：上一場 p0 的座位頻道收不到下一場任何手牌；本人重連拿到的頻道正是這一場發牌用的");
}

{
  // 小測：完整重用情境——上一場解散關房後，下一場用「同一個房號」開房，另一個帳號拿「同一個 playerId p0」入座
  const prev = await newMatch({ totalHands: 2 });
  const prevCh = (await post(joinRoute, { code: prev.code, playerId: "p0", name: "玩家0" }, "p0")).body.channel; // 上一場 p0（帳號 uid(0)）的座位頻道
  await post(leaveReqRoute, { roomId: prev.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2", "p3"]) await post(leaveVoteRoute, { roomId: prev.roomId, playerId: p, approve: true }, p);
  const prevGone = (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where code = $1`, [prev.code])).rows[0].n;
  const reuse = await insertRoom({ code: prev.code, host_id: "p0", host_user_id: OTHER, settings: { arrangeSec: 30, totalHands: 1 } }); // 房號被下一場重用
  const nextId = typeof reuse === "object" ? reuse.id : "";
  const j0 = await post(joinRoute, { code: prev.code, playerId: "p0", name: "新的p0" }, "other");
  for (const [i, p] of ["p1", "p2", "p3"].entries()) await post(joinRoute, { code: prev.code, playerId: p, name: `玩家${i + 1}` }, p);
  const before = sent.length;
  const st = await post(startRoute, { roomId: nextId, playerId: "p0" }, "other");
  const deals = sent.slice(before).filter((e) => e.event === "th_deal_hand");
  const reJoin = await post(joinRoute, { code: prev.code, playerId: "p0", name: "新的p0" }, "other");
  eq([prevGone, nextId !== prev.roomId, j0.status, st.status, deals.length, deals.filter((e) => e.channel === prevCh).length,
    deals.find((e) => e.payload.playerId === "p0")?.channel === j0.body.channel, reJoin.body.rejoined, reJoin.body.channel === j0.body.channel, j0.body.channel === prevCh],
    [0, true, 200, 200, 4, 0, true, true, true, false],
    "S1 完整重用：上一場關房後，同一個房號開下一場、另一個帳號拿同一個 playerId p0 入座開局——上一場 p0 的頻道一張新場手牌都收不到；新的 p0 發牌和重連用的是同一個新頻道");
}

// ---------- S2 房主綁開房帳號（審伯必修 2） ----------
{
  const c = await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 1 }, "p0");
  const grab = await post(joinRoute, { code: c.body.code, playerId: "p0", name: "搶房主" }, "watch");
  const w = await post(joinRoute, { code: c.body.code, playerId: "w1", name: "旁人" }, "watch");
  for (const [i, p] of ["p1", "p2"].entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i + 1}` }, p);
  const host = await post(joinRoute, { code: c.body.code, playerId: "p0", name: "玩家0" }, "p0");
  const wStart = await post(startRoute, { roomId: c.body.roomId, playerId: "w1" }, "watch");
  const ok = await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  const hostRe = await post(joinRoute, { code: c.body.code, playerId: "p0", name: "玩家0" }, "p0");
  eq([grab.status, grab.body.error, w.status, host.status, host.body.seat, wStart.body.error, ok.status, hostRe.body.rejoined],
    [403, "host_reserved", 200, 200, 3, "not_host", 200, true],
    "S2 別的帳號知道房主 id 也坐不進房主的座位、不能開局；開房的帳號照常入座、開局、重連");
}

// ---------- S3 解散最後一票（審伯必修 3） ----------
{
  const realFetch = globalThis.fetch;
  const recN = async (roomId: string) => (await db.query<{ n: number }>(`select count(*)::int n from match_records where room_id = $1`, [roomId])).rows[0].n;
  const roomN = async (roomId: string) => (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [roomId])).rows[0].n;
  // 最後一票要存檔時，別人剛好先存了新的（版本衝突）→ 重讀重判，票不遺失、照樣解散、紀錄一筆
  const m = await newMatch({ totalHands: 3 });
  for (const p of PIDS) await sub(m.roomId, p, autoArrange(await myHand(m.roomId, p)));
  await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2"]) await post(leaveVoteRoute, { roomId: m.roomId, playerId: p, approve: true }, p);
  let hit = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!hit && init?.method === "PATCH" && String(input).includes("/th_rooms")) { hit = true; await post(nextRoute, { roomId: m.roomId, playerId: "p1" }, "p1"); }
    return realFetch(input, init);
  }) as typeof fetch;
  const last = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: true }, "p3");
  globalThis.fetch = realFetch;
  eq([hit, last.status, last.body.result, await roomN(m.roomId), await recN(m.roomId)], [true, 200, "granted", 0, 1],
    "S3 最後一票遇到版本衝突：重讀重判，這一票沒有遺失，照樣解散並只寫一筆紀錄");

  // 關房那一刻失敗：不回成功；四家同意已經存著，之後讀狀態就補關，紀錄只寫一筆
  const m2 = await newMatch({ totalHands: 3 });
  for (const p of PIDS) await sub(m2.roomId, p, autoArrange(await myHand(m2.roomId, p)));
  await post(leaveReqRoute, { roomId: m2.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2"]) await post(leaveVoteRoute, { roomId: m2.roomId, playerId: p, approve: true }, p);
  let failed = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!failed && String(input).includes("/rpc/close_room_with_record")) { failed = true; return new Response(JSON.stringify({ code: "08006", message: "connection lost" }), { status: 503, headers: { "content-type": "application/json" } }); }
    return realFetch(input, init);
  }) as typeof fetch;
  const lastVote = await post(leaveVoteRoute, { roomId: m2.roomId, playerId: "p3", approve: true }, "p3");
  globalThis.fetch = realFetch;
  const saved = (await db.query<{ a: string[] }>(`select game_state->'leaveRequest'->'approvedBy' a from th_rooms where id = $1`, [m2.roomId])).rows[0].a;
  const deny = await post(leaveVoteRoute, { roomId: m2.roomId, playerId: "p1", approve: false }, "p1");
  const poll = await state(m2.roomId, "p0", "p0");
  eq([failed, lastVote.status, lastVote.body.ok, saved.length, deny.body.result, poll.status, poll.body.record?.endReason, await roomN(m2.roomId), await recN(m2.roomId)],
    [true, 500, undefined, 4, "granted", 410, "dissolved", 0, 1],
    "S3 關房那一刻失敗：回 500、不假報成功；第四票已經存著（4 票），之後再投不同意也不能推翻已成立的解散，補關成功、紀錄只寫一筆");

  // 被否決後重新發起：舊的同意票不會被沿用
  const m3 = await newMatch({ totalHands: 3 });
  await post(leaveReqRoute, { roomId: m3.roomId, playerId: "p0" }, "p0");
  await post(leaveVoteRoute, { roomId: m3.roomId, playerId: "p2", approve: true }, "p2");
  await post(leaveVoteRoute, { roomId: m3.roomId, playerId: "p3", approve: false }, "p3");
  await post(leaveReqRoute, { roomId: m3.roomId, playerId: "p1" }, "p1");
  const v = await post(leaveVoteRoute, { roomId: m3.roomId, playerId: "p0", approve: true }, "p0");
  eq([v.body.result, v.body.approvedCount, v.body.needed, await roomN(m3.roomId)], ["vote", 1, 3, 1], "S3 投票被否決後重新發起：之前的同意票不沿用（其他三家只有這一票＝1／3），不會用舊票關房");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
