// 暗槓不破壞門清（老闆 2026-11-18 BUG）：門清看的是「有沒有吃、碰、明槓（含碰後加槓）」，暗槓不算。
//   S1 只有暗槓、胡別人的牌：算門清 1 台
//   S2 只有暗槓、自摸：門清自摸 3 台（不再另算門清、自摸）
//   S3 兩組暗槓、自摸：一樣門清自摸 3 台
//   S4 暗槓＋碰：不算門清
//   S5 明槓：不算門清；加槓（碰後加槓，副露存成 type "kong"）：不算門清
//   S6 沒有任何副露：照舊門清 1 台／門清自摸 3 台
import type { Meld } from "../lib/mahjong/gameState";
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string, note = "") {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}${note ? `\n   ${note}` : ""}`}`);
}
let nextId = 9000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
const meld = (type: Meld["type"], k: string, from?: number): Meld => ({ type, tiles: (type === "pong" ? [k, k, k] : [k, k, k, k]).map(t), ...(from !== undefined ? { from } : {}) });
/** 閒家、沒有花；winKey 是手牌裡最後那張 */
function score(keys: string, winKey: string, isSelfDraw: boolean, revealed: Meld[]) {
  const concealed = keys.split(" ").filter(Boolean).map(t);
  const ctx: ScoringContext = { concealed, revealed, winTile: concealed.find((x) => x.suit + x.rank === winKey)!, isSelfDraw, isDealer: false,
    seatWind: 2, prevalentWind: 1, flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: false, isTing: false };
  const r = calculateScore(ctx);
  const of = (name: string) => r.fans.filter((f) => f.name === name).reduce((n, f) => n + f.value, 0);
  return { of, str: r.fans.map((f) => f.name + f.value).join("+"), total: r.totalFan };
}
const FOUR = "m1 m2 m3 m4 m5 m6 p2 p3 p4 s6 s7 s8 s9 s9"; // 四組＋眼（胡 s8，兩面以外的聽法不重要，這裡只看門清）
const THREE = "m1 m2 m3 m4 m5 m6 p2 p3 p4 s9 s9";

{
  const s = score(FOUR, "s8", false, [meld("concealed_kong", "z5")]);
  eq([s.of("門清"), s.of("門清自摸"), s.of("自摸")], [1, 0, 0], "S1 只有暗槓（中）、胡別人的牌：算門清 1 台", s.str);
}
{
  const s = score(FOUR, "s8", true, [meld("concealed_kong", "z5")]);
  eq([s.of("門清自摸"), s.of("門清"), s.of("自摸")], [3, 0, 0], "S2 只有暗槓、自摸：門清自摸 3 台，沒有另外的門清、自摸", s.str);
}
{
  const s = score(THREE, "s9", true, [meld("concealed_kong", "z5"), meld("concealed_kong", "z6")]);
  eq([s.of("門清自摸"), s.of("門清"), s.of("自摸")], [3, 0, 0], "S3 兩組暗槓、自摸：一樣門清自摸 3 台", s.str);
}
{
  const ron = score(THREE, "s9", false, [meld("concealed_kong", "z5"), meld("pong", "z6", 1)]);
  const tsumo = score(THREE, "s9", true, [meld("concealed_kong", "z5"), meld("pong", "z6", 1)]);
  eq([ron.of("門清"), tsumo.of("門清自摸"), tsumo.of("門清"), tsumo.of("自摸")], [0, 0, 0, 1], "S4 暗槓＋碰：不算門清（自摸只算自摸 1 台）", `${ron.str} ／ ${tsumo.str}`);
}
{
  const ming = score(FOUR, "s8", false, [meld("kong", "z5", 1)]);
  const add = score(FOUR, "s8", true, [meld("kong", "z6", 3)]); // 碰後加槓：副露改成 type "kong"，保留 from
  eq([ming.of("門清"), add.of("門清自摸"), add.of("門清"), add.of("自摸")], [0, 0, 0, 1], "S5 明槓不算門清；加槓（碰後加槓）也不算門清，自摸只算自摸 1 台", `${ming.str} ／ ${add.str}`);
}
{
  const ron = score("m1 m2 m3 m4 m5 m6 p2 p3 p4 p6 p7 p8 s6 s7 s8 s9 s9", "s8", false, []);
  const tsumo = score("m1 m2 m3 m4 m5 m6 p2 p3 p4 p6 p7 p8 s6 s7 s8 s9 s9", "s8", true, []);
  eq([ron.of("門清"), tsumo.of("門清自摸"), tsumo.of("門清"), tsumo.of("自摸")], [1, 3, 0, 0], "S6 沒有副露：照舊門清 1 台、自摸改算門清自摸 3 台", `${ron.str} ／ ${tsumo.str}`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
