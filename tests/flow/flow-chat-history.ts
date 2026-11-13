// 麻將聊天紀錄與觀戰收聊天（老闆 2026-11-13：聊天保存在這一場；觀戰可以看聊天、看互動，但不能發言）
//   S 保存：上桌玩家發言後，同桌每個人都能讀到歷史；重新整理（重新讀一次）歷史還在；被冷卻擋下的不存
//   L 上限：只留最近 CHAT_HISTORY_LIMIT 則
//   V 語音：歷史裡的語音重新簽發網址；檔案已清掉就給 null
//   W 觀戰：已同意的觀戰者能讀歷史、拿到觀戰頻道；聊天、互動都會送一份到觀戰頻道（公開頻道收不到）；
//         觀戰者不能發言、不能送語音、不能丟互動；沒被同意的人、沒登入的人讀不到
//   X 關房：這房的聊天紀錄一起刪掉，別房不動；讀歷史 404
//   P 不影響牌局：發言不碰牌局狀態（版本號不變）；冷卻＋存檔同一次資料庫呼叫（和查同意觀戰名單並行）
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { POST as chat } from "../../app/api/mahjong/chat/route";
import { GET as history } from "../../app/api/mahjong/chat/history/route";
import { POST as voice } from "../../app/api/mahjong/voice/route";
import { POST as effect } from "../../app/api/mahjong/effect/route";
import { closeMahjongRoom } from "../../lib/records/close";
import { privateChannelName, spectatorChannelName } from "../../lib/mahjong/access";
import { CHAT_HISTORY_LIMIT } from "../../lib/mahjong/chat/rules";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { clock, voices, calls } from "../support/stub-chat-store";
import { clock as fxClock } from "../support/stub-effects-store";
import { requestSpectate, respondSpectate, revokeSpectate } from "../support/stub-spectate-store";
import { db } from "../support/pg-mj";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const as = (pid: string) => `as:${pid}`;
async function post(fn: (r: Request) => Promise<Response>, body: unknown, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: auth(tok), body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function hist(roomId: string, tok?: string) {
  const r = await history(new Request(`http://x/api/mahjong/chat/history?roomId=${roomId}`, { headers: auth(tok) }));
  return { status: r.status, body: await r.json() };
}
const say = (pid: string, text: string, roomId = "R") => post(chat, { roomId, text }, as(pid));
const tick = (ms: number) => { clock.now += ms; fxClock.now += ms; };
const texts = (b: { messages?: { text?: string }[] }) => (b.messages ?? []).map((m) => m.text);

const mkState = (code: string, ids: string[]) => ({
  roomCode: code, status: "playing", stateVersion: 7,
  players: ids.map((id, seat) => ({ id, userId: `u:${id}`, name: "名" + id, seat, hand: [], revealed: [], flowers: [], discards: [], isDealer: seat === 0 })),
}) as unknown as MahjongGameState;
rooms.R = { id: "R", code: "5878", game_state: mkState("5878", ["p0", "p1", "p2", "p3"]), status: "playing" };
rooms.R2 = { id: "R2", code: "6000", game_state: mkState("6000", ["q0", "q1", "q2", "q3"]), status: "playing" };
tokens.watcher = { id: "u:watcher", displayName: "觀戰者", pictureUrl: null, isGuest: false };
tokens.stranger = { id: "u:stranger", displayName: "路人", pictureUrl: null, isGuest: false };

// ---------- S 保存 ----------
{
  const a = await say("p0", "大家好"); tick(2500);
  const b = await say("p1", "嗨"); tick(500);
  const blocked = await say("p1", "太快了被擋"); tick(2500);
  const h0 = await hist("R", as("p0"));
  const h3 = await hist("R", as("p3"));
  eq([a.status, b.status, blocked.status, h0.status, h0.body.role, texts(h0.body), texts(h3.body)],
    [200, 200, 429, 200, "player", ["大家好", "嗨"], ["大家好", "嗨"]],
    "S1 上桌玩家發言後，同桌每個人都讀得到歷史（舊到新）；被冷卻擋下的那則沒有存");
  eq([h0.body.messages[0].id === a.body.message.id, h0.body.messages[0].fromName, h0.body.messages[0].fromSeat, h0.body.limit, "spectatorChannel" in h0.body],
    [true, "名p0", 0, CHAT_HISTORY_LIMIT, false], "S2 歷史和即時事件是同一則（同一個 id，可以去重）；伺服器認定的名字、座位；玩家不會拿到觀戰頻道");
  const again = await hist("R", as("p0"));
  eq(texts(again.body), ["大家好", "嗨"], "S3 重新整理／斷線重連後再讀一次，歷史還在");
  const other = await hist("R2", as("q0"));
  eq([other.status, texts(other.body)], [200, []], "S4 別房的歷史是空的（各房分開存）");
}

// ---------- P 不影響牌局 ----------
{
  const before = rooms.R.game_state.stateVersion;
  calls.checkRate.length = 0;
  await say("p2", "打牌中說話"); tick(2500);
  eq([rooms.R.game_state.stateVersion, calls.checkRate], [before, ["text:take"]],
    "P1 發言不碰牌局狀態（版本號不變、不觸發牌局同步）；冷卻檢查和存檔是同一次資料庫呼叫（另外和查同意觀戰名單並行送出）");
}

// ---------- W 觀戰 ----------
{
  const req = await requestSpectate("R", "u:watcher", "p0", "觀戰者", null);
  if (req.ok) await respondSpectate("R", "p0", req.requestId, true);
  const h = await hist("R", "watcher");
  eq([req.ok, h.status, h.body.role, h.body.spectatorChannel, texts(h.body).length],
    [true, 200, "spectator", spectatorChannelName("5878", "R", "u:watcher"), 3],
    "W1 被同意觀戰的人：讀得到歷史，並拿到他自己的觀戰頻道名稱（綁這一場＋他的帳號，伺服器金鑰 HMAC，猜不到）");
  sent.length = 0;
  const m = await say("p3", "觀戰的人也看得到"); tick(5000);
  const fx = await post(effect, { roomId: "R", effect: "heart", to: "p1" }, as("p0"));
  const specCh = spectatorChannelName("5878", "R", "u:watcher");
  const toSpec = sent.filter((e) => e.channel === specCh);
  eq([m.status, fx.status, toSpec.map((e) => e.event), toSpec.map((e) => e.payload.playerId), (toSpec[0]?.payload.message as { text?: string })?.text, (toSpec[1]?.payload.effect as { effect?: string })?.effect],
    [200, 200, ["mj_chat", "mj_effect"], ["*spectators", "*spectators"], "觀戰的人也看得到", "heart"],
    "W2 聊天和互動特效都會送一份到這位觀戰者的頻道（格式和座位頻道一樣）");
  eq([sent.some((e) => e.channel === "mj-5878"), sent.filter((e) => e.event === "mj_chat" && e.channel !== specCh).every((e) => e.channel === privateChannelName("5878", e.payload.playerId as string))],
    [false, true], "W3 公開頻道 mj-<房號> 照樣收不到；座位頻道照舊");
  const count = async () => (await (await db()).query<{ n: number }>("select count(*)::int n from mj_chat_messages where room_id = 'R'")).rows[0].n;
  const cnt = await count();
  const s1 = await post(chat, { roomId: "R", text: "觀戰者想說話" }, "watcher");
  const s2 = await post(effect, { roomId: "R", effect: "egg", to: "p1" }, "watcher");
  const fd = new FormData(); fd.set("roomId", "R"); fd.set("audio", new Blob([new Uint8Array(100)], { type: "audio/webm" }), "rec");
  const s3r = await voice(new Request("http://x", { method: "POST", headers: auth("watcher"), body: fd }));
  const cnt2 = await count();
  eq([`${s1.status}:${s1.body.error}`, `${s2.status}:${s2.body.error}`, `${s3r.status}:${(await s3r.json()).error}`, cnt2 === cnt],
    ["403:not_in_room", "403:not_in_room", "403:not_in_room", true], "W4 觀戰者不能發言、不能丟互動、不能送語音（都 403 not_in_room），聊天紀錄沒有多");
  const st = await hist("R", "stranger");
  const nobody = await hist("R");
  const otherRoom = await hist("R2", "watcher");
  eq([`${st.status}:${st.body.error}`, `${nobody.status}:${nobody.body.error}`, `${otherRoom.status}:${otherRoom.body.error}`],
    ["403:not_allowed", "401:not_logged_in", "403:not_allowed"], "W5 沒被同意觀戰的人、沒登入的人、在別房沒被同意的觀戰者都讀不到");
  const req2 = await requestSpectate("R2", "u:stranger", "q0", "路人", null);
  eq([req2.ok, (await hist("R2", "stranger")).status], [true, 403], "W6 只是申請、還沒被同意：讀不到");

  // 必修 5：每位觀戰者各自一個頻道 → 偽造只能騙到自己
  tokens.watcher2 = { id: "u:watcher2", displayName: "觀戰者二", pictureUrl: null, isGuest: false };
  const r2 = await requestSpectate("R", "u:watcher2", "p1", "觀戰者二", null);
  if (r2.ok) await respondSpectate("R", "p1", r2.requestId, true);
  const ch1 = (await hist("R", "watcher")).body.spectatorChannel, ch2 = (await hist("R", "watcher2")).body.spectatorChannel;
  sent.length = 0;
  await say("p2", "兩位觀戰者各收一份"); tick(2500);
  const got = sent.filter((e) => e.event === "mj_chat" && e.payload.playerId === "*spectators").map((e) => e.channel);
  eq([ch1 !== ch2, got.sort()], [true, [ch1, ch2].sort()],
    "必修 5：兩位觀戰者各自一個頻道、各收一份；觀戰者手上只有自己的頻道名稱，用公開金鑰往裡面發假訊息只有自己看得到，騙不到其他觀戰者或玩家");
  const rev = await revokeSpectate("R", "p1", null);
  sent.length = 0;
  await say("p2", "收回之後"); tick(2500);
  eq([rev > 0, sent.some((e) => e.channel === ch2), sent.some((e) => e.channel === ch1)], [true, false, true],
    "必修 5（附帶）：每則都重新查同意名單，同意被收回後下一則就不再送到他的頻道");
}

// ---------- 必修 1：觀戰頻道綁這一場（房號重用） ----------
{
  const oldCh = spectatorChannelName("5878", "R", "u:watcher");
  rooms.R9 = { id: "R9", code: "5878", game_state: mkState("5878", ["z0", "z1", "z2", "z3"]), status: "playing" }; // 同一個房號開新的一場
  const req = await requestSpectate("R9", "u:watcher", "z0", "觀戰者", null);
  if (req.ok) await respondSpectate("R9", "z0", req.requestId, true);
  const newCh = (await hist("R9", "watcher")).body.spectatorChannel;
  sent.length = 0;
  await say("z1", "新的一場", "R9"); tick(2500);
  eq([oldCh !== newCh, sent.some((e) => e.channel === oldCh), sent.some((e) => e.channel === newCh)], [true, false, true],
    "必修 1：房號重用開新場，觀戰頻道名稱跟著換（綁房間 id）；舊場的觀戰頻道收不到新場的聊天");
  await closeMahjongRoom("R9", "5878", rooms.R9.game_state, "dissolved");
}

// ---------- V 語音 ----------
{
  const ff = (ffmpegStatic as unknown as string) || "ffmpeg";
  const dir = mkdtempSync(path.join(tmpdir(), "flow-chat-history-"));
  const f = path.join(dir, "a.webm");
  execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", "-b:a", "32k", f]);
  tick(60000);
  const fd = new FormData(); fd.set("roomId", "R"); fd.set("audio", new Blob([readFileSync(f)], { type: "audio/webm" }), "rec");
  const r = await voice(new Request("http://x", { method: "POST", headers: auth(as("p1")), body: fd }));
  const body = await r.json();
  const h = await hist("R", as("p2"));
  const v = h.body.messages.find((m: { id: string }) => m.id === body.message?.id);
  const stored = (await (await db()).query<{ msg: Record<string, unknown> }>("select msg from mj_chat_messages where msg->>'id' = $1", [body.message?.id])).rows[0]?.msg ?? {};
  eq([r.status, v?.kind, typeof v?.url === "string" && v.url.includes("R/"), v?.durationMs > 0, "url" in stored, stored.voiceKey],
    [200, "voice", true, true, false, `R/${body.message?.id}.m4a`],
    "V1 語音也存進歷史：資料庫只存檔案路徑（不存會過期的網址），讀歷史時重新簽發網址");
  for (const k of [...voices.keys()]) voices.delete(k); // 模擬 24 小時後被定期清除
  const h2 = await hist("R", as("p2"));
  eq(h2.body.messages.find((m: { id: string }) => m.id === body.message?.id)?.url, null, "V2 語音檔已經清掉：歷史照樣有這則，網址給 null（前端顯示「語音已過期」）");
}

// ---------- L 上限 ----------
{
  tick(60000);
  for (let i = 1; i <= CHAT_HISTORY_LIMIT + 5; i++) {
    // 每人每則間隔 2 秒、15 秒內最多 5 則：四個人輪流，每則間隔 4 秒，不會被冷卻擋
    const r = await say(["q0", "q1", "q2", "q3"][i % 4], `第${i}則`, "R2");
    if (r.status !== 200) { eq(r.status, 200, `L 送第 ${i} 則失敗`); break; }
    tick(4000);
  }
  const h = await hist("R2", as("q0"));
  const n = (await (await db()).query("select count(*)::int n from mj_chat_messages where room_id = 'R2'")).rows[0] as { n: number };
  eq([h.body.messages.length, texts(h.body)[0], texts(h.body).at(-1), n.n], [CHAT_HISTORY_LIMIT, "第6則", `第${CHAT_HISTORY_LIMIT + 5}則`, CHAT_HISTORY_LIMIT],
    `L1 每房只留最近 ${CHAT_HISTORY_LIMIT} 則：送了 ${CHAT_HISTORY_LIMIT + 5} 則，最舊的 5 則刪掉，資料庫也只剩 ${CHAT_HISTORY_LIMIT} 列`);
}

// ---------- X 關房 ----------
{
  const before = (await (await db()).query<{ room_id: string; n: number }>("select room_id, count(*)::int n from mj_chat_messages group by 1 order by 1")).rows;
  const closed = await closeMahjongRoom("R", "5878", rooms.R.game_state, "dissolved");
  const after = (await (await db()).query<{ room_id: string; n: number }>("select room_id, count(*)::int n from mj_chat_messages group by 1 order by 1")).rows;
  const h = await hist("R", as("p0"));
  eq([closed, before.map((r) => r.room_id), after.map((r) => `${r.room_id}:${r.n}`), `${h.status}:${h.body.error}`],
    [true, ["R", "R2"], [`R2:${CHAT_HISTORY_LIMIT}`], "404:room_not_found"],
    "X1 關房：這房的聊天紀錄一起刪掉，別房不動；之後讀歷史 404");
}

// ---------- 必修 3：關房後晚到的寫入要擋 ----------
{
  rooms.R3 = { id: "R3", code: "7001", game_state: mkState("7001", ["k0", "k1", "k2", "k3"]), status: "playing" };
  tick(60000);
  const ok = await say("k0", "關房前", "R3");
  const st = await import("../support/stub-chat-store");
  const msg = { id: "late-1", kind: "text" as const, from: "k1", fromName: "名k1", fromSeat: 1, text: "關房後才到", ts: clock.now };
  await closeMahjongRoom("R3", "7001", rooms.R3.game_state, "dissolved");
  // 模擬「resolveMember 時房間還在、寫入時房間剛被關掉」：直接打 store（路由在那之前已經通過檢查）
  tick(3000);
  const late = await st.postText("R3", "u:k1", msg);
  const lateVoice = await st.appendVoice("R3", { ...msg, id: "late-2", kind: "voice", durationMs: 1000 });
  const left = (await (await db()).query<{ n: number }>("select count(*)::int n from mj_chat_messages where room_id = 'R3'")).rows[0].n;
  const rate = (await (await db()).query<{ n: number }>("select count(*)::int n from mj_chat_rate where room_id = 'R3'")).rows[0].n;
  eq([ok.status, late, lateVoice, left, rate], [200, -1, false, 0, 0],
    "必修 3：關房並清掉紀錄之後，晚到的文字（回 -1）和語音（回 false）都寫不進去，這房的聊天紀錄和冷卻紀錄都維持 0 列");
  const viaApi = await say("k2", "路由也擋", "R3");
  eq(`${viaApi.status}:${viaApi.body.error}`, "404:room_not_found", "必修 3：房間關掉後走路由送：404（房間不在）");
}

// ---------- 必修 2：保底清除只刪房間已經不在的聊天 ----------
{
  const d = await db();
  rooms.OLD = { id: "OLD", code: "7002", game_state: mkState("7002", ["o0", "o1", "o2", "o3"]), status: "playing" };
  tick(60000);
  await say("o0", "開很久的房", "OLD");
  await d.query("update mj_chat_messages set created_at = created_at - interval '5 days' where room_id = 'OLD'"); // 這房開了 5 天、還在打
  await d.query("insert into mj_chat_messages (room_id, msg, created_at) values ('GONE', '{\"id\":\"x\",\"kind\":\"text\"}', now())"); // 已經關掉、漏刪的房
  tick(60000);
  await say("q1", "別房寫一則", "R2");
  const rows = (await d.query<{ room_id: string; n: number }>("select room_id, count(*)::int n from mj_chat_messages where room_id in ('OLD', 'GONE') group by 1 order by 1")).rows;
  eq(rows.map((r) => `${r.room_id}:${r.n}`), ["OLD:1"], "必修 2：別房寫入時的保底清除，只刪房間已經不在的（GONE），還開著的房就算聊天已經 5 天前也不動（OLD）");
}

// ---------- 必修 4：200 則裁切同房互斥 ----------
{
  const d = await db();
  await d.exec("begin");
  await d.query("select mj_chat_append('R2', '{\"id\":\"lock\",\"kind\":\"text\"}', $1)", [CHAT_HISTORY_LIMIT]);
  const locks = (await d.query<{ n: number }>("select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()")).rows[0].n;
  const roomLock = (await d.query<{ n: number }>("select count(*)::int n from pg_locks where locktype = 'tuple' or (locktype = 'relation' and relation = 'mj_rooms'::regclass and mode = 'RowShareLock')")).rows[0].n;
  await d.exec("commit");
  const n = (await d.query<{ n: number }>("select count(*)::int n from mj_chat_messages where room_id = 'R2'")).rows[0].n;
  eq([locks, roomLock > 0, n], [1, true, CHAT_HISTORY_LIMIT],
    "必修 4：寫入＋裁切在同一個交易裡先拿這房的 advisory lock（同房的另一則會排隊，不會交錯多刪少刪）、並鎖住房間那一列；裁切後仍剛好 200 則");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
