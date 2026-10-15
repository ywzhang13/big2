// 麻將一定要 LINE 登入：
//   A 沒登入不能建房／加入；每個動作都確認是座位本人，拿到別人的玩家 id 也不能操作或看手牌（含 Realtime 私人事件）
//   B 登入的人寫進對局紀錄時有 user_id
//   C 歷史紀錄 API 只回「我」的場次，附場數和累計總輸贏
//   D 上線前就有的房（座位沒綁帳號）也一律要登入：沒登入進不去、登入了也不能冒用舊座位
//   E 大老二不需要登入（共用程式不碰登入）
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POST as create } from "../../app/api/mahjong/create/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { POST as start } from "../../app/api/mahjong/start/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { POST as leaveRequest } from "../../app/api/mahjong/leave-request/route";
import { POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { GET as recordsGet } from "../../app/api/mahjong/records/route";
import { rooms, seats, opts } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import * as rs from "../support/stub-records-store";
import { privateChannelName, PRIVATE_EVENTS } from "../../lib/mahjong/access";
import { buildBig2Record } from "../../lib/records/build";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

opts.autoBind = false; // 這個檔要測「沒綁帳號的座位」，不讓 stub 自動綁

const U = ["11111111-0000-4000-8000-000000000000", "22222222-0000-4000-8000-000000000000", "33333333-0000-4000-8000-000000000000", "44444444-0000-4000-8000-000000000000"];
U.forEach((id, i) => (tokens[`tok${i}`] = { id, displayName: `LINE${i}`, pictureUrl: null, isGuest: false }));
tokens.tok5 = { id: "55555555-0000-4000-8000-000000000000", displayName: "LINE5", pictureUrl: null, isGuest: false };

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const headers = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: headers(tok), body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request(url, { headers: headers(tok) }));
  return { status: r.status, body: await r.json() };
}
const P = ["p0", "p1", "p2", "p3"];
const snapshot = (id: string) => JSON.stringify(rooms[id]?.game_state ?? null);

// ===================== A 沒登入不能建房／加入 =====================
let roomId = "", code = "";
{
  const before = Object.keys(rooms).length;
  const c0 = await post(create, { hostId: "p0", totalRounds: 1, basePoints: 100, fanPoints: 20 });
  const cBad = await post(create, { hostId: "p0", totalRounds: 1, basePoints: 100, fanPoints: 20 }, "tok-fake");
  eq([c0.status, c0.body, cBad.status, Object.keys(rooms).length], [401, { error: "not_logged_in" }, 401, before], "A1 沒登入（沒帶 token、token 無效）不能建房，也沒有建出房間");
  const c1 = await post(create, { hostId: "p0", totalRounds: 1, basePoints: 100, fanPoints: 20 }, "tok0");
  roomId = c1.body.roomId; code = c1.body.code;
  eq([c1.status, rooms[roomId]?.game_state], [200, { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } }], "A2 登入後可以建房");
}
{
  const j0 = await post(join, { code, name: "甲", playerId: "p0" });
  eq([j0.status, j0.body, seats[roomId]?.length ?? 0], [401, { error: "not_logged_in" }, 0], "A3 沒登入不能加入登入房");
  const js = [];
  for (let i = 0; i < 3; i++) js.push(await post(join, { code, name: `玩家${i}`, playerId: P[i] }, `tok${i}`));
  eq(js.map((j) => [j.status, j.body.seat, j.body.playerId, j.body.privateChannel === privateChannelName(code, P[j.body.seat])]),
    [[200, 0, "p0", true], [200, 1, "p1", true], [200, 2, "p2", true]], "A4 登入後可以加入，回傳座位、玩家 id、本人的座位頻道");
  const steal = await post(join, { code, name: "冒名", playerId: "p1" }, "tok3");
  eq([steal.status, steal.body, seats[roomId].length], [403, { error: "not_your_seat" }, 3], "A5 拿別人的玩家 id 加入（別的登入帳號）：403，不會拿到那個座位");
  const phone = await post(join, { code, name: "玩家1", playerId: "p1-phone" }, "tok1");
  eq([phone.status, phone.body.seat, phone.body.playerId, phone.body.rejoined, seats[roomId].length], [200, 1, "p1", true, 3], "A6 同一個 LINE 帳號換裝置（不同玩家 id）加入：回到原本座位、沿用原本的玩家 id，不會多佔一個位子");
  const j3 = await post(join, { code, name: "玩家3", playerId: "p3" }, "tok3");
  const full = await post(join, { code, name: "第五人", playerId: "p5" }, "tok5");
  eq([j3.status, j3.body.seat, full.status, seats[roomId].map((p) => p.user_id)], [200, 3, 400, U], "A7 第四人加入後坐滿，第五人進不來；四個座位各自綁定自己的 LINE 帳號");
}
{
  const s0 = await post(start, { roomId, playerId: "p0" });
  const s1 = await post(start, { roomId, playerId: "p0" }, "tok1");
  eq([s0.status, s1.status, rooms[roomId].status ?? "waiting"], [401, 403, "waiting"], "A8 開局：沒登入 401；別人冒用房主的玩家 id 403；都沒有開局");
  sent.length = 0;
  const ok = await post(start, { roomId, playerId: "p0" }, "tok0");
  const s = rooms[roomId].game_state;
  eq([ok.status, s.players.map((p) => p.userId)], [200, U], "A9 房主本人開局成功；牌局狀態記下每個座位的帳號");
  const pub = `mj-${code}`;
  const deal = sent.filter((e) => e.event === "mj_deal_hand");
  eq([deal.length, deal.every((e) => e.channel === privateChannelName(code, e.payload.playerId as string)), new Set(deal.map((e) => e.channel)).size],
    [4, true, 4], "A10 開局發牌：四家手牌各自只送到本人的座位頻道（四個不同頻道）");
  eq([sent.filter((e) => e.channel === pub && PRIVATE_EVENTS.has(e.event)).length, sent.filter((e) => e.channel === pub).some((e) => JSON.stringify(e.payload).includes('"hand"')),
    deal.some((e) => (e.channel ?? "").includes(e.payload.playerId as string))],
    [0, false, false], "A11 房間公開頻道沒有任何私人事件、沒有手牌；座位頻道名稱看不出玩家 id（只有伺服器算得出來）");
}
// 開局後：每個動作都要是座位本人
{
  const s = rooms[roomId].game_state;
  const d = s.dealerSeat, other = (d + 1) % 4;
  const tile = s.players[d].hand.find((t) => t.suit !== "f")!;
  const before = snapshot(roomId);
  const tries = [
    ["discard", await post(discard, { roomId, playerId: P[d], tileId: tile.id }, `tok${other}`)],
    ["draw", await post(draw, { roomId, playerId: P[d] }, `tok${other}`)],
    ["action", await post(action, { roomId, playerId: P[d], actionType: "win" }, `tok${other}`)],
    ["next-game", await post(nextGame, { roomId, playerId: P[d] }, `tok${other}`)],
    ["leave-request", await post(leaveRequest, { roomId, playerId: P[d] }, `tok${other}`)],
  ] as const;
  eq([tries.map(([n, r]) => [n, r.status, r.body.error]), snapshot(roomId) === before],
    [[["discard", 403, "not_your_seat"], ["draw", 403, "not_your_seat"], ["action", 403, "not_your_seat"], ["next-game", 403, "not_your_seat"], ["leave-request", 403, "not_your_seat"]], true],
    "A12 拿莊家的玩家 id、用別人的登入：打牌、摸牌、胡、下一局、請求解散全部 403，牌局完全沒變");
  const noTok = await post(discard, { roomId, playerId: P[d], tileId: tile.id });
  eq([noTok.status, snapshot(roomId) === before], [401, true], "A13 沒登入送動作：401，牌局沒變");
  const peek = await get(stateGet, `http://x/api/mahjong/state?roomId=${roomId}&playerId=${P[d]}`, `tok${other}`);
  const peekAnon = await get(stateGet, `http://x/api/mahjong/state?roomId=${roomId}&playerId=${P[d]}`);
  eq([peek.status, JSON.stringify(peek.body).includes('"hand"'), peekAnon.status, JSON.stringify(peekAnon.body).includes('"hand"')], [403, false, 401, false],
    "A14 拿莊家的玩家 id 查狀態：別人的登入 403、沒登入 401，都拿不到手牌");
  const mine = await get(stateGet, `http://x/api/mahjong/state?roomId=${roomId}&playerId=${P[d]}`, `tok${d}`);
  const pub = await get(stateGet, `http://x/api/mahjong/state?roomId=${roomId}`);
  eq([mine.status, mine.body.gameState.hand.length > 0, mine.body.gameState.myChannel === privateChannelName(code, P[d]), pub.status, JSON.stringify(pub.body).includes('"hand"'), JSON.stringify(mine.body).includes(U[0]) || JSON.stringify(pub.body).includes(U[0])],
    [200, true, true, 200, false, false], "A15 本人查得到自己的手牌和座位頻道；不帶玩家 id 只有公開資訊；回應裡不會出現任何人的帳號 id");
  sent.length = 0;
  const legit = await post(discard, { roomId, playerId: P[d], tileId: tile.id }, `tok${d}`);
  eq([legit.status, rooms[roomId].game_state.players[d].discards.some((t) => t.id === tile.id), sent.filter((e) => e.channel === `mj-${code}` && PRIVATE_EVENTS.has(e.event)).length],
    [200, true, 0], "A16 本人打牌成功；打牌後若有可以吃碰槓胡的通知，也只走座位頻道（不在公開頻道）");
}
// 解散投票：不能替別人投
{
  // 模擬已打完一局（記錄要有分數），再請求解散
  const s = rooms[roomId].game_state;
  s.pendingActions = undefined; s.handsCompleted = 1; s.playerScores = [300, -100, -100, -100];
  const req = await post(leaveRequest, { roomId, playerId: "p0" }, "tok0");
  const fake = await post(leaveVote, { roomId, playerId: "p1", approve: true }, "tok0");
  eq([req.status, fake.status, rooms[roomId].game_state.leaveRequest?.approvedBy], [200, 403, []], "A17 不能拿別人的玩家 id 替別人投同意解散");
  for (const i of [1, 2, 3]) await post(leaveVote, { roomId, playerId: P[i], approve: true }, `tok${i}`);
}

// ===================== B 對局紀錄有 user_id =====================
{
  const rec = rs.records.find((r) => r.roomId === roomId);
  eq([rec?.endReason, rec?.players.map((p) => [p.seat, p.playerId, p.userId, p.totalScore]), rooms[roomId] ?? null],
    ["dissolved", [[0, "p0", U[0], 300], [1, "p1", U[1], -100], [2, "p2", U[2], -100], [3, "p3", U[3], -100]], null],
    "B1 登入房解散：紀錄的每位玩家都有自己的 user_id（座位綁定的 LINE 帳號），然後刪房");
}

// ===================== D 上線前就有的房也一律要登入 =====================
{
  // 上線前建、還在等人的房：座位沒有綁帳號
  rooms.OLDW = { id: "OLDW", code: "7001", status: "waiting", host_id: "p0", game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
  seats.OLDW = P.slice(0, 3).map((pid, seat) => ({ player_id: pid, name: `舊${seat}`, seat, user_id: null }));
  const before = JSON.stringify(seats.OLDW);
  const anon = await post(join, { code: "7001", name: "舊1", playerId: "p1" });
  const steal = await post(join, { code: "7001", name: "舊1", playerId: "p1" }, "tok1");
  const st0 = await post(start, { roomId: "OLDW", playerId: "p0" });
  const st1 = await post(start, { roomId: "OLDW", playerId: "p0" }, "tok0");
  eq([anon.status, anon.body.error, steal.status, steal.body.error, st0.status, st1.status, JSON.stringify(seats.OLDW) === before, rooms.OLDW.status],
    [401, "not_logged_in", 403, "not_your_seat", 401, 403, true, "waiting"],
    "D1 上線前、還在等人的舊房：沒登入重新加入 401；登入了也不能接手沒綁帳號的舊座位 403；開局也一樣被擋，房間沒變");
}
{
  // 上線前就在打的房：牌局狀態的座位沒有 userId
  rooms.OLDP = { id: "OLDP", code: "7002", status: "playing", host_id: "p0", game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
  // 借用開局路由發牌：先暫時綁帳號開局，再把帳號全部拿掉，模擬「上線前開局、座位沒綁帳號」的牌局
  seats.OLDP = P.map((pid, seat) => ({ player_id: pid, name: `舊${seat}`, seat, user_id: `u:${pid}` }));
  rooms.OLDP.status = "waiting";
  const started = await post(start, { roomId: "OLDP", playerId: "p0" }, "as:p0");
  seats.OLDP.forEach((p) => (p.user_id = null));
  rooms.OLDP.game_state.players.forEach((p) => delete p.userId);
  const s = rooms.OLDP.game_state;
  const d = s.dealerSeat;
  const tile = s.players[d].hand.find((t) => t.suit !== "f")!;
  const before = JSON.stringify(rooms.OLDP.game_state);
  const routes = [
    ["discard", discard, { roomId: "OLDP", playerId: P[d], tileId: tile.id }],
    ["draw", draw, { roomId: "OLDP", playerId: P[d] }],
    ["action", action, { roomId: "OLDP", playerId: P[d], actionType: "win" }],
    ["next-game", nextGame, { roomId: "OLDP", playerId: P[d] }],
    ["leave-request", leaveRequest, { roomId: "OLDP", playerId: P[d] }],
  ] as const;
  const anon: unknown[] = [], loggedIn: unknown[] = [];
  for (const [n, fn, body] of routes) {
    anon.push([n, (await post(fn, body)).status]);
    loggedIn.push([n, (await post(fn, body, `tok${d}`)).status]);
  }
  const join2 = await post(join, { code: "7002", name: "舊", playerId: P[d] });
  const join3 = await post(join, { code: "7002", name: "舊", playerId: P[d] }, `tok${d}`);
  const view0 = await get(stateGet, `http://x/api/mahjong/state?roomId=OLDP&playerId=${P[d]}`);
  const view1 = await get(stateGet, `http://x/api/mahjong/state?roomId=OLDP&playerId=${P[d]}`, `tok${d}`);
  eq([started.status, anon, loggedIn, join2.status, join3.status, view0.status, view1.status, JSON.stringify(view0.body).includes('"hand"') || JSON.stringify(view1.body).includes('"hand"'), JSON.stringify(rooms.OLDP.game_state) === before],
    [200, routes.map(([n]) => [n, 401]), routes.map(([n]) => [n, 403]), 401, 403, 401, 403, false, true],
    "D2 上線前就在打的舊房：沒登入每個動作、加入、查手牌都 401；登入了也冒用不了沒綁帳號的舊座位（403）；拿不到手牌、牌局沒變");
}

// ===================== C 歷史紀錄 API =====================
{
  rs.reset();
  const mk = (roomId: string, endedAt: string, userIds: (string | null)[], scores: number[], game: "mahjong" | "big2" = "mahjong", endReason: "completed" | "dissolved" = "completed") =>
    rs.records.push({ game, roomId, roomCode: roomId.slice(-4), startedAt: null, endReason, totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 4, endedAt,
      players: [0, 1, 2, 3].map((seat) => ({ seat, playerName: `名${seat}`, playerId: `pid-${roomId}-${seat}`, userId: userIds[seat], totalScore: scores[seat] })) });
  mk("R-1001", "2026-10-15T10:00:00.000Z", [U[0], U[1], U[2], U[3]], [300, -100, -100, -100]);
  mk("R-1002", "2026-10-15T12:00:00.000Z", [U[1], U[0], null, U[3]], [200, -50, -50, -100], "mahjong", "dissolved");
  mk("R-1003", "2026-10-15T13:00:00.000Z", [U[1], U[2], U[3], null], [100, -100, 0, 0]); // 我沒打
  mk("R-1004", "2026-10-15T14:00:00.000Z", [U[0], null, null, null], [999, 0, 0, -999], "big2"); // 大老二不算

  const anon = await get(recordsGet, "http://x/api/mahjong/records");
  eq([anon.status, anon.body], [401, { error: "not_logged_in" }], "C1 沒登入查歷史紀錄：401 not_logged_in");
  const p1 = await get(recordsGet, "http://x/api/mahjong/records?limit=1&summary=1", "tok0");
  eq([p1.status, p1.body.items.map((x: { roomCode: string; endReason: string; myScore: number }) => [x.roomCode, x.endReason, x.myScore]), p1.body.summary, typeof p1.body.nextCursor],
    [200, [["1002", "dissolved", -50]], { matches: 2, totalScore: 250 }, "string"], "C2 只回我打過的麻將場次（新到舊），附場數和累計總輸贏；別人的場次、大老二都不算");
  const item = p1.body.items[0];
  eq([item.players.map((p: { seat: number; isMe: boolean }) => [p.seat, p.isMe]), Object.keys(item).sort(), Object.keys(item.players[0]).sort()],
    [[[0, false], [1, true], [2, false], [3, false]], ["basePoints", "endReason", "endedAt", "fanPoints", "handsPlayed", "id", "myScore", "players", "roomCode", "totalRounds"], ["isMe", "playerName", "seat", "totalScore"]],
    "C3 四家照座位排、用 isMe 標出自己；回應沒有玩家 id、帳號 id 欄位");
  const raw = JSON.stringify(p1.body);
  eq([U.some((u) => raw.includes(u)), raw.includes("pid-")], [false, false], "C4 回應裡完全不會出現任何人的帳號 id 或玩家 id");
  const p2 = await get(recordsGet, `http://x/api/mahjong/records?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`, "tok0");
  eq([p2.status, p2.body.items.map((x: { roomCode: string; myScore: number }) => [x.roomCode, x.myScore]), p2.body.nextCursor, "summary" in p2.body], [200, [["1001", 300]], null, false],
    "C5 用 nextCursor 拿下一頁：拿到較舊的那場、沒有更多時 nextCursor=null；沒帶 summary=1 就不回摘要");
  const other = await get(recordsGet, "http://x/api/mahjong/records?summary=1", "tok2");
  eq([other.body.items.map((x: { roomCode: string }) => x.roomCode), other.body.summary], [["1003", "1001"], { matches: 2, totalScore: -200 }], "C6 另一個人只看到他自己的場次與總輸贏");
  const none = await get(recordsGet, "http://x/api/mahjong/records?summary=1", "tok5");
  eq([none.status, none.body], [200, { items: [], nextCursor: null, summary: { matches: 0, totalScore: 0 } }], "C7 沒打過的人：空列表、0 場、0 分");
  const bad = await get(recordsGet, `http://x/api/mahjong/records?cursor=${encodeURIComponent("2026-10-15T12:00:00Z,id.gt.0|x")}`, "tok0");
  eq(bad.status, 400, "C8 cursor 不是「ISO 時間|uuid」：400（不會被拼進查詢條件）");
}

// ===================== E 大老二不需要登入 =====================
{
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(path.relative(ROOT, p));
    }
  };
  for (const d of ["app", "lib", "hooks", "components"]) walk(path.join(ROOT, d));
  const usesAuth = files.filter((f) => /from "@\/lib\/auth"|from "\.\.?\/.*auth"|mahjong\/access"/.test(readFileSync(path.join(ROOT, f), "utf8")));
  const outside = usesAuth.filter((f) => !f.startsWith("app/api/mahjong/") && !f.startsWith("app/api/auth/") && !f.startsWith("lib/mahjong/") && f !== "lib/records/close.ts");
  eq([outside, files.filter((f) => f.startsWith("app/api/game/") && usesAuth.includes(f))], [[], []], "E1 會檢查登入的程式只在麻將路由／登入路由（app/api/auth）／麻將函式庫；大老二的路由（app/api/game）、頁面、共用函式庫都沒有接登入");
  const b2 = buildBig2Record({ id: "B", code: "3001", status: "finished", created_at: "2026-10-20T08:00:00.000Z", records_enabled: true, scores: {} },
    [0, 1, 2, 3].map((seat) => ({ player_id: `b${seat}`, name: `大${seat}`, seat, hand: seat === 0 ? [] : ["3C" as never] })), "dissolved");
  eq(b2?.players.map((p) => p.userId ?? null), [null, null, null, null], "E2 大老二的紀錄不帶 user_id（照舊不需要登入）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
