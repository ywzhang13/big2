// 十三支 2026-11-19 畫面調整（老闆）：
//   N 名牌方向 A：88×38、名字一行 4 個字、最多兩行（8 個字）不出現「…」（實際排版在瀏覽器量，這裡鎖樣式）
//   R 所有牌照 A、2、3…J、Q、K 排：A 在最前、K 在最後（理牌手牌、墩、亮牌、結算共用 byRank）
//   U 本局結算每家沒用到的 3 張：放最右邊、正常顏色；伺服器沒給 unusedCards 就不顯示
//   W 牌面純白底：52 張都換成 v4 圖（像素比對在 .tmp/plate/牌面-純白-像素檢查.txt）
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const { parseCards } = await import("../lib/thirteen");
const A = await import("../components/thirteen/arrangeState");
const T = await import("../components/thirteen/revealTimeline");
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const { ThRoundResult } = await import("../components/thirteen/ThResult");
const GamePlate = (await import("../components/GamePlate")).default;

// ---- N 名牌 ----
{
  const css = readFileSync("components/gamePlate.css", "utf8");
  const nm = css.match(/^\.gp-nm \{[^}]*\}/m)?.[0] ?? "";
  ok(/^\.gp \{ position: absolute; box-sizing: border-box; width: 88px; height: 44px;/m.test(css), "N1 名牌本體 88×44（寬度不變；2026-11-22 B1 再加高 6）");
  ok(/white-space: normal/.test(nm) && /word-break: break-all/.test(nm) && /-webkit-line-clamp: 2/.test(nm) && !/text-overflow: ellipsis/.test(nm) && /line-height: 12px/.test(nm),
    "N2 名字可以換行、最多兩行、每行 12px，不再一行切成「…」");
  const room = readFileSync("components/thirteen/thRoom.css", "utf8");
  ok(/\.th-gp-bottom \{ left: 8px; top: 306px; \}/.test(room) && /\.th-gp-top \{ left: 214px; top: 8px; \}/.test(room)
    && /\.th-gp-left \{ left: 4px; top: 166px; \}/.test(room) && /\.th-gp-right \{ left: 752px; top: 166px; \}/.test(room),
    "N3 十三支四家位置照方向 A：自己 (8,306)、對家 (214,8)、左 (4,166)、右 (752,166)");
  const h = renderToStaticMarkup(createElement(GamePlate, { seat: "l", name: "崇恩五六七八九", score: -750 }));
  ok(/<span class="gp-nm">崇恩五六七八九<\/span>/.test(h), "N4 名字整串交給畫面排（不在程式裡切字）");
}

// ---- R 排序 ----
{
  const ranks = (cs: { rank: number }[]) => cs.map((c) => ({ 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" } as Record<number, string>)[c.rank] ?? String(c.rank)).join(" ");
  const all = parseCards("KS QH AD 2C TS JD 9H 3S 4D 5C 6H 7S 8D");
  ok(ranks(all.slice().sort(A.byRank)) === "A 2 3 4 5 6 7 8 9 T J Q K", `R1 byRank：A 在最前、K 在最後（${ranks(all.slice().sort(A.byRank))}）`);
  ok(A.showRank(14) === 1 && A.showRank(13) === 13 && A.showRank(2) === 2, "R2 只改顯示：A 排在 2 前面，計分引擎的 A 還是 14");
  const hand16 = parseCards("KS QH AD 2C TS JD 9H 3S 4D 5C 6H 7S 8D AH KH 2D");
  const v = A.derive(A.initArrange(hand16));
  ok(ranks(v.hand) === "A A 2 2 3 4 5 6 7 8 9 T J Q K K", `R3 理牌 16 張手牌照 A→K（${ranks(v.hand)}）`);
  const wheel = T.rowDisplayOrder(parseCards("5S AS 4S 3S 2S"));
  ok(ranks(wheel) === "A 2 3 4 5", `R4 老闆截圖的同花順 5 A 4 3 2 改成 A 2 3 4 5（${ranks(wheel)}）`);
}

// ---- U 沒用到的牌 ----
{
  const base = buildCase("normal")!;
  const unusedCards = [0, 1, 2, 3].map((s) => parseCards(["KC QC 2H", "AH 9C 3C", "JH TH 4H", "KD 5D 6D"][s]));
  const props = { names: ["老闆", "小明", "阿明", "小華"], mySeat: 0, secondsLeft: null, confirmed: false, onConfirm: () => {} };
  const h = renderToStaticMarkup(createElement(ThRoundResult, { ...props, rv: { ...base, unusedCards } }));
  const rows = [...h.matchAll(/data-th-res-seat="(\d)"[\s\S]*?(?=data-th-res-seat=|class="gr-next")/g)].map((m) => m[0]);
  const lastGrp = rows.map((r) => r.match(/<div class="th-res-grp th-res-unused" data-th-unused="3">((?:<img[^>]*>)+)<\/div><\/div>/));
  ok(rows.length === 4 && lastGrp.every(Boolean), "U1 四家都有 3 張沒用到的牌，放在牌列的最後一組（最右邊）");
  const firstOf = (i: number) => lastGrp[i]![1].match(/card-front-\w+-(\w+)\./)![1];
  ok(firstOf(0) === "2" && firstOf(1) === "a", `U2 沒用到的牌一樣照 A→K（老闆那家 2 Q K 的第一張是 ${firstOf(0)}、小明 A 3 9 的第一張是 ${firstOf(1)}）`);
  const css = readFileSync("components/thirteen/thReveal.css", "utf8");
  const uRule = css.match(/^\.th-res-unused \{[^}]*\}/m)?.[0] ?? "";
  ok(/border-left: 1px solid/.test(uRule) && /padding-left: 10px/.test(uRule) && !/grayscale|opacity|filter/.test(uRule), "U3 接在尾墩右邊、用一條線隔開（小宜 v15 §4-2）；沒有變灰（不加 grayscale／opacity／filter）");
  const none = renderToStaticMarkup(createElement(ThRoundResult, { ...props, rv: base }));
  ok(!/th-res-unused/.test(none), "U4 伺服器沒給 unusedCards（舊版、還沒比牌）：不顯示");
}

// ---- W 純白牌面 ----
{
  const { cardSrc } = await import("../components/thirteen/cardArt");
  const { buildDeck } = await import("../lib/thirteen");
  const srcs = buildDeck().map(cardSrc);
  ok(srcs.every((x) => x.endsWith(".v4.webp") && existsSync(`public${x}`)) && new Set(srcs).size === 52,
    `W1 52 種牌面都用 v4（純白底）的圖、檔案都在（兩副黑桃共用同一張，${new Set(srcs).size} 個檔）`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
