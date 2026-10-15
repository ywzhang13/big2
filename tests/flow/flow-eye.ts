// 眼牌：打牌時宣告（discard + declareEye）、能胡自動胡（自摸、放槍、搶槓、七搶一）、不能胡自動打出、不能吃碰槓、
// 眼牌的人看得到三家手牌（只送給本人：state 的 opponentHands、座位頻道的 mj_opponent_hands），其他人拿不到；
// 第一輪宣告同時算地聽 8 台、之後宣告不加台；四家都能眼牌；和過水不互卡
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";
import { privateChannelName } from "../../lib/mahjong/access";
import { startNextGame } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 80000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
/** firstRound=false：大家都打過牌（宣告眼牌不算地聽） */
function setup(firstRound = false) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: firstRound ? 0 : 8, hasDrawn: false, isFirstRound: firstRound, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  if (!firstRound) for (const p of s.players) p.discards = tiles("z7");
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state as MahjongGameState;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
/** 輪到 seat 摸牌，牌牆第一張換成 key */
function turn(seat: number, key: string) {
  const s = st();
  s.currentTurn = seat; s.hasDrawn = false; s.lastDiscard = null; s.pendingActions = undefined; s.drawnTileId = undefined;
  s.wall[0] = t(key);
  sent.length = 0;
}
/** seat 拿 hand16＋extra（剛摸進）後打出 extra；eye=true 時同時宣告眼牌 */
async function playFrom(seat: number, hand16: string, extra: string, eye: boolean) {
  const s = st();
  s.players[seat].hand = tiles(hand16 + " " + extra);
  const tile = s.players[seat].hand[16];
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id, ...(eye ? { declareEye: true } : {}) });
}
/** seat 摸進 key 後馬上打出它（模擬別家打出這張） */
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const fanNames = (seat: number) => st().winners?.find((w) => w.seat === seat)?.score.fans.map((f) => f.name) ?? [];
const handIds = (seat: number) => st().players[seat].hand.map((x) => x.id);
/** 文字裡出現了哪些別人的手牌 id（「"id":12345」） */
const leakedIds = (text: string, seats: number[]) => seats.flatMap((x) => handIds(x)).filter((id) => text.includes(`"id":${id},`));
const chan = (seat: number) => privateChannelName("T", "p" + seat);

// ---- 宣告（第一輪以後：不算地聽） ----
{
  setup();
  const s = st();
  s.players[1].hand = tiles(WAIT25 + " z5");
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = s.players[1].hand[16].id;
  const opt = toPlayerGameState(st(), "p1").myAvailableActions?.find((a) => a.type === "declare_eye");
  eq([opt?.tiles?.map((x) => x.display), opt?.ting], [["z5"], false], "E1 第一輪以後：myAvailableActions 有 declare_eye（只有打出中才會聽），ting=false");
  const r = await call(discard, { playerId: "p1", tileId: s.players[1].hand[16].id, declareEye: true });
  eq([r.status, r.body.eye, r.body.ting, st().eyeSeats, st().tingSeats ?? [], sent.map((e) => e.event).slice(0, 2), sent[0].payload.ting, sent.some((e) => e.event === "mj_ting_declared")],
    [200, true, false, [1], [], ["mj_eye_declared", "mj_discard"], false, false],
    "E2 宣告眼牌：eyeSeats=[1]、不算地聽；送 mj_eye_declared(ting:false)，沒有 mj_ting_declared");
  eq([toPublicGameState(st()).eyeSeats, toPlayerGameState(st(), "p3").eyeSeats], [[1], [1]], "E3 公開狀態有 eyeSeats");
  turn(1, "z2");
  await call(draw, { playerId: "p1" });
  const again = await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "m3")!.id, declareEye: true });
  eq(again.status, 400, "E4 已經眼牌：不能再宣告、也不能取消（打別張 400）");
}
// ---- 看得到三家手牌，而且只有眼牌的人看得到 ----
{
  setup();
  st().players[3].revealed = [{ type: "concealed_kong", tiles: tiles("z5 z5 z5 z5") }];
  await playFrom(1, WAIT25, "z6", true);
  const others = [0, 2, 3];
  const mine = toPlayerGameState(st(), "p1").opponentHands!;
  eq([mine.map((o) => o.seat), mine.map((o) => o.hand.length), mine.find((o) => o.seat === 3)!.revealed[0].tiles.map((x) => x.display)],
    [others, [16, 16, 16], ["z5", "z5", "z5", "z5"]], "E5 眼牌的人重新整理：opponentHands 有三家的手牌（16 張），也看得到暗槓的牌面");
  eq(mine.every((o) => JSON.stringify(o.hand.map((x) => x.id).sort()) === JSON.stringify(handIds(o.seat).sort())), true, "E6 opponentHands 的牌就是三家真正的手牌");
  const viewLeak = others.flatMap((v) => {
    const view = toPlayerGameState(st(), "p" + v);
    return [...("opponentHands" in view ? ["opponentHands@" + v] : []), ...leakedIds(JSON.stringify(view), [0, 1, 2, 3].filter((x) => x !== v)).map(String)];
  });
  eq([viewLeak, leakedIds(JSON.stringify(toPublicGameState(st())), [0, 1, 2, 3])], [[], []], "E7 其他三家的 state、公開 state：沒有 opponentHands，也沒有任何別人手牌的 id");
  // 下家摸牌：眼牌的人看到他摸進哪張；其他人的頻道、公開頻道都拿不到
  turn(2, "p9");
  await call(draw, { playerId: "p2" });
  const drawnId = st().drawnTileId;
  const ev = sent.find((e) => e.event === "mj_opponent_hands")!;
  const seat2 = (ev.payload.opponentHands as { seat: number; drawnTileId: number | null; hand: Tile[] }[]).find((o) => o.seat === 2)!;
  eq([ev.channel === chan(1), seat2.drawnTileId === drawnId, seat2.hand.length], [true, true, 17], "E8 別家摸牌：mj_opponent_hands 只送到眼牌者的座位頻道，標出他摸進的那張");
  const bad = sent.filter((e) => e.channel !== chan(1)).flatMap((e) => {
    const owner = [0, 1, 2, 3].find((x) => e.channel === chan(x));
    return leakedIds(JSON.stringify(e.payload), [0, 1, 2, 3].filter((x) => x !== owner)).map((id) => `${e.event}:${id}`);
  });
  eq([bad, sent.filter((e) => e.event === "mj_opponent_hands").length], [[], 1], "E9 公開頻道和其他座位頻道：沒有任何別人手牌的 id；mj_opponent_hands 只有一則");
}
// ---- 不能吃碰槓 ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  const s = st();
  s.players[1].hand = tiles("p5 p5 p5 p5 m3 m4 p1 p2 p3 s1 s2 s3 z1 z1 m6 m7");
  s.players[1].revealed = [{ type: "pong", tiles: tiles("s9 s9 s9") }];
  s.lastDiscard = { tile: t("m5"), from: 0 }; s.currentTurn = 0; s.hasDrawn = false;
  s.pendingActions = { discardFrom: 0, potentialActors: [1], passedActors: [] };
  const chi = await call(action, { playerId: "p1", actionType: "chi", tiles: [handIds(1)[4], handIds(1)[5]] });
  s.lastDiscard = { tile: t("p5"), from: 0 };
  const pong = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1).slice(0, 2) });
  const mk = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1).slice(0, 3) });
  s.lastDiscard = null; s.pendingActions = undefined; s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = handIds(1)[3];
  const ck = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1).slice(0, 4) });
  s.players[1].hand.push(t("s9"));
  const ak = await call(action, { playerId: "p1", actionType: "add_kong", tiles: [handIds(1)[16]] });
  eq([chi, pong, mk, ck, ak].map((r) => [r.status, r.body.error]), Array(5).fill([400, "地聽、眼牌後不能吃碰槓"]),
    "E10 眼牌後送吃、碰、明槓、暗槓、加槓：全部 400");
  eq([st().players[1].revealed.length, st().players[1].hand.length], [1, 17], "E11 狀態沒變");
}
// ---- 自動胡別人打的牌（第一輪以後：眼牌不加台、沒有地聽） ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  const d = await giveAndDiscard(2, "m5");
  eq([d.status, st().status, st().winners?.map((w) => w.seat), st().winners?.[0].from, fanNames(1).some((n) => /眼|地聽/.test(n)), sent.some((e) => e.event === "mj_game_over")],
    [200, "finished", [1], 2, false, true], "E12 別人打出五萬：自動胡（不用按），台數沒有眼、沒有地聽");
}
// ---- 一砲多響：眼牌自動胡，另一家照常決定 ----
{
  setup();
  st().players[3].hand = tiles(WAIT25);
  await playFrom(1, WAIT25, "z6", true);
  await giveAndDiscard(2, "m5");
  eq([st().status, st().winners?.map((w) => w.seat), sent.some((e) => e.event === "mj_partial_win" && e.payload.seat === 1), st().pendingActions?.potentialActors.includes(3)],
    ["playing", [1], true, true], "E13 兩家都能胡、一家眼牌：眼牌那家先自動胡（mj_partial_win），另一家還能決定");
  const w = await call(action, { playerId: "p3", actionType: "win" });
  eq([w.status, st().status, st().winners?.map((x) => x.seat)], [200, "finished", [3]], "E14 另一家也胡：照原本雙響規則，離放槍者近的那家（座位 3）截胡，眼牌自動胡的也一樣適用");
}
// ---- 搶槓：自動搶槓胡 ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  const s = st();
  s.players[0].revealed = [{ type: "pong", tiles: tiles("m5 m5 m5"), from: 2 }];
  s.players[0].hand = tiles("m5 s1 s1 s3 s5 s6 s7 s9 s9 z2 z3 z6 z6 z7");
  s.currentTurn = 0; s.hasDrawn = true; s.drawnTileId = s.players[0].hand[0].id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  const k = await call(action, { playerId: "p0", actionType: "add_kong", tiles: [s.players[0].hand[0].id] });
  eq([k.status, st().status, st().winners?.map((w) => w.seat), fanNames(1).includes("搶槓胡")], [200, "finished", [1], true], "E15 別人加槓五萬：眼牌的人自動搶槓胡");
}
// ---- 眼牌自動打出，下一位眼牌者能胡就接著自動胡 ----
{
  setup();
  await playFrom(0, H16, "z6", true);
  await playFrom(1, WAIT25, "z6", true);
  turn(0, "m5");
  const r = await call(draw, { playerId: "p0" });
  eq([r.body.autoDiscarded?.display, st().status, st().winners?.map((w) => [w.seat, w.from])], ["m5", "finished", [[1, 0]]],
    "E16 眼牌者摸到五萬（不是他聽的）自動打出 → 另一位聽五萬的眼牌者自動胡");
}
// ---- 和過水：眼牌不會因為「過」而過水；打出聽的牌造成的過水也會自動解除 ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  st().guoShuiSeats = [1];
  turn(1, "m5");
  const r = await call(draw, { playerId: "p1" });
  eq([r.body.autoWin, r.body.autoDiscarded?.display, st().guoShuiSeats], [false, "m5", [1]], "E17 過水中的眼牌者摸到五萬：不能胡 → 自動打出（打的是聽的牌，繼續過水）");
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq(p.status >= 400, true, "E18 眼牌者沒有「過」可以按（不在任何窗口）");
  turn(1, "z2");
  await call(draw, { playerId: "p1" });
  eq(st().guoShuiSeats, [], "E19 摸到南風自動打出 → 過水解除");
  await giveAndDiscard(2, "m2");
  eq([st().status, st().winners?.map((w) => w.seat)], ["finished", [1]], "E20 解除後別人打二萬：自動胡");
}
// ---- 七搶一：自動搶 ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  st().players[1].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
  turn(2, "f8");
  const r = await call(draw, { playerId: "p2" });
  eq([r.status, st().status, st().winners?.[0].seat, fanNames(1)[0]], [200, "finished", 1, "七搶一"], "E21 有 7 張花的眼牌者：別人摸到第 8 張花時自動七搶一");
}
// ---- 四家都眼牌（第一輪：同時地聽），互相看得到 ----
{
  setup(true);
  const decl = [];
  decl.push(await playFrom(0, H16, "z5", true));
  for (const seat of [1, 2, 3]) decl.push(await playFrom(seat, H16, "z6", true));
  eq([decl.map((d) => [d.status, d.body.ting]), st().eyeSeats, st().tingSeats], [[[200, true], [200, true], [200, true], [200, true]], [0, 1, 2, 3], [0, 1, 2, 3]],
    "E22 第一輪四家都宣告眼牌：四家都同時算地聽");
  eq([0, 1, 2, 3].map((v) => toPlayerGameState(st(), "p" + v).opponentHands?.map((o) => o.seat)), [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]],
    "E23 四家都看得到另外三家的手牌");
  turn(0, "m9");
  const r0 = await call(draw, { playerId: "p0" });
  eq([r0.body.autoDiscarded?.display, sent.filter((e) => e.event === "mj_opponent_hands").map((e) => e.channel === chan(e.payload.playerId === "p0" ? 0 : Number(String(e.payload.playerId).slice(1))))],
    ["m9", [true, true, true, true]], "E24 莊家摸到九萬自動打出；四家各自收到一則 mj_opponent_hands（各自的座位頻道）");
  turn(1, "s7");
  const r1 = await call(draw, { playerId: "p1" });
  eq([r1.body.autoWin, st().status, fanNames(1).includes("地聽"), fanNames(1).some((n) => n.includes("眼"))], [true, "finished", true, false],
    "E25 下家摸到七條：自動自摸；第一輪眼牌算地聽 8 台，眼牌本身不加台");
}
// ---- 吃、碰後打牌也能宣告眼牌 ----
{
  setup();
  st().players[2].hand = tiles("p5 p5 m1 m2 m3 s1 s2 s3 z2 z2 z2 z6 z6 p6 p7 m9");
  await giveAndDiscard(0, "p5");
  sent.length = 0;
  await call(action, { playerId: "p2", actionType: "pong", tiles: st().players[2].hand.filter((x) => x.display === "p5").map((x) => x.id) });
  const hu = sent.find((e) => e.event === "mj_hand_update")!.payload;
  const m9 = st().players[2].hand.find((x) => x.display === "m9")!.id;
  eq([(hu.eyeOptions as number[]).includes(m9), hu.eyeWithTing, toPlayerGameState(st(), "p2").myAvailableActions?.map((a) => a.type)], [true, false, ["declare_eye"]],
    "E26 碰完要打牌：mj_hand_update 帶 eyeOptions（打九萬會聽），重新整理也有 declare_eye");
  const r = await call(discard, { playerId: "p2", tileId: m9, declareEye: true });
  eq([r.status, st().eyeSeats], [200, [2]], "E27 碰完打九萬並宣告眼牌");
}
// ---- 兩位眼牌者同時能胡同一張：伺服器一次處理，照雙響規則只留離放槍者最近的那位 ----
{
  setup();
  await playFrom(1, WAIT25, "z6", true);
  await playFrom(3, WAIT25, "z6", true);
  const d = await giveAndDiscard(2, "m5"); // 之後沒有任何人手動送胡或過
  const w = st().winners ?? [];
  eq([d.status, st().status, st().pendingActions ?? null, w.map((x) => [x.seat, x.from]), sent.filter((e) => e.event === "mj_game_over").length, sent.some((e) => e.event === "mj_partial_win")],
    [200, "finished", null, [[3, 2]], 1, false],
    "E29 座位 1、3 都眼牌、都聽五萬，座位 2 打出五萬：兩人都自動胡，雙響只留離放槍者最近的座位 3；牌局結束、窗口清除、mj_game_over 只送一次");
  eq([fanNames(3), w[0]?.score.totalFan, st().settlement?.deltas], [["門清"], 1, [0, 0, -120, 120]],
    "E30 結算：座位 3 門清 1 台，只有放槍的座位 2 付 100＋1×20＝120，座位 1 沒有收錢");
}
// ---- 新的一局清空 ----
{
  setup();
  const s = st();
  s.eyeSeats = [1, 2]; s.tingSeats = [1]; s.status = "finished";
  const n = startNextGame(s);
  eq([n.eyeSeats, n.tingSeats], [undefined, undefined], "E28 下一局：眼牌、地聽都清掉");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
