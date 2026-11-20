// 房卡後台「全部流水帳」（老柯 2026-11-20，第二批），走真的路由；房卡帳是記憶體 PostgreSQL 跑真的 migration（含 20261120_room_cards_ledger_all.sql）。
//   L1 權限：沒登入 401、一般玩家和遊客 403；被擋的請求不回任何資料
//   L2 全部：充值、回收、扣卡、暫停、恢復都在，新到舊；同一時間的多筆也有固定順序
//   L3 分頁：每頁 3 筆一路翻到底，合起來等於全部、沒有重複、沒有漏、順序一樣；最後一頁 nextCursor 是 null
//   L4 種類篩選：5 種各自只回那一種，筆數加起來等於全部
//   L5 期間：today 只有台北時間今天的；week、month 照台北的週一、1 號算；stats 是這段期間充值、扣卡、回收各幾張（不看種類）
//   L6 老闆帳號的資料不出現（就算資料庫裡有）；每一筆附玩家名稱
//   L7 上線時「斗內欠款轉房卡」的回收：actorKind 是 donate_debt，跟老闆手動回收（owner）、扣卡（system）分得開
//   L8 參數不對 400（種類、期間、筆數、游標）
//   L9 游標嚴格驗證（審伯初審必修）：不存在的日期、越界的時間和時區、多欄缺欄、錯誤來源／編號都 400（不是 500）；合法閏日、合法時區偏移照常 200
//   L10 六位小數秒：同一毫秒內不同微秒、同一時間不同 id／來源，每頁 1 筆一路翻到底，和一次拿全部順序完全一樣，不漏不重複
import { tokens } from "../support/stub-auth";
import { addUser, chargeHand, clock as cardClock, db as cardDb, reclaim, setSuspended, topup } from "../support/stub-roomcard-store";
import { GET as ledgerAllRoute } from "../../app/api/admin/cards/ledger/all/route";
import { OWNER_USER_ID } from "../../lib/mahjong/zimoFx/rules";
import { DONATE_DEBT_ACTOR } from "../../lib/roomCard/rules";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const cards = await cardDb();
const U: Record<string, string> = { a: "00000000-0000-4000-8000-0000000000a1", b: "00000000-0000-4000-8000-0000000000b2", c: "00000000-0000-4000-8000-0000000000c3",
  boss: OWNER_USER_ID, guest: "00000000-0000-4000-8000-0000000000f6" };
for (const [k, id] of Object.entries(U)) { tokens[`tk-${k}`] = { id, displayName: k, pictureUrl: null, isGuest: k === "guest" }; await addUser(id, `玩家${k}`, k === "guest"); }
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function get(query: string, as: string | null): Promise<Res> {
  const r = await ledgerAllRoute(new Request(`http://x/?${query}`, { headers: as ? { authorization: `Bearer tk-${as}` } : {} }));
  return { status: r.status, body: await r.json() };
}
let op = 0;
const opId = () => `00000000-0000-4000-9000-${String(++op).padStart(12, "0")}`;
const T = (s: string) => Date.parse(s + "+08:00");

// 資料：上個月、上週、今天（台北 2026-11-20 週五）
cardClock.now = T("2026-10-25T10:00:00");          // 上個月
await topup(U.boss, U.a, 100, opId());
cardClock.now = T("2026-11-16T09:00:00");          // 這週一（本月、本週，不是今天）
await topup(U.boss, U.b, 30, opId());
await chargeHand("mahjong", "room-1", "1234", 1, [U.a, U.b]);
cardClock.now = T("2026-11-20T11:00:00");          // 今天：同一時間好幾筆
await topup(U.boss, U.c, 50, opId());
await reclaim(DONATE_DEBT_ACTOR, U.c, 20, opId());   // 上線時的斗內欠款轉房卡
await reclaim(U.boss, U.a, 5, opId());               // 老闆手動回收
await chargeHand("thirteen", "room-2", "5678", 1, [U.a, U.b, U.c]);
await setSuspended(U.boss, U.b, true, opId());
cardClock.now = T("2026-11-20T11:30:00");
await setSuspended(U.boss, U.b, false, opId());
// 老闆帳號的資料（正常不會有；直接寫進資料庫測排除）
await cards.query(`insert into room_card_ledger (user_id, kind, delta, balance_after, actor, created_at) values ($1, 'topup', 9, 9, 'test', $2)`, [U.boss, new Date(T("2026-11-20T11:40:00")).toISOString()]);
cardClock.now = T("2026-11-20T12:00:00");

// L1
{
  const out = [await get("", null), await get("", "a"), await get("", "guest")].map((r) => `${r.status}:${r.body.error}:${"entries" in r.body}`);
  eq(out, ["401:not_logged_in:false", "403:forbidden:false", "403:forbidden:false"], "L1 沒登入 401、一般玩家和遊客 403，都不回資料");
}
// L2
const all = (await get("limit=100", "boss")).body;
{
  const kinds = all.entries.map((e: { kind: string }) => e.kind);
  const count = (k: string) => kinds.filter((x: string) => x === k).length;
  const ats = all.entries.map((e: { at: number }) => e.at);
  eq([count("topup"), count("reclaim"), count("charge"), count("suspend"), count("resume"), all.entries.length], [3, 2, 5, 1, 1, 12], "L2 全部：充值 3、回收 2、扣卡 5、暫停 1、恢復 1，共 12 筆");
  eq(ats.every((t: number, i: number) => i === 0 || ats[i - 1] >= t), true, "L2 照時間新到舊");
  eq([all.entries[0].kind, all.entries.at(-1).kind, all.entries.at(-1).userId], ["resume", "topup", U.a], "L2 最新是 11:30 的恢復，最舊是上個月 a 的充值");
}
// L3
{
  const seen: string[] = [];
  let cursor: string | null = null, pages = 0, lastNull = false;
  do {
    const r: Res = await get(`limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "boss");
    seen.push(...r.body.entries.map((e: { cursor: string }) => e.cursor));
    cursor = r.body.nextCursor; pages++;
    if (!cursor) lastNull = r.body.entries.length <= 3;
  } while (cursor && pages < 20);
  eq([pages, seen.length, new Set(seen).size, JSON.stringify(seen) === JSON.stringify(all.entries.map((e: { cursor: string }) => e.cursor)), lastNull], [4, 12, 12, true, true],
    "L3 每頁 3 筆翻 4 頁：合起來 12 筆、沒重複沒漏、順序和一次拿全部一樣（同一時間的多筆也是），最後一頁 nextCursor 是 null");
}
// L4
{
  const n: Record<string, number> = {};
  const pure: boolean[] = [];
  for (const k of ["topup", "charge", "reclaim", "suspend", "resume"]) {
    const r = (await get(`kind=${k}&limit=100`, "boss")).body;
    n[k] = r.entries.length; pure.push(r.entries.every((e: { kind: string }) => e.kind === k));
  }
  eq([n, pure.every(Boolean), Object.values(n).reduce((a, b) => a + b, 0)], [{ topup: 3, charge: 5, reclaim: 2, suspend: 1, resume: 1 }, true, 12], "L4 種類篩選：各自只回那一種，加起來 12 筆");
  const p2 = (await get("kind=charge&limit=2", "boss")).body;
  const p2b = (await get(`kind=charge&limit=2&cursor=${encodeURIComponent(p2.nextCursor)}`, "boss")).body;
  eq([p2.entries.length, p2b.entries.length, p2b.entries.every((e: { kind: string }) => e.kind === "charge")], [2, 2, true], "L4 篩選加分頁：第 2 頁也只有扣卡");
}
// L5
{
  const today = (await get("period=today&limit=100", "boss")).body;
  const week = (await get("period=week&limit=100", "boss")).body;
  const month = (await get("period=month&limit=100", "boss")).body;
  eq([today.entries.length, week.entries.length, month.entries.length, all.entries.length], [8, 11, 11, 12], "L5 期間：今天 8 筆、本週（11/16 週一起）11 筆、本月 11 筆、全部 12 筆");
  eq([today.stats, all.stats], [{ topup: 50, charge: 3, reclaim: 25 }, { topup: 180, charge: 5, reclaim: 25 }], "L5 stats：今天充值 50、扣卡 3、回收 25；全部充值 180、扣卡 5、回收 25（不看種類、不含老闆）");
  const todayTopup = (await get("period=today&kind=topup", "boss")).body;
  eq([todayTopup.entries.length, todayTopup.stats], [1, { topup: 50, charge: 3, reclaim: 25 }], "L5 期間＋種類：今天的充值 1 筆，stats 照樣是整段期間");
}
// L6
{
  eq([all.entries.some((e: { userId: string }) => e.userId === U.boss), all.entries.every((e: { name: string }) => e.name.startsWith("玩家"))], [false, true],
    "L6 老闆帳號的資料不出現（資料庫裡有一筆也排除）；每一筆都有玩家名稱");
}
// L7
{
  const rc = all.entries.filter((e: { kind: string }) => e.kind === "reclaim").map((e: { userId: string; actorKind: string; actor: string; cards: number }) => [e.userId, e.actorKind, e.actor, e.cards]);
  const ak = [...new Set(all.entries.map((e: { kind: string; actorKind: string }) => `${e.kind}:${e.actorKind}`))].sort();
  eq(rc, [[U.a, "owner", U.boss, -5], [U.c, "donate_debt", DONATE_DEBT_ACTOR, -20]], "L7 回收兩筆：老闆手動的是 owner，斗內欠款轉房卡的是 donate_debt（操作人欄位寫「斗內欠款轉房卡」）");
  eq(ak, ["charge:system", "reclaim:donate_debt", "reclaim:owner", "resume:owner", "suspend:owner", "topup:owner"], "L7 扣卡是 system，後台操作是 owner");
}
// L8
{
  const bad = [];
  for (const q of ["kind=gift", "period=year", "limit=0", "limit=101", "limit=1.5", "cursor=abc", "cursor=2026-11-20T11:00:00Z|x|1"]) bad.push((await get(q, "boss")).status);
  eq(bad, [400, 400, 400, 400, 400, 400, 400], "L8 種類、期間、筆數、游標不對都 400");
}

// L9
{
  const T0 = "2026-11-20T11:00:00Z";
  const bad = ["2026-13-20T11:00:00Z", "2026-02-30T11:00:00Z", "2026-11-20T25:00:00Z", "2026-11-20T11:60:00Z", "2026-11-20T11:00:61Z", "2026-11-20T11:00:00+99:00",
    "2026-11-20T11:00:00+08:60", "2027-02-29T11:00:00Z"].map((t) => `${t}|l|1`);
  bad.push(`${T0}|l`, `${T0}|l|1|x`, `${T0}|x|1`, `${T0}|l|0`, `${T0}|l|-1`, `${T0}|l|1.5`, `|l|1`);
  const st: string[] = [];
  for (const c of bad) { const r = await get(`cursor=${encodeURIComponent(c)}`, "boss"); st.push(`${r.status}:${r.body.error}`); }
  eq([...new Set(st)], ["400:bad_request"], "L9 不存在的日期（13 月、2/30、平年 2/29）、25 點、60 分、61 秒、+99:00、+08:60、少一欄、多一欄、錯誤來源、編號 0／負數／小數、沒有時間：都 400，沒有 500");
  const good = [];
  for (const c of ["2028-02-29T11:00:00Z|l|1", "2026-11-20T19:00:00+08:00|a|5", "2026-11-20T11:00:00.123456+00:00|l|3", "2026-11-20 11:00:00+00|l|3"]) good.push((await get(`cursor=${encodeURIComponent(c)}`, "boss")).status);
  eq(good, [200, 200, 200, 200], "L9 合法閏日（2028/2/29）、+08:00 時區、六位小數秒、資料庫的空白分隔格式都 200");
}
// L10
{
  const iso = (s: string) => s; // 直接給資料庫的字串（保留微秒）
  for (const [t, d] of [["2026-11-20T11:50:00.123456+08:00", 1], ["2026-11-20T11:50:00.123457+08:00", 2], ["2026-11-20T11:50:00.123457+08:00", 3], ["2026-11-20T11:50:00.123458+08:00", 4]] as const)
    await cards.query(`insert into room_card_ledger (user_id, kind, delta, balance_after, actor, op_id, created_at) values ($1, 'topup', $2, 0, $3, $4, $5)`,
      [U.c, d, U.boss, `00000000-0000-4000-9100-00000000000${d}`, iso(t)]);
  await cards.query(`insert into room_card_audit (user_id, action, actor, op_id, created_at) values ($1, 'suspend', $2, '00000000-0000-4000-9200-000000000001', '2026-11-20T11:50:00.123457+08:00')`, [U.c, U.boss]);
  const full = (await get("limit=100", "boss")).body.entries.map((e: { cursor: string }) => e.cursor);
  const paged: string[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const r: Res = await get(`limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "boss");
    paged.push(...r.body.entries.map((e: { cursor: string }) => e.cursor));
    cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 50);
  const micro = full.filter((c: string) => c.includes(":50:00.12345"));
  eq([paged.length, new Set(paged).size, JSON.stringify(paged) === JSON.stringify(full), micro.length, micro.every((c: string) => /\.\d{6}/.test(c))], [full.length, full.length, true, 5, true],
    "L10 同一毫秒不同微秒、同時間不同 id 和來源共 5 筆：每頁 1 筆翻到底和一次拿全部完全一樣、不漏不重複；游標保留六位小數秒");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
