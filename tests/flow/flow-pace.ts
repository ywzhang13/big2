// 牌局節奏（老闆 2026-10-17）：補花、眼牌摸牌的特效播完之前，下一家不能摸牌、別人不能吃碰胡搶先；以伺服器時間為準。
//   G1～G4 補花：摸到花等 1 秒；連續補兩張還是 1 秒；等待期間自己打牌、下一家摸牌都等到時間到才處理
//   G5～G9 眼牌摸牌：不能胡自動打出 → 等 1.8 秒；期間下一家摸牌、別家碰都要等；能胡自動胡；眼牌又補到花 2.8 秒
//   G10～G12 不卡住：沒有特效不用等；伺服器時間異常最多等 4 秒；開局多家補花依序
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { paceClock, dealPaceMs, FLOWER_FX_MS, EYE_DRAW_MS, PACE_MAX_WAIT_MS } from "../../lib/mahjong/pace";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";
import { toPublicGameState } from "../../lib/mahjong/db";

// 假時鐘：sleep 只記錄要等多久並把時間往前推，不真的等
let now = 1_000_000;
const sleeps: number[] = [];
paceClock.now = () => now;
paceClock.sleep = async (ms: number) => { sleeps.push(ms); now += ms; };

let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const PONG_M2 = "m2 m2 m1 m3 m4 m6 m8 m9 p1 p3 p5 z1 z2 z3 z5 z6"; // 能碰 2 萬

function setup(opts: { turn: number; wallTop: string[]; wallEnd?: string[]; eye?: number[] }) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall: [...opts.wallTop.map(t), ...tiles(Array(40).fill("p2").join(" ")), ...(opts.wallEnd ?? []).map(t)], // 補花從牌尾補
    currentTurn: opts.turn, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
    eyeSeats: opts.eye ?? [],
  } as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0; sleeps.length = 0;
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

// ---------------- 補花 ----------------
{
  setup({ turn: 1, wallTop: ["f1"], wallEnd: ["m5"] });
  const t0 = now;
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, st().players[1].flowers.length, st().paceUntil! - t0, sleeps], [200, 1, FLOWER_FX_MS, []], "G1 摸到花：補花後記下 1 秒的等待（paceUntil＝現在＋1000），摸牌本身不用等");
  now += 300;
  const tile = st().players[1].hand.find((x) => x.id === st().drawnTileId)!;
  const dis = await call(discard, { playerId: "p1", tileId: tile.id });
  eq([dis.status, sleeps, now - t0, st().lastDiscard?.tile.display], [200, [700], 1000, "m5"], "G2 補花特效播放中（0.3 秒）自己打牌：伺服器等剩下的 0.7 秒才處理，打出成功");
}
{
  setup({ turn: 1, wallTop: ["f2"], wallEnd: ["m5", "f3"] }); // 摸到 f2 → 牌尾補到 f3 → 再補 m5
  const t0 = now;
  await call(draw, { playerId: "p1" });
  eq([st().players[1].flowers.length, st().paceUntil! - t0], [2, FLOWER_FX_MS], "G3 一次連續補到兩張花：同一家合成一顆膠囊，還是等 1 秒");
}
{
  // 下一家：seat1 補花後馬上打出（等完 1 秒），seat2 在補花期間就搶著摸 → 要等
  setup({ turn: 1, wallTop: ["f4"], wallEnd: ["m5"] });
  const t0 = now;
  await call(draw, { playerId: "p1" });
  // 模擬 seat1 已打出、輪到 seat2，但補花特效還在播（paceUntil 還沒到）
  const s = st(); const m5 = s.players[1].hand.find((x) => x.id === s.drawnTileId)!;
  s.players[1].hand = s.players[1].hand.filter((x) => x.id !== m5.id); s.players[1].discards.push(m5);
  s.currentTurn = 2; s.hasDrawn = false; s.drawnTileId = undefined; s.lastDiscard = null; s.pendingActions = undefined;
  now = t0 + 100;
  const d2 = await call(draw, { playerId: "p2" });
  eq([d2.status, sleeps, now - t0], [200, [900], 1000], "G4 補花特效播放中下一家就來摸牌：伺服器等到 1 秒播完才讓他摸");
}

// ---------------- 眼牌摸牌 ----------------
{
  setup({ turn: 1, wallTop: ["m2"], eye: [1] });
  st().players[1].hand = tiles(H16);
  st().players[2].hand = tiles(PONG_M2);
  const t0 = now;
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, d.body.autoDiscarded?.display, st().lastDiscard?.tile.display, st().paceUntil! - t0], [200, "m2", "m2", EYE_DRAW_MS],
    "G5 眼牌的人摸到不能胡的牌：伺服器自動打出，並記下 1.8 秒（翻牌 0.8＋停 1）的等待");
  now = t0 + 500;
  const twoM2 = st().players[2].hand.filter((x) => x.display === "m2").slice(0, 2).map((x) => x.id);
  const pong = await call(action, { playerId: "p2", actionType: "pong", tiles: twoM2 });
  eq([pong.status, sleeps, now - t0, st().players[2].revealed.length], [200, [1300], EYE_DRAW_MS, 1],
    "G6 翻牌期間（0.5 秒）別家搶著碰：伺服器等到 1.8 秒播完才處理，碰照常成立");
}
{
  setup({ turn: 1, wallTop: ["m2"], eye: [1] });
  st().players[1].hand = tiles(H16);
  const t0 = now;
  await call(draw, { playerId: "p1" });
  // 沒人能吃碰：輪到 seat2，翻牌中就送摸牌
  const s = st(); s.pendingActions = undefined; s.currentTurn = 2; s.hasDrawn = false; s.drawnTileId = undefined; s.lastDiscard = null;
  now = t0 + 200;
  const d2 = await call(draw, { playerId: "p2" });
  eq([d2.status, sleeps, now - t0], [200, [1600], EYE_DRAW_MS], "G7 眼牌翻牌期間下一家摸牌：等到 1.8 秒後才摸到");
}
{
  setup({ turn: 1, wallTop: ["s4"], eye: [1] });
  st().players[1].hand = tiles(H16);
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, d.body.autoWin, st().status], [200, true, "finished"], "G8 眼牌的人摸到能胡的牌：自動胡、這局結束（之後只剩下一局，不受等待影響）");
}
{
  setup({ turn: 1, wallTop: ["f5"], wallEnd: ["m2"], eye: [1] });
  st().players[1].hand = tiles(H16);
  const t0 = now;
  const d = await call(draw, { playerId: "p1" });
  eq([d.body.autoDiscarded?.display, st().paceUntil! - t0], ["m2", FLOWER_FX_MS + EYE_DRAW_MS], "G9 眼牌的人先補到花再摸到不能胡的牌：補花 1 秒＋翻牌 1.8 秒＝2.8 秒");
}

// ---------------- 不卡住 ----------------
{
  setup({ turn: 1, wallTop: ["m5"] });
  const d = await call(draw, { playerId: "p1" });
  const tile = st().players[1].hand.find((x) => x.display === "m5")!;
  const dis = await call(discard, { playerId: "p1", tileId: tile.id });
  eq([d.status, dis.status, st().paceUntil, sleeps], [200, 200, undefined, []], "G10 一般摸牌（沒補花、不是眼牌）：不記等待，打牌也不用等");
}
{
  setup({ turn: 1, wallTop: ["m5"] });
  st().paceUntil = now + 60_000; // 時鐘異常、或舊狀態留下很遠的時間
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, sleeps[0]], [200, PACE_MAX_WAIT_MS], "G11 等待時間異常（60 秒）：最多等 4 秒就照常處理，不會卡住");
}
{
  const s = { players: [0, 1, 2, 3].map((i) => ({ flowers: i === 2 ? [] : [t("f1")] })) } as unknown as MahjongGameState;
  eq([dealPaceMs(s), dealPaceMs({ players: [{ flowers: [] }] } as unknown as MahjongGameState)], [1240, 0],
    "G12 開局 3 家起手有花：依序錯開 0.12 秒，共 1.24 秒才能打第一張；沒人有花不用等");
}

{
  setup({ turn: 1, wallTop: ["f6"], wallEnd: ["m5"] });
  await call(draw, { playerId: "p1" });
  const pub = toPublicGameState(st());
  const ev = sent.find((e) => e.event === "mj_draw");
  eq([pub.paceUntil === st().paceUntil, typeof pub.serverNow, ev ? "有 mj_draw" : "沒有"], [true, "number", "有 mj_draw"],
    "G13 公開狀態帶 paceUntil 和伺服器現在時間 serverNow（前端用來對時、決定畫面何時往下走），廣播照舊");
}

// ---------------- 每個請求累計最多等 4 秒、只等一次（審伯 2026-10-17 退件項）----------------
// paceUntil 異常在 60 秒後：每條入口都只能 sleep 一次、總和 ≤ 4000ms，之後用最新狀態照常處理（不再重新等）
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
{
  setup({ turn: 1, wallTop: ["m5"] });
  st().paceUntil = now + 60_000;
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, sleeps.length, sum(sleeps) <= PACE_MAX_WAIT_MS, st().hasDrawn], [200, 1, true, true], "G14 draw：paceUntil 異常 60 秒，只 sleep 1 次、總和 ≤ 4 秒，之後照常摸牌");
}
{
  setup({ turn: 1, wallTop: ["m5"] });
  const s = st(); const tile = t("m5"); s.players[1].hand.push(tile); s.hasDrawn = true; s.drawnTileId = tile.id;
  s.paceUntil = now + 60_000;
  const dis = await call(discard, { playerId: "p1", tileId: tile.id });
  eq([dis.status, sleeps.length, sum(sleeps) <= PACE_MAX_WAIT_MS, st().lastDiscard?.tile.id], [200, 1, true, tile.id], "G15 discard：paceUntil 異常 60 秒，只 sleep 1 次、總和 ≤ 4 秒，之後照常打出");
}
{
  setup({ turn: 1, wallTop: ["m2"], eye: [1] });
  st().players[1].hand = tiles(H16);
  st().players[2].hand = tiles(PONG_M2);
  await call(draw, { playerId: "p1" }); // 眼牌自動打出二萬，seat2 可以碰
  st().paceUntil = now + 60_000; sleeps.length = 0;
  const twoM2 = st().players[2].hand.filter((x) => x.display === "m2").slice(0, 2).map((x) => x.id);
  const pong = await call(action, { playerId: "p2", actionType: "pong", tiles: twoM2 });
  eq([pong.status, sleeps.length, sum(sleeps) <= PACE_MAX_WAIT_MS, st().players[2].revealed.length], [200, 1, true, 1], "G16 action（碰）：paceUntil 異常 60 秒，只 sleep 1 次、總和 ≤ 4 秒，之後照常碰");
}
{
  setup({ turn: 1, wallTop: ["m5"] });
  st().paceUntil = now + 60_000;
  const wrong = await call(draw, { playerId: "p3" }); // 不是他的回合：等完照常用權限和牌局條件擋下
  eq([wrong.status, sleeps.length], [400, 1], "G17 等完之後照正常條件處理：不是輪到的人摸牌照樣 400，也只等 1 次");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
