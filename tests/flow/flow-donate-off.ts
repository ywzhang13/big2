// 斗內下架（老柯 2026-11-20；規劃 v1 第 2 節第 5、6 點），走真的路由、真的 migration（PGlite）。沒有設 MJ_DONATE_WRITES（＝正式站預設）：
//   D1 後台記打賞、作廢、以場結清、撤回結清 4 支 POST 一律 410 donate_disabled（老闆、一般玩家、沒登入都一樣）
//   D2 被擋下的請求什麼都沒寫：斗內、結清、開通、操作紀錄筆數不變；玩家已開通的特效一列都沒被收回
//   D3 舊紀錄照舊查得到：後台斗內紀錄、未結清清單 200
//   D4 每局結算：每把的胡牌、放槍照常記（對戰紀錄用），自摸次數不再記（mj_zimo_wins 不變）
//   D5 自摸特效全開：沒開通的一般玩家 6 種永久可選、選了自摸就播；老闆專屬的如來神掌照舊只有老闆；遊客照舊 403
//   D6 恢復開關 MJ_DONATE_WRITES=1：記打賞照舊寫入（原本的程式沒刪）
import { POST as donationsPost, GET as donationsGet } from "../../app/api/mahjong/admin/donations/route";
import { POST as voidPost } from "../../app/api/mahjong/admin/donations/void/route";
import { POST as settlePost, GET as settleGet } from "../../app/api/mahjong/admin/settlements/route";
import { POST as revokePost } from "../../app/api/mahjong/admin/settlements/revoke/route";
import { GET as myFxGet, POST as myFxSet } from "../../app/api/mahjong/zimo-fx/route";
import { recordZimoWins } from "../../lib/mahjong/donate/record";
import { applyZimoFx, prefetchZimoFx } from "../../lib/mahjong/zimoFx/attach";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { addMatch, addTip, clock, db, grantFx, users } from "../support/stub-zimofx-store";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

delete process.env.MJ_DONATE_WRITES;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const [A, B, G] = ["aa", "bb", "99"].map((x) => `${x.repeat(4)}-0000-4000-8000-0000000000d0`);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "阿華", pictureUrl: null, isGuest: false };
tokens.guest = { id: G, displayName: null, pictureUrl: null, isGuest: true };
users[BOSS] = { name: "張育瑋", avatarUrl: null }; users[A] = { name: "阿明", avatarUrl: null }; users[B] = { name: "阿華", avatarUrl: null };
for (const u of [BOSS, A, B]) await addUser(u);
await addUser(G, true);
const d = await db();
const T = (s: string) => Date.parse(s + "+08:00");
clock.now = T("2026-11-20T12:00:00");
async function call(fn: (r: Request) => Promise<Response>, body: object | null, tok?: string, url = "http://x/") {
  const r = await fn(new Request(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const n = async (sql: string) => Number((await d.query<{ n: number }>(sql)).rows[0].n);
const counts = async () => ({ donations: await n("select count(*)::int n from mj_donations"), settle: await n("select count(*)::int n from mj_match_settlements"),
  grants: await n("select count(*)::int n from mj_fx_grants"), live: await n("select count(*)::int n from mj_fx_grants where revoked_at is null"),
  audit: await n("select count(*)::int n from mj_fx_audit"), zimo: await n("select count(*)::int n from mj_zimo_wins"), hands: await n("select count(*)::int n from mj_hand_results") });

// 舊資料：A 一筆打賞（斗內自動開通 6 種）、一場打完的房
const ROOM = "dddddddd-0000-4000-8000-000000000001";
const tipId = await addTip(BOSS, { userId: A, name: "阿明", avatarUrl: null, amount: 100, donatedAt: clock.now - 3600_000, note: "" });
await grantFx(BOSS, B, ["meteor", "thunder", "storm", "frost", "blackhole", "sakura"], null);
await addMatch(ROOM, "1234", clock.now - 7200_000, clock.now - 3600_000);
const before = await counts();

// D1
{
  const out = [];
  for (const tok of ["boss", "a", undefined]) {
    out.push((await call(donationsPost, { userId: B, amount: 100, donatedAt: new Date(clock.now).toISOString() }, tok)).body?.error);
    out.push((await call(voidPost, { id: tipId, reason: "測試" }, tok)).body?.error);
    out.push((await call(settlePost, { userId: B, roomIds: [ROOM] }, tok)).body?.error);
    out.push((await call(revokePost, { batchId: tipId }, tok)).body?.error);
  }
  const st = (await call(voidPost, { id: tipId, reason: "測試" }, "boss")).status;
  eq([st, [...new Set(out)]], [410, ["donate_disabled"]], "D1 記打賞、作廢、結清、撤回 4 支 POST：老闆、一般玩家、沒登入一律 410 donate_disabled");
}
// D2
{
  eq(await counts(), before, "D2 被擋下的請求什麼都沒寫：斗內、結清、開通、操作紀錄、自摸次數都不變；已開通的特效一列都沒收回");
  eq(before.live >= 12, true, "D2 （前提）A 斗內自動開通、B 手動開通的特效都還有效");
}
// D3
{
  const list = await call(donationsGet, null, "boss", "http://x/?scope=all");
  const unpaid = await call(settleGet, null, "boss");
  eq([list.status, list.body.records.length, list.body.records[0].amount, unpaid.status], [200, 1, 100, 200], "D3 舊紀錄照舊查得到：後台斗內紀錄、未結清清單");
}
// D4
{
  const s = { status: "finished", settlement: {}, handsCompleted: 1, winner: { seat: 0 }, players: [A, B, null, null].map((userId, seat) => ({ id: `p${seat}`, seat, userId })) } as unknown as MahjongGameState;
  await recordZimoWins("dddddddd-0000-4000-8000-000000000002", s);
  const after = await counts();
  eq([after.hands - before.hands, after.zimo - before.zimo], [1, 0], "D4 A 自摸：每把的胡牌紀錄照常記 1 列，自摸次數不再記");
}
// D5
{
  const before5 = (await call(myFxGet, null, "b")).body; // B 有手動開通，對照組
  const mine = (await call(myFxGet, null, "a")).body;
  await d.query("update mj_fx_grants set revoked_at = now(), revoked_by = 'test' where user_id = $1 and revoked_at is null", [A]); // A 的開通全部收回：全開之後也照樣能用
  const sel = await call(myFxSet, { fx: "frost" }, "a");
  const rulai = await call(myFxSet, { fx: "rulai" }, "a");
  const st = { players: [{ userId: A }, { userId: BOSS }] } as unknown as MahjongGameState;
  await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'rulai', now()) on conflict (user_id) do update set fx = 'rulai'", [BOSS]);
  applyZimoFx(st, await prefetchZimoFx(st));
  const guest = [(await call(myFxGet, null, "guest")).status, (await call(myFxSet, { fx: "storm" }, "guest")).status];
  const SIX = ["blackhole", "frost", "golden", "meteor", "sakura", "storm", "thunder"];
  eq([Object.keys(mine.available).sort(), Object.values(mine.available).every((v) => v === null), "ownerFx" in mine, Object.keys(before5.available).sort()], [SIX, true, false, SIX],
    "D5 一般玩家 6 種自摸特效都永久可選（沒有老闆專屬）");
  eq([sel.status, sel.body.selected, rulai.status, rulai.body.error, st.players[0].zimoFx, st.players[1].zimoFx, guest],
    [200, "frost", 403, "not_granted", { code: "frost", until: null }, { code: "rulai", until: null }, [403, 403]],
    "D5 開通都被收回的玩家也能選冰封、自摸播冰封；如來神掌只有老闆能選能播；遊客照舊 403");
}
// D6
{
  process.env.MJ_DONATE_WRITES = "1";
  const r = await call(donationsPost, { userId: B, amount: 50, donatedAt: new Date(clock.now).toISOString() }, "boss");
  delete process.env.MJ_DONATE_WRITES;
  eq([r.status, r.body.tip, (await counts()).donations - before.donations], [200, 50, 1], "D6 恢復開關 MJ_DONATE_WRITES=1：記打賞照舊寫入");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
