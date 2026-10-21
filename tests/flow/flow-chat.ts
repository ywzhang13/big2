// 遊戲內打字聊天、語音訊息的 API（2026-10-23）
//   H 權限：沒登入、不是這桌、冒充別人的 playerId／名字、訪客（403，但照樣收得到）；訊息只走同桌四人的座位頻道
//   R 別的房間：別桌玩家送不進來、收不到；語音檔放在各自房間的資料夾
//   T 文字：快捷短語、長度（字元數）、空白、控制與雙向覆寫字元、超大 body；不過濾髒話
//   C 冷卻：每則間隔 2 秒、15 秒內 5 則冷卻 15 秒；被擋下的不扣、不送；文字和語音各算各的
//   V 語音：webm／mp4 都轉成 m4a、存檔、送網址；壞檔、太短不扣冷卻（審伯退件 1）；同時兩則只放一則；過大、非同桌
//   D 刪除：關房刪掉該房語音檔和冷卻紀錄，別房不動；定期清除刪掉房間已經不在的、超過 24 小時的
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { POST as chat } from "../../app/api/mahjong/chat/route";
import { POST as voice } from "../../app/api/mahjong/voice/route";
import { closeMahjongRoom, sweepIdleRooms } from "../../lib/records/close";
import { privateChannelName } from "../../lib/mahjong/access";
import { rooms, seats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { clock, voices, calls } from "../support/stub-chat-store";
import { db } from "../support/pg-mj";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const as = (pid: string) => `as:${pid}`; // stub-auth：以座位本人登入（帳號 u:<pid>）
async function call(fn: (r: Request) => Promise<Response>, body: unknown, tok?: string, raw = false) {
  const r = await fn(new Request("http://x", { method: "POST", headers: auth(tok), body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const say = (pid: string, text: unknown, extra: object = {}) => call(chat, { roomId: "R", text, ...extra }, as(pid));
const tick = (ms: number) => (clock.now += ms);
const chats = () => sent.filter((e) => e.event === "mj_chat");
const st = (r: { status: number; body: { error?: string } }) => `${r.status}:${r.body.error ?? "ok"}`;
const rateRows = async () => (await (await db()).query<{ room_id: string; user_id: string; kind: string }>("select room_id, user_id, kind from mj_chat_rate order by 1, 2, 3")).rows;

// 兩桌：R（5878，已開局，座位打亂過：p2 坐 0 號；g9 是訪客）、R2（6000，已開局）；L（7000，還在大廳，只有 mj_players）
const mkState = (code: string, ids: string[]) => ({
  roomCode: code, status: "playing", stateVersion: 3,
  players: ids.map((id, seat) => ({ id, userId: `u:${id}`, name: "名" + id, seat, hand: [], revealed: [], flowers: [], discards: [], isDealer: seat === 0 })),
}) as unknown as MahjongGameState;
rooms.R = { id: "R", code: "5878", game_state: mkState("5878", ["p2", "p0", "g9", "p1"]), status: "playing" };
rooms.R2 = { id: "R2", code: "6000", game_state: mkState("6000", ["q0", "q1", "q2", "q3"]), status: "playing" };
rooms.L = { id: "L", code: "7000", game_state: null as unknown as MahjongGameState, status: "waiting" };
seats.L = [{ player_id: "w0", name: "大廳甲", seat: 0, user_id: "u:w0" }, { player_id: "w1", name: "大廳乙", seat: 1, user_id: "u:w1" }];
tokens.guest = { id: "u:g9", displayName: "訪客", pictureUrl: null, isGuest: true };

// ---------- H 權限 ----------
{
  sent.length = 0;
  const r = await say("p0", "你好", { fromName: "假冒的名字", fromSeat: 0 });
  const ev = chats();
  const msg = r.body.message;
  eq([r.status, msg.kind, msg.from, msg.fromName, msg.fromSeat, msg.text], [200, "text", "p0", "名p0", 1, "你好"],
    "H1 同桌玩家送文字：200，發送者、名字、座位（打亂後 p0 坐 1 號）由伺服器決定（帶 fromName、fromSeat 也沒用）");
  eq([ev.length, ev.map((e) => e.payload.playerId).sort(), ev.every((e) => e.channel === privateChannelName("5878", e.payload.playerId as string))],
    [4, ["g9", "p0", "p1", "p2"], true], "H2 只送到同桌四人的座位頻道（含自己、含訪客 g9：訪客看得到）");
  eq(sent.some((e) => e.channel === "mj-5878" || e.channel === "mj-6000"), false, "H3 公開頻道 mj-<房號> 收不到（知道房號的外人看不到）");
}
{
  sent.length = 0; tick(3000);
  const g1 = await call(chat, { roomId: "R", text: "我是訪客" }, "guest");
  const g2 = await call(chat, { roomId: "R", phrase: "nice" }, "guest");
  const b = await call(chat, { roomId: "R", text: "冒充", playerId: "p1" }, as("p0"));
  const c = await call(chat, { roomId: "R", text: "沒登入" });
  tokens.outsider = { id: "u:zz", displayName: "路人", pictureUrl: null, isGuest: false };
  const d = await call(chat, { roomId: "R", text: "路人" }, "outsider");
  const e = await call(chat, { roomId: "NOPE", text: "x" }, as("p0"));
  eq([st(g1), st(g2), st(b), st(c), st(d), st(e)],
    ["403:guest_not_allowed", "403:guest_not_allowed", "403:not_your_seat", "401:not_logged_in", "403:not_in_room", "404:room_not_found"],
    "H4 訪客（就算坐在這桌）文字、快捷短語都 403 guest_not_allowed；冒充別人的 playerId 403；沒登入 401；不在這桌的 LINE 帳號 403；房間不存在 404");
  eq([chats().length, (await rateRows()).some((r) => r.user_id === "u:g9" || r.user_id === "u:zz")], [0, false], "H5 被擋下的請求一則都沒送出，也沒有記冷卻");
}
{
  sent.length = 0;
  const r = await call(chat, { roomId: "L", text: "大廳聊天" }, as("w1"));
  eq([r.status, r.body.message?.fromName, chats().map((e) => e.payload.playerId).sort()], [200, "大廳乙", ["w0", "w1"]], "H6 還沒開局（大廳）照 mj_players 認人，只送給已坐下的人");
}

// ---------- R 別的房間 ----------
{
  sent.length = 0; tick(3000);
  const a = await say("q0", "我是別桌的"); // q0 在 R2，不在 R
  const b = await call(chat, { roomId: "R2", text: "R2 的悄悄話" }, as("q1"));
  eq([st(a), b.status, chats().map((e) => e.channel).every((ch) => ["q0", "q1", "q2", "q3"].some((p) => ch === privateChannelName("6000", p)))],
    ["403:not_in_room", 200, true], "R1 別桌玩家送進 R：403；R2 的訊息只送到 R2 四人的座位頻道，R 的人收不到");
}

// ---------- T 文字 ----------
{
  tick(20000); sent.length = 0;
  const p = await call(chat, { roomId: "R", phrase: "hurry" }, as("p1")); tick(2000);
  const bad1 = await call(chat, { roomId: "R", phrase: "dance" }, as("p1"));
  const bad2 = await call(chat, { roomId: "R", phrase: "nice", text: "混在一起" }, as("p1"));
  eq([p.status, p.body.message?.text, p.body.message?.phrase, st(bad1), st(bad2)], [200, "快點啦", "hurry", "400:unknown_phrase", "400:unknown_phrase"],
    "T1 快捷短語：伺服器換成文字「快點啦」並帶 phrase；不認得的短語、短語和文字一起送都 400");
}
{
  tick(20000);
  const forty = "一".repeat(40), fortyOne = "一".repeat(41), emoji40 = "😀".repeat(40);
  const r1 = await say("p1", fortyOne); tick(2000);
  const r2 = await say("p1", forty); tick(2000);
  const r3 = await say("p1", emoji40); tick(2000);
  const r4 = await say("p1", "   \n\t  "); tick(2000);
  const r5 = await say("p1", 123); tick(20000);
  eq([st(r1), r2.status, r3.status, st(r4), st(r5)], ["400:text_too_long", 200, 200, "400:empty_text", "400:bad_request"],
    "T2 41 字擋、40 字和 40 個 emoji 可以（用字元數算）、空白 empty_text、不是字串 bad_request");
  const r6 = await say("p1", "a‮b\u0000c​d   e\n<script>alert(1)</script>"); tick(2000);
  const r7 = await say("p1", "幹你很爛欸"); tick(20000);
  eq([r6.body.message?.text, r7.status, r7.body.message?.text], ["abcd e <script>alert(1)</script>", 200, "幹你很爛欸"],
    "T3 控制字元、雙向覆寫、零寬字元拿掉、空白收成一格；HTML 原樣當文字；不過濾髒話（老闆決定）");
  const big = await call(chat, JSON.stringify({ roomId: "R", text: "x".repeat(5000) }), as("p1"), true);
  const broken = await call(chat, "{壞掉", as("p1"), true);
  eq([st(big), st(broken)], ["413:too_large", "400:bad_request"], "T4 超大 body 413、壞 JSON 400");
}

// ---------- C 冷卻 ----------
{
  tick(60000); sent.length = 0;
  const a = await say("p2", "第一則"); tick(1000);
  const b = await say("p2", "太快"); tick(1000);
  const c = await say("p2", "兩秒後");
  const other = await say("p1", "別人不受影響");
  eq([a.status, st(b), b.body.retryAfterMs, b.body.retryAfterSec, c.status, other.status], [200, "429:rate_limited", 1000, 1, 200, 200],
    "C1 每則間隔 2 秒：1 秒後 429（retryAfterMs 1000、retryAfterSec 1，畫面拿來倒數），2 秒後可以；每人分開算");
  eq([chats().length, chats().some((e) => (e.payload.message as { text?: string }).text === "太快")], [12, false], "C2 被擋下的那則沒有送出（3 則成功 × 4 人＝12 份）");
}
{
  tick(60000);
  const r: string[] = [];
  for (const dt of [0, 2000, 2000, 2000, 2000, 2000, 12999, 1]) { tick(dt); const x = await say("p0", "連發"); r.push(x.status === 429 ? `429:${x.body.retryAfterMs}` : String(x.status)); }
  eq(r, ["200", "200", "200", "200", "200", "429:13000", "429:1", "200"],
    "C3 連發：每 2 秒一則送了 5 則（都在 15 秒內）→ 從第 5 則起冷卻 15 秒（2 秒後還要 13 秒、14.999 秒還要 1ms、15 秒可以）");
}

// ---------- V 語音 ----------
const ff = (ffmpegStatic as unknown as string) || "ffmpeg";
const dir = mkdtempSync(path.join(tmpdir(), "flow-chat-"));
const gen = (name: string, args: string[]) => { const f = path.join(dir, name); execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", ...args, f]); return readFileSync(f); };
const webm = gen("a.webm", ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", "-b:a", "32k"]);
const mp4 = gen("b.mp4", ["-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-c:a", "aac", "-b:a", "64k"]);
const blip = gen("c.webm", ["-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-c:a", "libopus"]);
async function upload(tok: string, data: Uint8Array | string, type = "audio/webm", roomId = "R") {
  const fd = new FormData();
  fd.set("roomId", roomId);
  fd.set("audio", new Blob([data as BlobPart], { type }), "rec");
  const r = await voice(new Request("http://x", { method: "POST", headers: auth(tok), body: fd }));
  return { status: r.status, body: await r.json() };
}
{
  tick(60000); sent.length = 0;
  const a = await upload(as("p2"), webm);
  const keys = [...voices.keys()];
  const m = a.body.message ?? {};
  const head = voices.get(keys[0])?.data.subarray(4, 11).toString("latin1");
  eq([a.status, m.kind, m.from, m.fromName, keys.length, keys[0] === `R/${m.id}.m4a`, head, Math.abs((m.durationMs ?? 0) - 3000) < 150, typeof m.url],
    [200, "voice", "p2", "名p2", 1, true, "ftypM4A", true, "string"], "V1 Android webm 上傳：轉成 m4a（ftyp M4A）存在 R/<id>.m4a，約 3 秒，回播放網址");
  eq([chats().length, chats().every((e) => (e.payload.message as { url?: string }).url === m.url),
    chats().every((e) => e.channel === privateChannelName("5878", e.payload.playerId as string))], [4, true, true], "V2 語音網址只送給同桌四人的座位頻道（訪客也聽得到）");
  tick(2000);
  const c = await upload(as("p2"), mp4, "audio/mp4");
  eq([c.status, voices.size, Math.abs((c.body.message?.durationMs ?? 0) - 2000) < 150], [200, 2, true], "V3 iPhone mp4 上傳：同樣轉成 m4a");
}
{
  tick(60000); calls.checkRate.length = 0;
  const bad = await upload(as("p1"), "這不是聲音檔");
  const short = await upload(as("p1"), blip);
  const ok = await upload(as("p1"), webm);
  eq([st(bad), st(short), ok.status, calls.checkRate],
    ["400:bad_audio", "400:too_short", 200, ["voice:peek", "voice:peek", "voice:peek", "voice:take"]],
    "V4 壞檔 400、0.2 秒太短 400：轉檔前只檢查不扣，壞檔和太短都沒扣冷卻，緊接著送正常的照樣 200（審伯退件 1）");
  tick(1000);
  const fast = await upload(as("p1"), webm);
  eq([st(fast), fast.body.retryAfterMs, calls.checkRate.slice(-1)[0]], ["429:rate_limited", 1000, "voice:peek"], "V5 語音冷卻 2 秒：1 秒後 429，轉檔前就擋下（不白跑轉檔）");
}
{
  tick(60000); sent.length = 0;
  const before = voices.size;
  const both = await Promise.all([upload(as("p0"), webm), upload(as("p0"), mp4, "audio/mp4")]);
  eq([both.map((x) => x.status).sort(), voices.size - before, chats().length], [[200, 429], 1, 4],
    "V6 同一人同時送兩則：兩則都通過預先檢查、都轉檔，真的扣冷卻時只放一則；被擋的那則沒存檔、沒送出");
}
{
  tick(60000);
  const before = voices.size;
  const g = await upload("guest", webm);
  const big = await upload(as("p0"), new Uint8Array(600 * 1024));
  const other = await upload(as("q0"), webm);
  const none = await upload(as("p0"), "", "audio/webm");
  eq([st(g), st(big), st(other), st(none), voices.size - before], ["403:guest_not_allowed", "413:audio_too_large", "403:not_in_room", "400:bad_audio", 0],
    "V7 訪客 403、超過 512KB 413、別桌玩家 403、空檔 400；都沒有存檔");
  const r2 = await upload(as("q1"), webm, "audio/webm", "R2");
  eq([r2.status, [...voices.keys()].filter((k) => k.startsWith("R2/")).length], [200, 1], "V8 別桌 R2 的語音存在 R2/ 底下");
}

// ---------- D 刪除 ----------
{
  const rRows = (await rateRows()).filter((r) => r.room_id === "R").length;
  const closed = await closeMahjongRoom("R", "5878", rooms.R.game_state, "dissolved");
  const left = [...voices.keys()];
  eq([rRows > 0, closed, calls.deleteRoomChat.includes("R"), left.every((k) => k.startsWith("R2/")), left.length, (await rateRows()).filter((r) => r.room_id === "R").length],
    [true, true, true, true, 1, 0], "D1 R 關房：R 的語音檔全部刪掉、R 的冷卻紀錄刪掉；R2 的不動");
  const after = await say("p0", "關房後");
  eq(st(after), "404:room_not_found", "D2 關房後再送：404");
}
{
  // 關房時漏刪（例如 Storage 當時出錯）：房間已經不在的資料夾，定期清除整包刪；房間還在的，超過 24 小時才刪
  voices.set("GONE/x.m4a", { data: Buffer.from("x"), createdAt: clock.now });
  tick(60000);
  const fresh = await upload(as("q2"), webm, "audio/webm", "R2");
  tick(24 * 60 * 60 * 1000 - 30000);
  await sweepIdleRooms(clock.now);
  const mid = [...voices.keys()].sort();
  tick(60000);
  await sweepIdleRooms(clock.now);
  eq([fresh.status, calls.sweepVoices >= 2, mid.includes("GONE/x.m4a"), mid.filter((k) => k.startsWith("R2/")).length, [...voices.keys()].filter((k) => k.startsWith("R2/")).length],
    [200, true, false, 1, 0], "D3 建房時的閒置清理順便清語音：房間不在的 GONE/ 整包刪；R2 還開著，超過 24 小時的先刪、還沒滿 24 小時的留著，滿了再刪");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
