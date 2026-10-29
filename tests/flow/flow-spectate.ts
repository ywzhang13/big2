// 麻將觀戰模式（老闆 2026-10-30 定案）：申請、同意、收回、權限與資料安全
//   V1 查房：沒登入 401、遊客 403、房號格式錯 400、沒這房 404、還沒開局 409、同桌玩家 403；觀戰者看到四位玩家、沒有帳號 id
//   V2 申請：通知只送到被申請者的座位頻道（帶 LINE 本名、頭像，不帶帳號 id），公開頻道收不到；重複申請 409、遊客／同桌 403、不是這桌的玩家 400
//   V3 沒同意的玩家手牌拿不到（view 403，回應裡沒有那位的手牌）
//   V4 管理與回應只限座位本人；別人的 requestId 回應不了
//   V5 同意後 view：只有目標的手牌；另外三家只有公開資料（別家暗槓蓋牌、沒有 opponentHands／動作／座位頻道）；沒有帳號 id
//   V6 觀戰者送出遊戲動作、聊天、語音、特效、下一局、離房投票、讀本人 state 一律被拒，牌局狀態沒變
//   V7 收回後立刻拿不到；被觀戰人數廣播（公開，只有人數）
//   V8 冷卻 30 秒、逾時 30 秒（伺服器時間）；拒絕後 30 秒內不能再申請
//   V9 多個視角可以切換；state 帶被觀戰人數
//   V10 房間結束（整場打完 410、房間刪除 404）後拿不到
//   V11 查房先驗身分：沒登入、遊客連「房間在不在、開局沒」都查不到（審伯 2026-10-30）
//   V12 view 限流：同一位觀戰者、同一房每秒最多 10 次，第 11 次 429，而且在讀房間之前就擋
//   V13 關房時順手刪 7 天前的觀戰資料；刪失敗只記 log，房間照樣關
import { GET as roomInfo } from "../../app/api/mahjong/spectate/room/route";
import { POST as requestRoute } from "../../app/api/mahjong/spectate/request/route";
import { GET as view } from "../../app/api/mahjong/spectate/view/route";
import { GET as manage } from "../../app/api/mahjong/spectate/manage/route";
import { POST as respond } from "../../app/api/mahjong/spectate/respond/route";
import { POST as revoke } from "../../app/api/mahjong/spectate/revoke/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as chat } from "../../app/api/mahjong/chat/route";
import { POST as voice } from "../../app/api/mahjong/voice/route";
import { POST as effect } from "../../app/api/mahjong/effect/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { clock, db, failNext } from "../support/stub-spectate-store";
import { closeMahjongRoom } from "../../lib/records/close";
import { privateChannelName } from "../../lib/mahjong/access";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

const SPEC = "uid-spec-aaaa", SPEC2 = "uid-spec-bbbb", GUEST = "uid-guest-cccc";
const PIC = "https://profile.line-scdn.net/spec";
tokens.spec = { id: SPEC, displayName: "張育瑋", pictureUrl: PIC, isGuest: false };
tokens.spec2 = { id: SPEC2, displayName: "阿華", pictureUrl: null, isGuest: false };
tokens.guest = { id: GUEST, displayName: null, pictureUrl: null, isGuest: true };

let nextId = 1000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
// 四家手牌各不相同，方便比對；p1 有一副暗槓（m9），p0 已經眼牌（本人 state 看得到三家手牌）
const HANDS = ["m1 m2 m3 m4 m5 m6 m7 m8 p1 p2 p3 p4 p5 p6 p7 p8", "s1 s1 s2 s3 s4 s5 s6 s7 s8 s9 z1 z1", "p9 p9 p9 z2 z2 z2 z3 z3 z3 z4 z4 z4 z5 z5 z5 z6", "s9 s9 s9 z7 z7 z7 m1 m1 m1 p1 p1 p1 s2 s2 s2 z6"];
function setup() {
  const s = {
    roomCode: "1234", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(HANDS[seat]), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ").replace(/m9/g, "p5")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
    eyeSeats: [0], tingSeats: [0],
  } as unknown as MahjongGameState;
  s.players[1].revealed = [{ type: "concealed_kong", tiles: tiles("m9 m9 m9 m9") } as Meld];
  rooms.R = { id: "R", code: "1234", game_state: s, status: "playing" };
  rooms.W = { id: "W", code: "5678", game_state: { roomSettings: {} } as unknown as MahjongGameState, status: "waiting" };
}
setup();
const kongIds = rooms.R.game_state.players[1].revealed[0].tiles.map((x) => x.id);
const HAND_IDS = rooms.R.game_state.players.map((p) => p.hand.map((x) => x.id));
const handIds = (seat: number) => HAND_IDS[seat];

const results: string[] = [];
const archive: typeof sent = []; // 全程送出的廣播（各段會清 sent）
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request("http://x" + url, { headers: auth(tok) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const ACCOUNTS = [SPEC, SPEC2, GUEST, "u:p0", "u:p1", "u:p2", "u:p3"];
const leaks = (text: string) => ACCOUNTS.filter((id) => text.includes(id)).length + (/"userId"|"spectatorId"|"spectator_id"/.test(text) ? 1 : 0);
const hasId = (text: string, ids: number[]) => ids.filter((id) => text.includes(`"id":${id},`)).length;

// ---- V1 查房 ----
{
  const r = [
    (await get(roomInfo, "/?code=1234")).status,
    (await get(roomInfo, "/?code=1234", "guest")).body?.error,
    (await get(roomInfo, "/?code=12a4", "spec")).status,
    (await get(roomInfo, "/?code=9999", "spec")).body?.error,
    (await get(roomInfo, "/?code=5678", "spec")).body?.error,
    (await get(roomInfo, "/?code=1234", "as:p2")).body?.error,
  ];
  eq(r, [401, "guest_not_allowed", 400, "room_not_found", "not_started", "own_table"], "V1 查房：沒登入 401、遊客 403、房號格式錯 400、沒這房 404、還沒開局 409、同桌玩家 403");
  const ok = await get(roomInfo, "/?code=1234", "spec");
  eq([ok.status, ok.body.players.map((p: { playerId: string; status: string; canRequest: boolean; viewerCount: number }) => `${p.playerId}:${p.status}:${p.canRequest}:${p.viewerCount}`), leaks(ok.text), /"hand"/.test(ok.text)],
    [200, ["p0:available:true:0", "p1:available:true:0", "p2:available:true:0", "p3:available:true:0"], 0, false],
    "V1 觀戰者查房：四位玩家照座位、都可申請、人數 0；沒有帳號 id、沒有手牌");
}

// ---- V2 申請 ----
let reqId = "";
{
  archive.push(...sent); sent.length = 0;
  const r = await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "spec");
  const ev = sent.filter((e) => e.event === "mj_spectate_request");
  reqId = (ev[0]?.payload.requestId as string) ?? "";
  eq([r.status, r.body.status, r.body.expiresAt - clock.now, ev.length, ev[0]?.channel === privateChannelName("1234", "p0"), ev[0]?.payload.name, ev[0]?.payload.avatarUrl, sent.some((e) => e.channel === "mj-1234"), leaks(JSON.stringify(sent) + r.text)],
    [200, "pending", 30000, 1, true, "張育瑋", PIC, false, 0],
    "V2 申請：200 pending、30 秒後失效；通知只送到 p0 的座位頻道（LINE 本名、頭像），公開頻道沒有；沒有帳號 id");
  const again = await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "spec");
  eq([again.status, again.body.error, again.body.expiresAt - clock.now,
    (await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "guest")).body?.error,
    (await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "as:p1")).body?.error,
    (await post(requestRoute, { roomId: "R", targetPlayerId: "nobody" }, "spec")).body?.error,
    (await post(requestRoute, { roomId: "R", targetPlayerId: "p0" })).status],
    [409, "already_pending", 30000, "guest_not_allowed", "own_table", "bad_target", 401],
    "V2 重複申請 409（附失效時間）、遊客 403、同桌玩家 403、不是這桌的玩家 400、沒登入 401");
}

// ---- V3 沒同意的手牌拿不到 ----
{
  const v = await get(view, "/?roomId=R&target=p0", "spec");
  eq([v.status, v.body.error, hasId(v.text, handIds(0))], [403, "not_approved", 0], "V3 還沒同意：看 p0 視角 403 not_approved，回應裡沒有 p0 的手牌");
}

// ---- V4 管理與回應只限座位本人 ----
{
  const m = await get(manage, "/?roomId=R&playerId=p0", "as:p0");
  eq([m.status, m.body.pending.map((x: { name: string; avatarUrl: string; requestId: string }) => [x.name, x.avatarUrl, x.requestId === reqId]), m.body.approved.length, leaks(m.text)],
    [200, [["張育瑋", PIC, true]], 0, 0], "V4 p0 的管理清單：有一筆待回應（本名、頭像），沒有帳號 id");
  eq([(await get(manage, "/?roomId=R&playerId=p0", "spec")).status, (await get(manage, "/?roomId=R&playerId=p0", "as:p1")).status,
    (await post(respond, { roomId: "R", playerId: "p0", requestId: reqId, approve: true }, "as:p1")).status,
    (await post(respond, { roomId: "R", playerId: "p1", requestId: reqId, approve: true }, "as:p1")).body?.error,
    (await post(respond, { roomId: "R", playerId: "p0", requestId: reqId, approve: true }, "spec")).status,
    (await post(respond, { roomId: "R", playerId: "p0", requestId: "not-a-uuid", approve: true }, "as:p0")).body?.error],
    [403, 403, 403, "not_pending", 403, "not_pending"],
    "V4 觀戰者、別家看不到 p0 的管理清單；別家替 p0 回應 403；拿 p0 的 requestId 用自己的座位回應 409；觀戰者自己同意 403；亂寫 requestId 409");
}

// ---- V5 同意後只看得到目標的手牌 ----
{
  archive.push(...sent); sent.length = 0;
  const a = await post(respond, { roomId: "R", playerId: "p0", requestId: reqId, approve: true }, "as:p0");
  const cnt = sent.find((e) => e.event === "mj_spectators");
  eq([a.status, a.body.status, cnt?.channel, cnt?.payload.counts, Object.keys(cnt?.payload ?? {}).sort()], [200, "approved", "mj-1234", { p0: 1, p1: 0, p2: 0, p3: 0 }, ["counts", "serverNow"]],
    "V5 p0 同意：公開頻道廣播 mj_spectators，只有每位玩家的人數");
  const v = await get(view, "/?roomId=R&target=p0", "spec");
  const g = v.body.gameState;
  const others = [1, 2, 3].map((seat) => hasId(v.text, handIds(seat)));
  eq([v.status, v.body.target, g.spectating, g.hand.map((x: Tile) => x.id), others, hasId(v.text, kongIds),
    g.players[1].revealed[0].tiles.map((x: Tile) => `${x.suit}${x.rank}`).join(),
    "opponentHands" in g, "myAvailableActions" in g, "chiForbidden" in g, "myChannel" in g, leaks(v.text)],
    [200, { playerId: "p0", name: "P0", seat: 0 }, "p0", handIds(0), [0, 0, 0], 0, "z0,z0,z0,z0", false, false, false, false, 0],
    "V5 看 p0 視角：只有 p0 的手牌；另外三家手牌一張都沒有、p1 暗槓蓋牌（沒牌面、沒 id）；p0 眼牌看得到的三家手牌、動作、座位頻道都不在；沒有帳號 id");
  const other = await get(view, "/?roomId=R&target=p1", "spec");
  const spec2 = await get(view, "/?roomId=R&target=p0", "spec2");
  eq([other.status, hasId(other.text, handIds(1)), spec2.status, hasId(spec2.text, handIds(0)), (await get(view, "/?roomId=R&target=p0", "guest")).status, (await get(view, "/?roomId=R&target=p0")).status],
    [403, 0, 403, 0, 403, 401], "V5 沒同意的 p1 拿不到；別的觀戰者沒申請也拿不到 p0；遊客、沒登入都拿不到");
}

// ---- V6 觀戰者只能看 ----
{
  const before = JSON.stringify(rooms.R.game_state);
  archive.push(...sent); sent.length = 0;
  const form = new FormData(); form.set("roomId", "R"); form.set("playerId", "p0"); form.set("audio", new Blob([new Uint8Array(100)], { type: "audio/webm" }));
  const voiceRes = await voice(new Request("http://x", { method: "POST", headers: auth("spec"), body: form }));
  const codes = [
    (await post(discard, { roomId: "R", playerId: "p0", tileId: handIds(0)[0] }, "spec")).status,
    (await post(draw, { roomId: "R", playerId: "p0" }, "spec")).status,
    (await post(action, { roomId: "R", playerId: "p0", actionType: "pass" }, "spec")).status,
    (await post(chat, { roomId: "R", text: "報牌" }, "spec")).status,
    voiceRes.status,
    (await post(effect, { roomId: "R", effect: "heart", to: "p1" }, "spec")).status,
    (await post(nextGame, { roomId: "R", playerId: "p0" }, "spec")).status,
    (await post(leaveVote, { roomId: "R", playerId: "p0", approve: true }, "spec")).status,
    (await get(getState, "/?roomId=R&playerId=p0", "spec")).status,
  ];
  eq([codes.every((c) => c === 401 || c === 403), JSON.stringify(rooms.R.game_state) === before, sent.length], [true, true, 0],
    `V6 觀戰者送出打牌、摸牌、吃碰槓胡、聊天、語音、特效、下一局、離房投票、讀 p0 的本人 state 全部被拒（${codes.join(",")}），牌局沒變、沒有任何廣播`);
}

// ---- V7 收回 ----
{
  archive.push(...sent); sent.length = 0;
  const rv = await post(revoke, { roomId: "R", playerId: "p0", requestId: reqId }, "as:p0");
  const v = await get(view, "/?roomId=R&target=p0", "spec");
  const cnt = sent.find((e) => e.event === "mj_spectators");
  const list = await get(roomInfo, "/?code=1234", "spec");
  eq([rv.body.revoked, v.status, v.body.error, hasId(v.text, handIds(0)), cnt?.payload.counts, list.body.players[0].status, list.body.players[0].canRequest],
    [1, 403, "not_approved", 0, { p0: 0, p1: 0, p2: 0, p3: 0 }, "revoked", false],
    "V7 p0 收回：下一次看視角就 403、沒有手牌；人數廣播變 0；觀戰者清單顯示已收回（冷卻中不能馬上再申請）");
  eq([(await post(revoke, { roomId: "R", playerId: "p0" }, "spec")).status, (await post(revoke, { roomId: "R", playerId: "p0", requestId: "x" }, "as:p0")).status],
    [403, 400], "V7 觀戰者不能替 p0 收回；requestId 格式錯 400");
}

// ---- V8 冷卻與逾時 ----
{
  clock.now += 10_000;
  const cd = await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "spec");
  clock.now += 20_001;
  const ok = await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "spec");
  const req2 = (sent.filter((e) => e.event === "mj_spectate_request").at(-1)?.payload.requestId as string) ?? "";
  clock.now += 30_001;
  const late = await post(respond, { roomId: "R", playerId: "p0", requestId: req2, approve: true }, "as:p0");
  const list = await get(roomInfo, "/?code=1234", "spec");
  const pend = await get(manage, "/?roomId=R&playerId=p0", "as:p0");
  eq([cd.status, cd.body.error, cd.body.cooldownUntil - (clock.now - 60_002), ok.status, late.body.error, list.body.players[0].status, list.body.players[0].canRequest, pend.body.pending.length, (await get(view, "/?roomId=R&target=p0", "spec")).status],
    [429, "cooldown", 30000, 200, "not_pending", "expired", true, 0, 403],
    "V8 收回後 10 秒再申請 429（冷卻到上次申請 30 秒後）；30 秒後可以申請；30 秒沒回應就失效（同意 409、清單顯示 expired、管理清單沒了、看不到）");
  const r3 = await post(requestRoute, { roomId: "R", targetPlayerId: "p2" }, "spec");
  const req3 = (sent.filter((e) => e.event === "mj_spectate_request").at(-1)?.payload.requestId as string) ?? "";
  const rej = await post(respond, { roomId: "R", playerId: "p2", requestId: req3, approve: false }, "as:p2");
  clock.now += 5_000;
  const again = await post(requestRoute, { roomId: "R", targetPlayerId: "p2" }, "spec");
  const l2 = (await get(roomInfo, "/?code=1234", "spec")).body.players[2];
  eq([r3.status, rej.body.status, again.status, l2.status, l2.cooldownUntil - clock.now, (await get(view, "/?roomId=R&target=p2", "spec")).status],
    [200, "rejected", 429, "rejected", 25000, 403], "V8 p2 拒絕：5 秒後再申請 429，清單顯示已拒絕、還要 25 秒；看不到 p2");
}

// ---- V9 多視角切換、人數 ----
{
  clock.now += 30_001;
  const ids: Record<string, string> = {};
  for (const [tok, target] of [["spec", "p2"], ["spec", "p3"], ["spec2", "p2"]] as const) {
    await post(requestRoute, { roomId: "R", targetPlayerId: target }, tok);
    ids[tok + target] = sent.filter((e) => e.event === "mj_spectate_request").at(-1)?.payload.requestId as string;
    await post(respond, { roomId: "R", playerId: target, requestId: ids[tok + target], approve: true }, "as:" + target);
  }
  const v2 = await get(view, "/?roomId=R&target=p2", "spec");
  const v3 = await get(view, "/?roomId=R&target=p3", "spec");
  const st = await get(getState, "/?roomId=R&playerId=p1", "as:p1");
  const pubSt = await get(getState, "/?roomId=R");
  const want = { p0: 0, p1: 0, p2: 2, p3: 1 };
  eq([v2.status, v2.body.gameState.hand.map((x: Tile) => x.id), hasId(v2.text, handIds(3)), v3.status, v3.body.gameState.hand.map((x: Tile) => x.id), hasId(v3.text, handIds(2)),
    v2.body.spectatorCounts, st.body.gameState.spectatorCounts, pubSt.body.gameState.spectatorCounts, leaks(st.text + pubSt.text)],
    [200, handIds(2), 0, 200, handIds(3), 0, want, want, want, 0],
    "V9 同一位觀戰者可以在 p2、p3 之間切換，各自只有那一位的手牌；三處的人數一致（p2 兩人、p3 一人）；state 沒有帳號 id");
  const all = await post(revoke, { roomId: "R", playerId: "p2" }, "as:p2");
  eq([all.body.revoked, (await get(view, "/?roomId=R&target=p2", "spec")).status, (await get(view, "/?roomId=R&target=p2", "spec2")).status, (await get(view, "/?roomId=R&target=p3", "spec")).status],
    [2, 403, 403, 200], "V9 p2 收回全部：兩位都看不到 p2，p3 的同意不受影響");
}

// ---- V10 房間結束 ----
{
  rooms.R.game_state.gameOver = true;
  const over = await get(view, "/?roomId=R&target=p3", "spec");
  rooms.R.game_state.gameOver = false;
  delete rooms.R;
  const gone = await get(view, "/?roomId=R&target=p3", "spec");
  eq([over.status, over.body.error, hasId(over.text, handIds(3)), gone.status, gone.body.error], [410, "room_ended", 0, 404, "room_not_found"],
    "V10 整場打完 410、房間刪除 404，都拿不到手牌");
}

// ---- 全程：私人手牌沒有進公開頻道 ----
{
  const everything = [...archive, ...sent];
  const pub = everything.filter((e) => e.channel === "mj-1234");
  eq([pub.every((e) => e.event === "mj_spectators"), hasId(JSON.stringify(pub), [0, 1, 2, 3].flatMap(handIds)), leaks(JSON.stringify(everything)), everything.filter((e) => e.event === "mj_spectate_request").every((e) => e.channel !== "mj-1234")], [true, 0, 0, true],
    "觀戰 API 送到公開頻道的只有 mj_spectators（沒有任何手牌）；所有廣播都沒有帳號 id");
}

// ---- V11 查房先驗身分 ----
{
  const r = [
    (await get(roomInfo, "/?code=5678", "guest")).body?.error,
    (await get(roomInfo, "/?code=5678")).body?.error,
    (await get(roomInfo, "/?code=9999", "guest")).body?.error,
    (await get(roomInfo, "/?code=12a4")).body?.error,
  ];
  eq(r, ["guest_not_allowed", "not_logged_in", "guest_not_allowed", "not_logged_in"],
    "V11 遊客查還沒開局的房 403（不是 409）、沒登入 401；遊客查不存在的房 403（不是 404）；沒登入時房號格式錯也是 401");
}

// ---- V12 view 限流 ----
{
  setup();
  clock.now += 5_000;
  const real = rooms.R; let reads = 0;
  Object.defineProperty(rooms, "R", { get() { reads++; return real; }, configurable: true, enumerable: true });
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) codes.push((await get(view, "/?roomId=R&target=p3", "spec")).status);
  const before = reads;
  const over = await get(view, "/?roomId=R&target=p3", "spec");
  const readsOnBlocked = reads - before;
  const other = (await get(view, "/?roomId=R&target=p3", "spec2")).status; // 別的觀戰者不受影響（沒同意 403）
  clock.now += 1_000;
  const after = (await get(view, "/?roomId=R&target=p3", "spec")).status;
  delete (rooms as Record<string, unknown>).R; rooms.R = real;
  eq([codes.every((c) => c === 200), over.status, over.body.error, over.body.retryAfterMs, readsOnBlocked, other, after],
    [true, 429, "rate_limited", 1000, 0, 403, 200],
    "V12 同一秒內前 10 次 200，第 11 次 429 rate_limited（retryAfterMs 1000），被擋的那次沒有讀房間；別的觀戰者不受影響；過 1 秒恢復");
}

// ---- V13 關房時清 7 天前的觀戰資料 ----
{
  const d = await db();
  const ago = (days: number) => new Date(clock.now - days * 86_400_000).toISOString();
  const ins = (room: string, days: number) => d.query("insert into mj_spectate values ($1, 'uid-old', 'p0', gen_random_uuid(), 'approved', '舊', null, $2, $2)", [room, ago(days)]);
  await ins("OLD8", 8); await ins("KEEP6", 6);
  const rooms0 = async () => (await d.query<{ room_id: string }>("select distinct room_id from mj_spectate order by 1")).rows.map((r) => r.room_id);
  const hadR = (await rooms0()).includes("R");
  const closed = await closeMahjongRoom("R", "1234", rooms.R.game_state, "dissolved");
  const left = await rooms0();
  eq([hadR, closed, left], [true, true, ["KEEP6"]], "V13 R 關房：R 的觀戰資料刪掉、8 天前別房的也刪掉，6 天前的留著");
  await ins("OLD9", 9);
  setup();
  await post(requestRoute, { roomId: "R", targetPlayerId: "p1" }, "spec");
  failNext.deleteOld = true;
  const closed2 = await closeMahjongRoom("R", "1234", rooms.R.game_state, "dissolved");
  eq([closed2, await rooms0()], [true, ["KEEP6", "OLD9"]], "V13 清舊資料失敗：房間照樣關、R 的觀戰資料照樣刪，只是 9 天前的沒清到（下次關房再清）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
