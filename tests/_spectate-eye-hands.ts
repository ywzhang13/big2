// 觀戰時被觀戰的玩家眼牌（老闆 2026-10-31：該玩家眼牌時，觀戰者也要看得到其他玩家的牌）：觀戰頁的換算（spectateClient.toSpectateView）
//   E1 被觀戰的玩家在 eyeSeats、牌局進行中：view 的 gameState.opponentHands 原樣交給牌桌，內容和眼牌者本人收到的一樣（events.ts 的 opponentHands）
//   E2 被觀戰的玩家沒眼牌：就算回應裡有 opponentHands 也不顯示（只看目前視角那一家的權限）
//   E3 一局結束（finished）：不顯示（同本人畫面，結算時改看四家攤牌）
//   E4 舊的伺服器沒有這個欄位：null（畫面和以前一樣）
// 伺服器端要在 view API 的 gameState 帶 opponentHands（對接格式見老馬交付文件），這裡只驗前端換算
import { dealTiles, initGame } from "../lib/mahjong/gameLogic";
import { toSpectatorGameState } from "../lib/mahjong/db";
import { opponentHands } from "../lib/mahjong/events";
import { toSpectateView } from "../lib/mahjong/spectateClient";
import type { MahjongGameState } from "../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

const s: MahjongGameState = dealTiles(initGame(["a", "b", "c", "d"].map((id) => ({ id, name: id })), { totalRounds: 1, basePoints: 100, fanPoints: 20 }));
const target = s.players[1];
const view = (gs: Record<string, unknown>) =>
  toSpectateView({ roomId: "R", code: "1234", status: "playing", target: { playerId: target.id, name: target.name, seat: target.seat }, spectatorCounts: {}, gameState: gs as never }, null);
const base = toSpectatorGameState(s, target.id) as unknown as Record<string, unknown>;
const hands = opponentHands(s, target.seat);

const v1 = view({ ...base, eyeSeats: [target.seat], opponentHands: hands });
eq([v1.opponentHands?.map((h) => h.seat), v1.opponentHands?.every((h) => h.hand.length > 0), JSON.stringify(v1.opponentHands) === JSON.stringify(hands)],
  [s.players.filter((p) => p.seat !== target.seat).map((p) => p.seat), true, true], "E1 被觀戰的玩家眼牌、牌局進行中：觀戰畫面拿到其他三家的手牌，和眼牌者本人收到的一樣");
eq(view({ ...base, eyeSeats: [3], opponentHands: hands }).opponentHands, null, "E2 被觀戰的玩家沒眼牌（別家眼牌）：不顯示其他三家的牌");
eq(view({ ...base, status: "finished", eyeSeats: [target.seat], opponentHands: hands }).opponentHands, null, "E3 一局結束：不顯示（改看結算的四家攤牌）");
eq(view({ ...base, eyeSeats: [target.seat] }).opponentHands, null, "E4 伺服器沒帶 opponentHands：null，畫面和以前一樣");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
