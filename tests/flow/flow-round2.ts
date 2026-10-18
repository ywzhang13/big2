// 第二批：⑦一般胡牌窗口資格 ④七搶一／八仙過海 API ⑤⑨剩 16 張不能槓 ⑧其他路由同時寫入
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { rooms, opts, stats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 20000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H_TWO = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1s/4s/7s
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const PONG_S7 = "s7 s7 m1 m3 m4 m6 m8 m9 p1 p3 p5 z1 z2 z3 z5 z6";

function setup(mut?: (s: MahjongGameState) => void, wallSize = 40) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(wallSize).fill("m2").join(" ")),
    currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 8,
    hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 3,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 1, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  mut?.(s);
  rooms.R = { id: "R", code: "T", game_state: s, status: s.status };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const count = (ev: string) => sent.filter((e) => e.event === ev).length;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// ⑦ 一般胡牌窗口：seat0 打 7 條，seat1 能胡、seat2 能碰，seat3 什麼都不能做
function discardWindow() {
  setup((s) => {
    s.currentTurn = 0;
    s.players[1].hand = tiles(H_TWO);
    s.players[2].hand = tiles(PONG_S7);
    s.lastDiscard = { tile: t("s7"), from: 0 };
    s.pendingActions = { discardFrom: 0, potentialActors: [1, 2], passedActors: [] };
  });
}
{
  discardWindow();
  eq((await call(action, { playerId: "p3", actionType: "win" })).status, 403, "⑦a 不在窗口名單的 seat3 送 win：403");
  eq((await call(action, { playerId: "p3", actionType: "pass" })).status, 403, "⑦b 不在窗口名單的 seat3 送 pass：403");
  eq((await call(action, { playerId: "p1", actionType: "pass" })).status, 200, "⑦c seat1 按「過」：200");
  eq((await call(action, { playerId: "p1", actionType: "win" })).status, 403, "⑦d seat1 過了之後改送胡：403（不能反悔）");
  eq([st().status, st().winners ?? null], ["playing", null], "⑦e 被擋下後沒有人胡，牌局照常");
  discardWindow();
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq([w.status, st().status], [200, "finished"], "⑦f 名單內、還沒決定的 seat1 胡：照常結算");
}

// ④ 七搶一：seat3 有 7 張花，seat1 摸到第 8 張
function flowerSetup() {
  setup((s) => {
    s.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
    s.wall[0] = t("f8");
  });
}
{
  flowerSetup();
  const r = await call(draw, { playerId: "p1" });
  const avail = sent.find((e) => e.event === "mj_available_actions")!;
  eq([r.status, r.body.flowerRob, st().pendingFlowerRob?.robberSeat, count("mj_flower_rob_pending"), avail.payload],
    [200, true, 3, 1, { playerId: "p3", actions: [{ type: "win", playerSeat: 3 }], robFlower: true }],
    "④a 摸到第 8 張花：draw 回 flowerRob=true，廣播 mj_flower_rob_pending，並給 seat3 win＋robFlower");
  const drawTileEv = sent.find((e) => e.event === "mj_draw_tile")!.payload;
  eq([drawTileEv.canWin, drawTileEv.canKong], [false, false], "④b 等待七搶一時，摸牌的人不會拿到自摸／槓選項");
  eq((await call(discard, { playerId: "p1", tileId: st().players[1].hand[0].id })).status, 409, "④c 等待中摸牌的人不能打牌");
  eq((await call(action, { playerId: "p2", actionType: "win" })).status, 409, "④d 等待中其他人送 win：409");
  sent.length = 0;
  const w = await call(action, { playerId: "p3", actionType: "win" });
  eq([w.status, st().status, rooms.R.status, st().settlement?.deltas, st().playerScores, count("mj_game_over"), (sent[0].payload as { winners: { score: { fans: unknown } }[] }).winners[0].score.fans],
    [200, "finished", "finished", [-320, -260, -260, 840], [-320, -260, -260, 840], 1,
      [{ name: "七搶一", value: 8 }, { name: "莊家(斷)", value: 1 }, { name: "連1", value: 1 }, { name: "拉1", value: 1 }]],
    "④e seat3 搶：七搶一胡，閒家各付 260、莊家另加 1+連1+拉1 付 320");
}
{
  flowerSetup();
  await call(draw, { playerId: "p1" });
  sent.length = 0;
  const p = await call(action, { playerId: "p3", actionType: "pass" });
  const dt = sent.find((e) => e.event === "mj_draw_tile")!.payload;
  eq([p.status, st().pendingFlowerRob ?? null, sent.map((e) => e.event), dt.playerId], [200, null, ["mj_pass", "mj_draw", "mj_draw_tile"], "p1"],
    "④f seat3 不搶：清掉等待，重送 seat1 的摸牌事件（含自摸／槓選項）");
  eq((await call(discard, { playerId: "p1", tileId: st().players[1].hand.find((x) => x.display === "z6")!.id })).status, 200, "④g 之後 seat1 可以正常打牌");
}
{
  setup((s) => { s.players[1].flowers = tiles("f1 f2 f3 f4 f5 f6 f7"); s.wall[0] = t("f8"); });
  const r = await call(draw, { playerId: "p1" });
  eq([r.status, st().status, rooms.R.status, st().settlement?.deltas, count("mj_game_over"), (sent[0].payload as { winnerSeat: number }).winnerSeat],
    [200, "finished", "finished", [-320, 840, -260, -260], 1, 1], "④h 自己摸到第 8 張花：八仙過海立刻結束，閒家各付 260、莊家付 320（連 1）");
}
{
  setup((s) => {
    s.hasDrawn = true; s.drawnTileId = 1;
    s.players[1].flowers = tiles("f1 f2 f3 f4 f5 f6 f7");
    s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 p5 z6 z6");
    s.wall[s.wall.length - 1] = t("f8");
  });
  const r = await call(action, { playerId: "p1", actionType: "kong", tiles: st().players[1].hand.filter((x) => x.display === "p5").map((x) => x.id) });
  eq([r.status, st().status, sent.map((e) => e.event)], [200, "finished", ["mj_action", "mj_game_over"]], "④i 暗槓補到第 8 張花：八仙過海，廣播 暗槓＋結束");
}

// ⑤⑨ 剩 16 張不能槓（API）
{
  setup((s) => { s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 z6 z6"); s.wall[0] = t("p5"); }, 17);
  const r = await call(draw, { playerId: "p1" });
  const dt = sent.find((e) => e.event === "mj_draw_tile")!.payload;
  eq([r.status, st().wall.length, dt.canKong, dt.kongOptions], [200, 16, false, []], "⑤a 摸完剩 16 張、手上 4 張 5 筒：不提供暗槓");
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: st().players[1].hand.filter((x) => x.display === "p5").map((x) => x.id) });
  eq([k.status, k.body.error, st().players[1].revealed.length, st().wall.length], [400, "牌牆剩 16 張，不能再槓", 0, 16], "⑨a 硬送暗槓：400，狀態沒變（不會卡住）");
}
{
  setup((s) => {
    s.currentTurn = 0;
    s.players[2].hand = tiles("p5 p5 p5 m1 m2 m3 s1 s2 s3 z1 z1 z2 z2 z3 z3 z6");
    s.lastDiscard = { tile: t("p5"), from: 0 };
    s.pendingActions = { discardFrom: 0, potentialActors: [2], passedActors: [] };
  }, 16);
  const k = await call(action, { playerId: "p2", actionType: "kong", tiles: st().players[2].hand.filter((x) => x.display === "p5").map((x) => x.id) });
  eq([k.status, st().players[2].revealed.length], [400, 0], "⑨b 剩 16 張硬送明槓：400，狀態沒變");
  const p = await call(action, { playerId: "p2", actionType: "pong", tiles: st().players[2].hand.filter((x) => x.display === "p5").slice(0, 2).map((x) => x.id) });
  // 2026-10-19 起牌底不夠再摸一張就不能碰（吃碰要可摸 ≥4 張），剩 16 張改碰也擋下；可摸 4 張能碰、5 張才能明槓見 flow-claim-limits
  eq([p.status, p.body.error, st().players[2].revealed.length], [400, "牌底不夠再摸一張，不能吃碰", 0], "⑨c 同一張牌改碰：牌底不夠，也是 400、狀態沒變");
}

// ⑧ 其他路由同時寫入：每種 30 次，對照組關掉樂觀鎖
const RUNS = 30;
async function race(unsafe: boolean) {
  opts.unsafe = unsafe;
  stats.conflicts = 0;
  const fail = { nextGame: 0, leaveVote: 0, draw: 0, discard: 0 };
  for (let i = 0; i < RUNS; i++) {
    opts.delayMs = 1 + (i % 8);
    // 下一局：四家同時按同意 → 只開一局
    setup((s) => { s.status = "finished"; s.winners = [{ seat: 1, score: { fans: [], totalFan: 1 } }]; s.winner = s.winners[0]; });
    const ng = await Promise.all([0, 1, 2, 3].map((k) => call(nextGame, { playerId: "p" + k })));
    if (!(ng.every((r) => r.status === 200) && st().status === "playing" && count("mj_game_start") === 1)) fail.nextGame++;
    // 離開投票：三家同時同意 → 只成立一次
    setup((s) => { s.leaveRequest = { requesterId: "p0", requesterName: "P0", requesterSeat: 0, approvedBy: [], deniedBy: [] }; });
    const lv = await Promise.all([1, 2, 3].map((k) => call(leaveVote, { playerId: "p" + k, approve: true })));
    const granted = sent.filter((e) => e.event === "mj_leave_vote" && e.payload.result === "granted").length;
    // 通過後這場解散、房間會被刪掉（2026-10 對局紀錄：解散就關房）
    if (!(lv.every((r) => r.status === 200) && !rooms.R && granted === 1)) fail.leaveVote++;
    // 摸牌連點兩下 → 只摸一張
    setup();
    const dr = await Promise.all([call(draw, { playerId: "p1" }), call(draw, { playerId: "p1" })]);
    if (!(dr.filter((r) => r.status === 200).length === 1 && st().wall.length === 39 && st().players[1].hand.length === 17 && count("mj_draw_tile") === 1)) fail.draw++;
    // 打牌連點兩張 → 只打出一張
    setup((s) => { s.hasDrawn = true; s.players[1].hand.push(t("z7")); });
    const h = st().players[1].hand;
    const dc = await Promise.all([call(discard, { playerId: "p1", tileId: h[15].id }), call(discard, { playerId: "p1", tileId: h[16].id })]);
    if (!(dc.filter((r) => r.status === 200).length === 1 && st().players[1].hand.length === 16 && st().players[1].discards.length === 2 && count("mj_discard") === 1)) fail.discard++;
  }
  opts.unsafe = false; opts.delayMs = 5;
  return { fail, conflicts: stats.conflicts };
}
{
  const safe = await race(false);
  eq(safe.fail, { nextGame: 0, leaveVote: 0, draw: 0, discard: 0 },
    `⑧a 修好後：下一局四家同時同意、離開三家同時同意、摸牌連點、打牌連點各 ${RUNS} 次全部正確（樂觀鎖擋下並重做 ${safe.conflicts} 次）`);
  const unsafe = await race(true);
  eq(Object.values(unsafe.fail).every((n) => n > 0), true,
    `⑧b 對照組（關掉樂觀鎖＝修之前）：下一局錯 ${unsafe.fail.nextGame}、離開投票錯 ${unsafe.fail.leaveVote}、摸牌錯 ${unsafe.fail.draw}、打牌錯 ${unsafe.fail.discard} 次`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
