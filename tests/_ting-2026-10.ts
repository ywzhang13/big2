// 2026-10 老闆規則：天胡 24（只有莊家）、地胡 8、地聽 8（第一輪宣告眼牌時同時算地聽、不能改聽、和地胡不疊加）。
// 共同設定：底 100、每台 20、dealer=seat 0、doorSeat=0、圈風東、連莊 0。
import {
  canDeclareTingNow, eyeDiscardOptions, declareEyeAndDiscard, autoDiscardForTing,
  ownTurnActions, getAvailableActions, discardTile, drawTile, declareWin, calculateSettlement, startNextGame,
  executeConcealedKong,
} from "../lib/mahjong/gameLogic";
import { calculateScore } from "../lib/mahjong/scoring";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 7000;
function t(key: string): Tile {
  return { id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key };
}
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const meld = (type: Meld["type"], keys: string): Meld => ({ type, tiles: tiles(keys) });
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1s/4s/7s，門清 1 台
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";

/** 開局：莊家 seat0 拿 17 張（H16 + 中），還沒有人打牌 */
function opening(): MahjongGameState {
  const s = {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[],
      flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0,
    })),
    wall: tiles(Array(60).fill("m9").join(" ")),
    currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 0, hasDrawn: true, isFirstRound: true, isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[0].hand = tiles(H16 + " z5");
  s.drawnTileId = s.players[0].hand[16].id;
  return s;
}
/** 莊家打完第 1 張，輪到 seat1 摸完牌（H16 + 摸到 中），還沒打 */
function seat1FirstTurn(): MahjongGameState {
  const s = opening();
  s.players[0].hand = tiles(NOT_WAIT + " z7");
  s.players[0].discards = tiles("z7");
  s.turnCount = 1; s.isFirstRound = false;
  s.currentTurn = 1;
  s.players[1].hand = tiles(H16 + " z5");
  s.drawnTileId = s.players[1].hand[16].id;
  return s;
}
const ids = (ts: Tile[]) => ts.map((x) => x.display);
const fanStr = (st: MahjongGameState) =>
  (st.winners ?? []).map((w) => `seat${w.seat}:${w.score.fans.map((f) => f.name + f.value).join("+")}=${w.score.totalFan}`).join(" | ");
const results: string[] = [];
function eq(actual: unknown, expected: unknown, msg: string, detail = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}${detail ? "\n   " + detail : ""}`);
}
function throws(fn: () => unknown, msg: string) {
  try { fn(); results.push(`❌ ${msg}（沒有擋下）`); } catch (e) { results.push(`✅ ${msg}（${(e as Error).message}）`); }
}

// --- 宣告時機 ---
{
  const s = opening();
  const opts = ids(eyeDiscardOptions(s, 0));
  eq([canDeclareTingNow(s, 0), opts.includes("z5"), opts.includes("m1")], [true, true, false],
    "A1 莊家打第 1 張：可以宣告；打出中（z5）後聽 1/4/7 條 → 是選項；打出 1 萬後沒聽 → 不是選項");
  throws(() => declareEyeAndDiscard(s, s.players[0].hand[0].id), "A2 用打出後不會聽牌的 1 萬宣告：擋下");
  const d = declareEyeAndDiscard(s, s.players[0].hand[16].id);
  eq([d.tingSeats, d.lastDiscard?.tile.display, d.turnCount], [[0], "z5", 1], "A3 莊家打出中並宣告：tingSeats=[0]，照常打出（第 1 張）");
}
{
  const s = seat1FirstTurn();
  eq([canDeclareTingNow(s, 1), ids(eyeDiscardOptions(s, 1)).includes("z5")], [true, true], "A4 閒家 seat1 自己第一次打牌（桌上第 2 張）：可以宣告");
  const second = { ...seat1FirstTurn(), turnCount: 5 } as MahjongGameState;
  second.players[1].discards = tiles("z6");
  eq(canDeclareTingNow(second, 1), false, "A5 閒家自己的第 2 張：不能宣告");
  const late = { ...seat1FirstTurn(), turnCount: 5 } as MahjongGameState;
  eq(canDeclareTingNow(late, 1), false, "A6 桌上已打出 5 張後才輪到第一次打牌：不能宣告");
  const chi = seat1FirstTurn();
  chi.players[2].revealed = [meld("chi", "m5 m6 m7")];
  eq(canDeclareTingNow(chi, 1), false, "A7 之前有人吃過：不能宣告（碰、槓同理）");
}
{
  const s = opening();
  s.players[0].discards = tiles("z7"); s.turnCount = 4; s.isFirstRound = false;
  eq(canDeclareTingNow(s, 0), true, "A8 莊家第 2 次打牌（桌上第 5 張）：還可以宣告");
  s.turnCount = 5;
  eq(canDeclareTingNow(s, 0), false, "A9 莊家第 3 次打牌：不能宣告");
  const o = opening();
  const d = declareEyeAndDiscard(o, o.players[0].hand[16].id);
  eq(canDeclareTingNow({ ...d, currentTurn: 0, hasDrawn: true, lastDiscard: null, pendingActions: undefined } as MahjongGameState, 0), false, "A10 已經宣告過：不能再宣告");
}

// --- 宣告後不能改聽 ---
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  eq([s.tingSeats, s.players[1].hand.length], [[1], 16], "B0 seat1 打出中並宣告地聽");
  // 輪回 seat1：摸到不能胡的 9 萬 → 自動打出
  s.pendingActions = undefined; s.currentTurn = 1; s.hasDrawn = false; s.lastDiscard = null;
  s.wall[0] = t("m9");
  const drawn = drawTile(s);
  const auto = autoDiscardForTing(drawn);
  eq([auto?.lastDiscard?.tile.display, auto?.lastDiscard?.from, auto?.players[1].hand.length], ["m9", 1, 16], "B1 地聽後摸到不能胡的牌：自動打出那張");
  eq(ownTurnActions(drawn, 1), [], "B2 摸到不能胡的牌時：沒有任何可做的動作（不能暗槓、加槓、再宣告）");
  throws(() => discardTile(drawn, drawn.players[1].hand[0].id), "B3 地聽後想打別張：擋下");
}
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  s.pendingActions = undefined; s.currentTurn = 1; s.hasDrawn = false; s.lastDiscard = null;
  s.wall[0] = t("s7");
  const drawn = drawTile(s);
  eq([autoDiscardForTing(drawn), ownTurnActions(drawn, 1).map((a) => a.type)], [null, ["win"]], "B4 地聽後摸到能胡的牌：不自動打，只有自摸胡");
  const r = declareWin(drawn, 1, true);
  eq([r.winners![0].score.fans.map((f) => f.name + f.value), calculateSettlement(r).deltas],
    [["地聽8", "自摸1", "莊家(斷)1"], [-300, 860, -280, -280]], "B5 MIGI（地聽）自摸：地聽8+自摸1+莊家(斷)1=10 台（MIGI 一定門清，不算門清自摸 3）；閒家各付 100+9×20=280、莊家付 300", fanStr(r));
}
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  s.players[1].hand = tiles("p5 p5 p5 p5 m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4"); // 手上 4 張 5 筒
  s.pendingActions = undefined; s.currentTurn = 1; s.hasDrawn = true; s.lastDiscard = null;
  s.drawnTileId = s.players[1].hand[0].id;
  eq(ownTurnActions(s, 1).filter((a) => a.type === "kong").length, 0, "B6 地聽後手上有 4 張一樣：不給暗槓");
}
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  s.players[1].hand = tiles("s7 s7 m1 m2 m3 m4 m5 m6 p7 p8 p9 s1 s2 s3 z4 z4"); // 對 7 條＋對北：胡 7 條或北，也能碰 7 條
  s.pendingActions = undefined;
  s.lastDiscard = { tile: t("s7"), from: 2 };
  const acts = getAvailableActions(s).filter((a) => a.playerSeat === 1).map((a) => a.type);
  eq([acts.includes("win"), acts.includes("pong"), acts.includes("kong"), acts.includes("chi")], [true, false, false, false],
    "B7 地聽後別人打出的牌：只能胡，不給吃、碰、槓");
}

// --- 台數 ---
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  s.pendingActions = undefined;
  s.lastDiscard = { tile: t("s7"), from: 3 };
  const r = declareWin(s, 1, false);
  eq([r.winners![0].score.fans.map((f) => f.name + f.value), calculateSettlement(r).deltas], [["地聽8"], [0, 260, 0, -260]],
    "C1 MIGI（地聽）胡閒家放的槍：只有地聽 8 台（不算門清），放槍者付 100+8×20=260", fanStr(r));
}
{
  const hand = tiles(H16); const win = t("s7");
  const ctx = { concealed: [...hand, win], revealed: [], winTile: win, isSelfDraw: true, isDealer: false, seatWind: 2, prevalentWind: 1,
    flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false };
  const both = calculateScore({ ...ctx, isFirstDraw: true, isTing: true });
  eq(both.fans.filter((f) => ["地聽", "地胡", "天胡"].includes(f.name)).map((f) => f.name + f.value), ["地聽8"], "C2 同時符合地聽和地胡：只算地聽 8，不疊加");
  const di = calculateScore({ ...ctx, isFirstDraw: true });
  eq(di.fans.filter((f) => ["地聽", "地胡", "天胡"].includes(f.name)).map((f) => f.name + f.value), ["地胡8"], "C3 地胡：8 台（16 台取消）");
  // MIGI 只拿掉門清自摸（含門清、不求人）、改算自摸 1；獨聽、花等其他台數和沒地聽時一樣
  const single = tiles("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 s6 s7 s8"); const z5 = t("z5"), z5w = t("z5");
  const sctx = { ...ctx, concealed: [...single, z5, z5w], winTile: z5w, isFirstDraw: false, flowers: tiles("f2 f6") };
  const plain = calculateScore(sctx).fans.map((f) => f.name + f.value);
  const migi = calculateScore({ ...sctx, isTing: true }).fans.map((f) => f.name + f.value);
  eq([plain.includes("門清自摸3"), migi.filter((f) => /門清|不求人/.test(f)), migi.includes("地聽8"), migi.includes("自摸1"), migi.includes("獨聽1"),
    migi.filter((f) => f !== "地聽8" && f !== "自摸1"), plain.filter((f) => f !== "門清自摸3")].map((x) => JSON.stringify(x)),
    ["true", "[]", "true", "true", "true", JSON.stringify(plain.filter((f) => f !== "門清自摸3")), JSON.stringify(plain.filter((f) => f !== "門清自摸3"))],
    "C6 MIGI 自摸單吊：有地聽 8、自摸 1、獨聽 1，沒有門清自摸／門清／不求人；其他台數（花等）和一般門清自摸完全一樣", `一般=${plain.join("+")}　MIGI=${migi.join("+")}`);
  const ron = calculateScore({ ...sctx, isSelfDraw: false }).fans.map((f) => f.name + f.value);
  eq([plain.includes("門清自摸3"), ron.includes("門清1")], [true, true], "C7 沒有地聽：門清自摸照樣 3 台、胡別人照樣門清 1 台");
  const tian = calculateScore({ ...ctx, isDealer: true, isFirstDraw: true });
  eq(tian.fans.filter((f) => ["地聽", "地胡", "天胡"].includes(f.name)).map((f) => f.name + f.value), ["天胡24"], "C4 天胡：24 台，只有莊家");
}
// --- 下一局清掉地聽 ---
{
  const base = seat1FirstTurn();
  const s = declareEyeAndDiscard(base, base.players[1].hand[16].id);
  s.status = "finished";
  s.winners = [{ seat: 1, score: { fans: [], totalFan: 1 } }];
  eq(startNextGame(s).tingSeats ?? [], [], "D1 下一局：地聽清掉");
}

// --- C5（審伯退件回歸）開局莊家先暗槓、補牌後自摸：是槓上開花，不是天胡 ---
{
  const s = opening();
  // 莊家 17 張＝4 張 9 萬（暗槓）＋13 張聽 4/7 條；牌尾補到 7 條
  s.players[0].hand = tiles("m9 m9 m9 m9 m1 m2 m3 m4 m5 m6 p7 p8 p9 z4 z4 s5 s6");
  s.wall[s.wall.length - 1] = t("s7");
  const k = executeConcealedKong(s, s.players[0].hand.filter((x) => x.display === "m9"));
  const r = declareWin(k, 0, true);
  const names = r.winners![0].score.fans.map((f) => f.name);
  eq([k.isFirstRound, names.includes("天胡"), names.includes("槓上開花")], [true, false, true],
    "C5 開局莊家暗槓後補牌自摸：沒有天胡 24、有槓上開花", fanStr(r));
  const plain = opening();
  const r2 = declareWin({ ...plain, players: plain.players.map((p, i) => (i === 0 ? { ...p, hand: tiles(H16 + " s7") } : p)) } as MahjongGameState, 0, true);
  eq(r2.winners![0].score.fans.some((f) => f.name === "天胡"), true, "C5b 對照：沒有槓、起手 17 張直接胡仍是天胡", fanStr(r2));
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
