// 三款共用聊天互動（lib/social/chatClient.ts、lib/social/fx/transport.ts、lib/social/fx/place.ts）和十三支的錨點（components/thirteen/ThSocial.tsx）：
//   C  文字聊天：送到遊戲給的網址、泡泡貼 fromSeat、每家最多 3 則、5 秒淡出、去重、換場清空、舊場晚到的回應和事件丟掉、429 照伺服器倒數
//   F  互動送收：送到遊戲給的網址、名稱換成伺服器的、冷卻分輕重組、對方保護期不算自己冷卻、理牌中（target_arranging）、同一則只收一次
//   P  選單位置：左家放名牌右邊、右家放左邊（垂直置中）、對家放左邊上緣對齊；超出畫面夾回；提示放名牌（或思考中泡泡）下方
//   L  十三支三個階段的聊天鈕、聊天室、泡泡位置＝小宜設計說明 §2-1、§2-2、§3 量到的數字（手機 844×390）
import type { SocialChatIO } from "../lib/social/chatClient";
import type { ChatMessage, EffectEvent } from "../lib/social/events";
Object.assign(globalThis, { window: globalThis, document: { documentElement: { style: { setProperty: () => {} } }, addEventListener: () => {} } });
const C = await import("../lib/social/chatClient");
const F = await import("../lib/social/fx/transport");
const P = await import("../lib/social/fx/place");
const L = await import("../components/thirteen/ThSocial");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

// ---- 假時鐘＋計時器 ----
let t = 1_000_000, tid = 0;
const timers = new Map<number, { at: number; f: () => void }>();
function advance(ms: number) {
  const end = t + ms;
  for (;;) {
    const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]); t = next[1].at; next[1].f();
  }
  t = end;
}
type Res = { status: number; body: Record<string, unknown> };
let posts: { url: string; body: Record<string, unknown>; resolve: (r: Res) => void }[] = [];
const io: SocialChatIO = {
  now: () => t,
  setTimer: (f, ms) => { const id = ++tid; timers.set(id, { at: t + ms, f }); return id as unknown as ReturnType<typeof setTimeout>; },
  clearTimer: (id) => { timers.delete(id as unknown as number); },
  postJSON: (url, body) => new Promise((resolve) => posts.push({ url, body: body as Record<string, unknown>, resolve })),
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const ME = { account: "acc-A", roomId: "room-1", roomCode: "1111", myId: "p0", mySeat: 0, chatUrl: "/api/thirteen/chat" };
const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: crypto.randomUUID(), kind: "text", from: "p1", fromName: "阿華", fromSeat: 1, text: "好牌", ts: t, ...over });
const st = () => C.__peekSocialChat();

// ---------- C 文字聊天 ----------
C.__testSocialChat(io); posts = []; timers.clear();
C.bindSocialChat(ME);
const tapped: string[] = [];
const off = C.subscribeSocialChat((m) => tapped.push(m.id));
const m1 = msg({ text: "快點啦", fromSeat: 2, from: "p2" });
C.receiveSocialChat(m1, "p0", "1111");
C.receiveSocialChat(m1, "p0", "1111");
ok(st().bubbles.length === 1 && st().bubbles[0].seat === 2 && tapped.length === 1, "C1 對家的文字：泡泡貼座位 2，同一則收兩次只算一次（聊天室清單也只收一次）");
C.receiveSocialChat(msg({}), "p3", "1111");
C.receiveSocialChat(msg({}), "p0", "9999");
ok(st().bubbles.length === 1, "C2 不是給我這個座位、或不是這一房（房號不同）的 mj_chat：丟掉");
for (let i = 0; i < 4; i++) C.receiveSocialChat(msg({ text: `第${i + 1}則` }), "p0", "1111");
ok(st().bubbles.filter((b) => b.seat === 1).map((b) => b.text).join() === "第2則,第3則,第4則", "C3 同一家連發 4 則：只留最新 3 則");
C.receiveSocialChat(msg({ kind: "voice", text: undefined, url: "https://v/1.m4a", durationMs: 2000, fromSeat: 3 }), "p0", "1111");
ok(!st().bubbles.some((b) => b.seat === 3) && tapped.length === 6, "C4 語音（第二階段）：不出泡泡，但進聊天室清單");
advance(5300);
ok(st().bubbles.length === 0, "C5 文字泡泡 5 秒後淡出");
advance(3000);
ok(timers.size === 0, "C6 沒有泡泡、沒有倒數時計時器停掉");

const p1 = C.sendSocialPhrase("hurry");
ok(posts.length === 1 && posts[0].url === "/api/thirteen/chat" && posts[0].body.roomId === "room-1" && posts[0].body.phrase === "hurry", "C7 快捷短語送到遊戲給的網址（十三支 /api/thirteen/chat），帶 roomId、phrase");
ok(st().sending, "C8 送出中");
void C.sendSocialText("再一則");
ok(posts.length === 1, "C9 送出中不能再送（不會連發）");
const mine = msg({ from: "p0", fromSeat: 0, text: "快點啦" });
posts[0].resolve({ status: 200, body: { ok: true, message: mine } });
ok((await p1) === null && st().bubbles.some((b) => b.id === mine.id && b.mine) && st().readyAt === t + 2000, "C10 成功：自己的泡泡馬上出現、之後 2 秒不能再送");
C.receiveSocialChat(mine, "p0", "1111");
ok(st().bubbles.filter((b) => b.id === mine.id).length === 1, "C11 廣播回來同一則：不重複");
advance(2100);
const p2 = C.sendSocialText("  一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多出來  ");
ok(String(posts[1].body.text).length === 40, "C12 文字去頭尾空白、最多 40 字");
posts[1].resolve({ status: 429, body: { error: "rate_limited", retryAfterMs: 4500 } });
ok((await p2) === "cooldown" && st().readyAt === t + 4500, "C13 429：照伺服器的 retryAfterMs 倒數");
advance(4600);
const p3 = C.sendSocialText("斷線");
posts[2].resolve({ status: 500, body: {} });
ok((await p3) === "failed" && !!st().failed && st().readyAt <= t, "C14 伺服器錯：顯示「傳送失敗，點此重試」，不扣冷卻");
C.retrySocialFailed();
ok(posts.length === 4 && posts[3].body.text === "斷線", "C15 點重試：同一則再送一次");
posts[3].resolve({ status: 200, body: { ok: true, message: msg({ from: "p0", fromSeat: 0, text: "斷線" }) } });
await flush();
advance(2100);
const p4 = C.sendSocialText("換房前送的");
C.bindSocialChat({ ...ME, roomId: "room-2", roomCode: "2222" });
posts[4].resolve({ status: 200, body: { ok: true, message: msg({ from: "p0", fromSeat: 0, text: "換房前送的" }) } });
ok((await p4) === null && st().bubbles.length === 0 && !st().sending, "C16 送出途中換房：舊的回應丟掉，新房乾淨");
C.receiveSocialChat(msg({}), "p0", "1111");
ok(st().bubbles.length === 0, "C17 換房後才送達的舊房 mj_chat：丟掉");
C.bindSocialChat({ ...ME, roomId: "room-2", roomCode: "2222" });
C.receiveSocialChat(msg({ text: "新房" }), "p0", "2222");
C.bindSocialChat({ ...ME, roomId: "room-2", roomCode: "2222" });
ok(st().bubbles.length === 1, "C18 同一場重複綁定（換階段重掛）：不清空");
const p5 = C.sendSocialText("關房");
posts[5].resolve({ status: 410, body: { error: "room_closed" } });
ok((await p5) === "room_closed" && !st().failed && st().note?.text === "房間已關閉，訊息沒有送出", "C19 410 房間已關閉：不顯示重試、提示一行");
C.bindSocialChat(null);
ok(C.socialChatSession() === null && st().bubbles.length === 0, "C20 離開房間：清空");
off();

// ---------- F 互動送收 ----------
const fx: { url: string; body: Record<string, unknown>; resolve: (r: Res) => void }[] = [];
F.__testSocialFx({ now: () => t, post: (url, body) => new Promise((resolve) => fx.push({ url, body: body as Record<string, unknown>, resolve })), ready: () => true });
const got: string[] = [];
const offFx = F.subscribeSocialFx((m) => got.push(`${m.kind}:${m.from}>${m.to}`));
const ev = (over: Partial<EffectEvent>): EffectEvent => ({ id: crypto.randomUUID(), effect: "water", from: "p0", fromName: "我", fromSeat: 0, to: "p1", toName: "阿華", toSeat: 1, ts: t, ...over });
ok((await F.sendSocialFx("love", 1)).ok === false, "F1 還沒綁桌：不送");
F.bindSocialFxTable({ effectUrl: "/api/thirteen/effect", roomId: "room-1", players: [0, 1, 2, 3].map((s) => ({ id: `p${s}`, seat: s })), mySeat: 0 });
ok((await F.sendSocialFx("love", 0)).ok === false && fx.length === 0, "F2 不能丟自己");
const f1 = F.sendSocialFx("water", 1);
ok(fx[0].url === "/api/thirteen/effect" && fx[0].body.effect === "water" && fx[0].body.to === "p1" && fx[0].body.roomId === "room-1", "F3 送到遊戲給的網址（/api/thirteen/effect），帶 roomId、伺服器名稱、對方 playerId");
const e1 = ev({});
fx[0].resolve({ status: 200, body: { ok: true, effect: e1, cooldownMs: 10000 } });
ok((await f1).ok && got.join() === "water:0>1", "F4 成功：自己馬上播（API 回應當成收到）");
F.receiveSocialFx(e1);
ok(got.length === 1, "F5 廣播回來同一則：只播一次");
ok(F.socialFxCooldownLeft("egg") === 10000 && F.socialFxCooldownLeft("love") === 0, "F6 重組冷卻 10 秒（雞蛋也要等）、輕組不受影響");
const f2 = F.sendSocialFx("love", 2);
fx[1].resolve({ status: 409, body: { error: "target_arranging", reason: "target_arranging" } });
const r2 = await f2;
ok(!r2.ok && r2.reason === "target_arranging" && F.socialFxCooldownLeft("love") === 0, "F7 對方還在理牌（target_arranging）：回「理牌中」，不扣冷卻");
const f3 = F.sendSocialFx("clap", 3);
fx[2].resolve({ status: 429, body: { reason: "target_protected", retryAfterMs: 6000 } });
const r3 = await f3;
ok(!r3.ok && r3.reason === "target_protected" && r3.leftMs === 6000 && F.socialFxCooldownLeft("clap") === 0, "F8 對方剛被打過：提示秒數，不算自己的冷卻");
const f4 = F.sendSocialFx("cash", 3);
fx[3].resolve({ status: 429, body: { reason: "cooldown", retryAfterMs: 3000 } });
const r4 = await f4;
ok(!r4.ok && r4.reason === "cooldown" && F.socialFxCooldownLeft("love") === 3000, "F9 伺服器說冷卻中：照 retryAfterMs 倒數（輕組一起）");
F.receiveSocialFx({ ...ev({}), effect: "bark" });
ok(got.length === 1, "F10 不認得的特效名稱：不播");
F.bindSocialFxTable({ effectUrl: "/api/thirteen/effect", roomId: "room-2", players: [], mySeat: 0 });
ok(F.socialFxCooldownLeft("egg") === 0, "F11 換房：冷卻清掉");
offFx();

// ---------- R1 互動 session 隔離（審伯十三支聊天互動前端初審 R1）：換房、換帳號、換遊戲、離場後，舊請求晚到一律作廢 ----------
{
  type Pend = { body: Record<string, unknown>; resolve: (r: Res) => void; reject: (e: unknown) => void };
  const q: Pend[] = [];
  F.__testSocialFx({ now: () => t, post: (_u, body) => new Promise((resolve, reject) => q.push({ body: body as Record<string, unknown>, resolve, reject })), ready: () => true });
  const seen: string[] = [];
  const offR = F.subscribeSocialFx((m) => seen.push(m.id));
  const seats = (pre: string) => [0, 1, 2, 3].map((s) => ({ id: `${pre}${s}`, seat: s }));
  const A = { effectUrl: "/api/thirteen/effect", roomId: "room-A", players: seats("a"), mySeat: 0 };
  const B = { effectUrl: "/api/thirteen/effect", roomId: "room-B", players: seats("b"), mySeat: 0 };
  const fev = (id: string) => ({ ...ev({}), id });
  const why = (r: import("../lib/social/fx/transport").SendFxResult) => (r.ok ? "ok" : r.reason);

  // 交錯：A 送出 → 切 B → B 送出 → A 結束 → 再點 B（仍被 B 自己的 pending 擋）→ B 結束：只有 B 的事件、只套 B 的冷卻
  F.bindSocialFxTable(A);
  const a1 = F.sendSocialFx("water", 1);
  F.bindSocialFxTable(B);
  const b1 = F.sendSocialFx("love", 1);
  ok(q.length === 2 && q[1].body.roomId === "room-B", "R1-1 舊房請求還沒回來：新房照常送出（不被擋成 busy）");
  q[0].resolve({ status: 200, body: { ok: true, effect: fev("old-A"), cooldownMs: 10000 } });
  const ra1 = await a1;
  ok(why(ra1) === "stale" && !seen.includes("old-A") && F.socialFxCooldownLeft("water") === 0, "R1-2 舊房 200 晚到：不播、不進事件、不改新房冷卻，回 stale（畫面不出提示）");
  const b2 = await F.sendSocialFx("clap", 2);
  ok(why(b2) === "busy" && q.length === 2, "R1-3 舊房請求結束不會清掉新房的送出鎖：再點仍被 B 自己的 pending 擋");
  q[1].resolve({ status: 200, body: { ok: true, effect: fev("new-B"), cooldownMs: 4000 } });
  ok((await b1).ok && seen.join() === "new-B" && F.socialFxCooldownLeft("love") === 4000 && F.socialFxCooldownLeft("water") === 0, "R1-4 B 結束：只有 B 的事件、只套 B 的輕組冷卻");

  // 舊房 429：不影響新房冷卻
  F.__testSocialFx({ now: () => t, post: (_u, body) => new Promise((resolve, reject) => q.push({ body: body as Record<string, unknown>, resolve, reject })), ready: () => true });
  q.length = 0;
  F.bindSocialFxTable(A);
  const a2 = F.sendSocialFx("water", 1);
  F.bindSocialFxTable(B);
  q[0].resolve({ status: 429, body: { reason: "cooldown", retryAfterMs: 9000 } });
  const ra2 = await a2;
  ok(why(ra2) === "stale" && F.socialFxCooldownLeft("water") === 0, "R1-5 舊房 429（retryAfterMs 9000）：新房冷卻不變");

  // 舊房失敗／例外：不清新房的送出鎖
  F.bindSocialFxTable(A);
  const a3 = F.sendSocialFx("egg", 1);
  F.bindSocialFxTable(B);
  const b3 = F.sendSocialFx("egg", 2);
  q[1].reject(new Error("network"));
  ok(why(await a3) === "stale", "R1-6 舊房例外：回 stale");
  ok(why(await F.sendSocialFx("punch", 3)) === "busy", "R1-7 舊房例外結束：新房送出鎖還在");
  q[2].resolve({ status: 500, body: {} });
  ok(why(await b3) === "failed", "R1-8 新房自己的失敗照常回「送出失敗」");

  // 同一個 session：players 重讀（新陣列、同一批人）不清冷卻、不作廢送出中的請求
  q.length = 0;
  F.__testSocialFx({ now: () => t, post: (_u, body) => new Promise((resolve, reject) => q.push({ body: body as Record<string, unknown>, resolve, reject })), ready: () => true });
  F.bindSocialFxTable(A);
  const a4 = F.sendSocialFx("water", 1);
  F.bindSocialFxTable({ ...A, players: A.players.map((p) => ({ ...p })) });
  q[0].resolve({ status: 200, body: { ok: true, effect: fev("same-A"), cooldownMs: 10000 } });
  ok((await a4).ok && F.socialFxCooldownLeft("water") === 10000, "R1-9 同身分重讀 players：送出中的照常生效、冷卻保留");
  F.bindSocialFxTable({ ...A, players: A.players.map((p) => ({ ...p })) });
  ok(F.socialFxCooldownLeft("egg") === 10000, "R1-10 同身分再綁一次（換階段）：冷卻不被清");

  // 離場（解除綁定）再重入同一房：離場前的請求晚到也作廢
  const a5 = F.sendSocialFx("love", 2);
  F.bindSocialFxTable(null);
  ok(why(await F.sendSocialFx("love", 2)) === "no_target", "R1-11 離場後：不能送");
  F.bindSocialFxTable(A);
  q[1].resolve({ status: 200, body: { ok: true, effect: fev("left-A"), cooldownMs: 4000 } });
  ok(why(await a5) === "stale" && !seen.includes("left-A") && F.socialFxCooldownLeft("love") === 0, "R1-12 先離場再重入：離場前的請求晚到不播、不改冷卻");

  // 同房換帳號（座位一樣、playerId 不同）、換遊戲（送出網址不同）：都是新 session
  const a6 = F.sendSocialFx("clap", 1);
  F.bindSocialFxTable({ ...A, players: A.players.map((p) => (p.seat === 0 ? { ...p, id: "z0" } : p)) });
  q[2].resolve({ status: 200, body: { ok: true, effect: fev("acct-A"), cooldownMs: 4000 } });
  ok(why(await a6) === "stale" && !seen.includes("acct-A") && F.socialFxCooldownLeft("clap") === 0 && F.socialFxCooldownLeft("water") === 0, "R1-13 同房換帳號：舊帳號的請求作廢，冷卻清掉");
  const a7 = F.sendSocialFx("cash", 1);
  F.bindSocialFxTable({ ...A, players: A.players.map((p) => (p.seat === 0 ? { ...p, id: "z0" } : p)), effectUrl: "/api/big2/effect" });
  q[3].resolve({ status: 429, body: { reason: "cooldown", retryAfterMs: 7000 } });
  ok(why(await a7) === "stale" && F.socialFxCooldownLeft("cash") === 0, "R1-14 換遊戲（送出網址不同）：舊請求作廢");
  offR();
}

// ---------- P 選單位置（手機名牌 88×38；選單 98×191） ----------
const box = (l: number, tp: number, w: number, h: number) => ({ left: l, top: tp, right: l + w, bottom: tp + h });
const VW = 844, VH = 390, W = 98, H = 191;
const left = P.placeBesidePlate(L.menuPlacement("l"), box(4, 166, 88, 38), W, H, VW, VH);
ok(left.left === 99 && Math.round(left.top) === 90 && left.arrowSide === "l", `P1 左家：名牌右緣 +7、垂直置中 → (99, 90)，箭頭朝左（${left.left}, ${Math.round(left.top)}）`);
const right = P.placeBesidePlate(L.menuPlacement("r"), box(752, 166, 88, 38), W, H, VW, VH);
ok(right.left === 647 && Math.round(right.top) === 90 && right.arrowSide === "r", "P2 右家：名牌左緣 −7 → (647, 90)，箭頭朝右");
const top = P.placeBesidePlate(L.menuPlacement("t"), box(214, 8, 88, 38), W, H, VW, VH);
ok(top.left === 109 && top.top === 8 && top.arrow === 19, "P3 對家：名牌左邊直排、上緣對齊 → (109, 8)，箭頭指著名牌中心");
const clamped = P.placeBesidePlate(L.menuPlacement("r"), box(30, 300, 88, 38), W, H, VW, VH);
ok(clamped.left === 4 && clamped.top === VH - H - 4, "P4 超出畫面：夾回邊緣 4px 內");
const n1 = P.noteUnderPlate(box(214, 8, 88, 38), box(230, 52, 60, 24));
ok(n1.top === 82 && n1.width === 88 && n1.left === 214, "P5 對家有思考中泡泡：「理牌中」放在泡泡下面 +6、和名牌同寬");
ok(P.noteUnderPlate(box(4, 166, 88, 38), null).top === 210, "P6 沒有泡泡：放名牌下面 +6");

// ---------- L 十三支三個階段的位置（手機 844×390，倍率 1） ----------
const M = (o: Partial<import("../components/thirteen/ThSocial").Measured>) => ({ vw: VW, vh: VH, menu: box(8, 8, 34, 34), me: null, side: null, stage: null, submit: null, hand: null, frame: null, ok: null, s2: 1, ...o });
// 聊天鈕改成三款共用的右下圓鈕（iPhone UI 規格 P2、A3），位置是 CSS，不再由 phaseButton 算；844×390 時在 (745–789, 317–361)
const FAB = box(745, 317, 44, 44);
const td = L.phaseDock("table", M({ right: box(655, 120, 182, 130) }), FAB, 250)!;
ok(td.left === 397 && td.top === 50 && td.bottom === 309, `L1 牌桌聊天室：右緣貼右家牌列左緣 −8、下緣在聊天鈕上面 8 → (397, 50)～309（${td.left}, ${td.top}, ${td.bottom}）`);
const td0 = L.phaseDock("table", M({}), FAB, 250)!;
ok(td0.left === 789 - 8 - 250, "L2 量不到右家（還沒畫好）：先貼聊天鈕右緣 −8");
const ad = L.phaseDock("arrange", M({ side: box(680, 20, 150, 300) }), FAB, 250)!;
ok(ad.left === 580 && ad.top === 50 && ad.bottom === 311, "L4 理牌聊天室：右緣貼右欄、下緣在聊天鈕上面 6 → (580, 50)～311");
const ad16 = L.phaseDock("arrange", M({ side: box(680, 20, 150, 300), hand: box(66, 244, 594, 76) }), FAB, 250)!;
ok(ad16.bottom === 238, "L4b 16 張手牌伸到聊天室下方：聊天室停在手牌上緣 −6（不蓋手牌）");
const rd = L.phaseDock("result", M({ frame: box(0, 0, 844, 390) }), FAB, 250)!;
ok(rd.left === 539 && rd.top === 56 && rd.bottom === 309, "L6 結算聊天室：右緣對齊聊天鈕右緣、外框上緣 +56 → (539, 56)～309");
// 審伯 iPhone UI 初審 R1：結算按「查看牌桌」（外框收起）時聊天鈕還在右下，按下去要開得出看得到的聊天室——照牌桌的位置（右緣貼右家牌列左緣 −8）
const pk = L.phaseDock("result", M({ frame: null, right: box(655, 120, 182, 130) }), FAB, 250);
ok(!!pk && pk.left === 397 && pk.top === 50 && pk.bottom === 309, `L12 結算「查看牌桌」時：聊天室照牌桌位置開 → (397, 50)～309（${JSON.stringify(pk)}）`);
ok(L.plateKey(2, 0) === "t" && L.plateKey(3, 0) === "l" && L.plateKey(1, 0) === "r" && L.plateKey(0, 2) === "t" && L.plateKey(1, 2) === "l", "L8 座位 → 名牌鍵（相對自己：右家 r、對家 t、左家 l）");
const sl = L.tableStack("l", box(4, 166, 88, 38), VW, VH), sr = L.tableStack("r", box(752, 166, 88, 38), VW, VH), st2 = L.tableStack("t", box(214, 8, 88, 38), VW, VH);
ok(sl.pos.left === 4 && sl.pos.bottom === VH - 159 && sl.dir === "up", "L9 左家泡泡：名牌上方 7、左對齊、往上疊");
ok(sr.pos.right === 4 && sr.pos.bottom === VH - 159 && sr.align === "end", "L10 右家泡泡：名牌上方、右對齊");
ok(st2.pos.right === VW - 207 && st2.pos.top === 8 && st2.dir === "down", "L11 對家泡泡：名牌左側（右緣貼名牌左緣 −7）、上緣對齊、往下疊");

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
