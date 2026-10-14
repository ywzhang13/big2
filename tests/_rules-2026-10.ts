// 2026-10 老闆確認的規則：莊家台、一砲多響、獨聽、全求人、字一色、地胡。
// 全部走 declareWin → applyWinnerOrderRule → calculateSettlement，用真實手牌。
// 共同設定：底 100、每台 20、dealer=seat 0、doorSeat=0（seat0 東、1 南、2 西、3 北）、圈風東。
import { declareWin, applyWinnerOrderRule, calculateSettlement } from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 1000;
function t(key: string): Tile {
  const suit = key[0] as TileSuit;
  const rank = parseInt(key.slice(1), 10);
  return { id: nextId++, suit, rank, display: key };
}
function tiles(keys: string): Tile[] {
  return keys.split(" ").filter(Boolean).map(t);
}
function meld(type: Meld["type"], keys: string): Meld {
  return { type, tiles: tiles(keys) };
}

// 16-tile hands
const H_TWO_SIDED = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1s/4s/7s，門清 1 台
const H_SINGLE_7S = "m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 p3 z3 z3 z3 s7"; // 單吊 7s：門清 1 + 獨聽 1 = 2
const H_EDGE_7S = "m1 m2 m3 m4 m5 m6 p1 p2 p3 z5 z5 z5 p5 p5 s8 s9"; // 邊張 7s：門清 1 + 獨聽 1 + 三元牌 1 = 3

function baseState(consecutive = 0): MahjongGameState {
  return {
    roomCode: "TEST",
    status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat,
      hand: [], revealed: [], flowers: [], discards: [tiles("m9")[0]],
      isDealer: seat === 0,
    })),
    wall: tiles(Array(40).fill("m1").join(" ")), // 非海底
    currentTurn: 0,
    lastDiscard: null,
    dealerSeat: 0,
    doorSeat: 0,
    prevalentWind: 1,
    turnCount: 8,
    hasDrawn: false,
    isFirstRound: false,
    isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: consecutive, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
}

/** seats win off `from`'s discard of `tileKey` */
function ron(s: MahjongGameState, from: number, tileKey: string, seats: number[]) {
  s.lastDiscard = { tile: t(tileKey), from };
  for (const seat of seats) s = declareWin(s, seat, false);
  s = applyWinnerOrderRule(s);
  return { state: s, settle: calculateSettlement(s) };
}
/** seat self-draws `tileKey` */
function zimo(s: MahjongGameState, seat: number, tileKey: string) {
  s.currentTurn = seat;
  s.hasDrawn = true;
  s.players[seat].hand.push(t(tileKey));
  s = declareWin(s, seat, true);
  return { state: s, settle: calculateSettlement(s) };
}
const fanStr = (st: MahjongGameState) =>
  (st.winners ?? []).map((w) => `seat${w.seat}:${w.score.fans.map((f) => f.name + f.value).join("+")}=${w.score.totalFan}`).join(" | ");

const results: string[] = [];
function eq(actual: unknown, expected: unknown, msg: string, detail = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}${detail ? "\n   " + detail : ""}`);
}

// ① 非莊家放槍給非莊家：不加莊家台，莊家不付（連 2 也一樣）
{
  const s = baseState(2);
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 3, "s7", [1]);
  eq(r.settle.deltas, [0, 120, 0, -120], "①a 閒放閒（連2）：只算門清 1 台，放槍者付 120，莊家 0", fanStr(r.state));
}
// ① 莊家放槍給閒家（連 2）：贏家加 莊家1+連2+拉2
{
  const s = baseState(2);
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 0, "s7", [1]);
  eq(r.settle.deltas, [-220, 220, 0, 0], "①b 莊放閒（連2）：門清1+莊家(斷)1+連2+拉2=6 台，莊家付 220", fanStr(r.state));
}
// ① 閒家自摸（連 1）：只有莊家那份加 1+1+1
{
  const s = baseState(1);
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  eq(r.settle.deltas, [-220, 540, -160, -160], "①c 閒自摸（連1）：閒家各付 100+3×20=160，莊家付 160+3×20=220", fanStr(r.state));
}
// ① 莊家自摸（連 1）：三家都加
{
  const s = baseState(1);
  s.players[0].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 0, "s7");
  eq(r.settle.deltas, [660, -220, -220, -220], "①d 莊自摸（連1）：門清自摸3+莊家1+連1+拉1=6，三家各付 220", fanStr(r.state));
}
// ① 莊家胡別人（連 1）：放槍者付含連拉
{
  const s = baseState(1);
  s.players[0].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 3, "s7", [0]);
  eq(r.settle.deltas, [180, 0, 0, -180], "①e 莊胡閒放（連1）：門清1+莊家1+連1+拉1=4，放槍者付 180", fanStr(r.state));
}
// ② 三響且莊家是贏家（PM 驗收例子）
{
  const s = baseState(0);
  s.players[0].hand = tiles(H_TWO_SIDED); // 門清1+莊家1=2
  s.players[1].hand = tiles(H_SINGLE_7S); // 原始 2
  s.players[2].hand = tiles(H_EDGE_7S);   // 原始 3
  const r = ron(s, 3, "s7", [0, 1, 2]);
  eq(r.settle.deltas, [140, 140, 160, -440], "②a 三響含莊家贏：只有付莊家那筆有莊家台", fanStr(r.state));
}
// ② 三響且莊家放槍（連 1）：三位贏家都加莊家1+連1+拉1
{
  const s = baseState(1);
  s.players[1].hand = tiles(H_SINGLE_7S); // 2+3=5 → 200
  s.players[2].hand = tiles(H_EDGE_7S);   // 3+3=6 → 220
  s.players[3].hand = tiles(H_TWO_SIDED); // 1+3=4 → 180
  const r = ron(s, 0, "s7", [1, 2, 3]);
  eq(r.settle.deltas, [-600, 200, 220, 180], "②b 三響莊家放槍（連1）：三家都加 3 台", fanStr(r.state));
}
// ② 雙響：只算離放槍者最近那家，再套原則①
{
  const s = baseState(0);
  s.players[1].hand = tiles(H_SINGLE_7S);
  s.players[2].hand = tiles(H_EDGE_7S);
  const r = ron(s, 0, "s7", [2, 1]);
  eq(r.settle.deltas, [-160, 160, 0, 0], "②c 雙響莊家放槍：只有 seat1（下家）胡，2+莊家(斷)1=3 台", fanStr(r.state));
}
// ⑥ 獨聽：6、8 筒胡 7 筒 → 只 1 台獨聽
{
  const s = baseState(0);
  s.players[1].hand = tiles("m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z1 z1 p6 p8");
  const r = ron(s, 3, "p7", [1]);
  const fans = r.state.winners![0].score.fans.map((f) => f.name);
  eq([fans.filter((n) => ["獨聽", "中洞", "邊張"].includes(n)), r.state.winners![0].score.totalFan],
    [["獨聽"], 2], "⑥a 中洞 6p8p 胡 7p：獨聽 1 次，門清1+獨聽1=2", fanStr(r.state));
}
{
  const s = baseState(0);
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 3, "s7", [1]);
  eq(r.state.winners![0].score.fans.some((f) => f.name === "獨聽"), false, "⑥b 聽三種牌（1s/4s/7s）：沒有獨聽", fanStr(r.state));
}
// ⑤ 全求人：五組吃碰、手上單吊、胡別人
const QQR_MELDS = () => [
  meld("chi", "m1 m2 m3"), meld("chi", "p4 p5 p6"), meld("pong", "s7 s7 s7"),
  meld("chi", "s2 s3 s4"), meld("pong", "m9 m9 m9"),
];
{
  const s = baseState(0);
  s.players[1].revealed = QQR_MELDS();
  s.players[1].hand = tiles("z4");
  const r = ron(s, 3, "z4", [1]);
  eq(r.state.winners![0].score.fans.map((f) => f.name + f.value), ["獨聽1", "全求人1"], "⑤a 全求人：獨聽1+全求人1=2", fanStr(r.state));
}
{
  const s = baseState(0);
  s.players[1].revealed = QQR_MELDS();
  s.players[1].hand = tiles("z4");
  const r = zimo(s, 1, "z4");
  eq(r.state.winners![0].score.fans.some((f) => f.name === "全求人"), false, "⑤b 五組吃碰但自摸：不算全求人", fanStr(r.state));
}
{
  const s = baseState(0);
  s.players[1].revealed = [...QQR_MELDS().slice(0, 4), meld("concealed_kong", "m9 m9 m9 m9")];
  s.players[1].hand = tiles("z4");
  const r = ron(s, 3, "z4", [1]);
  eq(r.state.winners![0].score.fans.some((f) => f.name === "全求人"), false, "⑤c 有暗槓：不算全求人", fanStr(r.state));
}
// ⑤ 字一色 16 台（seat1 南、圈風東）
{
  const s = baseState(0);
  s.players[1].hand = tiles("z1 z1 z1 z2 z2 z2 z5 z5 z5 z6 z6 z6 z3 z3 z3 z7");
  const r = ron(s, 3, "z7", [1]);
  const fans = r.state.winners![0].score.fans.map((f) => f.name + f.value);
  eq([fans.includes("字一色16"), fans.some((f) => f.startsWith("混一色")), r.state.winners![0].score.totalFan],
    [true, false, 38],
    "⑤d 字一色：門清1+獨聽1+碰碰胡4+字一色16+三元牌1×2+小三元4+風牌(東圈)1+風牌(南門)1+五暗刻8=38，不算混一色", fanStr(r.state));
}
// ⑦ 地胡：閒家第一次摸牌就胡（自摸或胡莊家的牌）；之前有人碰、明槓、暗槓就不算
{
  const s = baseState(0);
  s.players[1].discards = [];
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  const fans = r.state.winners![0].score.fans.map((f) => f.name + f.value);
  eq(fans.includes("地胡16"), true, "⑦a 閒家第一次摸牌自摸：有地胡 16", fanStr(r.state));
}
{
  const s = baseState(0); // seat1 已打過 1 張
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), false, "⑦b 閒家已打過牌再自摸：沒有地胡", fanStr(r.state));
}
{
  const s = baseState(0);
  s.players[1].discards = [];
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 0, "s7", [1]);
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), true, "⑦c 閒家胡莊家第一張牌（放槍）：也算地胡", fanStr(r.state));
}
{
  const s = baseState(0); // 第一次摸牌前有人碰過
  s.players[1].discards = [];
  s.players[3].revealed = [meld("pong", "m5 m5 m5")];
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), false, "⑦e 之前有人碰過：不算地胡", fanStr(r.state));
}
{
  const s = baseState(0); // 第一次摸牌前莊家暗槓過
  s.players[1].discards = [];
  s.players[0].revealed = [meld("concealed_kong", "m5 m5 m5 m5")];
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), false, "⑦f 之前有人暗槓過：不算地胡", fanStr(r.state));
}
{
  const s = baseState(0); // 老闆確認（DIHU_CHI_BREAKS=true）：吃也破地胡
  s.players[1].discards = [];
  s.players[3].revealed = [meld("chi", "m5 m6 m7")];
  s.players[1].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 1, "s7");
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), false, "⑦g 之前有人吃過：不算地胡", fanStr(r.state));
}
{
  const s = baseState(0); // 待老闆確認（DIHU_RON_FROM_ANY=false）：胡閒家的牌不算
  s.players[2].discards = [];
  s.players[2].hand = tiles(H_TWO_SIDED);
  const r = ron(s, 1, "s7", [2]);
  eq(r.state.winners![0].score.fans.some((f) => f.name === "地胡"), false, "⑦h【暫定】胡其他閒家第一輪的牌：目前不算地胡", fanStr(r.state));
}
{
  const s = baseState(0); // 天胡回歸：莊家 17 張起手胡
  s.isFirstRound = true;
  s.players[0].discards = [];
  s.players[0].hand = tiles(H_TWO_SIDED);
  const r = zimo(s, 0, "s7");
  const fans = r.state.winners![0].score.fans.map((f) => f.name + f.value);
  eq([fans.includes("天胡24"), fans.some((f) => f.startsWith("地胡"))], [true, false], "⑦d 天胡不受影響", fanStr(r.state));
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
