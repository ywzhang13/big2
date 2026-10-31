// 牌局事件帶版本號 sv（老馬〈給老柯-事件帶版本號-2026-11-01〉；省量：輪詢拉長到 25 秒，漏事件靠跳號立刻補抓）
//   E1 摸牌：這次存檔的版本號（2 → 3）放進每一個廣播事件（公開頻道、座位頻道都一樣）
//   E2 打牌：下一次存檔（3 → 4）的事件都帶 4；一次請求的事件版本號都相同
//   E3 GET /state（本人、沒登入的公開）gameState 都帶 stateVersion，和資料庫一致
//   E4 接到前端 SyncPolicy：照順序收到 3、4 不算漏；漏掉摸牌那一批（直接收到 4）就立刻判定要補抓；舊伺服器沒帶 sv 不誤判
//   E5 沒存檔的廣播（withVersion 沒給 sv）payload 原樣、不加 sv
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { withVersion } from "../../lib/mahjong/access";
import { SyncPolicy } from "../../lib/mahjong/syncPolicy";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const JUNK = "m1 m1 m9 m9 p1 p9 s1 s9 z2 z3 z4 z6 z7 s5 s7 p5";
const s0 = {
  roomCode: "V", status: "playing",
  players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(JUNK), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0, userId: `u:p${seat}` })),
  wall: tiles(Array(40).fill("p8").join(" ")), currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
  prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
  roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
  roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
} as unknown as MahjongGameState;
rooms.R = { id: "R", code: "V", game_state: s0, status: "playing" };
const auth = (tok: string) => ({ "content-type": "application/json", authorization: `Bearer ${tok}` });
const post = (fn: (r: Request) => Promise<Response>, body: object, tok: string) => fn(new Request("http://x", { method: "POST", headers: auth(tok), body: JSON.stringify(body) }));
const svOf = (evs: typeof sent) => [...new Set(evs.map((e) => e.payload.sv))];

// ---- E1 摸牌 ----
sent.length = 0;
const r1 = await post(draw, { roomId: "R", playerId: "p1" }, "as:p1");
const drawEvents = sent.splice(0);
eq([r1.status, rooms.R.game_state.stateVersion, svOf(drawEvents), drawEvents.length > 1, drawEvents.some((e) => e.channel !== "mj-V"), drawEvents.some((e) => e.channel === "mj-V")],
  [200, 3, [3], true, true, true], "E1 摸牌存檔 2 → 3：每一個事件（公開頻道和座位頻道都有）都帶 sv=3");

// ---- E2 打牌 ----
const tileId = rooms.R.game_state.players[1].hand[0].id;
const r2 = await post(discard, { roomId: "R", playerId: "p1", tileId }, "as:p1");
const discardEvents = sent.splice(0);
eq([r2.status, rooms.R.game_state.stateVersion, svOf(discardEvents), discardEvents.length > 0], [200, 4, [4], true], "E2 打牌存檔 3 → 4：這次請求的事件都帶 sv=4");

// ---- E3 /state 帶版本號 ----
const own = await (await getState(new Request("http://x/?roomId=R&playerId=p2", { headers: { authorization: "Bearer as:p2" } }))).json();
const pub = await (await getState(new Request("http://x/?roomId=R"))).json();
eq([own.gameState?.stateVersion, pub.gameState?.stateVersion], [4, 4], "E3 本人和公開的 /state 都帶 stateVersion=4（和資料庫一致）");

// ---- E4 前端 SyncPolicy ----
const inOrder = new SyncPolicy();
inOrder.noteVersion(2, { fromState: true });
const gapsInOrder = [...drawEvents, ...discardEvents].map((e) => inOrder.noteVersion(e.payload.sv)).filter(Boolean).length;
const missed = new SyncPolicy();
missed.noteVersion(2, { fromState: true });
const gapAt = discardEvents.findIndex((e) => missed.noteVersion(e.payload.sv)); // 摸牌那一批整個漏掉
const legacy = new SyncPolicy();
legacy.noteVersion(2, { fromState: true });
const legacyGap = [...drawEvents, ...discardEvents].some((e) => legacy.noteVersion(undefined));
eq([gapsInOrder, gapAt, legacyGap], [0, 0, false], "E4 照順序收到 3、4：沒有誤判；漏掉 sv=3 那批：收到第一個 sv=4 的事件就判定要補抓（不用等 25 秒保險輪詢）；沒帶 sv 不誤判");

// ---- E5 沒存檔的事件不加 sv ----
const plain = withVersion([{ event: "mj_chat", payload: { playerId: "p1", text: "嗨" } }]);
const tagged = withVersion([{ event: "mj_x", payload: { a: 1 } }], 7);
eq([plain[0].payload, tagged[0].payload], [{ playerId: "p1", text: "嗨" }, { a: 1, sv: 7 }], "E5 沒給 sv 時 payload 原樣（聊天、語音、特效、觀戰人數這類沒存檔的事件）；有給就加上 sv");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
