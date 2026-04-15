import { calculateSettlement } from "../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../lib/mahjong/gameState";

function makePlayer(seat: number, isDealer = false) {
  return { id: "p"+seat, name: "P"+(seat+1), seat, hand: [], revealed: [], flowers: [], discards: [], isDealer };
}

// 莊家(seat 0) 自摸 with 連2 拉2
const s: MahjongGameState = {
  roomCode: "T",
  status: "playing",
  players: [0,1,2,3].map(s => makePlayer(s, s===0)),
  wall: [], currentTurn: 0, lastDiscard: null,
  dealerSeat: 0, prevalentWind: 1, turnCount: 5,
  hasDrawn: true, isFirstRound: false, isAfterKong: false,
  roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
  roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 2, initialDealerSeat: 0 },
  playerScores: [0,0,0,0],
  winners: [{ seat: 0, score: { fans: [
    {name:"自摸",value:1}, {name:"莊家",value:1}, {name:"連2",value:2}, {name:"拉2",value:2}
  ], totalFan: 6 } }],
} as any;
s.winner = s.winners![0];
const r = calculateSettlement(s);
console.log("莊家連2自摸 deltas:", r.deltas);
console.log("expected: [660, -220, -220, -220] (每家各自付 100+6×20=220)");
const ok = JSON.stringify(r.deltas) === JSON.stringify([660,-220,-220,-220]);
console.log(ok ? "✅ PASS" : "❌ FAIL");
process.exit(ok ? 0 : 1);
