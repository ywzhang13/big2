// 遊戲內互動特效 API（POST /api/mahjong/effect，2026-10-21）
//   E 權限：沒登入、非同桌、冒名（帶別人的 playerId）、房間不存在；被擋下的一則都不送
//   R 收件：只走同桌四人的座位頻道，公開頻道 mj-<房號> 收不到；發送者、對象的名字和座位由伺服器帶
//   T 目標：沒指定、打自己、目標在別桌、目標格式錯、未知特效
//   C 冷卻（2026-10-21 老闆定案）：輕組（愛心、砸錢）共用 5 秒、重組（雞蛋、潑水、拳擊）共用 10 秒、兩組互不影響；
//     重組有接收保護 10 秒（任何人都不能再用重組打他，輕組照常）；被擋下的不扣冷卻、不刷新保護期；三家同時打同一人只成功一個
//   X 關房：冷卻紀錄刪掉、之後再送 404
import { POST as effectApi } from "../../app/api/mahjong/effect/route";
import { closeMahjongRoom } from "../../lib/records/close";
import { privateChannelName } from "../../lib/mahjong/access";
import { rooms, seats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { clock, calls, db } from "../support/stub-effects-store";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
async function call(body: unknown, tok?: string, raw = false) {
  const headers: Record<string, string> = tok ? { authorization: `Bearer ${tok}` } : {};
  const r = await effectApi(new Request("http://x", { method: "POST", headers, body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const as = (pid: string) => `as:${pid}`; // stub-auth：以座位本人登入（帳號 u:<pid>）
const send = (pid: string, effect: string, to: unknown, extra: object = {}, roomId = "R") => call({ roomId, effect, to, ...extra }, as(pid));
const tick = (ms: number) => (clock.now += ms);
const fx = () => sent.filter((e) => e.event === "mj_effect");
const st = (r: { status: number; body: { error?: string; reason?: string; retryAfterMs?: number } }) =>
  r.status === 429 ? `429:${r.body.reason}:${r.body.retryAfterMs}` : r.body.error ? `${r.status}:${r.body.error}` : r.status;

// R（5878，已開局，座位打亂過：p2 坐 0 號）、R2（6000，別桌）、L（7000，還在大廳，只有 mj_players）
const mkState = (code: string, ids: string[]) => ({
  roomCode: code, status: "playing", stateVersion: 3,
  players: ids.map((id, seat) => ({ id, userId: `u:${id}`, name: "名" + id, seat, hand: [], revealed: [], flowers: [], discards: [], isDealer: seat === 0 })),
}) as unknown as MahjongGameState;
rooms.R = { id: "R", code: "5878", game_state: mkState("5878", ["p2", "p0", "p3", "p1"]), status: "playing" };
rooms.R2 = { id: "R2", code: "6000", game_state: mkState("6000", ["q0", "q1", "q2", "q3"]), status: "playing" };
rooms.L = { id: "L", code: "7000", game_state: null as unknown as MahjongGameState, status: "waiting" };
seats.L = [{ player_id: "w0", name: "大廳甲", seat: 0, user_id: "u:w0" }, { player_id: "w1", name: "大廳乙", seat: 1, user_id: "u:w1" }];
tokens.outsider = { id: "u:zz", displayName: "路人", pictureUrl: null, isGuest: false };

// ---------- E 權限 ----------
{
  sent.length = 0;
  const r = [
    await call({ roomId: "R", effect: "punch", to: "p1" }), // 沒登入
    await send("q0", "punch", "p1"), // 別桌玩家
    await call({ roomId: "R", effect: "punch", to: "p1" }, "outsider"), // 登入但沒坐這桌
    await send("p0", "punch", "p1", { playerId: "p3" }), // 冒名：帶別人的 playerId
    await send("p0", "punch", "p1", {}, "NOPE"), // 房間不存在
    await call({ effect: "punch", to: "p1" }, as("p0")), // 沒帶 roomId
    await call("{壞掉", as("p0"), true),
    await call(JSON.stringify({ roomId: "R", effect: "punch", to: "p1", pad: "x".repeat(2000) }), as("p0"), true),
  ].map(st);
  eq(r, ["401:not_logged_in", "403:not_in_room", "403:not_in_room", "403:not_your_seat", "404:room_not_found", "400:bad_request", "400:bad_request", "413:too_large"],
    "E1 沒登入 401、別桌玩家和路人 403 not_in_room、冒名 403 not_your_seat、房間不存在 404、格式錯 400、過大 413");
  eq(fx().length, 0, "E2 被擋下的請求一則都沒送出");
}

// ---------- R 收件 ----------
{
  sent.length = 0;
  const r = await send("p0", "punch", "p1", { fromName: "假名字", fromSeat: 3 });
  const e = r.body.effect;
  eq([r.status, e.effect, e.from, e.fromName, e.fromSeat, e.to, e.toName, e.toSeat, r.body.cooldownMs],
    [200, "punch", "p0", "名p0", 1, "p1", "名p1", 3, 10000], "R1 p0 對 p1 出拳：200；名字、座位都由伺服器帶（打亂後 p0 坐 1、p1 坐 3），帶假名字沒用");
  const ev = fx();
  eq([ev.length, ev.map((x) => x.payload.playerId).sort(), ev.every((x) => x.channel === privateChannelName("5878", x.payload.playerId as string)),
    ev.every((x) => (x.payload.effect as { id: string }).id === e.id)],
    [4, ["p0", "p1", "p2", "p3"], true, true], "R2 只送到同桌四人的座位頻道（含自己），四份是同一則（同一個 id）");
  eq(sent.some((x) => x.channel === "mj-5878" || x.channel === "mj-6000" || String(x.channel).startsWith("mj-6000-")), false, "R3 公開頻道和別桌的頻道都收不到");
  tick(60000); sent.length = 0;
  const l = await send("w1", "heart", "w0", {}, "L");
  eq([l.status, l.body.effect?.toName, fx().map((x) => x.payload.playerId).sort()], [200, "大廳甲", ["w0", "w1"]], "R4 還在大廳（沒開局）照 mj_players 認人，只送給坐下的人");
}

// ---------- T 目標 ----------
{
  tick(60000); sent.length = 0;
  const r = [
    await send("p2", "egg", undefined),
    await send("p2", "egg", null),
    await send("p2", "egg", "p2"),
    await send("p2", "egg", "q1"),
    await send("p2", "egg", 3),
    await send("p2", "bomb", "p1"),
    await send("p2", "Heart", "p1"),
  ].map(st);
  eq(r, ["400:target_required", "400:target_required", "400:cannot_target_self", "400:bad_target", "400:bad_target", "400:unknown_effect", "400:unknown_effect"],
    "T1 沒指定目標、打自己、目標在別桌、目標格式錯、未知特效（大小寫也算錯）都擋下");
  eq([fx().length, st(await send("p2", "egg", "p1"))], [0, 200], "T2 格式錯被擋下的不吃冷卻：緊接著送正確的一次就成功");
}

// ---------- C 冷卻 ----------
{
  const fresh = () => tick(60000); // 跳過所有冷卻和保護期
  const seq = async (steps: [number, string, string, string][]) => {
    const out: (string | number)[] = [];
    for (const [dt, pid, effect, to] of steps) { tick(dt); out.push(st(await send(pid, effect, to))); }
    return out;
  };

  fresh();
  eq(await seq([[0, "p3", "heart", "p0"], [1000, "p3", "money", "p0"], [3999, "p3", "heart", "p1"], [1, "p3", "money", "p1"]]),
    [200, "429:cooldown:4000", "429:cooldown:1", 200], "C1 輕組共用 5 秒：愛心後 1 秒送砸錢還要 4000ms、4.999 秒還要 1ms、5 秒可以（換目標也一樣）");

  fresh();
  eq(await seq([[0, "p3", "egg", "p1"], [3000, "p3", "water", "p2"], [6999, "p3", "punch", "p0"], [1, "p3", "punch", "p0"]]),
    [200, "429:cooldown:7000", "429:cooldown:1", 200], "C2 重組共用 10 秒：雞蛋後 3 秒潑別人還要 7000ms、9.999 秒還要 1ms、10 秒可以");

  fresh();
  eq(await seq([[0, "p1", "punch", "p0"], [0, "p1", "heart", "p0"], [0, "p2", "money", "p0"], [0, "p1", "egg", "p2"]]),
    [200, 200, 200, "429:cooldown:10000"], "C3 兩組互不影響：拳擊後馬上可以送愛心；輕組不受接收保護影響（剛被打的 p0 照樣收愛心、砸錢）；重組自己還在冷卻");

  fresh(); sent.length = 0;
  const table = async () => (await (await db()).query<{ j: string }>("select to_jsonb(r)::text j from mj_effect_rate r order by 1")).rows.map((r) => r.j);
  const t0 = await seq([[0, "p0", "egg", "p1"], [0, "p2", "water", "p1"], [4000, "p3", "punch", "p1"], [0, "p2", "heart", "p1"]]);
  eq(t0, [200, "429:target_protected:10000", "429:target_protected:6000", 200],
    "C4 接收保護 10 秒：p1 被丟雞蛋後，p2 潑水被擋（還要 10000ms）、4 秒後 p3 拳擊也被擋（還要 6000ms）；輕組照常");
  const snap = await table();
  const blocked = await seq([[0, "p2", "water", "p1"], [0, "p3", "punch", "p1"], [0, "p0", "punch", "p3"]]);
  eq([blocked, JSON.stringify(await table()) === JSON.stringify(snap)],
    [["429:target_protected:6000", "429:target_protected:6000", "429:cooldown:6000"], true],
    "C4' 三次被擋（兩次保護期、一次自己冷卻）前後，資料庫整張表的完整資料列完全相同");
  eq(await seq([[0, "p2", "water", "p3"]]), [200], "C5 被擋下的不扣冷卻：剛被擋的 p2 馬上可以用重組打別人");
  eq(await seq([[5999, "p0", "punch", "p1"], [0, "p3", "egg", "p1"]]), ["429:cooldown:1", "429:target_protected:1"],
    "C6 9.999 秒：原本的發送者 p0 自己還在冷卻（優先回 cooldown）、p3 打 p1 仍在保護期");
  tick(1);
  eq(await seq([[0, "p3", "egg", "p1"], [0, "p2", "heart", "p1"]]), [200, 200],
    "C7 第 10 秒保護期結束：中間被擋了好幾次也沒有刷新，p3 打中 p1；輕組照常");
  eq(await seq([[0, "p0", "water", "p1"], [0, "p0", "water", "p2"]]), ["429:target_protected:10000", 200],
    "C8 時間到恢復：p0 的冷卻過了；p1 剛被 p3 打中，又進入新的 10 秒保護期，p0 改打 p2 照常");

  fresh(); sent.length = 0;
  const before3 = await table();
  const three = await Promise.all([send("p2", "egg", "p1"), send("p0", "water", "p1"), send("p3", "punch", "p1")]);
  const ok = three.filter((x) => x.status === 200);
  const lost = three.filter((x) => x.status === 429);
  eq([ok.length, lost.length, lost.map((x) => x.body.reason), fx().length], [1, 2, ["target_protected", "target_protected"], 4],
    "C9 三家同時用重組打同一人：只成功一個，另外兩個回 429 target_protected，只廣播一則（四人各一份）");
  const added = (await table()).filter((r) => !before3.includes(r)).map((r) => JSON.parse(r)).map((r) => `${r.subject_id}:${r.slot}`).sort();
  const winner = ["p2", "p0", "p3"][three.findIndex((x) => x.status === 200)];
  eq(added, [`u:${winner}:send_heavy`, "u:p1:recv_heavy"].sort(), "C9' 資料庫只多了贏的那一家的重組冷卻和 p1 的保護期；搶輸的兩家什麼都沒寫入");
  const senders = ["p2", "p0", "p3"];
  const next: Record<string, string> = { p2: "p3", p0: "p2", p3: "p0" }; // 搶輸的人改打別人（都沒被打過）
  const losers = senders.filter((_, i) => three[i].status === 429);
  eq((await Promise.all(losers.map((p) => send(p, "punch", next[p])))).map((x) => x.status), [200, 200],
    "C10 搶輸的兩家沒被扣冷卻：馬上可以用重組打別人");

  fresh();
  const pair = await Promise.all([send("p0", "punch", "p1"), send("p1", "punch", "p0")]);
  eq(pair.map((x) => x.status), [200, 200], "C11 互打同時送出（A 打 B、B 打 A）：兩個都成功，不會互相卡住");

  fresh();
  const dup = await Promise.all([send("p2", "water", "p0"), send("p2", "egg", "p3")]);
  eq(dup.map((x) => String(st(x))).sort(), ["200", "429:cooldown:10000"],
    "C12 同一人同時送兩個重組（打不同人）：只放行一個，另一個回 cooldown");

  fresh();
  tick(1);
  const a = await send("p3", "heart", "p0"); tick(1);
  const b = await send("p3", "money", "p0");
  eq([a.status, b.status, b.body.error, b.body.reason, b.body.retryAfterMs, b.body.retryAfterSec, a.body.cooldownMs], [200, 429, "cooldown", "cooldown", 4999, 5, 5000],
    "C13 429 的 error 和 reason 相同，附剩餘毫秒和秒數（無條件進位）；成功回同組的冷卻長度");
  const rows = await (await db()).query<{ n: number }>("select count(*)::int n from mj_effect_rate where room_id = 'R' and slot = 'recv_heavy'");
  eq(rows.rows[0].n > 0, true, "C14 接收保護紀錄存在 R");
}

// ---------- X 關房 ----------
{
  const closed = await closeMahjongRoom("R", "5878", rooms.R.game_state, "dissolved");
  const left = await (await db()).query<{ room_id: string }>("select distinct room_id from mj_effect_rate order by 1");
  eq([closed, calls.deleteRoomEffects.includes("R"), left.rows.map((r) => r.room_id)], [true, true, ["L"]], "X1 R 關房：R 的發送冷卻和接收保護紀錄都刪掉，大廳 L 的不動");
  eq(st(await send("p0", "heart", "p1")), "404:room_not_found", "X2 關房後再送：404");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
