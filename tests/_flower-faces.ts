// 正花號碼要和牌面印的數字一致（2026-10-20 老闆：花牌偶爾算錯）。
// 牌面（public/tiles/faces/Flower1～8.webp，逐張目視確認）：春1 夏2 秋3 冬4、梅1 蘭2、Flower7 竹4、Flower8 菊3。
// 規則：開門那家（doorSeat）1 號，逆時針下一家 2 號…；同號兩張都算，雙 1 花 2 台。
import { declareWin } from "../lib/mahjong/gameLogic";
import { calculateScore } from "../lib/mahjong/scoring";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import { tileDisplay, type Tile, type TileSuit } from "../lib/mahjong/tiles";

// 牌面印的名稱和號碼（rank 1～8 對應 Flower1～8.webp）
const FACE: Record<number, [string, number]> = {
  1: ["春", 1], 2: ["夏", 2], 3: ["秋", 3], 4: ["冬", 4],
  5: ["梅", 1], 6: ["蘭", 2], 7: ["竹", 4], 8: ["菊", 3],
};

let nextId = 5000;
function t(key: string): Tile {
  return { id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key };
}
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const HAND = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z5 z5 s5 s6"; // 聽 4s/7s，沒有字牌刻

const results: string[] = [];
function eq(actual: unknown, expected: unknown, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}`);
}
function flowerFans(seatWind: number, flowerKeys: string) {
  const hand = tiles(HAND);
  const win = t("s7");
  const score = calculateScore({
    concealed: [...hand, win], revealed: [], winTile: win, isSelfDraw: false, isDealer: false,
    seatWind, prevalentWind: 1, flowers: tiles(flowerKeys), isLastTile: false,
    isAfterKong: false, isRobbingKong: false, isFirstDraw: false,
  });
  return score.fans.filter((f) => ["正花", "春夏秋冬", "梅蘭菊竹"].includes(f.name)).map((f) => f.name + f.value);
}
const rankOf = (name: string) => Number(Object.keys(FACE).find((r) => tileDisplay(t("f" + r)) === name));

// F1 名稱和牌面一致
eq([1, 2, 3, 4, 5, 6, 7, 8].map((r) => tileDisplay(t("f" + r))), [1, 2, 3, 4, 5, 6, 7, 8].map((r) => FACE[r][0]),
  "F1 花的文字名稱和牌面一致（rank 7 竹、rank 8 菊）");

// F2 四個門風 × 8 張花：只有牌面號碼等於門風的那張算正花 1 台
for (const wind of [1, 2, 3, 4]) {
  const got = [1, 2, 3, 4, 5, 6, 7, 8].filter((r) => flowerFans(wind, "f" + r).includes("正花1"));
  const want = [1, 2, 3, 4, 5, 6, 7, 8].filter((r) => FACE[r][1] === wind);
  eq(got.map((r) => FACE[r][0]), want.map((r) => FACE[r][0]), `F2 門風 ${"東南西北"[wind - 1]}（${wind} 號）的正花是 ${want.map((r) => FACE[r][0]).join("、")}`);
}

// F3 雙 1 花 2 台；其他號碼也是同號兩張都算
eq(flowerFans(1, "f1 f5"), ["正花2"], "F3a 開門那家拿春 1＋梅 1：正花 2 台");
eq(flowerFans(4, `f4 f${rankOf("竹")}`), ["正花2"], "F3b 北家拿冬 4＋竹 4：正花 2 台");
eq(flowerFans(3, `f3 f${rankOf("菊")}`), ["正花2"], "F3c 西家拿秋 3＋菊 3：正花 2 台");

// F4 竹（4）北家算、西家不算；菊（3）相反
eq(flowerFans(4, "f" + rankOf("竹")), ["正花1"], "F4a 竹 4 在北家：正花 1 台");
eq(flowerFans(3, "f" + rankOf("竹")), [], "F4b 竹 4 在西家：不算正花");
eq(flowerFans(3, "f" + rankOf("菊")), ["正花1"], "F4c 菊 3 在西家：正花 1 台");
eq(flowerFans(4, "f" + rankOf("菊")), [], "F4d 菊 3 在北家：不算正花");

// F5 花槓台名照號碼順序：梅蘭菊竹
eq(flowerFans(2, "f5 f6 f7 f8"), ["正花1", "梅蘭菊竹1"], "F5 南家拿梅蘭菊竹：蘭 2 正花 1＋花槓「梅蘭菊竹」1");

// F6 實際胡牌流程：開門在 seat 2，seat 1 是北（逆時針數到第 4 家），拿竹胡牌
{
  const s = {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles(HAND), revealed: [] as Meld[],
      flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 2,
    })),
    wall: tiles(Array(40).fill("m9").join(" ")),
    currentTurn: 1, lastDiscard: { tile: t("s7"), from: 3 }, dealerSeat: 2, doorSeat: 2, prevalentWind: 1,
    turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 2 },
    playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  s.players[1].flowers = [t("f" + rankOf("竹"))];
  const r = declareWin(s, 1, false);
  eq(r.winners![0].score.fans.filter((f) => f.name === "正花").map((f) => f.name + f.value), ["正花1"],
    "F6 開門 seat 2、seat 1 坐北拿竹 4 胡牌：結算有正花 1 台");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
