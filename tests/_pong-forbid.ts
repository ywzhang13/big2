// 碰牌後這一輪不能打同種牌（老闆 2026-11-18 BUG：碰八筒完當下不能打八筒，比照吃牌的食替）
//   P1 碰八筒：這輪不能打八筒（手上第 4 張八筒也不行），擋下的訊息是「剛碰的牌，這輪不能打」；其他牌照打
//   P2 限制只管碰完的這一次出牌：打出一張後清掉；下一輪自己摸牌後八筒照打
//   P3 吃牌食替不變：六七條吃五條，五條、八條不能打，訊息照舊；限制來源是「吃」
//   P4 明槓不受影響（槓完補牌，沒有限制）
//   P5 眼牌的出牌選項不含碰的那種牌
//   P6 保險：狀態被改到手上只剩同種牌時不限制（不會卡局；正常牌局碰完手上至少還有一張別的牌）
//   P7 前端提示文字：碰「剛碰的牌，這輪不能打」、吃照舊「剛吃的牌，這輪不能打同一搭」；伺服器沒給來源（舊版）當吃
import * as gl from "../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../lib/mahjong/gameState";
import { tileKey, type Tile, type TileSuit } from "../lib/mahjong/tiles";
import * as ui from "../lib/mahjong/chiForbid";

const { advanceTurn, chiForbiddenKeys, discardTile, drawTile, executeAction, eyeDiscardOptions, getAvailableActions } = gl;
// 新增的 chiForbiddenBy（限制來源：吃／碰）；修正前沒有這個函式，當成 undefined（測試照常跑出 ❌，不會整個檔案當掉）
const chiForbiddenBy = (s: MahjongGameState, seat: number): unknown =>
  (gl as unknown as { chiForbiddenBy?: (s: MahjongGameState, seat: number) => unknown }).chiForbiddenBy?.(s, seat);
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let nextId = 8000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
/** 座位 2 打出 disc，座位 0 手上是 hand（座位 0 不是下家，只能碰、槓） */
function game(hand: string, disc: string, from = 2): MahjongGameState {
  const d = t(disc);
  return {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: seat === 0 ? tiles(hand) : tiles("m1 m1 m4 m4 p2 p2 p7 p7 s2 s2 z5 z5 z6 z6 z7 z7"),
      revealed: [], flowers: [], discards: seat === from ? [d] : [], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: from, lastDiscard: { tile: d, from }, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 9, hasDrawn: false, isFirstRound: false, isAfterKong: false,
  } as unknown as MahjongGameState;
}
const act = (s: MahjongGameState, type: string, seat = 0) => {
  const a = getAvailableActions(s).find((x) => x.playerSeat === seat && x.type === type);
  if (!a) throw new Error(`沒有 ${type}`);
  return executeAction(s, a);
};
const tryDiscard = (s: MahjongGameState, key: string) => {
  const tile = s.players[s.currentTurn].hand.find((x) => tileKey(x) === key)!;
  try { discardTile(s, tile.id); return "ok"; } catch (e) { return (e as Error).message; }
};
const HAND = "p8 p8 p8 m3 m5 m7 s1 s4 z1 z2 z3 z4 m9 s9 p1 p5"; // 三張八筒＋雜牌

// P1
{
  const s = act(game(HAND, "p8"), "pong");
  eq([chiForbiddenKeys(s, 0), chiForbiddenBy(s, 0), tryDiscard(s, "p8"), tryDiscard(s, "m3"), tryDiscard(s, "z1")],
    [["p8"], "pong", "剛碰的牌，這輪不能打", "ok", "ok"], "P1 碰八筒：這輪不能打八筒（手上的第 3 張也不行），訊息「剛碰的牌，這輪不能打」；其他牌照打");
}
// P2
{
  let s = act(game(HAND, "p8"), "pong");
  s = discardTile(s, s.players[0].hand.find((x) => tileKey(x) === "z1")!.id);
  eq([s.chiForbid ?? null, chiForbiddenKeys(s, 0), chiForbiddenBy(s, 0)], [null, [], null], "P2a 碰完打出一張之後：限制清掉");
  s = { ...advanceTurn({ ...s, currentTurn: 3 }), lastDiscard: null } as MahjongGameState; // 下一輪輪到座位 0
  s = drawTile(s);
  eq(tryDiscard(s, "p8"), "ok", "P2b 下一輪自己摸牌後：八筒照打");
}
// P3
{
  const g = game("s5 s6 s7 s8 m3 m5 m7 p1 p3 p5 z1 z2 z3 z4 z5 z6", "s5", 3); // 座位 3 打，座位 0 是下家
  const a = getAvailableActions(g).find((x) => x.playerSeat === 0 && x.type === "chi" && x.tiles!.map((y) => y.display).sort().join() === "s6,s7")!;
  const s = executeAction(g, a);
  eq([chiForbiddenKeys(s, 0), chiForbiddenBy(s, 0), tryDiscard(s, "s8"), tryDiscard(s, "z1")], [["s5", "s8"], "chi", "吃完這輪不能打出和吃的那兩張湊成順子的牌", "ok"],
    "P3 吃牌食替不變：六七條吃五條，五條、八條不能打（訊息照舊），限制來源是吃");
}
// P4
{
  const s = act(game(HAND, "p8"), "kong");
  eq([chiForbiddenKeys(s, 0), s.chiForbid ?? null], [[], null], "P4 明槓八筒：沒有打牌限制");
}
// P5
{
  const g = game(HAND, "p8");
  const s = act(g, "pong");
  s.eyeSeats = []; s.isFirstRound = true; s.turnCount = 1; // 讓眼牌選項的時機成立與否不影響：只檢查選項裡沒有八筒
  eq(eyeDiscardOptions(s, 0).some((x) => tileKey(x) === "p8"), false, "P5 眼牌的出牌選項不含碰的那種牌");
}
// P6
{
  const s = act(game(HAND, "p8"), "pong");
  s.players[0].hand = tiles("p8");
  eq(chiForbiddenKeys(s, 0), [], "P6 狀態被改到手上只剩八筒：不限制（不會卡局）");
}

// P7（修正前沒有 forbidHint、forbidBy：當成 undefined，照常跑出 ❌）
{
  const u = ui as unknown as { forbidHint?: (by: string) => string; forbidBy?: (raw: unknown) => string };
  eq([u.forbidHint?.("pong"), u.forbidHint?.("chi"), u.forbidBy?.("pong"), u.forbidBy?.("chi"), u.forbidBy?.(undefined), u.forbidBy?.("x")],
    ["剛碰的牌，這輪不能打", "剛吃的牌，這輪不能打同一搭", "pong", "chi", "chi", "chi"], "P7 前端提示文字：碰「剛碰的牌，這輪不能打」、吃照舊；伺服器沒給來源或給錯的值都當吃");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
