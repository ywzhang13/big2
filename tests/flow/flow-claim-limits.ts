// 2026-10-19 老闆的兩條規則：
// 一、牌底不夠就不能吃碰槓別人的牌：可摸張數＝牌牆−16（剩 16 張流局）。吃、碰要 ≥4（三家各摸一張後自己還摸得到），
//     明槓別人的牌要 ≥5（多一張補牌）；暗槓、加槓照 canKongNow；胡不受影響。可選動作、API、executeAction 三層都擋。
// 二、碰的過水：能碰（或明槓）一張打出的牌卻按過，在自己摸牌（正常摸牌、槓後補牌、補花都算）或打出一張牌之前，
//     同一種牌都不能碰、也不能明槓；自己摸牌或打出一張牌就解除；其他牌照常；過水胡照舊；只在伺服器、不公開；每局重來。
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import { executeAction, getAvailableActions, startNextGame } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 97000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
// 其他三家：沒有對子、不聽牌，不會碰到也不會胡
const OTHER = "p1 p3 p5 p7 p9 s1 s3 s5 s7 s9 z1 z2 z3 z4 z5 z6";
// 我（座位 1）：一萬、紅中各一對，不能胡一萬
const ME = "m1 m1 z7 z7 m5 m7 m9 p2 p4 p6 s2 s4 s6 s8 z1 z2";
function setup(meHand = ME, wallSize = 40, mut?: (s: MahjongGameState) => void) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(OTHER), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(wallSize).fill("s8").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[1].hand = tiles(meHand);
  mut?.(s);
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
/** seat 摸進 key 後馬上打出它（模擬別家打出這張；不經過牌牆） */
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const handIds = (seat: number, key: string, n = 9) => st().players[seat].hand.filter((x) => x.display === key).slice(0, n).map((x) => x.id);
const actors = () => st().pendingActions?.potentialActors ?? [];
/** 座位 1 自己看得到（重新整理後）／收到廣播的動作 */
const myView = () => (toPlayerGameState(st(), "p1").myAvailableActions ?? []).map((a) => a.type);
const myBroadcast = () => sent
  .filter((e) => e.event === "mj_available_actions" && (e.payload as { playerId?: string }).playerId === "p1")
  .flatMap((e) => ((e.payload as { actions: { type: string }[] }).actions).map((a) => a.type));
const mine = (s: MahjongGameState, seat = 1) => getAvailableActions(s).filter((a) => a.playerSeat === seat).map((a) => a.type);
/** 硬送：直接開一個只有座位 1 的窗口（不經過 getAvailableActions），看 API 會不會擋 */
function forceWindow(from: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[from].discards.push(tile);
  s.lastDiscard = { tile, from };
  s.currentTurn = from; s.hasDrawn = false; s.drawnTileId = undefined;
  s.pendingActions = { discardFrom: from, potentialActors: [1], passedActors: [] };
}
const leaks: string[] = [];
function checkLeak(tag: string) {
  for (const seat of [0, 1, 2, 3]) if (/pongPass/i.test(JSON.stringify(toPlayerGameState(st(), "p" + seat)))) leaks.push(`${tag}:state:p${seat}`);
  if (sent.some((e) => /pongPass/i.test(JSON.stringify(e)))) leaks.push(`${tag}:broadcast`);
}

// ===================== 二、碰的過水：老闆的例子 =====================
{
  setup();
  // 下家（座位 2）打一萬：我可以碰，按過
  await giveAndDiscard(2, "m1");
  eq([actors(), myView()], [[1], ["pong"]], "A1 下家打一萬：我可以碰");
  const p = await call(action, { playerId: "p1", actionType: "pass" });
  eq([p.status, st().pongPassKeys?.[1]], [200, ["m1"]], "A2 按過：伺服器記下一萬（碰的過水）");
  checkLeak("A2");
  // 同一輪：對家（座位 3）打別的、上家（座位 0）接著打一萬 → 不能碰
  await giveAndDiscard(3, "p2");
  await giveAndDiscard(0, "m1");
  checkLeak("A3");
  eq([actors().includes(1), myView(), myBroadcast()], [false, [], []], "A3 上家同一輪接打一萬：不能碰（沒有窗口、沒有按鈕、沒有廣播）");
  forceWindow(0, "m1");
  const hp = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
  eq([hp.status, hp.body.error, st().players[1].revealed.length], [400, "這種牌剛才沒碰，要等自己摸牌或打牌後才能碰", 0], "A4 硬送碰一萬：400，狀態沒變");
  const s4 = st();
  const ex = (() => { try { executeAction(s4, { type: "pong", playerSeat: 1, tiles: s4.players[1].hand.filter((x) => x.display === "m1").slice(0, 2) }); return "ok"; } catch (e) { return (e as Error).message; } })();
  eq(ex, "這種牌剛才沒碰，要等自己摸牌或打牌後才能碰", "A5 executeAction 也擋下");
  // 另一種牌（紅中）照常可以碰
  st().pendingActions = undefined;
  await giveAndDiscard(3, "z7");
  eq([actors(), myView()], [[1], ["pong"]], "A6 過水中，別人打紅中：照常可以碰");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq(st().pongPassKeys?.[1], ["m1", "z7"], "A7 紅中也按過：兩種都記下");
  // 輪到我從牌牆摸牌 → 解除
  const s = st();
  s.currentTurn = 1; s.hasDrawn = false; s.lastDiscard = null; s.pendingActions = undefined; s.drawnTileId = undefined;
  s.wall[0] = t("p8");
  sent.length = 0;
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, st().pongPassKeys?.[1] ?? null], [200, null], "A8 自己從牌牆摸牌：解除碰的過水");
  checkLeak("A8");
  const dc = await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "p8")!.id });
  eq(dc.status, 200, "A9 摸完打出");
  await giveAndDiscard(0, "m1");
  eq([actors(), myView()], [[1], ["pong"]], "A10 摸牌後再有人打一萬：可以碰");
  const ok = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
  eq([ok.status, st().players[1].revealed[0]?.type, st().players[1].revealed[0]?.tiles.map((x) => x.display)], [200, "pong", ["m1", "m1", "m1"]], "A11 碰一萬成功");
}

// ===================== 二、明槓也一起擋 =====================
{
  setup("m1 m1 m1 z7 z7 m5 m7 p2 p4 p6 s2 s4 s6 s8 z1 z2");
  await giveAndDiscard(3, "m1"); // 對家打一萬：可碰可明槓
  eq(myView(), ["kong", "pong"], "B1 對家打一萬：我可以明槓或碰");
  await call(action, { playerId: "p1", actionType: "pass" });
  await giveAndDiscard(3, "m1"); // 實戰不會有第五張一萬；這裡只驗規則：同一種牌再被打出
  eq([actors().includes(1), mine(st())], [false, []], "B2 按過後同一種牌再打出：明槓、碰都沒有");
  forceWindow(3, "m1");
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "m1", 3) });
  eq([k.status, k.body.error], [400, "這種牌剛才沒碰，要等自己摸牌或打牌後才能碰"], "B3 硬送明槓：400");
}

// ===================== 二、槓後補牌（含補花）算自己摸牌：解除（老闆 2026-10-19 拍板） =====================
{
  // 老闆的例子：下家打紅中我按過；對家打一萬我明槓，補到紅中；之後有人打紅中就可以碰
  setup("m1 m1 m1 z7 z7 m5 m7 p2 p4 p6 s2 s4 s6 s8 z1 z2");
  await giveAndDiscard(2, "z7");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq(st().pongPassKeys?.[1], ["z7"], "C1 下家打紅中按過：記下紅中");
  const s = st();
  s.wall[s.wall.length - 1] = t("f1"); // 補牌先補到花，再補一張
  s.wall[s.wall.length - 2] = t("p9");
  await giveAndDiscard(3, "m1"); // 對家打一萬：明槓
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "m1", 3) });
  eq([k.status, st().players[1].flowers.length, st().pongPassKeys?.[1] ?? null], [200, 1, null], "C2 明槓一萬、補牌（含補花）：碰的過水解除");
  checkLeak("C2");
  await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "p9")!.id });
  await giveAndDiscard(0, "z7");
  eq([actors(), myView()], [[1], ["pong"]], "C3 之後有人打紅中：可以碰");
}

// ===================== 二、過水中碰了別種牌，打出一張後解除（老闆 2026-10-19 拍板） =====================
{
  setup();
  await giveAndDiscard(2, "m1");
  await call(action, { playerId: "p1", actionType: "pass" });
  await giveAndDiscard(3, "z7"); // 對家打紅中：碰（紅中沒過水）
  const p = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "z7", 2) });
  eq([p.status, st().pongPassKeys?.[1]], [200, ["m1"]], "C4 過水中碰紅中：還沒打牌，一萬仍在過水");
  forceWindow(3, "m1");
  const hp = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
  eq(hp.status, 400, "C5 碰完還沒打牌時硬送碰一萬：400");
  const s = st();
  s.pendingActions = undefined; s.lastDiscard = null; s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = undefined;
  const d = await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "s8")!.id });
  eq([d.status, st().pongPassKeys?.[1] ?? null], [200, null], "C6 碰完打出一張：碰的過水解除");
  await giveAndDiscard(0, "m1");
  eq([actors(), myView()], [[1], ["pong"]], "C7 之後上家打一萬：可以碰");
}

// ===================== 二、一砲多人：有人能胡、有人能碰、有人能吃 =====================
{
  // 座位 2 打一萬：座位 3（下家）能吃、座位 1 能碰、座位 0 能胡
  setup(ME, 40, (s) => {
    s.players[3].hand = tiles("m2 m3 p1 p3 p5 p7 p9 s1 s3 s5 s7 s9 z3 z4 z5 z6");
    s.players[0].hand = tiles("m2 m3 s1 s2 s3 s4 s5 s6 s7 s8 s9 p1 p2 p3 z3 z3");
  });
  await giveAndDiscard(2, "m1");
  eq([...actors()].sort(), [0, 1, 3], "D1 一萬：座位 0 能胡、1 能碰、3 能吃");
  await call(action, { playerId: "p1", actionType: "pass" });
  await call(action, { playerId: "p0", actionType: "pass" });
  eq([st().pongPassKeys?.[1], st().pongPassKeys?.[0] ?? null, st().guoShuiSeats], [["m1"], null, [0]], "D2 碰的人按過記碰的過水、胡的人按過照舊進入過水胡（不記碰的過水）");
  const c = await call(action, { playerId: "p3", actionType: "chi", tiles: [...handIds(3, "m2", 1), ...handIds(3, "m3", 1)] });
  eq([c.status, st().pongPassKeys?.[1]], [200, ["m1"]], "D3 下家吃走：碰的人仍在過水");
  checkLeak("D3");
}

// ===================== 二、地聽／眼牌：只能胡，按過不記碰的過水 =====================
{
  setup("m1 m1 m2 m3 s1 s2 s3 s4 s5 s6 s7 s8 s9 p1 p2 p3", 40, (s) => { s.tingSeats = [1]; });
  await giveAndDiscard(2, "m1");
  eq(myView(), ["win"], "E1 地聽的人：一萬只能胡、沒有碰");
  await call(action, { playerId: "p1", actionType: "pass" });
  eq([st().pongPassKeys?.[1] ?? null, st().guoShuiSeats], [null, [1]], "E2 地聽按過：進入過水胡，不記碰的過水");
}

// ===================== 二、每局重來 =====================
{
  setup();
  await giveAndDiscard(2, "m1");
  await call(action, { playerId: "p1", actionType: "pass" });
  const s = st();
  s.status = "finished";
  const n = startNextGame(s);
  eq([st().pongPassKeys?.[1], n.pongPassKeys ?? null], [["m1"], null], "F1 下一局開始：碰的過水清掉");
}

// ===================== 一、牌底不足：吃碰要可摸 ≥4、明槓要 ≥5 =====================
for (const [wall, can] of [[19, false], [20, true]] as const) {
  setup(ME, wall);
  await giveAndDiscard(2, "m1");
  eq([st().wall.length - 16, actors().includes(1), myView()], [wall - 16, can, can ? ["pong"] : []], `G1 可摸 ${wall - 16} 張：${can ? "可以碰" : "不能碰（沒有窗口、沒有按鈕）"}`);
  if (!can) {
    forceWindow(2, "m1");
    const r = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
    eq([r.status, r.body.error, st().players[1].revealed.length], [400, "牌底不夠再摸一張，不能吃碰", 0], "G2 可摸 3 張硬送碰：400，狀態沒變");
  } else {
    const r = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
    eq([r.status, st().players[1].revealed[0]?.type], [200, "pong"], "G3 可摸 4 張：碰成功");
  }
}
for (const [wall, can] of [[19, false], [20, true]] as const) {
  // 我是座位 0 的下家：上家打一萬，用二萬三萬吃
  setup("m2 m3 z7 z7 m5 m7 m9 p2 p4 p6 s2 s4 s6 s8 z1 z2", wall);
  await giveAndDiscard(0, "m1");
  eq([actors().includes(1), myView()], [can, can ? ["chi"] : []], `H1 可摸 ${wall - 16} 張：${can ? "可以吃" : "不能吃"}`);
  if (!can) {
    forceWindow(0, "m1");
    const r = await call(action, { playerId: "p1", actionType: "chi", tiles: [...handIds(1, "m2", 1), ...handIds(1, "m3", 1)] });
    eq([r.status, r.body.error], [400, "牌底不夠再摸一張，不能吃碰"], "H2 可摸 3 張硬送吃：400");
  } else {
    const r = await call(action, { playerId: "p1", actionType: "chi", tiles: [...handIds(1, "m2", 1), ...handIds(1, "m3", 1)] });
    eq([r.status, st().players[1].revealed[0]?.type], [200, "chi"], "H3 可摸 4 張：吃成功");
  }
}
for (const [wall, can] of [[20, false], [21, true]] as const) {
  setup("m1 m1 m1 z7 z7 m5 m7 p2 p4 p6 s2 s4 s6 s8 z1 z2", wall);
  await giveAndDiscard(3, "m1"); // 對家打（上家的牌本來就不能明槓）
  eq(myView(), can ? ["kong", "pong"] : ["pong"], `I1 可摸 ${wall - 16} 張：${can ? "可以明槓或碰" : "只能碰、不能明槓"}`);
  const r = await call(action, { playerId: "p1", actionType: "kong", tiles: handIds(1, "m1", 3) });
  if (can) eq([r.status, st().players[1].revealed[0]?.type, st().wall.length], [200, "kong", 20], "I2 可摸 5 張：明槓成功、補一張後剩 20");
  else eq([r.status, r.body.error, st().players[1].revealed.length], [400, "牌底不夠補牌再摸，不能明槓", 0], "I3 可摸 4 張硬送明槓：400，狀態沒變（仍可改碰）");
  if (!can) {
    const s = st();
    const ex = (() => { try { executeAction(s, { type: "kong", playerSeat: 1, tiles: s.players[1].hand.filter((x) => x.display === "m1") }); return "ok"; } catch (e) { return (e as Error).message; } })();
    eq(ex, "牌底不夠補牌再摸，不能明槓", "I4 executeAction 也擋下明槓");
    const p = await call(action, { playerId: "p1", actionType: "pong", tiles: handIds(1, "m1", 2) });
    eq([p.status, st().players[1].revealed[0]?.type], [200, "pong"], "I5 可摸 4 張改碰：成功");
  }
}
{
  // 胡不受影響：可摸 1 張也能胡
  setup("m1 m1 m2 m3 s1 s2 s3 s4 s5 s6 s7 s8 s9 p1 p2 p3", 17);
  await giveAndDiscard(2, "m1");
  eq(myView(), ["win"], "J1 可摸 1 張：照樣可以胡（但沒有碰）");
  // 暗槓照 canKongNow：摸完剩 17 張仍可暗槓
  setup("p5 p5 p5 z7 z7 m5 m7 m9 p2 p4 s2 s4 s6 s8 z1 z2", 18);
  const s = st();
  s.currentTurn = 1; s.wall[0] = t("p5");
  const d = await call(draw, { playerId: "p1" });
  const dt = sent.find((e) => e.event === "mj_draw_tile")?.payload as { canKong?: boolean } | undefined;
  eq([d.status, st().wall.length, dt?.canKong], [200, 17, true], "J2 暗槓不受新規則影響：剩 17 張照樣可以暗槓");
}
eq(leaks, [], "K1 碰的過水不出現在任何人的狀態或廣播裡");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
