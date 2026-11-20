// 總大廳歷史紀錄（老柯 2026-11-20，第二批），走真的路由；資料庫是記憶體 PostgreSQL 跑真的 migration（含 20261120_match_history.sql）。
// 十三支場次用真的開房、入座、開局、送出、下一局路由打完（真的寫進共用的 match_records）；麻將、大老二的場次直接寫進紀錄表（格式同 close_room_with_record）。
//   H1 十三支打完一場：紀錄表有這場，四家都有帳號；會出現在 A 的「全部」和「十三支」頁籤
//   H2 只看得到自己有參加的：A 查不到 B 單獨參加的麻將場；C 只看得到自己那兩場
//   H3 四個頁籤：麻將＋十三支＋大老二＝全部；大老二紀錄沒記帳號，一律 0 場；頁籤只回那一款
//   H4 每筆的欄位：日期、遊戲、房號、局數設定、實際局數、自己的分數、四家名字和分數（isMe 標自己）；沒有房卡、沒有帳號 id
//   H5 分頁：每頁 2 筆翻到底，合起來等於全部、新到舊、不重複；summary：單一遊戲有總輸贏，全部頁籤不加總（null）
//   H6 沒登入 401；game、limit、cursor 不對 400
//   H7 游標嚴格驗證（審伯初審必修）：不存在的日期、越界的時間和時區、多欄缺欄都 400（不是 500）；合法閏日、時區偏移照常 200
//   H8 六位小數秒：同一毫秒內不同微秒、同一時間不同 id 的場次，每頁 1 筆翻到底和一次拿全部一樣，不漏不重複
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POST as thCreate } from "../../app/api/thirteen/create/route";
import { POST as thJoin } from "../../app/api/thirteen/join/route";
import { POST as thStart } from "../../app/api/thirteen/start/route";
import { GET as thState } from "../../app/api/thirteen/state/route";
import { POST as thSubmit } from "../../app/api/thirteen/submit/route";
import { POST as thNext } from "../../app/api/thirteen/next-game/route";
import { GET as recordsRoute } from "../../app/api/records/route";
import { clock } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import type { Card } from "../../lib/thirteen/cards";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
await db.exec(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261120_match_history.sql"), "utf8"));
clock.now = () => Date.parse("2026-11-20T12:00:00Z");
const U: Record<string, string> = { a: "00000000-0000-4000-8000-0000000000a1", b: "00000000-0000-4000-8000-0000000000b2", c: "00000000-0000-4000-8000-0000000000c3",
  d: "00000000-0000-4000-8000-0000000000d4", e: "00000000-0000-4000-8000-0000000000e5" };
for (const [k, id] of Object.entries(U)) tokens[`tk-${k}`] = { id, displayName: k, pictureUrl: null, isGuest: false };
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string): Promise<Res> {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, query: string, as: string | null): Promise<Res> {
  const r = await fn(new Request(`http://x/?${query}`, { headers: as ? { authorization: `Bearer tk-${as}` } : {} }));
  return { status: r.status, body: await r.json() };
}

// 十三支：a（房主）、b、c、d 打完一場（局數改成 2 局，打快一點）
const keys = ["a", "b", "c", "d"];
const room = (await post(thCreate, { hostId: "h-a", arrangeSec: 30, totalHands: 8 }, "a")).body as { roomId: string; code: string };
const pids = keys.map((k, i) => (i === 0 ? "h-a" : `x-${k}`));
for (const [i, k] of keys.entries()) await post(thJoin, { code: room.code, playerId: pids[i], name: `玩家${k}` }, k);
await setTotalHands(db, room.roomId, 2);
await post(thStart, { roomId: room.roomId, playerId: pids[0] }, "a");
for (let h = 1; h <= 2; h++) {
  for (const [i, p] of pids.entries()) {
    const v = (await get(thState, `roomId=${room.roomId}&playerId=${p}`, keys[i])).body;
    if (!v.me) continue;
    const a = autoArrange(v.me.hand as Card[], { lucky: v.luckyCard?.rank ?? null });
    await post(thSubmit, { roomId: room.roomId, playerId: p, front: a.front.map((x) => x.id), middle: a.middle.map((x) => x.id), back: a.back.map((x) => x.id) }, keys[i]);
  }
  if (h < 2) for (const [i, p] of pids.entries()) await post(thNext, { roomId: room.roomId, playerId: p }, keys[i]);
}

// 麻將、大老二的場次（直接寫進紀錄表）
async function addRecord(game: string, code: string, endedAt: string, seats: [string | null, number][], extra: Record<string, unknown> = {}) {
  const m = (await db.query<{ id: string }>(`insert into match_records (game, room_id, room_code, started_at, ended_at, end_reason, total_rounds, hands_played)
    values ($1, gen_random_uuid(), $2, $3, $3, 'completed', $4, $5) returning id`, [game, code, endedAt, extra.totalRounds ?? null, extra.handsPlayed ?? null])).rows[0];
  for (const [seat, [k, score]] of seats.entries())
    await db.query(`insert into match_record_players (match_id, seat, player_name, player_id, total_score, user_id) values ($1, $2, $3, $4, $5, $6)`,
      [m.id, seat, k ? `玩家${k}` : `路人${seat}`, `p${seat}`, score, k ? U[k] : null]);
}
await addRecord("mahjong", "1111", "2026-11-18T10:00:00Z", [["a", 300], ["b", -100], ["e", -100], [null, -100]], { totalRounds: 1, handsPlayed: 4 });
await addRecord("mahjong", "2222", "2026-11-19T10:00:00Z", [["a", -50], ["c", 150], ["d", -50], [null, -50]], { totalRounds: 1, handsPlayed: 5 });
await addRecord("mahjong", "3333", "2026-11-17T10:00:00Z", [["b", 80], ["e", -80], [null, 0], [null, 0]], { totalRounds: 2, handsPlayed: 8 }); // b 單獨參加（a 沒有）
await addRecord("big2", "4444", "2026-11-16T10:00:00Z", [[null, 10], [null, -10], [null, 0], [null, 0]]);                                   // 大老二：沒有帳號

// H1
const thRec = (await db.query<{ id: string; n: number; users: number }>(`select m.id, count(p.*)::int n, count(p.user_id)::int users from match_records m join match_record_players p on p.match_id = m.id
  where m.game = 'thirteen' and m.room_id = $1 group by m.id`, [room.roomId])).rows;
const aAll = (await get(recordsRoute, "game=all&limit=50", "a")).body;
const aTh = (await get(recordsRoute, "game=thirteen", "a")).body;
eq([thRec.length, thRec[0]?.n, thRec[0]?.users], [1, 4, 4], "H1 十三支打完一場：共用紀錄表有這一場，四個座位都有帳號");
eq([aTh.items.length, aTh.items[0]?.game, aTh.items[0]?.roomCode, aTh.items[0]?.handsPlayed, aTh.items[0]?.totalHands, aAll.items.some((x: { id: string }) => x.id === thRec[0]?.id)],
  [1, "thirteen", room.code, 2, 2, true], "H1 這場出現在 a 的十三支和全部頁籤（打了 2 局、設定 2 局）");
// H2
{
  const aCodes = aAll.items.map((x: { roomCode: string }) => x.roomCode).sort();
  const bCodes = (await get(recordsRoute, "game=all", "b")).body.items.map((x: { roomCode: string }) => x.roomCode).sort();
  const cCodes = (await get(recordsRoute, "game=all", "c")).body.items.map((x: { roomCode: string }) => x.roomCode).sort();
  eq([aCodes, aCodes.includes("3333"), bCodes, cCodes], [["1111", "2222", room.code].sort(), false, ["1111", "3333", room.code].sort(), ["2222", room.code].sort()],
    "H2 只看得到自己有參加的：a 看不到 b 單獨參加的 3333；b、c 各自只有自己的場次");
}
// H3
{
  const out: string[] = [];
  for (const k of ["a", "b", "e"]) {
    const t: Record<string, number> = {};
    for (const g of ["all", "mahjong", "thirteen", "big2"]) {
      const r = (await get(recordsRoute, `game=${g}&limit=50`, k)).body;
      t[g] = r.items.length;
      if (g !== "all" && !r.items.every((x: { game: string }) => x.game === g)) out.push(`${k}:${g} 混到別款`);
      if (JSON.stringify(r.counts) !== JSON.stringify((await get(recordsRoute, "game=all", k)).body.counts)) out.push(`${k}:${g} counts 不一致`);
    }
    if (t.mahjong + t.thirteen + t.big2 !== t.all) out.push(`${k} 加總不對 ${JSON.stringify(t)}`);
    if (t.big2 !== 0) out.push(`${k} 大老二不是 0`);
  }
  eq([out, aAll.counts], [[], { all: 3, big2: 0, mahjong: 2, thirteen: 1 }], "H3 四個頁籤：麻將＋十三支＋大老二＝全部（a、b、e 都對）；大老二一律 0；頁籤只回那一款；counts 每頁都一樣");
}
// H4
{
  const m = aAll.items.find((x: { roomCode: string }) => x.roomCode === "1111");
  const keysOf = Object.keys(m).sort();
  const text = JSON.stringify(aAll);
  eq([keysOf, m.game, m.totalRounds, m.handsPlayed, m.myScore, m.players.map((p: { playerName: string; totalScore: number; isMe: boolean }) => [p.playerName, p.totalScore, p.isMe])],
    [["endReason", "endedAt", "game", "handsPlayed", "id", "myScore", "players", "roomCode", "totalHands", "totalRounds"], "mahjong", 1, 4, 300,
      [["玩家a", 300, true], ["玩家b", -100, false], ["玩家e", -100, false], ["路人3", -100, false]]],
    "H4 每筆有日期、遊戲、房號、局數設定、實際局數、自己的分數、四家名字和分數（isMe 標自己）");
  eq([/card|房卡/i.test(text), Object.values(U).some((id) => text.includes(id))], [false, false], "H4 回應裡沒有房卡、沒有任何帳號 id");
}
// H5
{
  const seen: string[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const r: Res = await get(recordsRoute, `game=all&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "a");
    seen.push(...r.body.items.map((x: { endedAt: string; id: string }) => `${x.endedAt}|${x.id}`));
    cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 10);
  const ends = seen.map((s) => Date.parse(s.split("|")[0]));
  eq([pages, seen.length, new Set(seen).size, ends.every((t, i) => i === 0 || ends[i - 1] >= t)], [2, 3, 3, true], "H5 每頁 2 筆翻 2 頁：合起來 3 筆、新到舊、不重複");
  const mj = (await get(recordsRoute, "game=mahjong", "a")).body.summary;
  eq([mj, aAll.summary], [{ matches: 2, totalScore: 250 }, { matches: 3, totalScore: null }], "H5 summary：麻將 2 場總輸贏 +250；全部頁籤不加總分數（null）");
}
// H6
{
  const r = [await get(recordsRoute, "", null)].map((x) => `${x.status}:${x.body.error}`);
  const bad = [];
  for (const q of ["game=poker", "limit=0", "limit=51", "limit=x", "cursor=abc", "cursor=2026-11-20T12:00:00Z|nope"]) bad.push((await get(recordsRoute, q, "a")).status);
  eq([r, bad], [["401:not_logged_in"], [400, 400, 400, 400, 400, 400]], "H6 沒登入 401；game、limit、cursor 不對 400");
}

// H7
{
  const ID = "00000000-0000-4000-8000-000000000001";
  const bad = ["2026-13-20T11:00:00Z", "2026-02-30T11:00:00Z", "2026-11-20T25:00:00Z", "2026-11-20T11:00:00+99:00", "2027-02-29T11:00:00Z", "2026-11-20T11:60:00Z"].map((t) => `${t}|${ID}`);
  bad.push(`2026-11-20T11:00:00Z|${ID}|extra`, "2026-11-20T11:00:00Z", `2026-11-20T11:00:00Z|${ID.slice(0, -1)}`, `|${ID}`);
  const st: string[] = [];
  for (const c of bad) { const r = await get(recordsRoute, `cursor=${encodeURIComponent(c)}`, "a"); st.push(`${r.status}:${r.body.error}`); }
  eq([...new Set(st)], ["400:bad_cursor"], "H7 13 月、2/30、25 點、+99:00、平年 2/29、60 分、多一欄、少一欄、id 不對、沒有時間：都 400，沒有 500");
  const good = [];
  for (const c of [`2028-02-29T11:00:00Z|${ID}`, `2026-11-20T19:00:00+08:00|${ID}`, `2026-11-20T11:00:00.123456+00:00|${ID}`]) good.push((await get(recordsRoute, `cursor=${encodeURIComponent(c)}`, "a")).status);
  eq(good, [200, 200, 200], "H7 合法閏日、+08:00 時區、六位小數秒都 200");
}
// H8
{
  const ids = ["11111111-0000-4000-8000-000000000001", "11111111-0000-4000-8000-000000000002", "11111111-0000-4000-8000-000000000003", "11111111-0000-4000-8000-000000000004"];
  const times = ["2026-11-15T10:00:00.123456+00:00", "2026-11-15T10:00:00.123457+00:00", "2026-11-15T10:00:00.123457+00:00", "2026-11-15T10:00:00.123458+00:00"];
  for (const [i, id] of ids.entries()) {
    await db.query(`insert into match_records (id, game, room_id, room_code, ended_at, end_reason) values ($1, 'mahjong', gen_random_uuid(), $2, $3, 'completed')`, [id, `90${i}0`, times[i]]);
    await db.query(`insert into match_record_players (match_id, seat, player_name, player_id, total_score, user_id) values ($1, 0, '玩家e', 'p0', 0, $2)`, [id, U.e]);
  }
  const full = (await get(recordsRoute, "game=all&limit=50", "e")).body.items.map((x: { endedAt: string; id: string }) => `${x.endedAt}|${x.id}`);
  const paged: string[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const r: Res = await get(recordsRoute, `game=all&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "e");
    paged.push(...r.body.items.map((x: { endedAt: string; id: string }) => `${x.endedAt}|${x.id}`));
    cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 50);
  const micro = full.filter((c: string) => c.includes("10:00:00.12345"));
  eq([paged.length, new Set(paged).size, JSON.stringify(paged) === JSON.stringify(full), micro.length], [full.length, full.length, true, 4],
    "H8 同一毫秒不同微秒、同時間不同 id 共 4 場：每頁 1 筆翻到底和一次拿全部完全一樣、不漏不重複");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
