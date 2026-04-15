import { calculateSettlement } from "../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../lib/mahjong/gameState";

function makePlayer(seat: number, isDealer = false) {
  return { id: "p"+seat, name: "P"+(seat+1), seat, hand: [], revealed: [], flowers: [], discards: [], isDealer };
}
function baseState(): MahjongGameState {
  return {
    roomCode: "TEST",
    status: "playing",
    players: [0,1,2,3].map(s => makePlayer(s, s===0)),
    wall: [],
    currentTurn: 2,
    lastDiscard: null,
    dealerSeat: 0,
    prevalentWind: 1,
    turnCount: 5,
    hasDrawn: true,
    isFirstRound: false,
    isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 3, initialDealerSeat: 0 },
    playerScores: [0,0,0,0],
  } as any;
}

// Non-dealer 自摸 (seat 2 wins, dealer=0) with dealerConsecutive=3
// streakFan = 1 (莊家) + 6 (連3 拉3) = 7
// winner totalFan = 自摸(1) + 莊家(斷)(1) + 連3(3) + 拉3(3) = 8
// baseFans = 8 - 7 = 1  (just 自摸)
// nonDealerPayment = 100 + 1*20 = 120
// dealerPayment = 120 + 7*20 = 260
// winner gain = 260 + 120 + 120 = 500
// deltas = [-260, -120, 500, -120]

const s = baseState();
s.winners = [{
  seat: 2,
  score: { fans: [
    {name:"自摸",value:1},
    {name:"莊家(斷)",value:1},
    {name:"連3",value:3},
    {name:"拉3",value:3},
  ], totalFan: 8 },
}];
s.winner = s.winners[0];
const r = calculateSettlement(s);
console.log("non-dealer 自摸 w/ streak deltas:", r.deltas);
console.log("expected: [-260, -120, 500, -120]");
const ok = JSON.stringify(r.deltas) === JSON.stringify([-260,-120,500,-120]);
console.log(ok ? "✅ PASS" : "❌ FAIL");

// Dealer 自摸 continuing streak
const s2 = baseState();
s2.winners = [{ seat: 0, score: { fans: [{name:"自摸",value:1},{name:"莊家",value:1},{name:"連3",value:3},{name:"拉3",value:3}], totalFan: 8 } }];
s2.winner = s2.winners[0];
const r2 = calculateSettlement(s2);
console.log("dealer 自摸 w/ streak deltas:", r2.deltas);
// payment = 100+8*20 = 260, each of 3 losers pays 260
// winner = 780
console.log("expected: [780, -260, -260, -260]");
const ok2 = JSON.stringify(r2.deltas) === JSON.stringify([780,-260,-260,-260]);
console.log(ok2 ? "✅ PASS" : "❌ FAIL");

if (!ok || !ok2) process.exit(1);
