// 食替（老闆 2026-10-21）：用手上兩張吃了上家的牌之後，同一輪打出的牌不能和「吃牌用的那兩張」湊成順子。
//   F1 六七條吃五條：這輪不能打五條、八條；其他牌照打
//   F2 五七條吃六條（中洞）：這輪不能打六條；五條、七條照打
//   F3 邊張：八九條吃七條只禁七條；一二萬吃三萬只禁三萬（沒有 0、10）；一三筒吃二筒（中洞）只禁二筒
//   F4 限制只持續吃完後的這一次出牌：打出一張後就清掉，下一輪同一種牌照打
//   F5 碰、明槓不受影響：碰完沒有禁打的牌
//   F6 吃完手上沒有能打的牌：那種吃法不提供；全部吃法都不行就沒有「吃」（碰照常）；硬送 executeAction 也會擋
//   F7 宣告眼牌的出牌選項也不含禁打的牌
//   F8 保險：狀態被改到手上全是禁打的牌時不限制（不會卡局）
//   F9 2000 手模擬（電腦玩家只從能打的牌裡挑、能吃就吃）：沒有卡局、沒有一次打出禁打的牌、每次吃完都有牌可打
import {
  advanceTurn, chiForbiddenKeys, chiForbiddenKeysFor, dealTiles, declareWin, discardTile, drawTile, executeAction,
  eyeDiscardOptions, getAvailableActions, initGame, isGuoShui, passFlowerRob,
} from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import { tileKey, type Tile, type TileSuit } from "../lib/mahjong/tiles";
import { isWinningHand } from "../lib/mahjong/winCheck";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let nextId = 7000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const FILL = "z1 z2 z3 z4 z5 z6 z7 m9 p9"; // 不會湊成什麼的雜牌

/** 座位 3 打出 disc，座位 0（下家）手上是 hand */
function game(hand: string, disc: string, revealed: Meld[] = []): MahjongGameState {
  const d = t(disc);
  return {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: seat === 0 ? tiles(hand) : tiles("m1 m1 m4 m4 p2 p2 p7 p7 s2 s2 z5 z5 z6 z6 z7 z7"),
      revealed: seat === 0 ? revealed : [], flowers: [], discards: seat === 3 ? [d] : [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: 3, lastDiscard: { tile: d, from: 3 }, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 9, hasDrawn: false, isFirstRound: false, isAfterKong: false,
  } as unknown as MahjongGameState;
}
const chiOpts = (s: MahjongGameState) => getAvailableActions(s).filter((a) => a.playerSeat === 0 && a.type === "chi").map((a) => a.tiles!.map((x) => x.display).sort().join("+"));
function chi(s: MahjongGameState, a: string, b: string) {
  const act = getAvailableActions(s).find((x) => x.playerSeat === 0 && x.type === "chi" && x.tiles!.map((y) => y.display).sort().join("+") === [a, b].sort().join("+"));
  if (!act) throw new Error(`沒有 ${a}+${b} 的吃法`);
  return executeAction(s, act);
}
const tryDiscard = (s: MahjongGameState, key: string) => {
  const tile = s.players[s.currentTurn].hand.find((x) => tileKey(x) === key)!;
  try { discardTile(s, tile.id); return "ok"; } catch (e) { return (e as Error).message.includes("湊成順子") ? "forbidden" : (e as Error).message; }
};

// F1
{
  const s = chi(game(`s5 s6 s7 s8 ${FILL} m3 m5`, "s5"), "s6", "s7");
  eq([chiForbiddenKeys(s, 0), tryDiscard(s, "s5"), tryDiscard(s, "s8"), tryDiscard(s, "m3"), tryDiscard(s, "z1")], [["s5", "s8"], "forbidden", "forbidden", "ok", "ok"],
    "F1 六七條吃五條：五條、八條都不能打（手上另一張五條也不行），其他牌照打");
}
// F2
{
  const s = chi(game(`s5 s6 s7 ${FILL} m3 m5 s1`, "s6"), "s5", "s7");
  eq([chiForbiddenKeys(s, 0), tryDiscard(s, "s6"), tryDiscard(s, "s1")], [["s6"], "forbidden", "ok"], "F2 五七條吃六條（中洞）：六條不能打，其他照打");
  const s2 = chi(game(`s4 s5 s7 s9 ${FILL} m3 m5`, "s6"), "s5", "s7");
  eq([tryDiscard(s2, "s4"), tryDiscard(s2, "s9")], ["ok", "ok"], "F2b 五七條吃六條：四條、九條和五七條湊不成順子，照打");
}
// F3
{
  eq([chiForbiddenKeysFor(t("s8"), t("s9")), chiForbiddenKeysFor(t("m1"), t("m2")), chiForbiddenKeysFor(t("p1"), t("p3")), chiForbiddenKeysFor(t("p9"), t("p7"))],
    [["s7"], ["m3"], ["p2"], ["p8"]], "F3 邊張：八九條只禁七條、一二萬只禁三萬；中洞：一三筒禁二筒、七九筒禁八筒（不會出現 0、10）");
  const s = chi(game(`s8 s9 s7 s6 ${FILL} m3 m5`, "s7"), "s8", "s9");
  eq([tryDiscard(s, "s7"), tryDiscard(s, "s6")], ["forbidden", "ok"], "F3b 八九條吃七條：手上另一張七條不能打；六條可以（六八九不是順子）");
}
// F4
{
  let s = chi(game(`s5 s6 s7 s8 ${FILL} m3 m5`, "s5"), "s6", "s7");
  s = discardTile(s, s.players[0].hand.find((x) => x.display === "m3")!.id);
  eq([s.chiForbid ?? null, chiForbiddenKeys(s, 0)], [null, []], "F4 吃完打出一張之後：限制清掉");
  s = { ...advanceTurn({ ...s, currentTurn: 3 }), lastDiscard: null } as MahjongGameState; // 下一輪又輪到座位 0
  s = drawTile(s);
  eq([tryDiscard(s, "s8"), tryDiscard(s, "s5")], ["ok", "ok"], "F4b 下一輪自己摸牌後：五條、八條照打（只限吃完的那一次）");
}
// F5
{
  const g = game(`s5 s5 s6 s7 s8 ${FILL} m3`, "s5");
  const pong = getAvailableActions(g).find((a) => a.playerSeat === 0 && a.type === "pong")!;
  const s = executeAction(g, pong);
  eq([chiForbiddenKeys(s, 0), s.chiForbid ?? null, tryDiscard(s, "s8"), tryDiscard(s, "s6")], [[], null, "ok", "ok"], "F5 碰五條：不受食替限制，四、六、八條照打");
}
// F6
{
  const melds: Meld[] = [0, 1, 2].map(() => ({ type: "pong", tiles: tiles("z1 z1 z1"), from: 1 }));
  const only = game("s6 s7 s8 s8", "s5", melds); // 吃完剩 s8 s8，都不能打
  eq(chiOpts(only), [], "F6 六七條吃五條後只剩兩張八條（都不能打）：不提供這種吃法，也沒有別的吃法 → 沒有「吃」");
  let threw = "";
  try { executeAction(only, { type: "chi", playerSeat: 0, tiles: only.players[0].hand.filter((x) => x.display === "s6" || x.display === "s7") }); } catch (e) { threw = (e as Error).message; }
  eq(threw.includes("沒有能打的牌"), true, "F6b 硬送吃（不經過選項）：executeAction 也擋下");
  const both = game("s3 s4 s6 s7 s8 s8 m1", "s5", melds.slice(0, 2)); // 三種吃法都還有牌可打
  eq(chiOpts(both), ["s3+s4", "s4+s6", "s6+s7"], "F6c 吃完還有牌可打的吃法照常提供（三四、四六、六七條）");
  const pongOnly = game("s5 s5 s6 s7", "s5", melds); // 六七吃完剩五五（禁打）→ 不能吃；可以碰
  eq([chiOpts(pongOnly), getAvailableActions(pongOnly).some((a) => a.playerSeat === 0 && a.type === "pong")], [[], true], "F6d 吃不了的時候碰照常可以");
}
// F7
{
  const s = chi(game("s5 s6 s7 s8 m1 m2 m3 p4 p5 p6 z1 z1 z2", "s5", []), "s6", "s7");
  const eye = eyeDiscardOptions(s, 0).map((x) => x.display);
  eq([eye.includes("s5"), eye.includes("s8")], [false, false], "F7 吃完可以宣告眼牌時：出牌選項不含禁打的五條、八條");
}
// F8
{
  const s = chi(game(`s5 s6 s7 s8 ${FILL} m3 m5`, "s5"), "s6", "s7");
  s.players[0].hand = tiles("s5 s8 s8");
  eq(chiForbiddenKeys(s, 0), [], "F8 萬一手上全是禁打的牌（資料被改過）：不限制，免得卡局");
}

// F9 2000 手模擬
{
  let seed = 20261021;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const realRandom = Math.random; Math.random = rnd;
  const stats = { hands: 0, finished: 0, wins: 0, draws: 0, chis: 0, forbidHits: 0, stuck: 0, badDiscard: 0, noLegal: 0, errors: [] as string[] };
  const legal = (s: MahjongGameState) => { const f = chiForbiddenKeys(s, s.currentTurn); return s.players[s.currentTurn].hand.filter((x) => x.suit !== "f" && !f.includes(tileKey(x))); };
  for (let h = 0; h < 2000; h++) {
    stats.hands++;
    let s = dealTiles(initGame(["a", "b", "c", "d"].map((id) => ({ id, name: id })), { totalRounds: 1, basePoints: 100, fanPoints: 20 }));
    let steps = 0, done = false;
    try {
      while (!done) {
        if (++steps > 600) { stats.stuck++; break; }
        if (s.status === "finished") { stats.finished++; stats.draws++; break; }
        if (s.pendingFlowerRob) { s = passFlowerRob(s); continue; }
        if (!s.hasDrawn) { s = drawTile(s); continue; }
        const seat = s.currentTurn;
        const me = s.players[seat]; // 只看能不能自摸（ownTurnActions 還會算眼牌選項，2000 手太慢）
        if (s.drawnTileId !== undefined && !isGuoShui(s, seat) && isWinningHand(me.hand, me.revealed.length) && rnd() < 0.7) { declareWin(s, seat, true); stats.wins++; stats.finished++; break; }
        const f = chiForbiddenKeys(s, seat);
        if (f.length) stats.forbidHits++;
        const ok = legal(s);
        if (ok.length === 0) { stats.noLegal++; break; }
        const pick = ok[Math.floor(rnd() * ok.length)];
        if (f.includes(tileKey(pick))) stats.badDiscard++;
        s = discardTile(s, pick.id);
        const acts = getAvailableActions(s);
        const win = acts.find((a) => a.type === "win");
        if (win && rnd() < 0.7) { declareWin(s, win.playerSeat, false); stats.wins++; stats.finished++; break; }
        const claim = acts.find((a) => a.type === "pong" && rnd() < 0.5) ?? acts.find((a) => a.type === "chi" && rnd() < 0.8);
        if (claim) {
          s = executeAction(s, claim);
          if (claim.type === "chi") {
            stats.chis++;
            if (legal(s).length === 0) stats.noLegal++;
          }
          continue;
        }
        s = drawTile(advanceTurn(s));
      }
    } catch (e) { stats.errors.push(`${h}:${(e as Error).message}`); }
  }
  Math.random = realRandom;
  eq([stats.hands, stats.finished, stats.stuck, stats.noLegal, stats.badDiscard, stats.errors.slice(0, 3), stats.chis > 1000, stats.forbidHits === stats.chis],
    [2000, 2000, 0, 0, 0, [], true, true],
    `F9 2000 手模擬：全部打完（胡 ${stats.wins}、流局 ${stats.draws}），吃 ${stats.chis} 次每次都有牌可打、${stats.forbidHits} 次有禁打的牌，沒有卡局、沒有打出禁打的牌`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
