// 過水：打出自己聽的牌、或能胡別人的牌卻 pass → 過水中不能胡任何牌（自摸、放槍、搶槓）；
// 打出一張不是聽的牌就解除。伺服器擋（前端直接送胡也不行），而且其他人從 API／廣播都看不出誰過水
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import { declareWin, ownTurnActions, startNextGame } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 70000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
const WAIT9 = "m1 m1 m1 m2 m3 m4 m5 m6 m7 m8 p1 p2 p3 z1 z1 z1"; // 聽二三五六八九萬
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
function setup(seat1Hand = WAIT25) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  for (const p of s.players) p.discards = tiles("z7"); // 大家都打過牌（不是第一輪）
  s.players[1].hand = tiles(seat1Hand);
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state as MahjongGameState;
const gs = () => st().guoShuiSeats ?? [];
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
/** seat 摸進 key 後馬上打出它（模擬別家打出這張） */
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const handId = (seat: number, key: string) => st().players[seat].hand.find((x) => x.display === key)!.id;
const actors = () => st().pendingActions?.potentialActors ?? [];
const canRon = (seat: number) => actors().includes(seat);
/** 從玩家自己的角度：重新整理後看得到的「胡」選項 */
const viewWin = (seat: number) => !!toPlayerGameState(st(), "p" + seat).myAvailableActions?.some((a) => a.type === "win");

// ---- 老闆例子一：聽二五萬，上家打二萬沒胡 → 過水；摸南風打南風 → 解除；下家打五萬可以胡 ----
{
  setup();
  const d = await giveAndDiscard(0, "m2");
  eq([d.status, canRon(1), viewWin(1)], [200, true, true], "G1 上家打二萬：聽二五萬的下家可以胡（有胡選項）");
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq([p.status, gs(), st().currentTurn], [200, [1], 1], "G2 沒胡（pass）→ 過水；輪到自己");
  turn(1, "z2");
  const r = await call(draw, { playerId: "p1" });
  eq([r.status, r.body.canWin], [200, false], "G3 摸到南風：不能胡");
  const dd = await call(discard, { playerId: "p1", tileId: handId(1, "z2") });
  eq([dd.status, gs()], [200, []], "G4 打出南風（不是聽的牌）→ 過水解除");
  await giveAndDiscard(2, "m5");
  eq([canRon(1), viewWin(1)], [true, true], "G5 下家打五萬：可以胡");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status, st().winners?.map((x) => x.seat)], [200, "finished", [1]], "G6 胡五萬成功");
}
// ---- 過水後還沒輪到自己打牌：別家再打聽的牌也不能胡 ----
{
  setup();
  await giveAndDiscard(2, "m2");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq(gs(), [1], "G7 對家打二萬沒胡 → 過水");
  const d = await giveAndDiscard(3, "m5");
  eq([d.status, canRon(1), viewWin(1), (d.body.availableActions as { playerSeat: number }[]).some((a) => a.playerSeat === 1)],
    [200, false, false, false], "G8 還沒打牌解除前，下家打五萬：不在可動作名單、沒有胡選項");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status, st().winners ?? []], [403, "playing", []], "G9 前端硬送胡：403，狀態不變");
}
// ---- 老闆例子二：聽二五八、三六九萬，自己打出五萬 → 過水；摸到二萬不能自摸，別人打的也不能胡 ----
{
  setup(WAIT9 + " m5");
  const s = st();
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = s.players[1].hand[16].id;
  const d = await call(discard, { playerId: "p1", tileId: s.players[1].hand[16].id });
  eq([d.status, gs()], [200, [1]], "G10 自己打出五萬（自己聽的牌）→ 過水");
  turn(1, "m2");
  const r = await call(draw, { playerId: "p1" });
  eq([r.status, r.body.canWin, viewWin(1), ownTurnActions(st(), 1).some((a) => a.type === "win")], [200, false, false, false],
    "G11 摸到二萬：沒有自摸選項（摸牌回應、重新整理都沒有）");
  const before = JSON.stringify(st());
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, w.body.error, JSON.stringify(st()) === before], [400, "現在不能胡", true], "G12 前端硬送自摸：400「現在不能胡」，狀態不變");
  let threw = "";
  try { declareWin(st(), 1, true); } catch (e) { threw = (e as Error).message; }
  eq(threw, "現在不能胡", "G13 declareWin 本身也擋（不只 route）");
  const dd = await call(discard, { playerId: "p1", tileId: handId(1, "m2") });
  eq([dd.status, gs()], [200, [1]], "G14 摸到的二萬再打出去：打的還是聽的牌 → 繼續過水");
  const blocked: string[] = [];
  for (const [seat, key] of [[2, "m2"], [3, "m5"], [0, "m8"], [2, "m3"], [3, "m6"], [0, "m9"]] as const) {
    await giveAndDiscard(seat, key);
    // 下家可能還能吃，所以只看「胡」：沒有胡選項，硬送胡也不行
    const w = await call(action, { playerId: "p1", actionType: "win" });
    if (viewWin(1) || w.status === 200) blocked.push(key);
  }
  eq(blocked, [], "G15 別人打出二五八、三六九萬：全部沒有胡選項，硬送胡也被擋");
  turn(1, "z2");
  await call(draw, { playerId: "p1" });
  await call(discard, { playerId: "p1", tileId: handId(1, "z2") });
  eq(gs(), [], "G16 打出南風 → 解除");
  await giveAndDiscard(2, "m9");
  eq(canRon(1), true, "G17 解除後別人打九萬：可以胡");
}
// ---- 打出不是聽的牌時不會進入過水 ----
{
  setup(WAIT25 + " z2");
  const s = st();
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = s.players[1].hand[16].id;
  await call(discard, { playerId: "p1", tileId: handId(1, "z2") });
  eq(gs(), [], "G18 打出不是聽的牌：不會過水");
}
// ---- 搶槓 ----
function kongSetup(guoShui: boolean) {
  setup();
  const s = st();
  s.players[0].revealed = [{ type: "pong", tiles: tiles("m5 m5 m5"), from: 2 }];
  s.players[0].hand = tiles("m5 s1 s1 s3 s5 s6 s7 s9 s9 z2 z3 z6 z6 z7");
  s.currentTurn = 0; s.hasDrawn = true; s.drawnTileId = s.players[0].hand[0].id;
  if (guoShui) s.guoShuiSeats = [1];
  sent.length = 0;
}
{
  kongSetup(true);
  const k = await call(action, { playerId: "p0", actionType: "add_kong", tiles: [handId(0, "m5")] });
  eq([k.status, k.body.robWindow, st().pendingAddKong ?? null, st().players[0].revealed[0].type], [200, false, null, "kong"],
    "G19 過水中不能搶槓：加槓直接完成，不開搶槓窗口");
}
{
  kongSetup(false);
  const k = await call(action, { playerId: "p0", actionType: "add_kong", tiles: [handId(0, "m5")] });
  eq([k.body.robWindow, actors()], [true, [1]], "G20 沒過水：可以搶槓");
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq([p.status, gs(), st().players[0].revealed[0].type], [200, [1], "kong"], "G21 能搶槓卻 pass → 過水，加槓完成");
}
// ---- 地聽 + 過水：摸到聽的牌也要自動打出，不能卡住 ----
{
  setup();
  st().tingSeats = [1];
  st().guoShuiSeats = [1];
  turn(1, "m5");
  const r = await call(draw, { playerId: "p1" });
  eq([r.status, r.body.canWin, r.body.autoDiscarded?.display, gs()], [200, false, "m5", [1]],
    "G22 地聽又過水，摸到五萬：不能胡，自動打出（打的是聽的牌，繼續過水）");
  turn(1, "z2");
  const r2 = await call(draw, { playerId: "p1" });
  eq([r2.body.autoDiscarded?.display, gs()], ["z2", []], "G23 再摸到南風自動打出 → 解除");
  turn(1, "m2");
  const r3 = await call(draw, { playerId: "p1" });
  eq([r3.body.canWin, r3.body.autoDiscarded], [true, null], "G24 解除後摸到二萬：可以自摸");
}
// ---- 一砲多響 ----
{
  setup();
  st().players[2].hand = tiles(WAIT25);
  st().guoShuiSeats = [1];
  await giveAndDiscard(0, "m5");
  const w1 = await call(action, { playerId: "p1", actionType: "win" });
  eq([viewWin(1), viewWin(2), w1.status], [false, true, 400], "G25 兩家都聽五萬、一家過水：只有沒過水的那家有胡選項（過水那家仍可吃，硬送胡 400）");
  const w = await call(action, { playerId: "p2", actionType: "win" });
  eq([w.status, st().status, st().winners?.map((x) => x.seat)], [200, "finished", [2]], "G26 不等過水那家，直接結束");
}
{
  setup();
  st().players[2].hand = tiles(WAIT25);
  await giveAndDiscard(0, "m5");
  eq([viewWin(1), viewWin(2)], [true, true], "G27 兩家都沒過水：兩家都能胡");
  const w = await call(action, { playerId: "p2", actionType: "win" });
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq([w.body.partial, p.status, st().status, st().winners?.map((x) => x.seat)], [true, 200, "finished", [2]], "G28 一家胡、一家 pass：這局照常結束");
}
// ---- 天胡、地胡 ----
{
  setup();
  const s = st();
  s.players[0].hand = tiles("m2 m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1");
  for (const p of s.players) p.discards = [];
  s.turnCount = 0; s.isFirstRound = true; s.hasDrawn = true; s.drawnTileId = s.players[0].hand[16].id;
  eq(ownTurnActions(s, 0).some((a) => a.type === "win"), true, "G29 天胡：開局沒有人過水，照常可以胡");
}
{
  setup();
  const s = st();
  for (const p of s.players) p.discards = [];
  s.turnCount = 0; s.isFirstRound = true;
  await giveAndDiscard(0, "m2");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq(gs(), [1], "G30 地胡：莊家第一張打二萬，閒家能胡沒胡 → 過水");
  turn(1, "m5");
  st().turnCount = 1;
  const r = await call(draw, { playerId: "p1" });
  eq(r.body.canWin, false, "G31 接著摸到五萬：不能自摸（地胡也不行）");
}
// ---- 七搶一（目前預設：花牌胡不受過水影響，待確認） ----
{
  setup();
  const s = st();
  s.guoShuiSeats = [1];
  s.players[1].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
  s.players[0].flowers = tiles("f8");
  s.pendingFlowerRob = { robberSeat: 1, fromSeat: 0, tile: s.players[0].flowers[0] };
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().winners?.[0].score.fans[0].name], [200, "七搶一"], "G32 過水中仍可七搶一（目前預設，待阿哲確認）");
}
// ---- 新的一局重來 ----
{
  setup();
  const s = st();
  s.guoShuiSeats = [1, 3];
  s.status = "finished";
  eq(startNextGame(s).guoShuiSeats, undefined, "G33 下一局開始：過水清空");
}
// ---- 不外洩：別人（和自己）從 API／廣播都看不出誰過水 ----
{
  setup();
  await giveAndDiscard(0, "m2");
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  const passEvent = sent.find((e) => e.event === "mj_pass")!;
  eq([gs(), Object.keys(passEvent.payload).sort(), Object.keys(p.body).sort()], [[1], ["allPassed", "currentTurn", "hasDrawn", "seat", "sv"], ["success"]],
    "G34 過水的 pass：廣播和回應的欄位跟一般 pass 一樣");
  const leak: string[] = [];
  for (const seat of [0, 1, 2, 3]) {
    if (/guoShui/i.test(JSON.stringify(toPlayerGameState(st(), "p" + seat)))) leak.push("state:p" + seat);
  }
  turn(1, "z2");
  await call(draw, { playerId: "p1" });
  await call(discard, { playerId: "p1", tileId: handId(1, "z2") });
  await giveAndDiscard(2, "m2");
  if (sent.some((e) => /guoShui/i.test(JSON.stringify(e)))) leak.push("broadcast");
  eq(leak, [], "G35 四家的 state、所有廣播都沒有過水欄位");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
