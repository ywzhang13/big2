// 別家暗槓的牌面（老柯 2026-10-29 發現、阿哲排修）：還沒眼牌的別家在任何回應或廣播裡都拿不到牌面，
// 但看得到那裡有一副暗槓、共 4 張；本人（自己的 state）和已經眼牌的人（opponentHands、mj_opponent_hands）拿得到。
//   K1 暗槓那一刻的廣播：公開頻道的 mj_action 沒有牌面、沒有那 4 張的 id；本人座位頻道的 mj_hand_update 有自己的暗槓（myRevealed）
//   K2 讀牌桌狀態：p0、p2（沒眼牌）看到 seat3 有 1 副 concealed_kong、4 張，但沒有牌面和 id；本人 p3 有牌面
//   K3 已經眼牌的 p1：opponentHands 和 mj_opponent_hands 有牌面
//   K4 公開 state（廣播用）、下一個動作（摸牌、打牌）之後的所有公開廣播：都沒有牌面
//   K5 眼牌前的 tingInfo 照舊（別家暗槓本來就不扣）
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";
import { privateChannelName } from "../../lib/mahjong/access";
import { waitsLeft } from "../../lib/mahjong/tingInfo";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 90000;
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


const all: { channel: string; text: string }[] = []; // 這個檔案裡所有廣播（含頻道）和 state 回應
const keep = () => { for (const e of sent) all.push({ channel: e.channel ?? "", text: JSON.stringify(e.payload) }); sent.length = 0; };
async function stateOf(seat: number) {
  const r = await getState(new Request(`http://x/api/mahjong/state?roomId=R&playerId=p${seat}`, { headers: { authorization: `Bearer as:p${seat}` } }));
  const body = await r.json();
  all.push({ channel: `state:p${seat}`, text: JSON.stringify(body) });
  return body.gameState ?? body;
}
const KONG = "z5 z5 z5 z5";
{
  setup();
  await playFrom(1, WAIT25, "z6", true); // p1 先眼牌（聽二五萬）
  keep();
  const s = st();
  s.players[3].hand = tiles(KONG + " m1 m2 m3 p1 p2 p3 s1 s2 s3 s7 s8 s9 m9");
  const kongIds = s.players[3].hand.slice(0, 4).map((x) => x.id);
  s.currentTurn = 3; s.hasDrawn = true; s.drawnTileId = s.players[3].hand[16].id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  const r = await call(action, { playerId: "p3", actionType: "kong", tiles: kongIds });
  const has = (text: string) => kongIds.filter((id) => text.includes(`"id":${id},`)).length;
  const pub = sent.filter((e) => e.channel === "mj-T");
  const act = pub.find((e) => e.event === "mj_action")!;
  const mine = sent.find((e) => e.channel === chan(3) && e.event === "mj_hand_update");
  const myRev = (mine?.payload as { myRevealed?: Meld[] } | undefined)?.myRevealed;
  eq([r.status, act.payload.type, (act.payload.tiles as Tile[]).length, pub.reduce((n, e) => n + has(JSON.stringify(e.payload)), 0), (act.payload.tiles as Tile[]).some((x) => x.suit === "z" && x.rank === 5),
    myRev?.find((m) => m.type === "concealed_kong")?.tiles.map((x) => x.id)],
    [200, "concealed_kong", 4, 0, false, kongIds],
    "K1 暗槓那一刻：公開頻道的 mj_action 是 concealed_kong、4 張，但沒有牌面也沒有那 4 張的 id；本人座位頻道的 mj_hand_update 帶 myRevealed（有牌面）");
  const eyeEv = sent.find((e) => e.event === "mj_opponent_hands" && e.channel === chan(1));
  keep();
  const v0 = await stateOf(0), v2 = await stateOf(2), v3 = await stateOf(3), v1 = await stateOf(1);
  const kongOf = (v: { players: { seat: number; revealed: Meld[] }[] }) => v.players.find((p) => p.seat === 3)!.revealed.find((m) => m.type === "concealed_kong");
  eq([kongOf(v0)?.tiles.length, kongOf(v2)?.tiles.length, has(JSON.stringify(v0)), has(JSON.stringify(v2)), kongOf(v0)?.tiles.some((x) => x.rank === 5)],
    [4, 4, 0, 0, false], "K2 沒眼牌的 p0、p2 讀牌桌狀態：seat3 有一副暗槓、4 張，但沒有牌面和 id");
  eq(kongOf(v3)?.tiles.map((x) => x.id), kongIds, "K2b 本人 p3 讀牌桌狀態：自己的暗槓有牌面");
  const opp = (v1.opponentHands as { seat: number; revealed: Meld[] }[]).find((o) => o.seat === 3)!;
  eq([opp.revealed.find((m) => m.type === "concealed_kong")?.tiles.map((x) => x.id), has(JSON.stringify(eyeEv?.payload ?? {}))], [kongIds, 4],
    "K3 已經眼牌的 p1：state 的 opponentHands 和座位頻道 mj_opponent_hands 都有牌面");
  // 之後打牌、摸牌：公開廣播和公開 state 照樣不帶
  await call(discard, { playerId: "p3", tileId: st().players[3].hand.find((x) => x.display === "m9")!.id });
  keep();
  const pubText = all.filter((x) => x.channel === "mj-T").map((x) => x.text).join("\n") + JSON.stringify(toPublicGameState(st()));
  const otherPriv = all.filter((x) => x.channel === chan(0) || x.channel === chan(2) || x.channel === "state:p0" || x.channel === "state:p2").map((x) => x.text).join("\n");
  eq([has(pubText), has(otherPriv)], [0, 0], "K4 全部公開廣播、公開 state、p0／p2 的座位頻道和 state 回應：都沒有那 4 張暗槓的 id");
  // K5 眼牌前的 tingInfo：別家暗槓本來就不扣，遮掉牌面後結果和拿原始牌局（有牌面）算的一樣
  st().players[0].hand = tiles(WAIT25);
  const v = toPlayerGameState(st(), "p0");
  const raw = { hand: st().players[0].hand, players: st().players.map((p) => ({ seat: p.seat, revealed: p.revealed, discards: v.players.find((x) => x.seat === p.seat)!.discards })) };
  eq([waitsLeft(v, 0).map((x) => x.key), waitsLeft(v, 0), "opponentHands" in v], [["m2", "m5"], waitsLeft(raw, 0), false], "K5 眼牌前 tingInfo 照常算（聽 m2、m5），和用原始牌面算的一樣；沒有 opponentHands");
}
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
