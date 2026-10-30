// 觀戰手牌順序（老闆 2026-10-31 回報觀戰看到摸進來的牌沒整理）：觀戰畫面和被觀戰玩家本人畫面的手牌順序要完全一樣
//   H1 真的發牌、摸牌、打牌 10 輪：每一步四家的「本人畫面」和「觀戰畫面」手牌順序、剛摸的那張都一樣；伺服器原始順序確實是亂的（測試有意義）
//   H2 吃碰後（手牌少兩張、多一副）：兩邊一樣
//   H3 切換視角：同一時刻換看別家，拿到的是那一家本人畫面的順序
// 本人畫面＝hooks/useMahjong.ts：safeHand(state 的 hand)＋myDrawnTileId；觀戰畫面＝spectateClient.toSpectateView(view API 的 gameState)
import { dealTiles, discardTile, drawTile, initGame } from "../lib/mahjong/gameLogic";
import { toPlayerGameState, toSpectatorGameState } from "../lib/mahjong/db";
import { safeHand } from "../lib/mahjong/handOrder";
import { toSpectateView } from "../lib/mahjong/spectateClient";
import type { MahjongGameState } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const key = (t: Tile) => `${t.suit}${t.rank}`;
/** 本人畫面：手牌（排好的）＋分到右邊的那張 */
function playerView(s: MahjongGameState, id: string) {
  const g = toPlayerGameState(s, id);
  return { hand: safeHand(g.hand ?? []).map(key), drawn: g.myDrawnTileId ?? null };
}
/** 觀戰畫面：view API 的回應經過觀戰頁的換算 */
function spectatorView(s: MahjongGameState, id: string) {
  const t = s.players.find((p) => p.id === id)!;
  const v = toSpectateView({ roomId: "R", code: "1234", status: "playing", target: { playerId: id, name: t.name, seat: t.seat }, spectatorCounts: {}, gameState: toSpectatorGameState(s, id) as never }, null);
  return { hand: v.myHand.map(key), drawn: v.drawnTileId };
}

let s = dealTiles(initGame(["a", "b", "c", "d"].map((id) => ({ id, name: id })), { totalRounds: 1, basePoints: 100, fanPoints: 20 }));
const ids = s.players.map((p) => p.id);
let mismatch: string[] = [], steps = 0, rawUnsorted = 0, drawnSeen = 0;
const check = (label: string) => {
  for (const id of ids) {
    const a = playerView(s, id), b = spectatorView(s, id);
    steps++;
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatch.push(`${label} ${id}`);
    if (a.drawn !== null) drawnSeen++;
    const raw = s.players.find((p) => p.id === id)!.hand.filter((t) => t.suit !== "f").map(key);
    if (JSON.stringify(raw) !== JSON.stringify(a.hand)) rawUnsorted++;
  }
};
check("開局");
for (let round = 1; round <= 10; round++) {
  for (let k = 0; k < 4 && s.status === "playing"; k++) {
    if (!s.hasDrawn) { s = drawTile(s); check(`第${round}輪摸牌`); }
    if (s.status !== "playing") break;
    const me = s.players[s.currentTurn];
    const pick = me.hand.filter((t) => t.suit !== "f")[(round * 7 + k) % me.hand.length] ?? me.hand[0];
    s = discardTile(s, pick.id);
    s.pendingActions = undefined; s.lastDiscard = null; // 不等吃碰，直接下一家
    check(`第${round}輪打牌`);
  }
}
eq([mismatch.slice(0, 5), steps > 100, rawUnsorted > 0, drawnSeen > 0], [[], true, true, true],
  `H1 真的發牌、摸牌、打牌 10 輪（${steps} 次比對）：四家的觀戰畫面和本人畫面手牌順序、剛摸的那張都一樣；伺服器原始順序有 ${rawUnsorted} 次是亂的、剛摸的牌出現 ${drawnSeen} 次（測試有意義）`);

// H2 吃碰後：拿手上一對當成碰，手牌少兩張、多一副
{
  const p = s.players[s.currentTurn];
  const hand = p.hand.filter((t) => t.suit !== "f");
  const pair = hand.find((t, i) => hand.findIndex((u) => key(u) === key(t)) !== i);
  const two = pair ? hand.filter((t) => key(t) === key(pair)).slice(0, 2) : hand.slice(0, 2);
  p.hand = p.hand.filter((t) => !two.some((x) => x.id === t.id));
  p.revealed = [...p.revealed, { type: "pong", tiles: [...two, two[0]] } as never];
  s.hasDrawn = true; s.drawnTileId = undefined;
  eq(JSON.stringify(spectatorView(s, p.id)) === JSON.stringify(playerView(s, p.id)), true, "H2 碰牌後（手牌少兩張、多一副、沒有剛摸的牌）：觀戰畫面和本人畫面一樣");
}

// H3 切換視角：同一時刻四家輪流看
{
  const order = ids.map((id) => JSON.stringify(spectatorView(s, id)) === JSON.stringify(playerView(s, id)));
  eq(order, [true, true, true, true], "H3 切換視角：同一時刻換看四家，每一家都和那一家本人畫面的順序一樣");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
