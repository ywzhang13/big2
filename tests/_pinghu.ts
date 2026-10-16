// 2026-10 老闆確認的平胡（2 台）：①沒字、沒花 ②五副都是順子（吃的、手上都沒刻子）③眼先在手上，胡的那張不是拿來做眼
// ④不是獨聽，胡的那張要是兩面聽（邊張、中洞、單吊都不算）⑤胡別人的牌（自摸不算，搶槓算）。
// 同一手有多種拆法：整手聽 2 種以上，且「有一種拆法」能把胡的那張放進手上的順子當兩面聽，就算平胡。
// 共同設定：底 100、每台 20、seat0 莊家、doorSeat=0、圈風東。
import { declareWin, calculateSettlement } from "../lib/mahjong/gameLogic";
import { calculateScore, ScoringContext } from "../lib/mahjong/scoring";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 8000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const meld = (type: Meld["type"], keys: string): Meld => ({ type, tiles: tiles(keys) });
const results: string[] = [];
function eq(actual: unknown, expected: unknown, msg: string, detail = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}${detail ? "\n   " + detail : ""}`);
}

/** 閒家（南）胡牌的計分；hand 是胡之前的手牌，胡的那張 win 一律放進 concealed */
function score(hand: string, win: string, opt: Partial<ScoringContext> = {}) {
  const w = t(win);
  const r = calculateScore({
    concealed: [...tiles(hand), w], revealed: [], winTile: w, isSelfDraw: false, isDealer: false,
    seatWind: 2, prevalentWind: 1, flowers: [], isLastTile: false, isAfterKong: false,
    isRobbingKong: false, isFirstDraw: false, ...opt,
  });
  return r.fans.map((f) => f.name + f.value);
}
const hasPing = (fans: string[]) => fans.includes("平胡2");

// 兩面聽：四五萬聽三、六萬，眼是九條
const TWO = "m1 m2 m3 p2 p3 p4 p6 p7 p8 s1 s2 s3 s9 s9 m4 m5";

// ---- 成立 ----
{
  const f = score(TWO, "m6");
  eq([hasPing(f), f], [true, ["門清1", "平胡2"]], "P1 兩面聽（四五萬聽三六萬）胡別人打的六萬：平胡 2＋門清 1");
  const f2 = score("m1 m2 m3 p2 p3 p4 s1 s2 s3 s9 s9 m4 m5", "m6", { revealed: [meld("chi", "p6 p7 p8")] });
  eq([hasPing(f2), f2.includes("門清1")], [true, false], "P2 有吃（明順子）、其餘條件都符合：平胡成立，只是沒有門清");
  const f3 = score(TWO, "m6", { isRobbingKong: true });
  eq([hasPing(f3), f3.includes("搶槓胡1")], [true, true], "P3 搶槓胡（算胡別人的牌）：平胡成立，搶槓胡照算");
  const f4 = score(TWO, "m3");
  eq(hasPing(f4), true, "P4 多種拆法：一二三四五萬胡三萬，可拆成「一二三＋三四五（四五兩面聽）」→ 算平胡");
  const f5 = score("m1 m2 m3 m1 m2 m3 m7 m8 m9 m7 m8 m9 m5 m5 m3 m4", "m2");
  eq([hasPing(f5), f5.includes("清一色8")], [true, true], "P5 清一色的兩面聽胡別人：平胡和清一色一起算（其他台不受影響）");
}

// ---- ① 沒字、沒花 ----
{
  eq(hasPing(score(TWO, "m6", { flowers: tiles("f3") })), false, "N1 有花（不是本花）：不算平胡");
  eq(hasPing(score(TWO, "m6", { flowers: tiles("f2") })), false, "N1b 有花（本花）：不算平胡");
  eq(hasPing(score("m1 m2 m3 p2 p3 p4 p6 p7 p8 s1 s2 s3 z1 z1 m4 m5", "m6")), false, "N2 眼是字牌（東）：不算平胡");
}
// ---- ② 五副都是順子 ----
{
  eq(hasPing(score("m1 m2 m3 p2 p2 p2 p6 p7 p8 s1 s2 s3 s9 s9 m4 m5", "m6")), false, "N3 手上有刻子（三張二筒）：不算平胡");
  eq(hasPing(score("m1 m2 m3 p6 p7 p8 s1 s2 s3 s9 s9 m4 m5", "m6", { revealed: [meld("pong", "p2 p2 p2")] })), false, "N4 碰了一副（明刻）：不算平胡");
}
// ---- ③ 胡的那張不能是眼 ----
{
  const H = "p1 p2 p3 p4 p5 p6 s2 s3 s4 s6 s7 s8 m5 m6 m7 m8";
  eq(hasPing(score(H, "m5")), false, "N5 手上五六七八萬、胡五萬（五萬做眼）：不算平胡");
  eq(hasPing(score(H, "m8")), false, "N6 手上五六七八萬、胡八萬（八萬做眼）：不算平胡");
}
// ---- ④ 不能獨聽 ----
{
  eq(hasPing(score("m4 m5 m6 p2 p3 p4 p6 p7 p8 s1 s2 s3 s9 s9 m1 m2", "m3")), false, "N7 邊張（一二萬胡三萬）：不算平胡");
  eq(hasPing(score("m4 m5 m6 p2 p3 p4 p6 p7 p8 s1 s2 s3 s9 s9 m7 m9", "m8")), false, "N8 中洞（七九萬胡八萬）：不算平胡");
  eq(hasPing(score("m1 m2 m3 p1 p2 p3 p4 p5 p6 s1 s2 s3 s7 s8 s9 m9", "m9")), false, "N9 單吊（單吊九萬）：不算平胡");
}
// ---- ⑤ 自摸不算 ----
{
  const f = score(TWO, "m6", { isSelfDraw: true });
  eq([hasPing(f), f], [false, ["門清自摸3"]], "N10 同一手兩面聽改成自摸：不算平胡（只有門清自摸）");
}

// ---- 平胡＋門清＋莊家（連 1）的總台數和金額 ----
{
  const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[],
      flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0,
    })),
    wall: tiles(Array(40).fill("m9").join(" ")),
    currentTurn: 2, lastDiscard: { tile: t("m6"), from: 2 }, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, hasDrawn: true, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 1, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[0].hand = tiles(TWO);
  const r = declareWin(s, 0, false);
  const w = r.winners![0].score;
  eq([w.fans.map((f) => f.name + f.value), w.totalFan, calculateSettlement(r).deltas],
    [["莊家1", "門清1", "平胡2", "連11", "拉11"], 6, [220, 0, -220, 0]],
    "S1 莊家（連 1）兩面聽胡閒家（台名是「連1」「拉1」、各 1 台）：莊家1＋門清1＋平胡2＋連1＋拉1＝6 台，放槍者付 100+6×20=220");
  const sd = { ...s, roundInfo: { ...s.roundInfo!, dealerConsecutive: 0 } } as MahjongGameState;
  const r2 = declareWin(sd, 0, false);
  eq([r2.winners![0].score.totalFan, calculateSettlement(r2).deltas], [4, [180, 0, -180, 0]],
    "S2 莊家（沒連莊）兩面聽胡閒家：莊家1＋門清1＋平胡2＝4 台，放槍者付 100+4×20=180");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
