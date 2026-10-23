// 2026-10-21 老闆規則：天胡不另算門清、自摸、門清自摸，其他台（三暗刻、清一色、四喜、碰碰胡、三元牌、獨聽…）照一般規則算。
//   T1 固定種子產生 2000 手各式胡牌：非天胡的每一手，台數和台名都和改前（fixtures 基準檔）完全一樣
//   T2 同一批裡的天胡：剛好等於改前的結果拿掉門清、自摸、門清自摸，其他台一個不少
//   T3 指定牌型：天胡疊獨聽、三元牌、清一色、碰碰胡、暗刻、大小四喜照算，沒有門清、自摸
//   T5 河底撈魚（2026-10-21 新增）只出現在「最後一張＋胡別人打的牌」的手，其他台不變
//   T4 真實結算流程（declareWin）：連 2 拉 2 照加；結算照自摸三家付；整場統計、斗內共用的自摸判斷照樣算自摸
// 重產基準檔（只能在改規則之前跑）：WRITE_GOLDEN=1 node --import ./tests/support/register.mjs tests/_tianhu-scoring.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import { calculateSettlement, declareWin, isSelfDrawWin, tallyHandStats } from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string, note = "") {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}${note ? `\n   ${note}` : ""}`}`);
}
const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/scoring-golden-2026-10-21.json");
const TIANHU_DROPS = ["門清", "自摸", "門清自摸"];

let nextId = 9000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);

// ---- T1／T2：固定種子的隨機胡牌 ----
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261021);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
const KINDS = [..."mps"].flatMap((s) => Array.from({ length: 9 }, (_, i) => s + (i + 1))).concat(Array.from({ length: 7 }, (_, i) => "z" + (i + 1)));
function makeCase(): ScoringContext {
  for (;;) {
    const used = new Map<string, number>();
    const take = (keys: string[]) => keys.forEach((k) => used.set(k, (used.get(k) ?? 0) + 1));
    const melds: { kind: "chi" | "pong" | "kong"; keys: string[] }[] = [];
    // 偏向字牌和刻子，讓風牌、三元、四喜、碰碰胡都有機會出現
    for (let i = 0; i < 5; i++) {
      const r = R();
      if (r < 0.45) { const s = pick([..."mps"]), n = 1 + Math.floor(R() * 7); melds.push({ kind: "chi", keys: [s + n, s + (n + 1), s + (n + 2)] }); }
      else { const k = R() < 0.4 ? "z" + (1 + Math.floor(R() * 7)) : pick(KINDS); melds.push({ kind: R() < 0.1 ? "kong" : "pong", keys: Array(R() < 0.1 ? 4 : 3).fill(k) }); }
    }
    melds.forEach((m) => { if (m.kind === "kong") m.keys = Array(4).fill(m.keys[0]); if (m.kind === "pong") m.keys = m.keys.slice(0, 3); take(m.keys); });
    const pair = pick(KINDS); take([pair, pair]);
    if ([...used.values()].some((c) => c > 4)) continue;
    const nRev = pick([0, 0, 0, 0, 1, 1, 2, 3, 5]);
    const revealed: Meld[] = [], concealed: Tile[] = [];
    melds.forEach((m, i) => {
      if (i < nRev || m.kind === "kong") revealed.push({ type: m.kind === "kong" ? (R() < 0.5 ? "concealed_kong" : "kong") : m.kind, tiles: tiles(m.keys.join(" ")) });
      else concealed.push(...tiles(m.keys.join(" ")));
    });
    concealed.push(...tiles(`${pair} ${pair}`));
    if (concealed.length === 0) continue;
    const flowers = Array.from({ length: 8 }, (_, i) => i + 1).filter(() => R() < 0.25).map((r) => t("f" + r));
    const isSelfDraw = R() < 0.5;
    const winTile = concealed[Math.floor(R() * concealed.length)];
    return {
      concealed, revealed, winTile, isSelfDraw, isDealer: R() < 0.4, seatWind: 1 + Math.floor(R() * 4), prevalentWind: 1 + Math.floor(R() * 4), flowers,
      isLastTile: R() < 0.1, isAfterKong: isSelfDraw && R() < 0.1, isRobbingKong: !isSelfDraw && R() < 0.05, isFirstDraw: R() < 0.3, isTing: R() < 0.1,
    };
  }
}
const cases = Array.from({ length: 2000 }, makeCase);
const fmt = (r: { fans: { name: string; value: number }[]; totalFan: number }) => `${r.totalFan}|${r.fans.map((f) => f.name + f.value).join(",")}`;
const raw = cases.map((c) => fmt(calculateScore(c)));
// 2026-10-21 新增河底撈魚：基準檔是加之前產的。「最後一張＋胡別人打的牌（不是搶槓）」的手拿掉河底撈魚 1 台後比對，其他手原樣比對（T5 另外驗河底撈魚只出現在這些手）
const isHedi = (c: ScoringContext) => c.isLastTile && !c.isSelfDraw && !c.isRobbingKong;
const noHedi = (g: string) => { const [n, f] = g.split("|"); const kept = f.split(",").filter((x) => x !== "河底撈魚1"); return kept.length === f.split(",").length ? g : `${Number(n) - 1}|${kept.join(",")}`; };
const out = raw.map((r, i) => (isHedi(cases[i]) ? noHedi(r) : r));
const isTianhu = (c: ScoringContext) => c.isFirstDraw && c.isDealer;
// 2026-10-23 三元、四喜改台（老闆）：基準檔是改之前產的。有大三元、小三元的手拿掉「三元牌」；
// 小四喜而且圈風是刻子（或槓）的手，在小四喜前面補 1 台風牌（圈風），再比對（T6 另外驗只有這些手不一樣）
const keysOf = (c: ScoringContext) => [...c.concealed, ...c.revealed.flatMap((m) => m.tiles)].map((x) => x.suit + x.rank);
const honorAdj = (g: string, c: ScoringContext) => {
  let f = g.split("|")[1].split(",").filter(Boolean);
  if (f.some((x) => /^(大三元|小三元)\d/.test(x))) f = f.filter((x) => x !== "三元牌1");
  if (f.includes("小四喜8") && keysOf(c).filter((k) => k === `z${c.prevalentWind}`).length >= 3) f.splice(f.indexOf("小四喜8"), 0, "風牌1");
  return `${f.reduce((n, x) => n + Number(x.match(/\d+$/)![0]), 0)}|${f.join(",")}`;
};
if (process.env.WRITE_GOLDEN) {
  writeFileSync(GOLDEN, JSON.stringify(out, null, 0).replace(/","/g, '",\n"') + "\n");
  console.log(`基準檔已寫入 ${cases.length} 手`);
} else {
  const before: string[] = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const golden = before.map((g, i) => honorAdj(g, cases[i]));
  const changedHands = cases.map((c, i) => i).filter((i) => golden[i] !== before[i]);
  eq([changedHands.length, changedHands.every((i) => /大三元|小三元|小四喜/.test(before[i])), cases.filter((c, i) => /大三元|小三元|小四喜/.test(before[i])).length],
    [10, true, 10], `T6 三元、四喜改台：2000 手裡只有 ${changedHands.length} 手台數變了，全都是大三元、小三元或小四喜的牌（每手少掉構成牌型的三元牌台）；其他 ${2000 - changedHands.length} 手和改前完全一樣（見 T1、T2）`);
  const non = cases.map((c, i) => i).filter((i) => !isTianhu(cases[i]));
  const diff = non.filter((i) => out[i] !== golden[i]);
  const names = new Set(non.flatMap((i) => out[i].split("|")[1].split(",").map((f) => f.replace(/\d+$/, "")).filter(Boolean)));
  eq([golden.length, diff.length, diff.slice(0, 3).map((i) => [i, golden[i], out[i]])], [cases.length, 0, []],
    `T1 非天胡 ${non.length} 手（含地胡、地聽、門清自摸、獨聽、平胡、四喜、八仙等 ${names.size} 種台）：台數、台名和改前完全一樣`);
  const th = cases.map((c, i) => i).filter((i) => isTianhu(cases[i]));
  // 門清、自摸、門清自摸只看整手（不看拆法），每種拆法都少一樣的台，選到的拆法不變：改後應該剛好等於改前拿掉這三種台
  const strip = (g: string) => { const [, f] = g.split("|"); const kept = f.split(",").filter((x) => x && !TIANHU_DROPS.includes(x.replace(/\d+$/, ""))); return `${kept.reduce((n, x) => n + Number(x.match(/\d+$/)![0]), 0)}|${kept.join(",")}`; };
  const bad = th.filter((i) => out[i] !== strip(golden[i]));
  const changed = th.filter((i) => out[i] !== golden[i]).length;
  eq([th.length > 100, bad.slice(0, 3).map((i) => [golden[i], out[i]])], [true, []], `T2 天胡 ${th.length} 手（其中 ${changed} 手原本有門清或自摸）：剛好是改前拿掉門清、自摸、門清自摸，其他台一個不少`);
  const hedi = cases.map((c, i) => i).filter((i) => isHedi(cases[i]));
  const has = (i: number) => raw[i].split("|")[1].split(",").includes("河底撈魚1");
  eq([hedi.length > 50, hedi.filter((i) => !has(i)).length, cases.map((c, i) => i).filter((i) => !isHedi(cases[i]) && raw[i].includes("河底撈魚")).length], [true, 0, 0],
    `T5 河底撈魚：${hedi.length} 手「最後一張＋胡別人打的牌」每手都多 1 台河底撈魚（其他台和改前一樣，見 T1、T2）；自摸、搶槓、不是最後一張的 ${cases.length - hedi.length} 手都沒有`);
}

// ---- T3：指定牌型 ----
const names = (r: { fans: { name: string }[] }) => r.fans.map((f) => f.name);
const NO_ZIMO = (r: { fans: { name: string }[] }) => !names(r).some((n) => TIANHU_DROPS.includes(n));
const base: Omit<ScoringContext, "concealed" | "winTile"> = { revealed: [], isSelfDraw: true, isDealer: true, seatWind: 1, prevalentWind: 1,
  flowers: [], isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: true, isTing: false };
const hand = (keys: string) => { const c = tiles(keys); return { concealed: c, winTile: c[c.length - 1] }; };
// 莊家（東家、東風圈）起手 17 張自摸：東風刻、中刻、三副順子、單吊 5p；花：春（正花）、夏
{
  const r = calculateScore({ ...base, ...hand("z1 z1 z1 z5 z5 z5 m1 m2 m3 m4 m5 m6 s7 s8 s9 p5 p5"), flowers: tiles("f1 f2") });
  eq([r.fans.map((f) => f.name + f.value), r.totalFan], [["天胡24", "莊家1", "獨聽1", "三元牌1", "風牌1", "風牌1", "正花1"], 30],
    "T3 天胡帶東風刻、中刻、單吊、正花：只少了門清自摸 3，獨聽、三元牌、風牌、正花照算＝30");
  const non = calculateScore({ ...base, ...hand("z1 z1 z1 z5 z5 z5 m1 m2 m3 m4 m5 m6 s7 s8 s9 p5 p5"), flowers: tiles("f1 f2"), isFirstDraw: false });
  eq(names(non).includes("門清自摸"), true, "T3b 同一手不是天胡時：門清自摸照算（只限制天胡）");
}
{
  const r = calculateScore({ ...base, ...hand("m1 m1 m1 m2 m2 m2 m3 m3 m3 m5 m5 m5 m7 m7 m7 m9 m9") });
  eq([["清一色", "碰碰胡", "五暗刻"].every((n) => names(r).includes(n)), NO_ZIMO(r), names(r).includes("天胡")], [true, true, true],
    "T3c 天胡＋清一色＋碰碰胡＋五暗刻：大牌型全部照算，沒有門清、自摸", names(r).join("+"));
  const three = calculateScore({ ...base, ...hand("p2 p2 p2 s4 s4 s4 z6 z6 z6 m1 m2 m3 m4 m5 m6 s8 s8") });
  eq([names(three).includes("三暗刻"), NO_ZIMO(three)], [true, true], "T3d 天胡＋三暗刻：三暗刻照算", names(three).join("+"));
  const big = calculateScore({ ...base, ...hand("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 p5 p5") });
  const small = calculateScore({ ...base, ...hand("z1 z1 z1 z2 z2 z2 z3 z3 z3 m1 m2 m3 m4 m5 m6 z4 z4") });
  eq([names(big).includes("大四喜"), names(small).includes("小四喜"), names(big).includes("風牌"), NO_ZIMO(big) && NO_ZIMO(small)], [true, true, false, true],
    "T3e 天胡＋大四喜、天胡＋小四喜：四喜照一般規則算（大四喜不另加風牌），沒有門清、自摸", `${names(big).join("+")}｜${names(small).join("+")}`);
}

// ---- T4：真實結算流程 ----
{
  const hand = tiles("z1 z1 z1 z5 z5 z5 m1 m2 m3 m4 m5 m6 s7 s8 s9 p5 p5");
  const s = {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: seat === 0 ? hand : tiles("m9 m9 m9 m8 m8 m8 m7 m7 m7 s1 s1 s1 s2 s2 s2 s3"),
      revealed: [] as Meld[], flowers: seat === 0 ? tiles("f1") : [], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(60).fill("p9").join(" ")), currentTurn: 0, hasDrawn: true, drawnTileId: hand[16].id, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    isFirstRound: true, isAfterKong: false, roundInfo: { dealerConsecutive: 2 }, roomSettings: { basePoints: 100, fanPoints: 20, totalRounds: 1 },
  } as unknown as MahjongGameState;
  const r = declareWin(s, 0, true);
  const w = r.winners![0];
  eq([w.score.fans.map((f) => f.name + f.value), w.score.totalFan], [["天胡24", "莊家1", "獨聽1", "三元牌1", "風牌1", "風牌1", "正花1", "連22", "拉22"], 34],
    "T4 莊家連 2 拉 2 天胡：天胡、莊家、獨聽、三元牌、風牌、正花，再加連 2、拉 2＝34（沒有門清自摸）");
  const set = calculateSettlement(r);
  eq([set.reason, set.deltas], ["self_draw", [3 * (100 + 34 * 20), -(100 + 34 * 20), -(100 + 34 * 20), -(100 + 34 * 20)]],
    "T4c 結算照自摸算：三家各付 底 100＋34 台×20＝780（天胡沒有自摸台，也不會被當成放槍而沒人付）");
  tallyHandStats(r);
  eq([isSelfDrawWin(w), r.handStats!.selfDraws], [true, [1, 0, 0, 0]], "T4b 整場統計、斗內共用的自摸判斷：天胡照樣算莊家自摸一次（自摸台拿掉不影響）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
