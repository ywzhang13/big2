// 帳號專屬的自摸特效（老闆 2026-10-25「隕石自摸」）：設定表裡的帳號自摸時，胡牌紀錄帶公開代號 winFx
//   F1 指定帳號（座位 1）手動自摸：winners[0].winFx="meteor"，mj_game_over 廣播、重新整理讀到的 state（另一家看）都有
//   F2 指定帳號胡別人打的牌：沒有 winFx
//   F3 其他人自摸：沒有 winFx
//   F4 指定帳號大牌自摸（大三元）：照樣有 winFx
//   F5 指定帳號眼牌、伺服器自動自摸：也有 winFx
//   F7 公開座位資料帶代號（開局就能預載）：牌局中讀 state，指定帳號那個座位 players[i].winFx="meteor"、其他座位沒有；
//      開局廣播 mj_game_start 的 players 也一樣（開局會隨機排座位，用玩家 id 對）
//   F6 全部廣播和 state 回應裡都沒有帳號 id（userId）（含 F7 的回應）
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { POST as start } from "../../app/api/mahjong/start/route";
import { rooms, seats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72"; // lib/mahjong/winFx.ts 設定表裡的帳號
tokens.boss = { id: BOSS, displayName: null, pictureUrl: null, isGuest: false };
let nextId = 70000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
const DSY = "z5 z5 z5 z6 z6 z6 z7 z7 m1 m2 m3 p4 p5 p6 s1 s1"; // 摸到 z7＝大三元
const JUNK = "m1 m1 m9 m9 p1 p9 s1 s9 z2 z3 z4 z6 z7 s5 s7 p5";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const allSent: string[] = []; // 所有廣播和 state 回應（F6 檢查有沒有帳號 id）
const auth = (seat: number) => ({ authorization: `Bearer ${seat === 1 ? "boss" : `as:p${seat}`}` });
async function call(fn: (r: Request) => Promise<Response>, seat: number, body: object) {
  const b = { roomId: "R", playerId: "p" + seat, ...body };
  const r = await fn(new Request("http://x", { method: "POST", headers: auth(seat), body: JSON.stringify(b) }));
  return { status: r.status, body: await r.json() };
}
async function stateFor(seat: number) {
  const r = await getState(new Request(`http://x/api/mahjong/state?roomId=R&playerId=p${seat}`, { headers: auth(seat) }));
  const text = await r.text();
  allSent.push(text);
  return JSON.parse(text);
}
const st = () => rooms.R.game_state as MahjongGameState;
/** 座位 1 綁設定表裡的帳號，其他座位綁一般帳號；輪到 turn 打牌 */
function setup(hands: string[], turn: number) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(hands[seat]), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0, userId: seat === 1 ? BOSS : `u:p${seat}` })),
    wall: tiles(Array(40).fill("p9").join(" ")), currentTurn: turn, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
/** seat 摸進 key（還沒打）：輪到他、可以自摸 */
function drawn(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
}
const overPayload = () => sent.find((e) => e.event === "mj_game_over")?.payload as { winners?: { seat: number; winFx?: string }[] } | undefined;
const keep = () => allSent.push(JSON.stringify(sent));

// F1 指定帳號手動自摸
{
  setup([JUNK, WAIT25, JUNK, JUNK], 1);
  drawn(1, "m5");
  const r = await call(action, 1, { actionType: "win" });
  keep();
  const other = await stateFor(2);
  eq([r.status, st().status, st().winners?.map((w) => [w.seat, w.from, w.winFx]), overPayload()?.winners?.map((w) => w.winFx), other.gameState?.winners?.map((w: { winFx?: string }) => w.winFx)],
    [200, "finished", [[1, null, "meteor"]], ["meteor"], ["meteor"]],
    "F1 指定帳號自摸：胡牌紀錄 winFx=meteor；mj_game_over 廣播有；另一家重新整理讀到的 state 也有");
}
// F2 指定帳號胡別人打的牌
{
  setup([JUNK, WAIT25, JUNK, JUNK], 0);
  drawn(0, "m5");
  const d = await call(discard, 0, { tileId: st().players[0].hand.at(-1)!.id });
  const r = await call(action, 1, { actionType: "win" });
  keep();
  eq([d.status, r.status, st().status, st().winners?.map((w) => [w.seat, w.from, w.winFx ?? null]), overPayload()?.winners?.map((w) => w.winFx ?? null)],
    [200, 200, "finished", [[1, 0, null]], [null]],
    "F2 指定帳號胡別人打的牌（座位 0 打五萬）：沒有 winFx");
}
// F3 其他人自摸
{
  setup([JUNK, JUNK, WAIT25, JUNK], 2);
  drawn(2, "m2");
  const r = await call(action, 2, { actionType: "win" });
  keep();
  eq([r.status, st().winners?.map((w) => [w.seat, w.from, w.winFx ?? null]), overPayload()?.winners?.map((w) => w.winFx ?? null)],
    [200, [[2, null, null]], [null]],
    "F3 其他人（座位 2，一般帳號）自摸：沒有 winFx");
}
// F4 指定帳號大牌自摸
{
  setup([JUNK, DSY, JUNK, JUNK], 1);
  drawn(1, "z7");
  const r = await call(action, 1, { actionType: "win" });
  keep();
  const w = st().winners?.[0];
  eq([r.status, w?.score.fans.some((f) => f.name.includes("大三元")), w?.winFx, overPayload()?.winners?.[0]?.winFx],
    [200, true, "meteor", "meteor"],
    "F4 指定帳號大三元自摸：大牌自摸也帶 winFx=meteor");
}
// F5 指定帳號眼牌，摸到胡牌由伺服器自動自摸
{
  setup([JUNK, WAIT25, JUNK, JUNK], 1);
  st().eyeSeats = [1];
  st().wall[0] = t("m2");
  const r = await call(draw, 1, {});
  keep();
  eq([r.status, st().status, st().winners?.map((w) => [w.seat, w.from, w.winFx]), overPayload()?.winners?.map((w) => w.winFx)],
    [200, "finished", [[1, null, "meteor"]], ["meteor"]],
    "F5 指定帳號眼牌、伺服器自動自摸：也帶 winFx=meteor");
  await stateFor(0); await stateFor(1);
}
// F7 公開座位資料帶代號
{
  setup([JUNK, WAIT25, JUNK, JUNK], 0);
  const fxOf = (players: { id: string; winFx?: string }[] | undefined) => players?.map((p) => [p.id, p.winFx ?? null]);
  const asOther = await stateFor(2), asSelf = await stateFor(1);
  // 開局：p2 綁指定帳號，房主 p0 開局
  rooms.R = { id: "R", code: "T", status: "waiting", host_id: "p0", game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
  seats.R = [0, 1, 2, 3].map((seat) => ({ player_id: "p" + seat, name: "P" + seat, seat, user_id: seat === 2 ? BOSS : `u:p${seat}` }));
  sent.length = 0;
  const sr = await start(new Request("http://x", { method: "POST", headers: auth(0), body: JSON.stringify({ roomId: "R", playerId: "p0" }) }));
  keep();
  const startPlayers = (sent.find((e) => e.event === "mj_game_start")?.payload as { players?: { id: string; winFx?: string }[] } | undefined)?.players;
  const byId = (list: { id: string; winFx?: string }[] | undefined) => Object.fromEntries((list ?? []).map((p) => [p.id, p.winFx ?? null]).sort());
  delete seats.R;
  eq([fxOf(asOther.gameState?.players), fxOf(asSelf.gameState?.players), sr.status, byId(startPlayers)],
    [[["p0", null], ["p1", "meteor"], ["p2", null], ["p3", null]], [["p0", null], ["p1", "meteor"], ["p2", null], ["p3", null]], 200, { p0: null, p1: null, p2: "meteor", p3: null }],
    "F7 牌局中 state（別家看、自己看）：指定帳號那個座位 players[i].winFx=meteor，其他座位沒有；開局廣播 mj_game_start 的 players 也是（p2 綁指定帳號）");
}
// F6 帳號 id 不能出現在任何廣播或 state 回應
{
  const blob = allSent.join("\n");
  eq([allSent.length > 0, blob.includes("meteor"), blob.includes(BOSS), /"userId"/.test(blob)], [true, true, false, false],
    "F6 F1～F5、F7 的所有廣播和 state 回應：有 winFx 代號，但沒有帳號 id、沒有 userId 欄位");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
