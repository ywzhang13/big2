// 牌局回放的讀取 API 和資料庫（20261113_mahjong_replay.sql；老闆 2026-11-13：保留 7 天、只有上桌 4 人能看）
//   A1 整場還沒結束（沒有對戰紀錄）：上桌的人也讀不到（403 not_finished）
//   A2 整場結束後，上桌 4 人都讀得到列表和整局紀錄（四家完整資料、牌面對照）
//   A3 觀戰者、其他人 403；未登入 401；參數錯 400；沒有紀錄的局 404
//   A4 整場結束滿 7 天：列表、整局都回 410 並附到期時間（資料還沒清掉也一樣）
//   A5 過期自動刪除：之後任何一局寫入時順手刪掉；沒有對戰紀錄、寫入超過 14 天的也刪
//   A6 同一局重送不重複、不覆蓋
//   A7 公開金鑰（anon、authenticated）讀不到表、不能呼叫函式
//   A8 回放紀錄不會出現在給前端的牌局狀態（公開、本人、觀戰）
//   A9 開局補花就胡（發牌和結算同一次存檔）也有完整紀錄
//   A10 rollback 只刪本次新增的表和函式，對戰紀錄不動；可以再套用一次
import { GET as listGet } from "../../app/api/mahjong/replay/route";
import { GET as handGet } from "../../app/api/mahjong/replay/hand/route";
import { tokens } from "../support/stub-auth";
import { addMatch, addMatchPlayers, clock } from "../support/stub-zimofx-store";
import { db, saveReplay } from "../support/stub-replay-store";
import { dealTiles, initGame } from "../../lib/mahjong/gameLogic";
import { replayFrames, decodeRecord, snapshot, stepReplay, summaryOf, type ReplayRecord } from "../../lib/mahjong/replay/log";
import { toPlayerGameState, toPublicGameState, toSpectatorGameState } from "../../lib/mahjong/db";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const d = await db();
const U = ["a", "b", "c", "d", "e", "f"].map((x) => `${x.repeat(8)}-0000-4000-8000-0000000000aa`);
["A", "B", "C", "D", "E", "S"].forEach((n, i) => { tokens[`tok${n}`] = { id: U[i], displayName: n, pictureUrl: null, isGuest: false }; });
const T = (s: string) => Date.parse(s + "+08:00");

/** 做一局真的發牌、直接流局結算的紀錄（stepReplay 和牌局存檔走同一個函式） */
function makeHand(hand: number): ReplayRecord {
  const s = initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "玩家" + (i + 1) })), { totalRounds: 1, basePoints: 100, fanPoints: 20 });
  const g = dealTiles(s);
  Object.assign(g, { startedAt: "2026-11-13T10:00:00.000Z", handsCompleted: hand - 1 });
  stepReplay(g, 1000);
  g.players[0].discards.push(g.players[0].hand.pop()!);
  stepReplay(g, 2000);
  Object.assign(g, { status: "finished", handsCompleted: hand, settlement: { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 } });
  return stepReplay(g, 3000)!;
}
async function put(roomId: string, hand: number, at: number) {
  clock.now = at;
  const rec = makeHand(hand);
  return saveReplay(roomId, hand, summaryOf(rec), rec);
}
const call = async (fn: (r: Request) => Promise<Response>, q: string, tok?: string) => {
  const r = await fn(new Request("http://x/api" + q, { headers: tok ? { authorization: `Bearer ${tok}` } : {} }));
  return { status: r.status, body: await r.json() };
};
const matchId = async (roomId: string) => (await d.query<{ id: string }>("select id from match_records where room_id = $1", [roomId])).rows[0]?.id;
const count = async (roomId: string) => (await d.query("select 1 from mj_hand_replays where room_id = $1", [roomId])).rows.length;

const R1 = "cc000000-0000-4000-8000-000000000001";
const START = T("2026-11-13T20:00:00"), END = T("2026-11-13T21:10:00");
await put(R1, 1, START + 600_000);
await put(R1, 2, START + 1_200_000);

// ---- A1 還在打 ----
// 還沒有對戰紀錄，所以也沒有 matchId；用一個不存在的 id 和「別場的 id」都一樣 403
eq((await call(listGet, "/replay?matchId=99999999-0000-4000-8000-000000000000", "tokA")).body, { error: "not_finished" }, "A1 整場還沒結束（沒有對戰紀錄）：讀不到，403 not_finished");

// ---- A2 結束後上桌的人 ----
await addMatch(R1, "5501", START, END);
await addMatchPlayers(R1, [U[0], U[1], U[2], U[3]]);
await d.query("update match_record_players set player_name = '玩家' || (seat + 1) where match_id = $1", [await matchId(R1)]);
const M1 = await matchId(R1);
clock.now = END + 3600_000;
const expires = new Date(END + 7 * 86400_000).toISOString();
const la = await call(listGet, `/replay?matchId=${M1}`, "tokA");
eq([la.status, la.body.mySeat, la.body.expiresAt, la.body.roomCode, la.body.players.map((p: { name: string }) => p.name), la.body.hands.map((h: { handNo: number; reason: string; steps: number }) => [h.handNo, h.reason, h.steps])],
  [200, 0, expires, "5501", ["玩家1", "玩家2", "玩家3", "玩家4"], [[1, "draw", 2], [2, "draw", 2]]],
  "A2a 上桌的 A：列表 200，有第 1、2 局的摘要（流局、2 步），到期時間＝整場結束＋7 天");
const ha = await call(handGet, `/replay/hand?matchId=${M1}&hand=2`, "tokA");
const view = ha.body.replay;
const allIds = view.init.seats.flatMap((x: { h: number[]; f: number[] }) => [...x.h, ...x.f]).concat(view.init.wall);
eq([ha.status, view.hand, view.init.seats.map((x: { h: number[] }) => x.h.length), allIds.length, new Set(allIds).size, Object.keys(ha.body.tiles).length,
  view.events.map((e: { k: string[] }) => e.k), replayFrames(view).length],
  [200, 2, view.init.seats.map((x: { h: number[] }) => x.h.length), 144, 144, 144, [["discard"], ["draw_game"]], 3],
  "A2b 整局紀錄：四家手牌都在（可切換任何一家）、144 張牌各一張、牌面對照 144 張、事件已解開（打牌、流局）");
const others = await Promise.all(["tokB", "tokC", "tokD"].map(async (t) => [(await call(listGet, `/replay?matchId=${M1}`, t)).body.mySeat, (await call(handGet, `/replay/hand?matchId=${M1}&hand=1`, t)).status]));
eq(others, [[1, 200], [2, 200], [3, 200]], "A2c 上桌的 B、C、D 也都讀得到（各自的座位）");

// ---- A3 權限、參數 ----
eq([(await call(listGet, `/replay?matchId=${M1}`, "tokE")).status, (await call(handGet, `/replay/hand?matchId=${M1}&hand=1`, "tokE")).body],
  [403, { error: "not_player" }], "A3a 沒上桌的人：列表、整局都 403 not_player");
eq([(await call(listGet, `/replay?matchId=${M1}`, "tokS")).status, (await call(handGet, `/replay/hand?matchId=${M1}&hand=1`, "tokS")).status],
  [403, 403], "A3b 觀戰者（不在這場的入座名單）：403");
eq([(await call(listGet, `/replay?matchId=${M1}`)).status, (await call(handGet, `/replay/hand?matchId=${M1}&hand=1`)).status], [401, 401], "A3c 未登入：401");
eq([(await call(listGet, "/replay?matchId=abc", "tokA")).body, (await call(handGet, `/replay/hand?matchId=${M1}&hand=x`, "tokA")).body, (await call(handGet, `/replay/hand?matchId=${M1}&hand=0`, "tokA")).status],
  [{ error: "bad_match_id" }, { error: "bad_hand" }, 400], "A3d 參數錯：400（matchId 不是 uuid、hand 不是正整數）");
eq((await call(handGet, `/replay/hand?matchId=${M1}&hand=3`, "tokA")).body, { error: "not_found" }, "A3e 這場沒有紀錄的局：404 not_found");

// ---- A4 到期 ----
clock.now = END + 7 * 86400_000 - 60_000;
eq((await call(listGet, `/replay?matchId=${M1}`, "tokA")).status, 200, "A4a 到期前 1 分鐘：照常 200");
clock.now = END + 7 * 86400_000;
const gl = await call(listGet, `/replay?matchId=${M1}`, "tokA");
const gh = await call(handGet, `/replay/hand?matchId=${M1}&hand=1`, "tokA");
eq([gl.status, gl.body, gh.status, gh.body, await count(R1)], [410, { error: "expired", expiresAt: expires }, 410, { error: "expired", expiresAt: expires }, 2],
  "A4b 整場結束滿 7 天：列表、整局都 410 並附到期時間（資料還沒被清掉也讀不到）");
eq((await call(listGet, `/replay?matchId=${M1}`, "tokE")).status, 403, "A4c 過期的場次，沒上桌的人仍是 403（不透露到期資訊）");

// ---- A5 自動刪除 ----
const R2 = "cc000000-0000-4000-8000-000000000002", R3 = "cc000000-0000-4000-8000-000000000003", R4 = "cc000000-0000-4000-8000-000000000004";
await put(R3, 1, T("2026-11-01T10:00:00")); // 沒有對戰紀錄的房（從沒結束），11/1 寫入
await put(R4, 1, T("2026-11-14T10:00:00")); // 沒有對戰紀錄，11/14 寫入
eq([await count(R1), await count(R3), await count(R4)], [2, 1, 1], "A5a 11/14 寫入時：R1 還沒滿 7 天、R3 寫入還沒滿 14 天，都不刪");
await put(R2, 1, T("2026-11-21T12:00:00"));
eq([await count(R1), await count(R3), await count(R4), await count(R2)], [0, 0, 1, 1],
  "A5b 11/21 任何一局寫入時順手清除：整場結束滿 7 天的 R1（2 局）刪掉、沒有對戰紀錄且寫入滿 14 天的 R3 刪掉；R4、新寫的 R2 照留");
eq((await call(listGet, `/replay?matchId=${M1}`, "tokA")).body.error, "expired", "A5c 刪掉之後讀取照樣是 410 expired（不是 404）");

// ---- A6 重送 ----
const first = (await d.query<{ data: ReplayRecord }>("select data from mj_hand_replays where room_id = $1 and hand_no = 1", [R2])).rows[0].data;
const again = makeHand(1);
eq([await saveReplay(R2, 1, summaryOf(again), again), JSON.stringify((await d.query<{ data: ReplayRecord }>("select data from mj_hand_replays where room_id = $1 and hand_no = 1", [R2])).rows[0].data) === JSON.stringify(first)],
  [0, true], "A6 同一局重送：不新增、不覆蓋原本的紀錄");

// ---- A7 公開金鑰 ----
const denied: string[] = [];
for (const role of ["anon", "authenticated"]) {
  for (const sql of ["select * from mj_hand_replays", `select * from mj_replay_hands('${R2}')`, `select mj_replay_hand('${R2}', 1)`,
    `select * from mj_replay_match('${M1}', '${U[0]}')`, `select mj_replay_save('${R2}', 9, '{}', '{}')`, "select mj_replay_purge()", "delete from mj_hand_replays"]) {
    try { await d.exec(`set role ${role}; ${sql}; reset role;`); } catch { denied.push(`${role}`); }
    await d.exec("reset role;");
  }
}
eq(denied.length, 14, "A7 anon、authenticated 讀表、刪表、呼叫 5 個函式全部被拒絕（14/14）");

// ---- A8 不外流 ----
{
  const s = dealTiles(initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "P" + i })), { totalRounds: 1, basePoints: 100, fanPoints: 20 }));
  Object.assign(s, { startedAt: "2026-11-13T10:00:00.000Z", handsCompleted: 0 });
  stepReplay(s, 0);
  const views = [toPublicGameState(s), toPlayerGameState(s, "p0"), toSpectatorGameState(s, "p1")].map((v) => JSON.stringify(v));
  eq([!!s.replayLog, views.map((v) => v.includes("replayLog") || v.includes('"init"') || v.includes('"ev"'))], [true, [false, false, false]],
    "A8 牌局狀態裡有進行中的回放紀錄，但公開、本人、觀戰三種給前端的狀態都不帶（牌牆順序不會外流）");
}

// ---- A9 開局補花就胡 ----
{
  const s = dealTiles(initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "P" + i })), { totalRounds: 1, basePoints: 100, fanPoints: 20 })) as MahjongGameState;
  Object.assign(s, { startedAt: "2026-11-13T10:00:00.000Z", handsCompleted: 1, status: "finished",
    settlement: { deltas: [300, -100, -100, -100], reason: "self_draw", fanTotal: 8, paymentPerPlayer: 100 },
    winners: [{ seat: 0, from: null, score: { fans: [{ name: "八仙過海", value: 8 }], totalFan: 8 } }] });
  const rec = stepReplay(s, 0)!;
  const again2 = stepReplay(s, 10);
  eq([rec.hand, rec.result.reason, rec.result.winners[0].selfDraw, JSON.stringify(replayFrames(decodeRecord(rec)).pop()) === JSON.stringify(snapshot(s)), again2],
    [1, "self_draw", true, true, null], "A9 開局補花就胡（發牌和結算同一次存檔）：照樣有一局紀錄；之後再存檔不會重複交出");
}

// ---- A10 rollback ----
{
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const before = (await d.query("select count(*)::int n from match_records")).rows[0];
  await d.exec(readFileSync(path.join(dir, "20261113_mahjong_replay_rollback.sql"), "utf8"));
  const left = (await d.query<{ n: number }>(`select (select count(*) from pg_proc where proname like 'mj_replay%')::int + (case when to_regclass('public.mj_hand_replays') is null then 0 else 1 end) n`)).rows[0].n;
  const after = (await d.query("select count(*)::int n from match_records")).rows[0];
  await d.exec(readFileSync(path.join(dir, "20261113_mahjong_replay.sql"), "utf8"));
  const back = (await d.query<{ n: number }>("select count(*)::int n from pg_proc where proname like 'mj_replay%'")).rows[0].n;
  eq([left, JSON.stringify(after) === JSON.stringify(before), back], [0, true, 5], "A10 rollback 刪光本次新增的表和 5 個函式、對戰紀錄筆數不變；之後可以再套用一次");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
