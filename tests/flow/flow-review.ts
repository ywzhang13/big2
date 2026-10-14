// 審伯退件三項：①搶槓決定同時送出 ②搶槓資格 ③沒牌可補的加槓收尾
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms, opts, stats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

let nextId = 9000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const W_MID = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z1 z1 p4 p6";
const W_TWO = "m1 m2 m3 m4 m5 m6 s4 s5 s6 s7 s8 s9 z4 z4 p3 p4";
const W_SINGLE = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z3 z3 z3 p5";
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 z2 z3";

function setup(others: Record<number, string>, wallSize = 40) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(others[seat] ?? NOT_WAIT), revealed: [] as Meld[], flowers: [], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(wallSize).fill("m2").join(" ")),
    currentTurn: 2, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 8,
    hasDrawn: true, isFirstRound: false, isAfterKong: false, stateVersion: 7,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[2].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5") }];
  s.players[2].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5");
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
  return s.players[2].hand.find((x) => x.display === "p5")!.id;
}
async function call(body: object) {
  const r = await action(new Request("http://x", { method: "POST", body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const count = (ev: string) => sent.filter((e) => e.event === ev).length;
async function openWindow(others: Record<number, string>) {
  const id = setup(others);
  await call({ playerId: "p2", actionType: "add_kong", tiles: [id] });
  sent.length = 0;
}
const both = (a: object, b: object) => Promise.all([call(a), call(b)]);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// ① 同時送出：每種情況跑 30 次，讀寫延遲隨機 1–8ms、送出順序也輪流
const RUNS = 30;
async function race(unsafe: boolean) {
  opts.unsafe = unsafe;
  const fail = { winwin: 0, winpass: 0, passpass: 0 };
  stats.conflicts = 0;
  for (let i = 0; i < RUNS; i++) {
    opts.delayMs = 1 + (i % 8);
    const flip = i % 2 === 1;
    const order = <T>(a: T, b: T): [T, T] => (flip ? [b, a] : [a, b]);

    // win+win（三家能搶：seat1、seat3 同時胡，之後 seat0 pass）
    await openWindow({ 0: W_SINGLE, 1: W_MID, 3: W_TWO });
    const ww = await both(...order({ playerId: "p1", actionType: "win" }, { playerId: "p3", actionType: "win" }));
    const winnersMid = (st().winners ?? []).map((w) => w.seat).sort();
    const passedMid = [...(st().pendingActions?.passedActors ?? [])].sort();
    await call({ playerId: "p0", actionType: "pass" });
    const okWW = ww.every((r) => r.status === 200) && JSON.stringify(winnersMid) === "[1,3]" && JSON.stringify(passedMid) === "[1,3]"
      && st().status === "finished" && count("mj_game_over") === 1 && count("mj_add_kong") === 0
      && JSON.stringify(st().settlement?.deltas) === "[0,0,-140,140]";
    if (!okWW) fail.winwin++;

    // win+pass（兩家能搶：seat1 胡、seat3 pass）
    await openWindow({ 1: W_MID, 3: W_TWO });
    const wp = await both(...order({ playerId: "p1", actionType: "win" }, { playerId: "p3", actionType: "pass" }));
    const okWP = wp.every((r) => r.status === 200) && st().status === "finished" && count("mj_game_over") === 1
      && count("mj_add_kong") === 0 && st().players[2].revealed[0].type === "pong"
      && JSON.stringify(st().settlement?.deltas) === "[0,160,-160,0]";
    if (!okWP) fail.winpass++;

    // pass+pass（兩家能搶：都 pass）→ 槓只完成一次
    await openWindow({ 1: W_MID, 3: W_TWO });
    const pp = await both(...order({ playerId: "p1", actionType: "pass" }, { playerId: "p3", actionType: "pass" }));
    const p = st().players[2];
    const okPP = pp.every((r) => r.status === 200) && !st().pendingAddKong && count("mj_add_kong") === 1
      && p.revealed.length === 1 && p.revealed[0].type === "kong" && p.revealed[0].tiles.length === 4
      && p.hand.length === 14 && st().wall.length === 39 && st().status === "playing" && st().currentTurn === 2;
    if (!okPP) fail.passpass++;
  }
  return { fail, conflicts: stats.conflicts };
}
{
  const safe = await race(false);
  eq(safe.fail, { winwin: 0, winpass: 0, passpass: 0 }, `①a 修好後：win+win／win+pass／pass+pass 各同時送出 ${RUNS} 次，全部正確（期間樂觀鎖擋下並重做 ${safe.conflicts} 次寫入衝突）`);
  const unsafe = await race(true);
  eq(unsafe.fail.winwin + unsafe.fail.winpass + unsafe.fail.passpass > 0, true,
    `①b 對照組：關掉樂觀鎖（=修之前）同樣情境會出錯，win+win 錯 ${unsafe.fail.winwin}、win+pass 錯 ${unsafe.fail.winpass}、pass+pass 錯 ${unsafe.fail.passpass} 次（證明測試抓得到這個問題）`);
  opts.unsafe = false; opts.delayMs = 5;
}

// ② 資格：只有名單內、還沒決定的人能送 win／pass
{
  await openWindow({ 1: W_MID, 3: W_TWO });
  eq((await call({ playerId: "p0", actionType: "win" })).status, 403, "②a 不在搶槓名單的 seat0 送 win：403");
  eq((await call({ playerId: "p0", actionType: "pass" })).status, 403, "②b 不在搶槓名單的 seat0 送 pass：403");
  eq((await call({ playerId: "p3", actionType: "pass" })).status, 200, "②c 名單內的 seat3 pass：200");
  eq((await call({ playerId: "p3", actionType: "win" })).status, 403, "②d seat3 已經 pass 又送 win：403");
  eq([st().status, st().pendingAddKong?.seat], ["playing", 2], "②e 被擋下的請求沒有改到窗口（還在等 seat1）");
  await openWindow({ 1: W_MID, 3: W_TWO, 0: W_SINGLE });
  eq((await call({ playerId: "p1", actionType: "win" })).body.partial, true, "②f seat1 胡（還在等其他人）");
  eq((await call({ playerId: "p1", actionType: "pass" })).status, 403, "②g seat1 已經胡了又送 pass：403");
  eq((await call({ playerId: "p1", actionType: "win" })).status, 403, "②h seat1 重複送 win：403");
}

// ③ 牌牆沒牌可補（2026-10 老闆規則：剩 16 張就不能槓，所以 API 會先擋下；收尾仍要能安全結束）
{
  const id = setup({}, 0);
  const r = await call({ playerId: "p2", actionType: "add_kong", tiles: [id] });
  eq([r.status, r.body.error, st().status, st().players[2].revealed[0].type, sent.length],
    [400, "牌牆剩 16 張，不能再槓", "playing", "pong", 0], "③a 牌牆不夠時送加槓：400 擋下，狀態沒變、沒有廣播");
}
{
  const s0 = setup({ 1: W_MID }, 40);
  await call({ playerId: "p2", actionType: "add_kong", tiles: [s0] });
  rooms.R.game_state.wall = []; // 窗口開著時牌牆被用完（正常打不會發生，只驗證收尾安全）
  sent.length = 0;
  const r = await call({ playerId: "p1", actionType: "pass" });
  eq([r.status, st().status, rooms.R.status, st().settlement?.reason, st().pendingAddKong ?? null, count("mj_game_over"), count("mj_draw_tile")],
    [200, "finished", "finished", "draw", null, 1, 0], "③b 窗口中 pass 後沒牌可補：流局結束，不會卡在窗口");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
