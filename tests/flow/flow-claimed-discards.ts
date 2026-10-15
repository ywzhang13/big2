// 被吃、碰、明槓拿走（或放槍被胡走）的牌，不再顯示在打出那家的海底；牌局狀態裡的打牌紀錄不變（地聽、地胡、過水照舊）
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";
import { canDeclareTingNow } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const FILLER = "m1 m1 m3 m4 m6 m7 m8 s7 s1 s3 s5 s9 z1 z2 z3 z7"; // 沒有九萬、五萬
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
function setup(firstRound = false) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(FILLER), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("s8").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: firstRound ? 0 : 8, hasDrawn: false, isFirstRound: firstRound, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  if (!firstRound) for (const p of s.players) p.discards = tiles("z6");
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
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
/** seat 摸進 key 後馬上打出它 */
async function giveAndDiscard(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  await call(discard, { playerId: "p" + seat, tileId: tile.id });
  return tile;
}
const ids = (ts: Tile[]) => ts.map((x) => x.id);
const pub = () => toPublicGameState(st());
/** 公開畫面上（海底＋吃碰槓）這張牌出現幾次 */
const shown = (id: number) => pub().players.reduce((n, p) => n + ids(p.discards).filter((x) => x === id).length + p.revealed.flatMap((m) => ids(m.tiles)).filter((x) => x === id).length, 0);
/** 四家重新整理後看到的海底都一樣 */
const sameForAll = () => new Set([0, 1, 2, 3].map((v) => JSON.stringify(toPlayerGameState(st(), "p" + v).players.map((p) => ids(p.discards))))).size === 1;

// ---- 碰（老闆截圖的情況：碰九萬後全場只看得到 3＋其他，不會多一張） ----
{
  setup();
  st().players[3].hand = tiles("m9 m9 m3 m4 m6 m7 m8 s7 s1 s3 s5 s9 z1 z2 z3 z7");
  const before = st().players[0].discards.length;
  const nine = await giveAndDiscard(0, "m9");
  const shownBefore = pub().players.flatMap((p) => [...p.discards, ...p.revealed.flatMap((m) => m.tiles)]).filter((x) => x.display === "m9").length;
  const r = await call(action, { playerId: "p3", actionType: "pong", tiles: st().players[3].hand.filter((x) => x.display === "m9").map((x) => x.id) });
  const nines = pub().players.flatMap((p) => [...p.discards, ...p.revealed.flatMap((m) => m.tiles)]).filter((x) => x.display === "m9").length;
  eq([r.status, ids(pub().players[0].discards).includes(nine.id), ids(pub().players[3].revealed[0].tiles).includes(nine.id), shown(nine.id), shownBefore, nines],
    [200, false, true, 1, 1, 3], "C1 碰九萬：打出那家的海底不再有那張，碰的那家吃碰區有；那張全場只出現一次（碰完畫面上九萬共 3 張，不會變 4、5 張）");
  eq([st().players[0].discards.length, ids(st().players[0].discards).includes(nine.id)], [before + 1, true], "C2 牌局狀態裡的打牌紀錄不變（還是記著打過這張），只有輸出給畫面時濾掉");
  eq(sameForAll(), true, "C3 四家重新整理後看到的海底一致");
}
// ---- 吃 ----
{
  setup();
  st().players[1].hand = tiles("m4 m6 m1 m3 m7 m8 s7 s1 s3 s5 s9 z1 z2 z3 z7 z7");
  const five = await giveAndDiscard(0, "m5");
  const r = await call(action, { playerId: "p1", actionType: "chi", tiles: st().players[1].hand.filter((x) => x.display === "m4" || x.display === "m6").map((x) => x.id) });
  eq([r.status, ids(pub().players[0].discards).includes(five.id), shown(five.id), sameForAll()], [200, false, 1, true], "C4 吃：被吃的那張不在海底、在吃的那家吃碰區，全場只出現一次，四家一致");
}
// ---- 明槓 ----
{
  setup();
  st().players[2].hand = tiles("z5 z5 z5 m1 m3 m4 m6 m7 m8 s7 s1 s3 s5 s9 z1 z2");
  const red = await giveAndDiscard(0, "z5");
  const r = await call(action, { playerId: "p2", actionType: "kong", tiles: st().players[2].hand.filter((x) => x.display === "z5").map((x) => x.id) });
  eq([r.status, st().players[2].revealed[0]?.type, ids(pub().players[0].discards).includes(red.id), shown(red.id), sameForAll()], [200, "kong", false, 1, true],
    "C5 明槓：被槓的那張不在海底、在槓的那家，全場只出現一次，四家一致");
}
// ---- 放槍：被胡走的那張也不在海底，攤牌只在贏家那邊出現一次 ----
{
  setup();
  st().players[1].hand = tiles(WAIT25);
  const five = await giveAndDiscard(0, "m5");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  const p = pub();
  const inHands = (p.allHands ?? []).flatMap((h) => ids(h.hand)).filter((x) => x === five.id).length;
  eq([w.status, p.status, p.winners?.[0]?.winTile?.id === five.id, ids(p.players[0].discards).includes(five.id), inHands], [200, "finished", true, false, 0],
    "C6 放槍：胡走的那張只當成贏家的胡牌顯示，不在放槍那家的海底，也不在攤牌的手牌裡（不重複）");
  eq(ids(st().players[0].discards).includes(five.id), true, "C7 放槍那家的打牌紀錄不變");
}
// ---- 第一輪被碰：地聽、地胡的判斷用的是打牌紀錄，和修改前一樣 ----
{
  setup(true);
  st().players[2].hand = tiles("z5 z5 m1 m3 m4 m6 m7 m8 s7 s1 s3 s5 s9 z1 z2 z7");
  const first = await giveAndDiscard(0, "z5"); // 莊家第一張
  await call(action, { playerId: "p2", actionType: "pong", tiles: st().players[2].hand.filter((x) => x.display === "z5").map((x) => x.id) });
  const s = st();
  eq([s.players[0].discards.length, ids(pub().players[0].discards).includes(first.id), pub().players[0].discards.length], [1, false, 0],
    "C8 莊家第一張被碰：打牌紀錄仍是 1 張（系統知道莊家打過牌），畫面上海底是空的");
  eq([0, 1, 2, 3].map((seat) => canDeclareTingNow({ ...s, currentTurn: seat, hasDrawn: true, lastDiscard: null, pendingActions: undefined } as MahjongGameState, seat)), [false, false, false, false],
    "C9 第一輪有人碰過：四家都不能再地聽（和修改前一樣，地胡也同樣因有人碰而不成立）");
}
// ---- 過水：自己打出聽的牌被別人碰走，照樣過水 ----
{
  setup();
  st().players[1].hand = tiles(WAIT25);
  st().players[2].hand = tiles("m5 m5 m1 m3 m4 m6 m7 m8 s7 s1 s3 s5 s9 z1 z2 z7");
  const s = st();
  const five = t("m5"); s.players[1].hand.push(five);
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = five.id;
  await call(discard, { playerId: "p1", tileId: five.id });
  const gs1 = [...(st().guoShuiSeats ?? [])];
  const r = await call(action, { playerId: "p2", actionType: "pong", tiles: st().players[2].hand.filter((x) => x.display === "m5").map((x) => x.id) });
  eq([gs1, r.status, st().guoShuiSeats, ids(pub().players[1].discards).includes(five.id)], [[1], 200, [1], false],
    "C10 打出自己聽的五萬（過水）被下家碰走：海底不顯示那張，過水照樣成立");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
