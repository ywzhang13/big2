
import { applyWinnerOrderRule, calculateSettlement } from "../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../lib/mahjong/gameState";

function makePlayer(seat: number, isDealer = false) {
  return { id: "p"+seat, name: "P"+(seat+1), seat, hand: [], revealed: [], flowers: [], discards: [], isDealer };
}

function baseState(discarderSeat: number): MahjongGameState {
  return {
    roomCode: "TEST",
    status: "playing",
    players: [0,1,2,3].map(s => makePlayer(s, s===0)),
    wall: [],
    currentTurn: discarderSeat,
    lastDiscard: { tile: { id: 0, suit: "m", rank: 1, display: "1萬" }, from: discarderSeat },
    dealerSeat: 0,
    prevalentWind: 1,
    turnCount: 5,
    hasDrawn: false,
    isFirstRound: false,
    isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0,0,0,0],
  } as any;
}

function fakeWinner(seat: number, totalFan: number) {
  return { seat, score: { fans: [{ name: "test", value: totalFan }], totalFan } };
}

const results: string[] = [];
function pass(msg: string) { results.push("✅ " + msg); }
function fail(msg: string) { results.push("❌ " + msg); }
function eq(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(msg + " => " + JSON.stringify(actual));
  else fail(msg + " expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
}

// --- Case 1: single-winner ron, non-dealer winner & discarder ---
// dealer=seat 0 (consecutive=0). 斷莊罰 = 1 台 → dealer 多付 20.
// seat 3 discards to seat 1, totalFan=2 (含 莊家(斷) 1 台).
// baseFans = 2-1 = 1. shooterPay=100+20=120. dealerPay=20.
// Winner gets 140. Dealer pays 20. Discarder pays 120.
{
  const s = baseState(3); // seat 3 discards
  s.winners = [fakeWinner(1, 2)];
  s.winner = s.winners[0];
  const filtered = applyWinnerOrderRule(s);
  eq(filtered.winners!.length, 1, "single ron: 1 winner remains");
  const settle = calculateSettlement(filtered);
  eq(settle.deltas, [-20, 140, 0, -120], "single ron: dealer 多付 20 (斷莊罰) + 放槍者付 120");
}

// --- Case 2: 雙響 — seats 0 and 2 both win off seat 3's discard ---
// Priority: (seat - discarder - 1 + 4) % 4 = (seat - 4) % 4
//   seat 0: (0-3-1+4)%4 = 0   (下家，第一順位)
//   seat 1: (1-3-1+4)%4 = 1
//   seat 2: (2-3-1+4)%4 = 2
// seat 0 should win, seat 2 forfeits.
{
  const s = baseState(3);
  s.winners = [fakeWinner(0, 3), fakeWinner(2, 5)];
  s.winner = s.winners[0];
  const filtered = applyWinnerOrderRule(s);
  eq(filtered.winners!.length, 1, "雙響: exactly 1 winner after filter");
  eq(filtered.winners![0].seat, 0, "雙響: seat 0 (下家) takes priority over seat 2");
  const settle = calculateSettlement(filtered);
  eq(settle.deltas, [160, 0, 0, -160], "雙響: only seat 0 paid, seat 3 (discarder) pays");
}

// --- Case 3: 雙響 with seats 2 and 1 — discarder = seat 0 ---
// Priority from discarder=0:
//   seat 1: 0   (下家)
//   seat 2: 1
//   seat 3: 2
{
  const s = baseState(0);
  s.winners = [fakeWinner(2, 3), fakeWinner(1, 4)];
  s.winner = s.winners[0];
  const filtered = applyWinnerOrderRule(s);
  eq(filtered.winners!.length, 1, "雙響 #2: 1 winner after filter");
  eq(filtered.winners![0].seat, 1, "雙響 #2: seat 1 (下家) beats seat 2");
}

// --- Case 4: 三響 — seats 0, 1, 2 all win off seat 3's discard ---
// seat 0 = dealer.
// Winner 0 (dealer): discarderIsDealer=false，但 winnerIsDealer=true，
//   走 full-totalFan path: payment=100+2*20=140. deltas[0]+=140, deltas[3]-=140.
// Winner 1 (non-dealer): baseFans=3-1=2, shooterPay=140, dealerPay=20.
//   deltas[1]+=160, deltas[3]-=140, deltas[0]-=20.
// Winner 2 (non-dealer): baseFans=4-1=3, shooterPay=160, dealerPay=20.
//   deltas[2]+=180, deltas[3]-=160, deltas[0]-=20.
// Totals: [140-20-20, 160, 180, -140-140-160] = [100, 160, 180, -440]
{
  const s = baseState(3);
  s.winners = [fakeWinner(0, 2), fakeWinner(1, 3), fakeWinner(2, 4)];
  s.winner = s.winners[0];
  const filtered = applyWinnerOrderRule(s);
  eq(filtered.winners!.length, 3, "三響: all 3 winners kept");
  const settle = calculateSettlement(filtered);
  eq(settle.deltas, [100, 160, 180, -440], "三響: 各家分別結算，dealer 再被扣兩次斷莊罰");
  eq(settle.fanTotal, 9, "三響: fan total sums to 9");
}

// --- Case 5: non-dealer self-draw (dealer=0, consecutive=0) ---
// streakFan = 1 (just 莊家斷), baseFans=1, nonDealerPay=120, dealerPay=140
// winner += 140+120+120=380
{
  const s = baseState(0);
  s.currentTurn = 2;
  s.hasDrawn = true;
  s.lastDiscard = null;
  s.winners = [{ seat: 2, score: { fans: [{ name: "自摸", value: 1 }, { name: "莊家(斷)", value: 1 }], totalFan: 2 } }];
  s.winner = s.winners[0];
  const filtered = applyWinnerOrderRule(s);
  eq(filtered.winners!.length, 1, "self-draw: 1 winner unchanged");
  const settle = calculateSettlement(filtered);
  eq(settle.deltas, [-140, -120, 380, -120], "self-draw: dealer 多付 20 (斷莊罰)");
  eq(settle.reason, "self_draw", "self-draw: reason=self_draw");
}

console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
