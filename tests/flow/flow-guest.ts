// 遊客登入（只給老闆自己測試用）：
//   G 密碼與次數限制（沒設密碼＝關閉、錯誤擋下、同一 IP 鎖、全站鎖、鎖住時對的密碼也不收）
//   P 遊客打完一場（每次登入都是新遊客、座位本人檢查、寫紀錄）
//   R 遊客紀錄不會出現在 LINE 帳號的歷史紀錄，遊客也看不到別人的紀錄；遊客和 LINE 玩家不同桌
//   C 遊客清得掉（過期清理、自己刪除）
import { POST as guestLogin, DELETE as guestDelete } from "../../app/api/auth/guest/route";
import { POST as create } from "../../app/api/mahjong/create/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { POST as start } from "../../app/api/mahjong/start/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { GET as recordsGet } from "../../app/api/mahjong/records/route";
import { rooms, opts } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import * as gs from "../support/stub-guest-store";
import * as rs from "../support/stub-records-store";
import { sweepExpiredGuests, GUEST_TTL_MS } from "../../lib/guest/guest";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

opts.autoBind = false; // 座位一律照真的綁帳號
const PASSWORD = "test-guest-password-for-flow";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
async function req(fn: (r: Request) => Promise<Response>, method: string, body?: object, h: Record<string, string> = {}, url = "http://x") {
  const r = await fn(new Request(url, { method, headers: { "content-type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined }));
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null, retry: r.headers.get("retry-after") };
}
const login = (password: unknown, ip = "1.1.1.1", name?: string) => req(guestLogin, "POST", { password, name }, { "x-forwarded-for": `${ip}, 10.0.0.1` });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

// ===================== G 密碼與次數限制 =====================
{
  delete process.env.GUEST_LOGIN_PASSWORD;
  const off = await login(PASSWORD);
  eq([off.status, off.body], [404, { error: "disabled" }], "G1 伺服器沒設 GUEST_LOGIN_PASSWORD：遊客登入整個關閉（404），不會建立任何遊客");
  process.env.GUEST_LOGIN_PASSWORD = PASSWORD;
}
{
  gs.reset();
  const wrong = await login("guess-1");
  const empty = await login(undefined);
  eq([wrong.status, wrong.body, empty.status, gs.guests.size], [401, { error: "wrong_password" }, 401, 0], "G2 密碼錯誤或沒給：401 wrong_password，沒有建立遊客");
}
{
  gs.reset();
  for (let i = 0; i < 4; i++) await login(`guess-${i}`, "2.2.2.2"); // 第 5 次錯才鎖
  const fifth = await login("guess-5", "2.2.2.2");
  const rightButLocked = await login(PASSWORD, "2.2.2.2");
  const otherIp = await login(PASSWORD, "3.3.3.3");
  // Retry-After 無條件進位，鎖定時間和現在差 1 毫秒就會是 901，兩個都對
  eq([fifth.status, fifth.body.error, ["900", "901"].includes(fifth.retry ?? ""), rightButLocked.status, otherIp.status, gs.guests.size],
    [429, "too_many_attempts", true, 429, 200, 1],
    "G3 同一個 IP 錯 5 次就鎖 15 分鐘（429＋Retry-After）；鎖住時連對的密碼也不收；別的 IP 不受影響");
}
{
  gs.reset();
  for (let i = 0; i < 20; i++) await login(`guess-${i}`, `9.9.9.${i}`); // 每個 IP 只錯 1 次，全站累積 20 次
  const fresh = await login(PASSWORD, "8.8.8.8");
  eq([fresh.status, fresh.body.error, gs.guests.size], [429, "too_many_attempts", 0], "G4 換 IP 一直猜：全站 1 小時錯 20 次就整個鎖 1 小時，新的 IP 用對的密碼也進不來");
  const realNow = gs.clock.now;
  gs.clock.now = () => realNow() + 61 * 60 * 1000;
  const after = await login(PASSWORD, "8.8.8.8");
  gs.clock.now = realNow;
  eq(after.status, 200, "G5 鎖定時間過了：對的密碼就能登入");
}

// ===================== P 遊客打完一場 =====================
gs.reset();
const G: { token: string; name: string }[] = [];
for (let i = 0; i < 4; i++) {
  const r = await login(PASSWORD, "4.4.4.4", `測試${i + 1}`);
  G.push({ token: r.body.accessToken, name: r.body.user.displayName });
}
const guestIds = [...gs.guests.keys()];
eq([new Set(G.map((g) => g.token)).size, guestIds.length, G.map((g) => g.name)], [4, 4, ["測試1", "測試2", "測試3", "測試4"]],
  "P1 每次登入都是一個新的遊客（4 次 → 4 個不同的遊客），名字照填的");
const P = ["gp0", "gp1", "gp2", "gp3"];
const c = await req(create, "POST", { hostId: P[0], totalRounds: 1, basePoints: 100, fanPoints: 20 }, bearer(G[0].token));
const roomId = c.body.roomId, code = c.body.code;
eq([c.status, rooms[roomId]?.game_state], [200, { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 }, guestRoom: true }], "P2 遊客可以建房（標成遊客房）");
const joins = [];
for (let i = 0; i < 4; i++) joins.push(await req(join, "POST", { code, name: G[i].name, playerId: P[i] }, bearer(G[i].token)));
const st = await req(start, "POST", { roomId, playerId: P[0] }, bearer(G[0].token));
eq([joins.map((j) => j.status), st.status, rooms[roomId].game_state.players.map((p) => p.userId)], [[200, 200, 200, 200], 200, guestIds],
  "P3 四個遊客加入、開局，每個座位綁的是各自的遊客身分");
{
  const d = rooms[roomId].game_state.dealerSeat;
  const other = (d + 1) % 4;
  const steal = await req(action, "POST", { roomId, playerId: P[d], actionType: "win" }, bearer(G[other].token));
  const peek = await req(stateGet, "GET", undefined, bearer(G[other].token), `http://x/api/mahjong/state?roomId=${roomId}&playerId=${P[d]}`);
  eq([steal.status, steal.body.error, peek.status, JSON.stringify(peek.body).includes('"hand"')], [403, "not_your_seat", 403, false],
    "P4 遊客拿別的遊客的玩家 id 操作或看手牌：403");
}
{
  // 打到最後一局：seat3 打出 7 條、seat1 胡（和 flow-records 一樣的牌型），整場結束
  let id = 90000;
  const t = (k: string): Tile => ({ id: id++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
  const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
  const s = rooms[roomId].game_state as MahjongGameState;
  for (const p of s.players) { p.hand = tiles("m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6"); p.revealed = [] as Meld[]; p.flowers = []; p.discards = [t("m9")]; p.isDealer = p.seat === 0; }
  s.players[1].hand = tiles("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6");
  s.players[3].hand.push(t("s7"));
  Object.assign(s, { wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 3, lastDiscard: null, dealerSeat: 0, doorSeat: 0, turnCount: 8, hasDrawn: true,
    isFirstRound: false, isAfterKong: false, pendingActions: undefined, pendingFlowerRob: undefined, drawnTileId: undefined, handsCompleted: 3,
    roundInfo: { currentRound: 1, currentGame: 4, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [300, -100, -100, -100] });
  const s7 = s.players[3].hand.find((x) => x.display === "s7")!.id;
  const dis = await req(discard, "POST", { roomId, playerId: P[3], tileId: s7 }, bearer(G[3].token));
  const win = await req(action, "POST", { roomId, playerId: P[1], actionType: "win" }, bearer(G[1].token));
  const rec = rs.records.find((r) => r.roomId === roomId);
  eq([dis.status, win.status, rec?.endReason, rec?.players.map((p) => p.userId), rooms[roomId] ?? null], [200, 200, "completed", guestIds, null],
    "P5 遊客打完一場：寫紀錄（四位玩家都是遊客身分）、房間刪除");
}

// ===================== R 紀錄隔離、不同桌 =====================
{
  tokens.line1 = { id: "11111111-0000-4000-8000-0000000000aa", displayName: "LINE", pictureUrl: null, isGuest: false };
  // 加一場 LINE 玩家自己的紀錄，確認他只看到自己的
  rs.records.push({ game: "mahjong", roomId: "LINE-ROOM", roomCode: "5555", startedAt: null, endReason: "completed", totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 4,
    endedAt: new Date().toISOString(), players: [0, 1, 2, 3].map((seat) => ({ seat, playerName: `L${seat}`, playerId: `l${seat}`, userId: seat === 0 ? "11111111-0000-4000-8000-0000000000aa" : null, totalScore: 0 })) });
  const lineHist = await req(recordsGet, "GET", undefined, bearer("line1"), "http://x/api/mahjong/records?summary=1");
  const guestHist = await req(recordsGet, "GET", undefined, bearer(G[1].token), "http://x/api/mahjong/records?summary=1");
  const newGuest = await login(PASSWORD, "5.5.5.5");
  const otherHist = await req(recordsGet, "GET", undefined, bearer(newGuest.body.accessToken), "http://x/api/mahjong/records?summary=1");
  eq([lineHist.body.items.map((x: { roomCode: string }) => x.roomCode), guestHist.body.items.map((x: { roomCode: string }) => x.roomCode), otherHist.body],
    [["5555"], [code], { items: [], nextCursor: null, summary: { matches: 0, totalScore: 0 } }],
    "R1 遊客的牌局不會出現在 LINE 帳號的歷史紀錄；遊客只看得到自己打的那場；別的遊客什麼都看不到");
}
{
  const gRoom = await req(create, "POST", { hostId: "gx", totalRounds: 1, basePoints: 100, fanPoints: 20 }, bearer(G[0].token));
  const lineInGuest = await req(join, "POST", { code: gRoom.body.code, name: "L", playerId: "lx" }, bearer("line1"));
  const lRoom = await req(create, "POST", { hostId: "lx2", totalRounds: 1, basePoints: 100, fanPoints: 20 }, bearer("line1"));
  const guestInLine = await req(join, "POST", { code: lRoom.body.code, name: "G", playerId: "gx2" }, bearer(G[2].token));
  eq([lineInGuest.status, lineInGuest.body.error, rooms[lRoom.body.roomId]?.game_state, guestInLine.status, guestInLine.body.error],
    [403, "guest_room", { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } }, 403, "guest_not_allowed"],
    "R2 遊客和 LINE 玩家不同桌：LINE 玩家進不了遊客房、遊客進不了一般房（一般房不帶遊客標記）");
}

// ===================== C 清得掉 =====================
{
  const before = gs.guests.size;
  // 讓其中一個遊客過期
  const expiredId = guestIds[0];
  gs.guests.get(expiredId)!.expiresAt = new Date(Date.now() - 1000).toISOString();
  const n = await sweepExpiredGuests();
  const gone = await req(create, "POST", { hostId: "gz", totalRounds: 1, basePoints: 100, fanPoints: 20 }, bearer(G[0].token));
  eq([n, gs.guests.size, gs.guests.has(expiredId), gone.status], [1, before - 1, false, 401], "C1 過期清理：只刪過期的遊客，刪掉後那個 token 就不能再用（401）");
  eq(Date.parse(gs.guests.get(guestIds[1])!.expiresAt) - Date.now() <= GUEST_TTL_MS && Date.parse(gs.guests.get(guestIds[1])!.expiresAt) - Date.now() > GUEST_TTL_MS - 60_000, true,
    "C2 遊客身分 24 小時後過期");
  const del = await req(guestDelete, "DELETE", undefined, bearer(G[2].token));
  const after = await req(create, "POST", { hostId: "gz", totalRounds: 1, basePoints: 100, fanPoints: 20 }, bearer(G[2].token));
  const lineDel = await req(guestDelete, "DELETE", undefined, bearer("line1"));
  eq([del.status, gs.guests.has(guestIds[2]), after.status, lineDel.status, lineDel.body.error], [204, false, 401, 403, "not_guest"],
    "C3 遊客可以自己刪除自己（之後 token 失效）；這支不能拿來刪 LINE 帳號（403）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
