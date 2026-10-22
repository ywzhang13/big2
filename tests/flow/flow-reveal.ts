// 胡牌攤牌的資料：winners[].winTile／from／waits，以及結束後 state 帶四家手牌（allHands），進行中不帶
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import type { MahjongGameState, Meld, WinnerEntry } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 60000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6";        // 聽 1/4/7 條
const W_SINGLE = "m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 p3 z3 z3 z3 s7";   // 單吊 7 條
const W_EDGE = "m1 m2 m3 m4 m5 m6 p1 p2 p3 z5 z5 z5 p5 p5 s8 s9";     // 邊張 7 條
const W_MID5P = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z1 z1 p4 p6";    // 中洞 5 筒
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";

function setup(mut?: (s: MahjongGameState) => void) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 3, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: true, isFirstRound: false, isAfterKong: false, stateVersion: 3,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  mut?.(s);
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const overEvent = () => sent.find((e) => e.event === "mj_game_over")!.payload as { winners: (WinnerEntry & { name: string })[]; allHands: unknown[] };
const brief = (w: WinnerEntry) => ({ seat: w.seat, winTile: w.winTile?.display, from: w.from, waits: w.waits?.map((x) => x.display) });
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// R1 放槍（seat3 打 7 條，seat1 胡）＋ seat2 有暗槓
{
  setup((s) => {
    s.players[1].hand = tiles(H16);
    s.players[2].revealed = [{ type: "concealed_kong", tiles: tiles("p9 p9 p9 p9") }];
    s.players[2].hand = tiles("m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z6");
    s.players[3].hand.push(t("s7"));
  });
  const d = await call(discard, { playerId: "p3", tileId: st().players[3].hand.find((x) => x.display === "s7")!.id });
  sent.length = 0;
  const w = await call(action, { playerId: "p1", actionType: "win" });
  const ev = overEvent();
  eq([d.status, w.status, ev.winners.map(brief)], [200, 200, [{ seat: 1, winTile: "s7", from: 3, waits: ["1條", "4條", "7條"] }]],
    "R1 放槍：winTile=7 條、from=3（放槍的人）、waits=1/4/7 條");
  const after = toPlayerGameState(st(), "p0");
  const hands = after.allHands!;
  eq([hands.length, hands.map((h) => h.hand.length), hands[2].revealed[0].type, hands[2].revealed[0].tiles.map((x) => x.display), JSON.stringify(hands) === JSON.stringify(ev.allHands)],
    [4, [16, 16, 13, 16], "concealed_kong", ["p9", "p9", "p9", "p9"], true],
    "R2 結束後 state：allHands 有四家手牌、暗槓給牌面，和 mj_game_over 的 allHands 完全一樣");
  eq((after.winners ?? []).map(brief), [{ seat: 1, winTile: "s7", from: 3, waits: ["1條", "4條", "7條"] }], "R3 結束後重新整理：state 的 winners 也有 winTile／from／waits");
  eq(hands[1].hand.some((x) => x.display === "s7"), false, "R4 贏家手牌不含胡的那張（胡的那張在 winTile）");
}
// R5 自摸
{
  setup((s) => { s.currentTurn = 1; s.hasDrawn = false; s.players[1].hand = tiles(H16); s.wall[0] = t("s4"); });
  await call(draw, { playerId: "p1" });
  sent.length = 0;
  await call(action, { playerId: "p1", actionType: "win" });
  eq(overEvent().winners.map(brief), [{ seat: 1, winTile: "s4", from: null, waits: ["1條", "4條", "7條"] }], "R5 自摸：winTile=摸到的 4 條、from=null");
  const h = toPlayerGameState(st(), "p0").allHands![1].hand;
  eq([h.length, h.some((x) => x.id === st().winners![0].winTile!.id)], [16, false], "R5b 自摸的贏家手牌也不含胡的那張（16 張），和放槍一致");
}
// R6 三響（seat3 打 7 條，seat0、1、2 都胡）
{
  setup((s) => {
    s.players[0].hand = tiles(H16); s.players[1].hand = tiles(W_SINGLE); s.players[2].hand = tiles(W_EDGE);
    s.players[3].hand.push(t("s7"));
  });
  await call(discard, { playerId: "p3", tileId: st().players[3].hand.find((x) => x.display === "s7")!.id });
  for (const p of ["p0", "p1", "p2"]) await call(action, { playerId: p, actionType: "win" });
  const ws = (st().winners ?? []).map(brief).sort((a, b) => a.seat - b.seat);
  eq(ws, [
    { seat: 0, winTile: "s7", from: 3, waits: ["1條", "4條", "7條"] },
    { seat: 1, winTile: "s7", from: 3, waits: ["7條"] },
    { seat: 2, winTile: "s7", from: 3, waits: ["7條"] },
  ], "R6 三響：三位贏家各一筆，winTile 都是 7 條、from 都是 3，waits 各自不同");
  eq(toPlayerGameState(st(), "p3").allHands?.length, 4, "R7 三響結束後 state 帶四家手牌");
}
// R8 搶槓胡（seat2 加槓 5 筒，seat1 搶）
{
  setup((s) => {
    s.currentTurn = 2; s.drawnTileId = 1;
    s.players[2].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5") }];
    s.players[2].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5");
    s.players[1].hand = tiles(W_MID5P);
  });
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [st().players[2].hand.find((x) => x.display === "p5")!.id] });
  sent.length = 0;
  await call(action, { playerId: "p1", actionType: "win" });
  eq(overEvent().winners.map(brief), [{ seat: 1, winTile: "p5", from: 2, waits: ["5筒"] }], "R8 搶槓胡：winTile=5 筒、from=2（加槓的人）、waits=5 筒");
}
// R9 七搶一（seat3 有 7 張花，seat1 摸到第 8 張，立刻成立；2026-10-22 起不用 seat3 按）
{
  setup((s) => { s.currentTurn = 1; s.hasDrawn = false; s.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6 f7"); s.wall[0] = t("f8"); });
  sent.length = 0;
  await call(draw, { playerId: "p1" });
  eq(overEvent().winners.map(brief), [{ seat: 3, winTile: "f8", from: 1, waits: [] }], "R9 七搶一：winTile=搶來的花、from=1（摸到花的人）、waits=[]");
}
// R10 八仙過海
{
  setup((s) => { s.currentTurn = 1; s.hasDrawn = false; s.players[1].flowers = tiles("f1 f2 f3 f4 f5 f6 f7"); s.wall[0] = t("f8"); });
  sent.length = 0;
  await call(draw, { playerId: "p1" });
  eq(overEvent().winners.map(brief), [{ seat: 1, winTile: "f8", from: null, waits: [] }], "R10 八仙過海：winTile=第 8 張花、from=null、waits=[]");
}
// R11 流局
{
  setup((s) => { s.currentTurn = 1; s.hasDrawn = false; s.wall = s.wall.slice(0, 16); });
  sent.length = 0;
  await call(draw, { playerId: "p1" });
  const ev = overEvent();
  const after = toPlayerGameState(st(), "p2");
  eq([st().status, ev.winners.length, ev.allHands.length, after.allHands?.length, after.allHands?.map((h) => h.hand.length)],
    ["finished", 0, 4, 4, [16, 16, 16, 16]], "R11 流局：mj_game_over 和結束後 state 都帶四家手牌，沒有贏家");
}
// R12 進行中：state 只給自己的手牌
{
  setup((s) => { s.players[1].hand = tiles(H16); s.players[2].revealed = [{ type: "concealed_kong", tiles: tiles("p9 p9 p9 p9") }]; });
  const v = toPlayerGameState(st(), "p0");
  const json = JSON.stringify(v);
  const otherIds = [1, 2, 3].flatMap((i) => st().players[i].hand.map((x) => x.id));
  const leaked = otherIds.filter((id) => new RegExp(`"id":${id}[,}]`).test(json));
  eq([v.allHands ?? null, leaked.length, v.hand?.length, v.players.every((p) => !("hand" in p))], [null, 0, 16, true],
    "R12 進行中：state 沒有 allHands、找不到任何別家手牌的 id，只有自己的 16 張");
}

// R13（審伯退件回歸）一砲多響還在等人決定時：重新整理拿不到 winTile／from／waits，結束後才有
{
  setup((s) => {
    s.players[0].hand = tiles(H16); s.players[1].hand = tiles(W_SINGLE); s.players[2].hand = tiles(W_EDGE);
    s.players[3].hand.push(t("s7"));
  });
  await call(discard, { playerId: "p3", tileId: st().players[3].hand.find((x) => x.display === "s7")!.id });
  const partial = await call(action, { playerId: "p1", actionType: "win" });
  const mid = toPlayerGameState(st(), "p0");
  const midJson = JSON.stringify(mid);
  eq([partial.body.partial, st().status, mid.winners?.map((w) => Object.keys(w).sort()), mid.winner ? Object.keys(mid.winner).sort() : null,
      midJson.includes("waits"), midJson.includes("winTile"), mid.allHands ?? null],
    [true, "playing", undefined, null, false, false, null],
    "R13 一砲多響 seat1 先胡、還在等其他人：state 完全不給 winners／winner（2026-10-22：最後算誰胡要看順位，不先公開先按的人），也沒有 waits／winTile／allHands");
  await call(action, { playerId: "p0", actionType: "win" });
  await call(action, { playerId: "p2", actionType: "win" });
  const done = toPlayerGameState(st(), "p0");
  eq([st().status, done.winners?.every((w) => w.waits && w.winTile && w.from === 3), done.allHands?.length], ["finished", true, 4],
    "R13b 全部決定完、這局結束：winners 才帶 waits／winTile／from，並有 allHands");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
