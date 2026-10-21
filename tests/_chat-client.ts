// 打字聊天與語音訊息的前端狀態（lib/mahjong/chatClient.ts）：
//   B  泡泡：貼對的座位、每家最多三則、文字 5 秒淡出、同一則（POST 回應＋mj_chat）只顯示一次
//   V  語音：依到達順序自動播放、不重疊（自己的也播，播完 3 秒淡出）；關掉自動播放就不播、只提示一次（自己的不播、幾秒後淡出）；瀏覽器擋了改成「點一下播放」；音量跟偏好設定
//   S  送出：送出中不能重複送、成功後 2 秒冷卻、429 照 retryAfterMs 倒數、壞檔顯示「傳送失敗，點此重試」且不扣冷卻、訪客 403 顯示提示
//   X  跨帳號殘留（審伯退回第 4 項）：換帳號、換房間、登出就全部清空；舊的那一場晚回來的 POST 回應、mj_chat 一律丟掉
//      X9～X11（審伯 2026-10-21 退回②）：同帳號、同玩家、同座位從 A 房換到 B 房，換完才送達的 A 房 mj_chat 丟掉，B 房照常
// 在 node 裡跑真的 chatClient.ts：時鐘、計時器、伺服器、播放器都換成假的。
import type { ChatIO, ChatMessage } from "../lib/mahjong/chatClient"; // 只拿型別（假的 localStorage、document 要先裝好）
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  document: { documentElement: { style: { setProperty: () => {} } } },
});
const C = await import("../lib/mahjong/chatClient");
const P = await import("../lib/mahjong/prefs");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

// ---- 假時鐘＋計時器 ----
let t = 1_000_000;
let tid = 0;
const timers = new Map<number, { at: number; f: () => void }>();
function advance(ms: number) {
  const end = t + ms;
  for (;;) {
    const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]);
    t = next[1].at;
    next[1].f();
  }
  t = end;
}
// ---- 假伺服器：由測試決定什麼時候回、回什麼 ----
type Res = { status: number; body: Record<string, unknown> };
let posts: { body: object; resolve: (r: Res) => void }[] = [];
let voices: { roomId: string; resolve: (r: Res) => void }[] = [];
// ---- 假播放器 ----
let plays: { url: string; volume: number; end: (r?: { blocked?: boolean }) => void; stopped: boolean }[] = [];
const io: ChatIO = {
  now: () => t,
  setTimer: (f, ms) => { const id = ++tid; timers.set(id, { at: t + ms, f }); return id as unknown as ReturnType<typeof setTimeout>; },
  clearTimer: (id) => { timers.delete(id as unknown as number); },
  postJSON: (body) => new Promise((resolve) => posts.push({ body, resolve })),
  postVoice: (roomId) => new Promise((resolve) => voices.push({ roomId, resolve })),
  play: (url, volume, onEnd) => {
    const p = { url, volume, end: (r: { blocked?: boolean } = {}) => onEnd(r), stopped: false };
    plays.push(p);
    return () => { p.stopped = true; };
  },
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const ME = { account: "acc-A", roomId: "room-1", roomCode: "1111", myId: "p0", mySeat: 0 };
const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: crypto.randomUUID(), kind: "text", from: "p1", fromName: "阿華", fromSeat: 1, text: "好牌", ts: t, ...over });
const voice = (from: string, seat: number, ms = 3000): ChatMessage => msg({ kind: "voice", from, fromSeat: seat, text: undefined, url: `https://v/${crypto.randomUUID()}.m4a`, durationMs: ms });
const reset = () => { C.__testChat(io); posts = []; voices = []; plays = []; timers.clear(); };
const st = () => C.__peekChat();

// ---------- B 泡泡 ----------
reset();
C.bindChatSession(ME);
const m1 = msg({ text: "快點啦", fromSeat: 2, from: "p2", fromName: "阿美" });
C.receiveChat(m1, "p0");
C.receiveChat(m1, "p0");
ok(st().bubbles.length === 1 && st().bubbles[0].seat === 2 && st().bubbles[0].text === "快點啦", "B1 收到對家的文字：泡泡貼在座位 2（看 fromSeat），同一則收兩次只顯示一次");
C.receiveChat(msg({ text: "別人的" }), "p3");
ok(st().bubbles.length === 1, "B2 不是送給我這個座位的 mj_chat：丟掉");
for (let i = 0; i < 4; i++) C.receiveChat(msg({ text: `第${i + 1}則`, fromSeat: 1 }), "p0");
const s1 = st().bubbles.filter((b) => b.seat === 1);
ok(s1.length === 3 && s1.map((b) => b.text).join() === "第2則,第3則,第4則", `B3 同一家連發 4 則：只留最新 3 則（${s1.map((b) => b.text).join("、")}）`);
advance(5300);
ok(st().bubbles.filter((b) => b.kind === "text").length === 0, "B4 文字泡泡 5 秒後淡出");
advance(5000);
ok(timers.size === 0, "B5 沒有泡泡、沒有倒數時，計時器停掉（不空轉）");

// ---------- V 語音 ----------
reset();
C.bindChatSession(ME);
const v1 = voice("p1", 1, 2000), v2 = voice("p2", 2, 1500), vMine = voice("p0", 0, 1000);
C.receiveChat(v1, "p0"); C.receiveChat(v2, "p0"); C.receiveChat(vMine, "p0");
ok(plays.length === 1 && plays[0].url === v1.url && st().playing?.id === v1.id, "V1 兩家幾乎同時傳語音：先到的先播，第二則等著（不重疊）");
ok(Math.abs(plays[0].volume - 0.7) < 1e-9, "V2 音量照偏好設定（預設一般＝0.7）");
plays[0].end();
ok(plays.length === 2 && plays[1].url === v2.url, "V3 第一則播完，接著播第二則");
plays[1].end();
ok(plays.length === 3 && plays[2].url === vMine.url && st().playing?.id === vMine.id, "V4 自己發的語音也自動播放（排在前面的播完才輪到）");
const v1b = st().bubbles.find((b) => b.id === v1.id)!;
ok(v1b.until <= t + 2000, "V5 別人的語音播完 2 秒後淡出（不變）");
plays[2].end();
const mineB = st().bubbles.find((b) => b.id === vMine.id)!;
ok(mineB.until === t + 3000, "V5b 自己的語音播完 3 秒後淡出");
advance(3300);
ok(!st().bubbles.some((b) => b.id === vMine.id), "V5c 播完 3 秒後泡泡消失");
reset();
C.bindChatSession(ME);
const vMine2 = voice("p0", 0, 1000);
C.receiveChat(vMine2, "p0");
plays[0].end();
C.toggleVoice(vMine2.id);
ok(plays.length === 2 && plays[1].url === vMine2.url && st().playing?.id === vMine2.id, "V6 按泡泡可以再播一次（包括自己的）");
C.toggleVoice(vMine2.id);
ok(plays[1].stopped && st().playing === null, "V7 播放中再按一次：停");
// 關掉自動播放
reset();
P.bindPrefsAccount(null);
P.setPrefs({ autoVoice: false, voiceVol: "high" });
C.bindChatSession(ME);
const v3 = voice("p3", 3), v4 = voice("p1", 1);
C.receiveChat(v3, "p0"); C.receiveChat(v4, "p0");
ok(plays.length === 0 && st().autoOffNotice?.seat === 3, "V8 自動播放關閉：不播，第一次收到語音時在那家名牌上方提示「自動播放已關閉」");
advance(2100);
ok(st().autoOffNotice === null, "V9 提示 2 秒後消失，第二則語音不再提示（不重複打擾）");
C.toggleVoice(v4.id);
ok(plays.length === 1 && Math.abs(plays[0].volume - 1) < 1e-9, "V10 自動播放關閉時按泡泡照樣能播，音量照偏好設定（高＝1.0）");
plays[0].end();
const vMine3 = voice("p0", 0, 2000);
C.receiveChat(vMine3, "p0");
ok(plays.length === 1 && st().playing === null && st().autoOffNotice === null && st().bubbles.some((b) => b.id === vMine3.id), "V10b 自動播放關閉：自己的語音不播、不提示，泡泡照樣出現");
advance(4800);
ok(st().bubbles.some((b) => b.id === vMine3.id), "V10c 語音長度（2 秒）＋3 秒內泡泡還在");
advance(400);
ok(!st().bubbles.some((b) => b.id === vMine3.id), "V10d 語音長度＋3 秒後泡泡淡出（不留 12 秒）");
P.setPrefs({ autoVoice: true, voiceVol: "mid" });
// 瀏覽器擋自動播放
reset();
C.bindChatSession(ME);
const v5 = voice("p1", 1), v6 = voice("p2", 2);
C.receiveChat(v5, "p0"); C.receiveChat(v6, "p0");
plays[0].end({ blocked: true });
const b5 = st().bubbles.find((b) => b.id === v5.id)!;
ok(b5.blocked === true && plays.length === 1 && st().playing === null, "V11 瀏覽器擋了自動播放：泡泡改成「點一下播放」，後面排隊的也不硬播");
C.toggleVoice(v5.id);
ok(plays.length === 2 && st().bubbles.find((b) => b.id === v5.id)!.blocked === false, "V12 按一下就播");

// ---------- S 送出 ----------
reset();
C.bindChatSession(ME);
const p1 = C.sendPhrase("hurry");
ok(posts.length === 1 && JSON.stringify(posts[0].body) === JSON.stringify({ roomId: "room-1", phrase: "hurry" }) && st().sending, "S1 快捷短語送 id（hurry），送出中");
const again = await C.sendPhrase("nice");
ok(again === "busy" && posts.length === 1, "S2 送出中不能重複送");
const sent = msg({ from: "p0", fromSeat: 0, fromName: "我", text: "快點啦", phrase: "hurry" });
posts[0].resolve({ status: 200, body: { ok: true, message: sent } });
await p1;
C.receiveChat(sent, "p0"); // 同一則從 mj_chat 再來一次
ok(!st().sending && st().bubbles.filter((b) => b.id === sent.id).length === 1 && st().bubbles[0].seat === 0, "S3 成功：自己的泡泡出現在自己名牌（座位 0），POST 回應和 mj_chat 只顯示一次");
ok(st().readyAt === t + 2000 && (await C.sendText("hi")) === "cooldown" && posts.length === 1, "S4 成功後 2 秒內：錄音鍵、送出鍵都不能用（請等 2 秒再傳）");
advance(2100);
const p2 = C.sendText("  等一下要吃宵夜嗎  ");
ok(JSON.stringify(posts[1].body) === JSON.stringify({ roomId: "room-1", text: "等一下要吃宵夜嗎" }), "S5 自由文字去掉前後空白再送");
posts[1].resolve({ status: 429, body: { error: "rate_limited", retryAfterMs: 15000, retryAfterSec: 15 } });
await p2;
ok(st().readyAt === t + 15000, "S6 伺服器回 429：照 retryAfterMs（15 秒）倒數");
advance(15100);
ok((await C.sendText("   ")) === "empty" && posts.length === 2, "S7 空白不送");
const p3 = C.sendVoice(new Blob(["x"]), 1200);
ok(voices.length === 1 && voices[0].roomId === "room-1", "S8 語音送出（multipart，帶房間 id）");
voices[0].resolve({ status: 400, body: { error: "bad_audio" } });
await p3;
ok(st().failed?.label === "語音" && st().readyAt <= t, "S9 壞檔：顯示「傳送失敗，點此重試」，不扣冷卻");
C.retryFailed();
await flush();
ok(voices.length === 2 && st().sending && st().failed === null, "S10 點重試：同一段錄音再送一次");
voices[1].resolve({ status: 200, body: { ok: true, message: voice("p0", 0, 1200) } });
await flush(); await flush();
ok(!st().sending && st().failed === null && st().bubbles.some((b) => b.kind === "voice" && b.seat === 0), "S11 重試成功：自己的語音泡泡出現");
advance(2100);
ok(!!((await C.sendVoice(new Blob(["x"]), 300)) === "too_short" && voices.length === 2 && st().note?.text.includes("太短")), "S12 錄不到 0.5 秒：不送、提示太短");
const p4 = C.sendText("訪客想講話");
posts[2].resolve({ status: 403, body: { error: "guest_not_allowed" } });
await p4;
ok(st().note?.text === "登入 LINE 後就能聊天與傳語音。" && !st().sending, "S13 伺服器說是訪客：顯示「登入 LINE 後就能聊天與傳語音。」");

// ---------- X 跨帳號、換房間 ----------
reset();
C.bindChatSession(ME);
C.receiveChat(msg({ text: "上一場的" }), "p0");
C.receiveChat(voice("p1", 1), "p0");
C.setChatOpen(true);
const late = C.sendText("送到一半");
ok(!!(st().bubbles.length === 2 && st().playing && st().sending && st().open), "X0 這一場：有泡泡、正在播語音、送出中、底板開著");
const playing0 = plays[0];
C.bindChatSession({ ...ME, account: "acc-B" });
ok(st().bubbles.length === 0 && st().playing === null && !st().sending && !st().open && st().readyAt === 0 && st().note === null, "X1 換帳號：泡泡、播放、送出中、底板、冷卻、提示全部清空");
ok(playing0.stopped && timers.size === 0, "X2 換帳號：正在播的語音停掉，計時器都取消");
posts[0].resolve({ status: 200, body: { ok: true, message: msg({ from: "p0", fromSeat: 0, text: "送到一半" }) } });
await late;
ok(st().bubbles.length === 0 && st().readyAt === 0, "X3 上一個帳號晚回來的 POST 成功回應：丟掉（不顯示泡泡、不開始冷卻）");
const late429 = C.sendText("x");
C.bindChatSession({ ...ME, account: "acc-B", roomId: "room-2" });
posts[1].resolve({ status: 429, body: { error: "rate_limited", retryAfterMs: 30000 } });
await late429;
ok(st().readyAt === 0, "X4 換房間：上一間晚回來的 429 不會讓新房間開始倒數");
const lateFail = C.sendText("y");
C.bindChatSession(null);
posts[2].resolve({ status: 500, body: { error: "server_error" } });
await lateFail;
ok(st().failed === null && !st().sending, "X5 登出（離開房間）後才回來的失敗：不顯示「傳送失敗」");
C.receiveChat(msg({ text: "登出後才到" }), "p0");
ok(st().bubbles.length === 0, "X6 沒有綁定任何一場時收到的 mj_chat：丟掉");
C.bindChatSession({ ...ME, account: "acc-B", roomId: "room-2" });
const dup = msg({ text: "上一場同一則" });
C.receiveChat(dup, "p0");
C.bindChatSession({ ...ME, account: "acc-B", roomId: "room-3" });
C.receiveChat(dup, "p0");
ok(st().bubbles.length === 1, "X7 換房間後去重紀錄也清掉（同一個 id 在新的一場照常顯示一次）");
C.bindChatSession({ ...ME, account: "acc-B", roomId: "room-3", mySeat: 2 });
ok(st().bubbles.length === 0, "X8 換座位（重新入座）也算新的一場：清空");
// 審伯退回②：account、playerId、seat 都一樣，只有房間不同
reset();
const RA = { ...ME, roomId: "room-A", roomCode: "1001" }, RB = { ...ME, roomId: "room-B", roomCode: "2002" };
C.bindChatSession(RA);
C.receiveChat(msg({ text: "A 房的" }), "p0", "1001");
ok(st().bubbles.length === 1 && st().bubbles[0].text === "A 房的", "X9 綁 A 房：A 房頻道來的 mj_chat 照常顯示");
C.bindChatSession(RB);
C.receiveChat(msg({ text: "換房後才到的 A 房訊息" }), "p0", "1001");
C.receiveChat(voice("p1", 1), "p0", "1001");
ok(st().bubbles.length === 0 && plays.length === 0, "X10 同帳號、同玩家、同座位換到 B 房：之後才送達的 A 房文字、語音都丟掉（不顯示、不播）");
C.receiveChat(msg({ text: "B 房的" }), "p0", "2002");
ok(st().bubbles.length === 1 && st().bubbles[0].text === "B 房的", "X11 B 房頻道來的 mj_chat 照常顯示");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
