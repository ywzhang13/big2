// 十三支「場內全壘打」（老闆 2026-11-28：某一家被另外三家都打槍，播悲情版全壘打 3.2 秒；只加動畫、不改計分）
//   I1 誰是場內全壘打：被三家打槍才算；只被兩家打不算；一局最多一家
//   I2 時間軸：有場內全壘打才有 insidehr 這一段（3.2 秒、座位對）；同一局也有全壘打時先全壘打、再場內全壘打
//   I3 揭牌總長：伺服器 revealDurationMs 多 3.2 秒，前端時間軸的結束時間跟伺服器一樣（隨機 3000 局逐局比）；最長等待 NEXT_HAND_MAX_MS 也算進去
//   I4 計分不變：有沒有場內全壘打，每家的分數都只是兩兩比牌＋打槍＋全壘打（scoreRound 沒有新加分）
//   I5 畫面：特效層有場內全壘打這一段、四張新圖有長寬比、登記長期快取；測試頁有「場內全壘打」按鈕
import { readFileSync, existsSync } from "node:fs";
import { autoArrange, deal, revealOrder, scoreRound, type RoundResult } from "../lib/thirteen";
import { insideHomeRunOf, REVEAL_TIMING, revealDurationMs, NEXT_HAND_MAX_MS, SETTLE_WAIT_MS } from "../lib/thirteen/flow";
import * as T from "../components/thirteen/revealTimeline";
import { buildCase } from "../app/thirteen/preview/reveal/cases";

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const must = (n: string) => { const rv = buildCase(n); if (!rv) throw new Error(`預覽牌局 ${n} 找不到`); return rv; };
type Pair = RoundResult["pairs"][number];
/** 只有打槍資訊的假結果：guns＝[打的人, 被打的人] */
const fake = (guns: [number, number][]): Pick<RoundResult, "pairs"> => {
  const pairs: Pair[] = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const g = guns.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
    pairs.push({ a, b, gunner: g ? g[0] : null } as Pair);
  }
  return { pairs };
};

// ---- I1 ----
ok(insideHomeRunOf(fake([[1, 0], [2, 0], [3, 0]])) === 0, "I1 0 號被 1、2、3 號都打槍 → 場內全壘打是 0 號");
ok(insideHomeRunOf(fake([[0, 2], [1, 2], [3, 2], [0, 1]])) === 2, "I1 2 號被三家打槍（另外還有別的槍）→ 2 號");
ok(insideHomeRunOf(fake([[1, 0], [2, 0]])) === null, "I1 只被兩家打槍 → 沒有場內全壘打");
ok(insideHomeRunOf(fake([[0, 1], [0, 2], [0, 3]])) === null, "I1 一家打三家（全壘打）但沒有人被三家打 → 沒有場內全壘打");
ok(insideHomeRunOf(fake([])) === null, "I1 沒有打槍 → 沒有");

// ---- I2 ----
{
  const ihr = must("insidehr"), both = must("ihrhr");
  const st = (rv: typeof ihr) => T.buildTimeline(rv).steps;
  const a = st(ihr).filter((s) => s.kind === "insidehr");
  ok(a.length === 1 && a[0].kind === "insidehr" && a[0].seat === 0 && a[0].dur === 3200, `I2 自己被三家打槍：時間軸有一段場內全壘打（座位 0、3.2 秒）：${JSON.stringify(a)}`);
  const lastGun = st(ihr).filter((s) => s.kind === "gun").pop()!;
  ok(a[0]?.t0 === lastGun.t0 + lastGun.dur, "I2 場內全壘打接在最後一槍後面");
  const b = st(both), h = b.find((s) => s.kind === "homerun"), i = b.find((s) => s.kind === "insidehr");
  ok(!!h && !!i && i.t0 === h.t0 + h.dur && b.indexOf(h) < b.indexOf(i), `I2 同局也有全壘打：先全壘打（${h?.t0}）、再場內全壘打（${i?.t0}）`);
  // 播放中看板淡出（跟打槍、全壘打一樣）
  const tl = T.buildTimeline(ihr);
  const at = (a[0]?.t0 ?? tl.end) + 1000;
  ok(!T.frameAt(tl, at).board.show && T.frameAt(tl, at).active.some((s) => s.kind === "insidehr"), "I2 播場內全壘打時看板是收起來的、特效層拿得到這一段");
}

// ---- I3 ----
{
  ok(REVEAL_TIMING.INSIDE_HR_MS === 3200 && T.MS.insidehr === 3200, "I3 場內全壘打 3.2 秒（伺服器、前端同一個常數）");
  const ihr = must("insidehr"), both = must("ihrhr");
  for (const [n, rv] of [["insidehr", ihr], ["ihrhr", both]] as const) {
    const end = T.buildTimeline(rv).end, server = revealDurationMs(rv.result);
    const without = server - 3200, guns = rv.result.pairs.filter((p) => p.gunner !== null).length;
    ok(end === server && server - without === 3200 && T.revealDurationV8(0, guns, rv.result.homeRun !== null, true) - T.revealDurationV8(0, guns, rv.result.homeRun !== null) === 3200,
      `I3 ${n}：前端結束時間 ${end} ＝伺服器 ${server}，比沒有場內全壘打多 3.2 秒`);
  }
  ok(NEXT_HAND_MAX_MS === REVEAL_TIMING.LEAD_MS + REVEAL_TIMING.START_MS + 3 * REVEAL_TIMING.ROW_MS + 12 * REVEAL_TIMING.SPECIAL_MS + 6 * REVEAL_TIMING.GUN_MS
    + REVEAL_TIMING.HOME_RUN_MS + REVEAL_TIMING.INSIDE_HR_MS + REVEAL_TIMING.SETTLE_PAUSE_MS + SETTLE_WAIT_MS, `I3 最長等待算進場內全壘打（${NEXT_HAND_MAX_MS}）`);
  let seed = 7, bad = 0, seen = 0, seenBoth = 0, mismatch = 0, two = 0, twoBad = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 3000; k++) {
    const { hands } = deal(rnd), a = hands.map((h) => autoArrange(h)), result = scoreRound(a);
    const tl = T.buildTimeline({ order: revealOrder(a), result });
    if (tl.end !== revealDurationMs(result)) bad++;
    const hit = [0, 0, 0, 0]; for (const p of result.pairs) if (p.gunner !== null) hit[p.gunner === p.a ? p.b : p.a]++;
    const want = hit.indexOf(3), got = tl.steps.find((s) => s.kind === "insidehr");
    if ((want >= 0) !== !!got || (got && got.kind === "insidehr" && got.seat !== want)) mismatch++;
    if (want >= 0) { seen++; if (result.homeRun !== null) seenBoth++; }
    if (Math.max(...hit) === 2) { two++; if (got) twoBad++; }
  }
  ok(two > 0 && twoBad === 0, `I2 只被兩家打槍（最多兩槍）的局：${two} 局，有播場內全壘打的 ${twoBad} 局`);
  ok(bad === 0 && mismatch === 0 && seen > 0, `I3 隨機 3000 局：前端≠伺服器 ${bad} 局、觸發判斷不對 ${mismatch} 局（樣本有場內全壘打 ${seen} 局，其中同局全壘打 ${seenBoth} 局）`);
}

// ---- I4 計分不變 ----
{
  const src = readFileSync("lib/thirteen/score.ts", "utf8");
  ok(!/insideHomeRun|INSIDE_HR/.test(src), "I4 計分引擎（score.ts）沒有任何場內全壘打的加減分");
  const rv = must("insidehr"), r = rv.result;
  ok(r.totals.reduce((x, y) => x + y, 0) === 0 && rv.stats.every((s) => !("insideHomeRun" in s)), "I4 場內全壘打那局四家總分仍是 0、明細沒有新項目");
}

// ---- I5 畫面、素材 ----
{
  const { FX_AR, FX_NAMES, fxSrc } = await import("../components/thirteen/ThRevealFx");
  const tsx = readFileSync("components/thirteen/ThRevealFx.tsx", "utf8"), css = readFileSync("components/thirteen/thReveal.css", "utf8");
  const reg = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, string>;
  const names = ["ihrfield", "ihrstand", "ihrkneel", "ihrword"];
  ok(names.every((n) => FX_NAMES.includes(n) && !!(FX_AR as Record<string, unknown>)[n]), "I5 四張新圖都在預載清單、都有長寬比");
  const files = names.flatMap((n) => (["m", "d"] as const).map((z) => fxSrc(n, z)));
  ok(files.every((f) => /\.v1\.[md]\.webp$/.test(f) && existsSync(`public${f}`) && !!reg[f]), `I5 8 個檔名有版本號、檔案存在、登記長期快取：${files.filter((f) => !reg[f]).join("、") || "全部"}`);
  ok(/s\.kind === "insidehr"\) return <InsideHrFx/.test(tsx) && /data-th-insidehr=/.test(tsx), "I5 特效層會畫場內全壘打");
  ok(/\.th-ihr\.is-flip \.th-ihr-figs \{ transform: scaleX\(-1\); \}/.test(css) && /pos === "right" \|\| pos === "top"/.test(tsx.slice(tsx.indexOf("function InsideHrFx"))), "I5 右家、對家觸發時左右鏡射（同全壘打）");
  ok(/@keyframes th-ihr-out \{.*87\.5% \{ opacity: 1; \} 100% \{ opacity: 0; \} \}/.test(css), "I5 2.8～3.2 秒淡出");
  ok(/key: "insidehr", name: "場內全壘打"/.test(readFileSync("components/thirteen/ThFxLab.tsx", "utf8")), "I5 特效測試頁有「場內全壘打」按鈕");
}

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
if (fail) process.exit(1);
