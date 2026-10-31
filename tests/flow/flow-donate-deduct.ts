// 斗內卡收起、後台自摸次數、記一筆斗內自動抵扣（老闆 2026-10-31；小宜〈斗內卡收起與後台自摸次數〉第 4 節），走真的 API、真的 migration
//   K1 部分斗內：17 次斗 NT$100 → 抵 10 次、剩 7 次繼續欠、打賞 0；斗內卡顯示 7
//   K2 剛好斗完：7 次斗 NT$70 → 抵 7 次、剩 0
//   K3 斗超過：3 次斗 NT$500 → 抵 3 次、剩 0、打賞 NT$470（不預存：之後自摸從 1 開始）
//   K4 零頭：5 次斗 NT$35 → 抵 3 次、剩 2、打賞 NT$5；2 次斗 NT$5 → 抵 0 次、還是 2、打賞 NT$5
//   K5 手動清除：歸零、寫 zimo_clear 操作紀錄 { cleared }；已經是 0 回 409 nothing_to_clear、不寫紀錄；非老闆 403、遊客 unknown_player
//   K6 看過才收起：show＝次數 > 看過；看過不改次數；看到的數字不能超過目前次數；次數被抵扣變少，看過跟著降，之後再自摸卡片照常出現
//   K7 後台清單：每人次數、應斗（次數 × 10）、上次歸零時間／方式／清掉幾次；0 次的人也列出；不含遊客；非老闆 403
//   K8 操作紀錄寫明抵扣：記帳前幾次、抵扣幾次、剩幾次、打賞、單價
//   K9 記帳那一刻之後才記進來的自摸不會被抵扣（留到下一輪）；作廢斗內不還原次數；舊的 mj_donation_add 介面也一樣是抵扣
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { POST as donateSeen } from "../../app/api/mahjong/donate/seen/route";
import { POST as donationsAdd } from "../../app/api/mahjong/admin/donations/route";
import { POST as donationVoid } from "../../app/api/mahjong/admin/donations/void/route";
import { GET as countsGet } from "../../app/api/mahjong/admin/zimo-counts/route";
import { POST as countsClear } from "../../app/api/mahjong/admin/zimo-counts/clear/route";
import { GET as audit } from "../../app/api/mahjong/admin/audit/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";

const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const id = (n: number) => `d0d0d0d0-0000-4000-8000-00000000000${n}`;
const [P1, P2, P3, P4, P5, G] = [1, 2, 3, 4, 5, 9].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.p1 = { id: P1, displayName: "陳大文", pictureUrl: null, isGuest: false };
tokens.guest = { id: G, displayName: null, pictureUrl: null, isGuest: true };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
["陳大文", "林小美", "王阿明", "李阿華", "周小強"].forEach((n, i) => (users[id(i + 1)] = { name: n, avatarUrl: i === 0 ? "https://pic/p1" : null }));
users[G] = { name: "遊客", avatarUrl: null, guest: true };
for (const u of [BOSS, P1, P2, P3, P4, P5]) await addUser(u);
await addUser(G, true);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request("http://x" + url, { headers: auth(tok) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const d = await db();
let room = 0;
/** user 自摸 n 次（每次一間房一局），時間在現在之前 */
async function wins(user: string, n: number, at = clock.now - 1000) {
  for (let i = 0; i < n; i++) await d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3)", [`e0e0e0e0-0000-4000-8000-${String(++room).padStart(12, "0")}`, user, new Date(at).toISOString()]);
}
const count = async (user: string) => Number((await d.query<{ n: number }>("select public.mj_donate_count($1) n", [user])).rows[0].n);
const donate = (user: string, amount: number) => post(donationsAdd, { userId: user, amount, donatedAt: new Date(clock.now).toISOString() }, "boss");
const ded = (r: { body: { deduction: Record<string, number> } }) => { const x = r.body.deduction; return [x.before, x.deducted, x.remaining, x.tip, x.price]; };

clock.now = T("2026-11-05T20:00:00");

// ---- K1 部分斗內 ----
{
  await wins(P1, 17);
  const r = await donate(P1, 100);
  const card = await get(donateGet, "/", "p1");
  eq([r.status, typeof r.body.id, ded(r), await count(P1), card.body], [200, "string", [17, 10, 7, 0, 10], 7, { count: 7, show: true }],
    "K1 陳大文自摸 17 次斗 NT$100：抵 10 次、剩 7 次繼續欠、打賞 0、單價 10；斗內卡顯示 7 次");
}

// ---- K2 剛好斗完 ----
{
  clock.now += 60_000;
  const r = await donate(P1, 70);
  const card = await get(donateGet, "/", "p1");
  eq([ded(r), await count(P1), card.body], [[7, 7, 0, 0, 10], 0, { count: 0, show: false }], "K2 剩 7 次再斗 NT$70：抵 7 次、剩 0，卡片不出現");
}

// ---- K3 斗超過 ----
{
  clock.now += 60_000;
  await wins(P2, 3);
  const r = await donate(P2, 500);
  const after = await count(P2);
  clock.now += 60_000; await wins(P2, 1);
  eq([ded(r), after, await count(P2)], [[3, 3, 0, 470, 10], 0, 1], "K3 林小美 3 次斗 NT$500：抵 3 次、剩 0、打賞 NT$470；不預存，之後自摸一次就是 1");
}

// ---- K4 零頭 ----
{
  clock.now += 60_000;
  await wins(P3, 5);
  const r1 = await donate(P3, 35);
  const c1 = await count(P3);
  clock.now += 60_000;
  const r2 = await donate(P3, 5);
  eq([ded(r1), c1, ded(r2), await count(P3)], [[5, 3, 2, 5, 10], 2, [2, 0, 2, 5, 10], 2],
    "K4 王阿明 5 次斗 NT$35：抵 3 次、剩 2、零頭 NT$5 算打賞；再斗 NT$5：抵 0 次、還是 2、打賞 NT$5");
}

// ---- K5 手動清除 ----
{
  clock.now += 60_000;
  await wins(P4, 4);
  const auditN = async () => Number((await d.query<{ n: number }>("select count(*)::int n from mj_fx_audit where action = 'zimo_clear'")).rows[0].n);
  const notOwner = await post(countsClear, { userId: P4 }, "p1");
  const guest = await post(countsClear, { userId: G }, "boss");
  const bad = await post(countsClear, {}, "boss");
  const c = await post(countsClear, { userId: P4 }, "boss");
  const n1 = await auditN();
  const again = await post(countsClear, { userId: P4 }, "boss");
  const n2 = await auditN();
  const rec = (await d.query<{ actor_id: string; detail: unknown }>("select actor_id, detail from mj_fx_audit where action = 'zimo_clear' and target_user_id = $1", [P4])).rows;
  eq([notOwner.status, guest.body.error, bad.status, c.status, c.body.ok, c.body.cleared, typeof c.body.resetAt, await count(P4), n1, again.status, again.body.error, n2, rec],
    [403, "unknown_player", 400, 200, true, 4, "number", 0, 1, 409, "nothing_to_clear", 1, [{ actor_id: BOSS, detail: { cleared: 4 } }]],
    "K5 李阿華 4 次：非老闆 403、遊客 unknown_player、沒帶 userId 400；老闆清除 → 清掉 4 次、歸零、操作紀錄 zimo_clear {cleared:4}（actor 是老闆）；再清一次 409 nothing_to_clear、不多寫紀錄");
}

// ---- K6 看過才收起 ----
{
  clock.now += 60_000;
  await wins(P1, 3);
  const g1 = (await get(donateGet, "/", "p1")).body;
  const s1 = await post(donateSeen, { count: 3 }, "p1");
  const g2 = (await get(donateGet, "/", "p1")).body;
  const c1 = await count(P1);
  clock.now += 60_000; await wins(P1, 1);
  const g3 = (await get(donateGet, "/", "p1")).body;
  const s2 = await post(donateSeen, { count: 99 }, "p1"); // 看到的數字超過目前次數：只算到目前次數
  clock.now += 60_000; await wins(P1, 1);
  const g4 = (await get(donateGet, "/", "p1")).body;      // 5 次、看過 4 次 → 出現
  await post(donateSeen, { count: 5 }, "p1");
  clock.now += 60_000;
  const r = await donate(P1, 30);                          // 5 → 抵 3、剩 2；看過 5 → 降到 2
  const g5 = (await get(donateGet, "/", "p1")).body;
  const seen5 = Number((await d.query<{ s: number }>("select seen_count s from mj_donate_acks where user_id = $1", [P1])).rows[0].s);
  clock.now += 60_000; await wins(P1, 1);
  const g6 = (await get(donateGet, "/", "p1")).body;
  const errs = [(await post(donateSeen, { count: 1 })).status, (await post(donateSeen, { count: -1 }, "p1")).status, (await post(donateSeen, { count: "3" }, "p1")).status,
    (await post(donateSeen, { count: 1 }, "guest")).body, (await get(donateGet, "/", "guest")).body, (await get(donateGet, "/")).body];
  eq([g1, s1.body, g2, c1, g3, s2.body, g4, ded(r), g5, seen5, g6, errs],
    [{ count: 3, show: true }, { count: 3, show: false }, { count: 3, show: false }, 3, { count: 4, show: true }, { count: 4, show: false }, { count: 5, show: true },
      [5, 3, 2, 0, 10], { count: 2, show: false }, 2, { count: 3, show: true },
      [401, 400, 400, { count: 0, show: false }, { count: 0, show: false }, { count: 0, show: false }]],
    "K6 3 次看過 → 收起、次數不變；再自摸 → 出現；看到的數字 99 只算到 4；5 次看過後斗 NT$30 剩 2、看過跟著降到 2（不出現）；再自摸變 3 → 照常出現；沒登入 401、數字錯 400、遊客和沒登入都是 0／不出現");
}

// ---- K7 後台清單 ----
{
  await wins(G, 2).catch(() => {}); // 遊客不會被記（auth.users 標記遊客）；就算有也不列
  const list = await get(countsGet, "/", "boss");
  const byName = Object.fromEntries((list.body.players as { name: string }[]).map((p) => [p.name, p]));
  const pick = (n: string) => { const p = byName[n] as Record<string, unknown> | undefined; return p && [p.count, p.owed, p.lastResetSource, p.lastResetCleared, typeof p.lastResetAt]; };
  const p1 = byName["陳大文"] as Record<string, unknown>;
  eq([list.status, list.body.price, Object.keys(byName).sort(), pick("陳大文"), pick("林小美"), pick("王阿明"), pick("李阿華"), [p1.userId, p1.shortId, p1.avatarUrl],
    Object.keys(p1).sort(), (await get(countsGet, "/", "p1")).status, (await get(countsGet, "/")).status],
    [200, 10, ["李阿華", "林小美", "王阿明", "陳大文"], [3, 30, "donation", 3, "number"], [1, 10, "donation", 3, "number"], [2, 20, "donation", 0, "number"],
      [0, 0, "clear", 4, "number"], [P1, P1.slice(-4), "https://pic/p1"],
      ["avatarUrl", "count", "lastResetAt", "lastResetCleared", "lastResetSource", "name", "owed", "shortId", "userId"], 403, 401],
    "K7 後台清單：4 位（沒自摸過的周小強、遊客不在）；次數、應斗（×10）、上次歸零方式（斗內／清除）和清掉幾次；0 次的李阿華也列出；非老闆 403、沒登入 401");
}

// ---- K8 操作紀錄寫明抵扣 ----
{
  const recs = (await get(audit, "/?limit=50", "boss")).body.records as { action: string; targetUserId: string; detail: Record<string, unknown> }[];
  const k1 = recs.filter((r) => r.action === "donation_add" && r.targetUserId === P1).map((r) => [r.detail.amount, r.detail.before, r.detail.deducted, r.detail.remaining, r.detail.tip, r.detail.price, r.detail.cleared]).reverse();
  const clr = recs.find((r) => r.action === "zimo_clear");
  eq([k1, clr?.targetUserId, clr?.detail], [[[100, 17, 10, 7, 0, 10, 10], [70, 7, 7, 0, 0, 10, 7], [30, 5, 3, 2, 0, 10, 3]], P4, { cleared: 4 }],
    "K8 操作紀錄：記一筆寫明金額、記帳前幾次、抵扣幾次、剩幾次、打賞、單價（cleared＝抵扣次數）；清除寫 zimo_clear {cleared}");
}

// ---- K9 之後才進來的自摸、作廢、舊介面 ----
{
  clock.now += 60_000;
  await wins(P5, 2);
  await wins(P5, 1, clock.now + 1000); // 記帳那一刻之後才記進來的一局
  const r = await donate(P5, 20);
  const after = await count(P5);
  const v = await post(donationVoid, { id: r.body.id, reason: "測試作廢" }, "boss");
  const afterVoid = await count(P5);
  clock.now += 60_000; await wins(P5, 4);
  const old = (await d.query<{ id: string }>("select public.mj_donation_add($1, $2, 'x', null, 30, $3, '', $3) id", [BOSS, P5, new Date(clock.now).toISOString()])).rows[0].id;
  eq([ded(r), after, v.status, afterVoid, typeof old, await count(P5)], [[2, 2, 0, 0, 10], 1, 200, 1, "string", 2],
    "K9 周小強 2 次＋記帳之後才進來的 1 次：斗 NT$20 只抵前 2 次、之後那次留著（剩 1）；作廢那筆不還原次數；舊的 mj_donation_add 介面也是抵扣（5 次斗 NT$30 剩 2）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
