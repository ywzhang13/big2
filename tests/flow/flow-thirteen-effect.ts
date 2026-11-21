// 十三支互動道具 POST /api/thirteen/effect（老柯 2026-11-20；小宜〈十三支共用聊天互動 v1〉第 7 節）：照麻將 /api/mahjong/effect，
// 「這桌有誰」用十三支的 chatMembers，冷卻表 mj_effect_take 直接共用（記憶體 PostgreSQL 跑真的 SQL），廣播 mj_effect 到同桌四人座位頻道＋已同意觀戰者。
//   F1 理牌中、目標還沒送出 → 409 target_arranging（不廣播、不算冷卻）；目標送出後可以丟：200 { ok, effect, cooldownMs }，四家座位頻道＋觀戰者都收到
//   F2 冷卻：同一個人同一組（輕組 5 秒）馬上再丟 → 429 cooldown（retryAfterMs）；5 秒後可以
//   F3 保護期：重組丟中的人 10 秒內別人再用重組丟他 → 429 target_protected；輕組不受影響
//   F4 不能丟的人：不在這桌（含觀戰者）403 not_in_room、沒登入 401、遊客 403 guest_not_allowed；丟自己 400、不在桌的目標 400、不存在的道具 400
// 「關閉互動」照設計只記在收件人自己的分頁、不通知伺服器（小宜 4-5、麻將 lib/mahjong/fx/block.ts），所以伺服器不擋，前端收到時不播。
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { clock as fxClock } from "../support/stub-effects-store";
import { requestSpectate, respondSpectate } from "../support/stub-spectate-store";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { clock } from "../../lib/thirteen/flow";
import { privateChannel } from "../../lib/thirteen/server";
import { spectatorChannelName } from "../../lib/mahjong/access";
import { autoArrange } from "../../lib/thirteen/arrange";
import type { Card } from "../../lib/thirteen/cards";
import { ruleOf } from "../support/thirteen-rule";

// 新路由：修改前沒有這支，其他項目照樣跑（才看得出修改前是紅的）
const mod = await import("../../app/api/thirteen/effect/route").catch(() => null) as { POST: (r: Request) => Promise<Response> } | null;

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-20T12:00:00Z");
clock.now = () => NOW;
fxClock.now = NOW;
const PIDS = ["e0", "e1", "e2", "e3"];
const uid = (i: number) => `00000000-0000-4000-8000-0000000003a${i}`;
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: uid(i), displayName: null, pictureUrl: null, isGuest: false }; });
tokens["tk-watch"] = { id: "00000000-0000-4000-8000-0000000003c9", displayName: null, pictureUrl: null, isGuest: false };
tokens["tk-stranger"] = { id: "00000000-0000-4000-8000-0000000003d9", displayName: null, pictureUrl: null, isGuest: false };
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(fn: ((r: Request) => Promise<Response>) | undefined, body: object, as?: string): Promise<Res> {
  if (!fn) return { status: 404, body: { error: "no_route" } };
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer tk-${as}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const fx = (roomId: string, as: string | undefined, to: string, effect = "heart") => post(mod?.POST, { roomId, effect, to }, as);
const effects = () => sent.filter((e) => e.event === "mj_effect");

const c = (await post(createRoute, { hostId: "e0", arrangeSec: 60, totalHands: 8 }, "e0")).body as { roomId: string; code: string };
for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.code, playerId: p, name: `玩家${i}` }, p);
await post(startRoute, { roomId: c.roomId, playerId: "e0" }, "e0");
const rr = await requestSpectate(c.roomId, tokens["tk-watch"].id, "e1", "觀戰員", null);
if (rr.ok) await respondSpectate(c.roomId, "e1", rr.requestId, true);
async function submit(p: string) {
  const hand = (await (await stateRoute(new Request(`http://x/?roomId=${c.roomId}&playerId=${p}`, { headers: { authorization: `Bearer tk-${p}` } }))).json()).me.hand as Card[];
  const a = autoArrange(hand, await ruleOf(db, c.roomId));
  await post(submitRoute, { roomId: c.roomId, playerId: p, front: a.front.map((x) => x.id), middle: a.middle.map((x) => x.id), back: a.back.map((x) => x.id) }, p);
}

// F1
{
  sent.length = 0;
  const arranging = await fx(c.roomId, "e0", "e1");
  const quiet = effects().length;
  await submit("e1");
  sent.length = 0;
  const ok = await fx(c.roomId, "e0", "e1");
  const chans = effects().map((e) => e.channel).sort();
  const want = [...PIDS.map((p, i) => privateChannel(c.roomId, c.code, p, uid(i))), spectatorChannelName(c.code, c.roomId, tokens["tk-watch"].id)].sort();
  eq([arranging.status, arranging.body.error, quiet, ok.status, ok.body.ok, ok.body.effect?.from, ok.body.effect?.to, ok.body.effect?.effect, ok.body.cooldownMs, JSON.stringify(chans) === JSON.stringify(want)],
    [409, "target_arranging", 0, 200, true, "e0", "e1", "heart", 5000, true],
    "F1 目標還在理牌 409 target_arranging、不廣播；送出後可以丟：回 effect 和 cooldownMs 5000，四家座位頻道和已同意的觀戰者都收到 mj_effect");
}
// F2
{
  await submit("e2"); await submit("e3");
  const again = await fx(c.roomId, "e0", "e2", "clap");
  NOW += 5_000; fxClock.now = NOW;
  const later = await fx(c.roomId, "e0", "e2", "clap");
  eq([again.status, again.body.error, again.body.retryAfterMs > 0, later.status], [429, "cooldown", true, 200], "F2 同一個人輕組 5 秒內再丟 429 cooldown（附 retryAfterMs）；5 秒後可以");
}
// F3
{
  NOW += 20_000; fxClock.now = NOW;
  const hit = await fx(c.roomId, "e0", "e3", "egg");
  const prot = await fx(c.roomId, "e1", "e3", "water");
  const light = await fx(c.roomId, "e2", "e3", "heart");
  eq([hit.status, prot.status, prot.body.error, light.status], [200, 429, "target_protected", 200], "F3 重組丟中後 10 秒內別人用重組丟同一個人 429 target_protected；輕組不受影響");
}
// F4
{
  NOW += 20_000; fxClock.now = NOW;
  tokens["tk-guest"] = { id: uid(2), displayName: null, pictureUrl: null, isGuest: true }; // 同一個座位帳號、但以遊客身分
  const tries = [
    await fx(c.roomId, "watch", "e1"),      // 觀戰者
    await fx(c.roomId, "stranger", "e1"),   // 不在這桌
    await fx(c.roomId, undefined, "e1"),    // 沒登入
    await fx(c.roomId, "guest", "e1"),      // 遊客
    await fx(c.roomId, "e0", "e0"),         // 丟自己
    await fx(c.roomId, "e0", "nobody"),     // 不在桌的目標
    await fx(c.roomId, "e0", "e1", "bomb"), // 不存在的道具
  ];
  eq(tries.map((t) => [t.status, t.body.error]),
    [[403, "not_in_room"], [403, "not_in_room"], [401, "not_logged_in"], [403, "guest_not_allowed"], [400, "cannot_target_self"], [400, "bad_target"], [400, "unknown_effect"]],
    "F4 觀戰者、不在這桌 403 not_in_room；沒登入 401；遊客 403；丟自己、不在桌的目標、不存在的道具 400");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
