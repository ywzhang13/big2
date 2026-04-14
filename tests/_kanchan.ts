import { calculateScore, ScoringContext } from "../lib/mahjong/scoring";
import type { Tile } from "../lib/mahjong/tiles";

function tile(suit: "m"|"p"|"s"|"z"|"f", rank: number, id: number): Tile {
  const display = `${rank}${suit}`;
  return { id, suit, rank, display };
}

// Hand: 1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 東東 (win on 2p — middle of 1-2-3p)
// Concealed: 14 + winTile = 15? needs to be 17
// Let me craft: 4 melds + pair from concealed + 1 meld that needs winTile (total 17 on win)
// 5 melds + pair = 17 tiles total
//
// Example 中洞: concealed = 1m2m3m 4m5m6m 7m8m9m 1s2s3s 東東 1p 3p (16 tiles)
//   win on 2p → completes 1p2p3p (中洞)
const results: string[] = [];
function pass(m: string) { results.push("✅ " + m); }
function fail(m: string) { results.push("❌ " + m); }

function ctxFor(concealed: Tile[], winTile: Tile, isSelfDraw: boolean): ScoringContext {
  return {
    concealed, revealed: [], winTile, isSelfDraw,
    isDealer: false, seatWind: 1, prevalentWind: 1,
    flowers: [], isLastTile: false, isAfterKong: false,
    isRobbingKong: false, isFirstDraw: false,
  };
}

// Case 1: 中洞 — held 1p 3p, win 2p
{
  const id = (() => { let n = 0; return () => n++; })();
  const hand = [
    tile("m", 1, id()), tile("m", 2, id()), tile("m", 3, id()),
    tile("m", 4, id()), tile("m", 5, id()), tile("m", 6, id()),
    tile("m", 7, id()), tile("m", 8, id()), tile("m", 9, id()),
    tile("s", 1, id()), tile("s", 2, id()), tile("s", 3, id()),
    tile("z", 1, id()), tile("z", 1, id()),
    tile("p", 1, id()), tile("p", 3, id()),
  ];
  const winTile = tile("p", 2, id());
  // ron: concealed = hand + winTile
  const score = calculateScore(ctxFor([...hand, winTile], winTile, false));
  const has = score.fans.some(f => f.name === "中洞");
  if (has) pass(`中洞 detected (hand held 1p+3p, win 2p). Fans: ${JSON.stringify(score.fans)}`);
  else fail(`中洞 NOT detected. Fans: ${JSON.stringify(score.fans)}`);
}

// Case 2: 邊張 — held 1p 2p, win 3p
{
  const id = (() => { let n = 0; return () => n++; })();
  const hand = [
    tile("m", 1, id()), tile("m", 2, id()), tile("m", 3, id()),
    tile("m", 4, id()), tile("m", 5, id()), tile("m", 6, id()),
    tile("m", 7, id()), tile("m", 8, id()), tile("m", 9, id()),
    tile("s", 1, id()), tile("s", 2, id()), tile("s", 3, id()),
    tile("z", 1, id()), tile("z", 1, id()),
    tile("p", 1, id()), tile("p", 2, id()),
  ];
  const winTile = tile("p", 3, id());
  const score = calculateScore(ctxFor([...hand, winTile], winTile, false));
  const has = score.fans.some(f => f.name === "邊張");
  if (has) pass(`邊張 detected (hand held 1p+2p, win 3p). Fans: ${JSON.stringify(score.fans)}`);
  else fail(`邊張 NOT detected. Fans: ${JSON.stringify(score.fans)}`);
}

// Case 3: 邊張 — held 8p 9p, win 7p
{
  const id = (() => { let n = 0; return () => n++; })();
  const hand = [
    tile("m", 1, id()), tile("m", 2, id()), tile("m", 3, id()),
    tile("m", 4, id()), tile("m", 5, id()), tile("m", 6, id()),
    tile("s", 1, id()), tile("s", 2, id()), tile("s", 3, id()),
    tile("s", 4, id()), tile("s", 5, id()), tile("s", 6, id()),
    tile("z", 1, id()), tile("z", 1, id()),
    tile("p", 8, id()), tile("p", 9, id()),
  ];
  const winTile = tile("p", 7, id());
  const score = calculateScore(ctxFor([...hand, winTile], winTile, false));
  const has = score.fans.some(f => f.name === "邊張");
  if (has) pass(`邊張 detected (hand held 8p+9p, win 7p). Fans: ${JSON.stringify(score.fans)}`);
  else fail(`邊張 NOT detected. Fans: ${JSON.stringify(score.fans)}`);
}

// Case 4: 兩面 — held 2p 3p, win 4p → NO 邊張/中洞
{
  const id = (() => { let n = 0; return () => n++; })();
  const hand = [
    tile("m", 1, id()), tile("m", 2, id()), tile("m", 3, id()),
    tile("m", 4, id()), tile("m", 5, id()), tile("m", 6, id()),
    tile("m", 7, id()), tile("m", 8, id()), tile("m", 9, id()),
    tile("s", 1, id()), tile("s", 2, id()), tile("s", 3, id()),
    tile("z", 1, id()), tile("z", 1, id()),
    tile("p", 2, id()), tile("p", 3, id()),
  ];
  const winTile = tile("p", 4, id());
  const score = calculateScore(ctxFor([...hand, winTile], winTile, false));
  const hasEdge = score.fans.some(f => f.name === "邊張" || f.name === "中洞");
  if (!hasEdge) pass(`兩面 wait (2p+3p wait 1p/4p, win 4p): no 邊張/中洞. Fans: ${JSON.stringify(score.fans)}`);
  else fail(`兩面 wait should not have 邊張/中洞. Fans: ${JSON.stringify(score.fans)}`);
}

console.log(results.join("\n"));
if (results.some(r => r.startsWith("❌"))) process.exit(1);
