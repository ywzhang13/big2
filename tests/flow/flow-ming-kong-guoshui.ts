// 明槓別人打出的牌、補到胡牌 → 過水：補牌當下不能自摸，當輪打出哪一張都不解除，下一輪摸牌也不能自摸、
// 這段期間也不能胡別人的牌；要等下一輪摸牌後打出不是聽的牌才解除（打出的仍是聽的牌就繼續過水）。
// 補到的不是胡牌就照常。暗槓、加槓補牌照樣可以自摸、算槓上開花。過水狀態不公開。
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import { startNextGame } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 96000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const REST = "m3 m4 s1 s2 s3 s4 s5 s6 s7 s8 s9 z1 z1"; // 槓完剩這 13 張：聽二五萬
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
function setup(seat1Hand: string) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
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
/** 槓的補牌（從牌尾補）換成 key */
const setReplacement = (key: string) => { st().wall[st().wall.length - 1] = t(key); };
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
const handIds = (seat: number, key: string) => st().players[seat].hand.filter((x) => x.display === key).map((x) => x.id);
const canRon = (seat: number) => (st().pendingActions?.potentialActors ?? []).includes(seat);
/** 從玩家自己的角度：重新整理後看得到的「胡」選項 */
const viewWin = (seat: number) => !!toPlayerGameState(st(), "p" + seat).myAvailableActions?.some((a) => a.type === "win");
/** 補牌（摸牌）後送給本人的「能不能胡」 */
const drawCanWin = () => (sent.find((e) => e.event === "mj_draw_tile")?.payload as { canWin?: boolean } | undefined)?.canWin;
const fans = () => (st().winners?.[0]?.score.fans ?? []).map((f) => f.name);
const leaks: string[] = [];
function checkLeak(tag: string) {
  for (const seat of [0, 1, 2, 3]) if (/guoShui/i.test(JSON.stringify(toPlayerGameState(st(), "p" + seat)))) leaks.push(`${tag}:state:p${seat}`);
  if (sent.some((e) => /guoShui/i.test(JSON.stringify(e)))) leaks.push(`${tag}:broadcast`);
}
/** 對家打五筒，seat1 明槓，補牌是 replacement */
async function mingKong(replacement: string) {
  setup("p5 p5 p5 " + REST);
  setReplacement(replacement);
  await giveAndDiscard(3, "p5"); // 對家打出（上家打的牌不能明槓，2026-10-17）
  sent.length = 0;
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "p5") });
  checkLeak("明槓");
  return k;
}

// ---- ① 明槓後補到胡牌：不能自摸 ----
{
  const k = await mingKong("m2");
  eq([k.status, st().players[1].revealed[0]?.type, st().currentTurn, st().hasDrawn], [200, "kong", 1, true], "K1 對家打五筒，明槓成功，補了一張牌");
  eq([drawCanWin(), viewWin(1), gs()], [false, false, [1]], "K2 補到二萬（湊成胡牌）：補牌通知和重新整理都沒有胡的按鈕，已過水");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, w.body.error, st().status, st().winners ?? []], [400, "現在不能胡", "playing", []], "K3 硬送自摸：伺服器擋下（400），這局繼續");
  const d = await call(discard, { playerId: "p1", tileId: handIds(1, "m2")[0] });
  checkLeak("補牌後打牌");
  eq([d.status, st().status, st().players[1].hand.length, st().lastDiscard?.from], [200, "playing", 13, 1], "K4 只能打牌：打出二萬成功，牌局繼續（不會卡住）");
}

// ---- ③ 當輪打出別張（不是補到的胡牌）：仍過水；下一輪摸牌後打出不是聽的牌才解除 ----
{
  await mingKong("m2");
  const d = await call(discard, { playerId: "p1", tileId: handIds(1, "z1")[0] });
  eq([d.status, gs(), st().currentTurn], [200, [1], 2], "K5 補到二萬後打出東（拆掉眼，不是補到的胡牌）：仍過水，輪到下家");
  const r = await giveAndDiscard(2, "z1");
  eq([r.status, canRon(1), viewWin(1)], [200, false, false], "K6 下家打出東（現在聽的牌）：不能胡、沒有胡的按鈕");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status >= 400, st().status, st().winners ?? []], [true, "playing", []], "K7 硬送胡：伺服器擋下，這局繼續");
  turn(1, "z6");
  const dr = await call(draw, { playerId: "p1" });
  const d2 = await call(discard, { playerId: "p1", tileId: handIds(1, "z6")[0] });
  eq([dr.status, d2.status, gs()], [200, 200, []], "K8 下一輪摸到發、打出發（不是聽的牌）：過水解除");
  await giveAndDiscard(2, "z1");
  eq([canRon(1), viewWin(1)], [true, true], "K9 解除後下家打出東：可以胡");
  const ron = await call(action, { playerId: "p1", actionType: "win" });
  eq([ron.status, st().status, st().winners?.[0]?.seat], [200, "finished", 1], "K10 胡別人的牌成功");
}
{
  await mingKong("m2");
  await call(discard, { playerId: "p1", tileId: handIds(1, "z1")[0] });
  turn(1, "z6");
  await call(draw, { playerId: "p1" });
  await call(discard, { playerId: "p1", tileId: handIds(1, "z6")[0] });
  turn(1, "z1");
  const dr = await call(draw, { playerId: "p1" });
  eq([dr.body.canWin, viewWin(1)], [true, true], "K11 解除後再輪到自己摸到東：可以自摸");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status, fans().includes("槓上開花")], [200, "finished", false], "K12 自摸成功（不是槓上開花）");
}

// ---- 下一輪摸到胡牌不能自摸；打出的仍是聽的牌就繼續過水 ----
{
  await mingKong("m2");
  await call(discard, { playerId: "p1", tileId: handIds(1, "z1")[0] });
  turn(1, "z1");
  const dr = await call(draw, { playerId: "p1" });
  eq([dr.status, dr.body.canWin, viewWin(1)], [200, false, false], "K13 下一輪摸到東（胡牌）：還在過水，不能自摸、沒有胡的按鈕");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status], [400, "playing"], "K13b 硬送自摸：伺服器擋下");
  const d = await call(discard, { playerId: "p1", tileId: handIds(1, "z1")[0] });
  eq([d.status, gs()], [200, [1]], "K14 打出東（是聽的牌）：繼續過水");
  await giveAndDiscard(2, "z1");
  eq([canRon(1), viewWin(1)], [false, false], "K15 下家打出東：不能胡");
  turn(1, "z6");
  await call(draw, { playerId: "p1" });
  await call(discard, { playerId: "p1", tileId: handIds(1, "z6")[0] });
  await giveAndDiscard(2, "z1");
  eq([gs(), canRon(1)], [[], true], "K16 再下一輪打出發（不是聽的牌）：解除，下家打東可以胡");
}

// ---- 補花後才補到胡牌：一樣過水 ----
{
  setup("p5 p5 p5 " + REST);
  const w = st().wall;
  w[w.length - 1] = t("f3"); w[w.length - 2] = t("m5");
  await giveAndDiscard(3, "p5"); // 對家打出（上家打的牌不能明槓，2026-10-17）
  sent.length = 0;
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "p5") });
  eq([k.status, st().players[1].flowers.length, drawCanWin(), viewWin(1), gs()], [200, 1, false, false, [1]], "K17a 明槓補到花、補花後拿到五萬（胡牌）：一樣過水，不能自摸");
}

// ---- ② 明槓補到的不是胡牌：一切照常 ----
{
  const k = await mingKong("z7");
  eq([k.status, drawCanWin(), gs()], [200, false, []], "K17b 明槓補到中（不是胡牌）：沒有過水");
  const d = await call(discard, { playerId: "p1", tileId: handIds(1, "z7")[0] });
  eq([d.status, gs()], [200, []], "K17c 打出中：照一般規則，不會過水");
  await giveAndDiscard(2, "m5");
  eq([canRon(1), viewWin(1)], [true, true], "K17d 下家打出五萬：可以胡");
  turn(1, "m2");
  const dr = await call(draw, { playerId: "p1" });
  eq(dr.body.canWin, true, "K17e 改成下一輪自己摸到二萬：可以自摸");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status], [200, "finished"], "K17f 自摸成功");
}

// ---- ④ 暗槓、加槓不受影響 ----
{
  setup("p5 p5 p5 " + REST);
  turn(1, "p5");
  await call(draw, { playerId: "p1" });
  setReplacement("m2");
  sent.length = 0;
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "p5") });
  eq([k.status, st().players[1].revealed[0]?.type, drawCanWin(), viewWin(1), gs()], [200, "concealed_kong", true, true, []], "K17 暗槓補到二萬：可以自摸，沒有過水");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, fans().includes("槓上開花"), fans().includes("自摸")], [200, true, true], "K18 暗槓補牌自摸成功，算自摸和槓上開花");
}
{
  setup(REST);
  st().players[1].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5"), from: 0 }];
  turn(1, "p5");
  await call(draw, { playerId: "p1" });
  setReplacement("m2");
  sent.length = 0;
  const k = await call(action, { playerId: "p1", actionType: "add_kong", tiles: handIds(1, "p5") });
  eq([k.status, k.body.robWindow, st().players[1].revealed[0]?.type, drawCanWin(), viewWin(1), gs()], [200, false, "kong", true, true, []], "K19 加槓補到二萬：可以自摸，沒有過水");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, fans().includes("槓上開花"), fans().includes("自摸")], [200, true, true], "K20 加槓補牌自摸成功，算槓上開花");
}

// ---- 不公開、每局重來 ----
eq(leaks, [], "K21 明槓、補牌後打牌時，四家的 state 和所有廣播都看不到過水欄位");
{
  await mingKong("m2");
  const n = startNextGame({ ...st(), status: "finished" } as MahjongGameState);
  eq(n.guoShuiSeats, undefined, "K22 下一局開始：明槓的過水清空");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
