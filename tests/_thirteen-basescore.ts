// 十三支底分（老闆 2026-11-19：每局分數＝墩數 × 底分，選 30／50／100／200 或自訂 10～100000）前端部分：
//   L 開房：局數下面一排底分 30／50／100／200＋自訂、預設 100、沒有說明字；自訂超出範圍不能送出；開房時用 baseScore 送給後端
//   W 等人畫面標出底分；舊房（後端沒回 baseScore）不顯示
//   D 分數一律照後端回的：中央看板用伺服器的 rowDeltas、打槍明細用 gunEach；前端不自己乘。舊房照舊
//   S 本局結算：左欄一律墩數（stats，含左欄「本局」），右欄四家讀 rv.scores（老闆 2026-11-19 定案）；R 誰按了確認；A 名牌大頭照
//   J 甲案（2026-11-19）：老闆截圖那一局左欄、右欄、備用看板照 scoreRule 分甲案／舊規則（J6）、和後端 flow.rowDeltas 一致（J7）
//   （舊說明）「這局幾分」讀 rv.scores（老柯 API：已乘底分；result.totals、stats 是淨墩數）；舊房沒有 scores 照舊用 result.totals
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ThWaiting from "../components/thirteen/ThWaiting";
import { BASE_SCORE_DEFAULT, BASE_SCORE_OPTIONS, parseBaseScore } from "../components/thirteen/ThLobby";
import GamePlate from "../components/GamePlate";
import type { ThWaitingView } from "../components/thirteen/useThirteenRoom";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const T = await import("../components/thirteen/revealTimeline");
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const { ThRoundResult } = await import("../components/thirteen/ThResult");

// ---- L 開房 ----
{
  const page = readFileSync("app/thirteen/page.tsx", "utf8");
  ok(JSON.stringify(BASE_SCORE_OPTIONS) === "[30,50,100,200]" && BASE_SCORE_DEFAULT === 100, `L1 底分選項 ${BASE_SCORE_OPTIONS.join("／")}＋自訂、預設 ${BASE_SCORE_DEFAULT}`);
  const { CreateRoomShell, sectionValue } = await import("../components/gameLobby/GameLobby");
  const { TH_SECTIONS } = await import("../components/thirteen/ThLobby");
  const shell = (name: string) => renderToStaticMarkup(createElement(CreateRoomShell, { brand: null, sections: TH_SECTIONS, initialName: { name, fromLine: false }, busy: false, error: "", onCreate: () => {}, onBack: () => {} })).replace(/<!-- -->/g, "");
  const created = shell("老闆");
  const cardTitles = [...created.matchAll(/<h4>([^<]*)<\/h4>/g)].map((m) => m[1]);
  ok(JSON.stringify(cardTitles) === JSON.stringify(["理牌時間", "局數", "底分"]) && /data-gl-opt="base:30"[\s\S]*data-gl-opt="base:200"[\s\S]*data-gl-custom-on="base"[^>]*>自訂</.test(created)
    && /data-gl-opt="base:100"[^>]*aria-pressed="true"/.test(created) && !/4 人|65 張|～|基本分/.test(created),
    `L2 開房用共用外框：設定卡 ${cardTitles.join("／")}（照設計稿順序）、底分 30／50／100／200＋自訂、預設 100，卡片只有標題沒有副標`);
  const cases = ["10", "100000", "300", "9", "100001", "", " ", "12.5", "abc", "0", "1e3", "-50"].map((t) => [t, parseBaseScore(t)]);
  ok(JSON.stringify(cases.map(([, v]) => v)) === JSON.stringify([10, 100000, 300, null, null, null, null, null, null, null, null, null]),
    `L3 自訂底分只收 10～100000 的整數：${cases.map(([t, v]) => `"${t}"→${v}`).join("、")}`);
  const baseSec = TH_SECTIONS[2];
  const shellSrc = readFileSync("components/gameLobby/GameLobby.tsx", "utf8");
  ok(sectionValue(baseSec, { value: 100, custom: true, text: "12.5" }) === null && sectionValue(baseSec, { value: 100, custom: true, text: "300" }) === 300
    && /const ok = !!nm\.valid && Object\.values\(values\)\.every\(\(v\) => v !== null\)/.test(shellSrc) && /disabled=\{!ok \|\| busy\}/.test(shellSrc) && /if \(ok && !busy\) onCreate/.test(shellSrc)
    && /disabled=""[^>]*data-gl-go="create"|data-gl-go="create"[^>]*disabled=""/.test(shell("   ")),
    "L4 自訂底分不合法（null）或暱稱空白：建立房間按鈕停用、按了（含 Enter）也不送出");
  const onChange = /data-gl-custom=[\s\S]*?onChange=\{\(e\) => set\(\{ text: ([^}]*) \}\)\}/.exec(shellSrc)?.[1] ?? "";
  ok(onChange !== "" && !/replace/.test(onChange) && parseBaseScore("12.5") === null && parseBaseScore("1e3") === null,
    `L6 自訂底分輸入不偷刪字元（${onChange}）：打「12.5」照原樣留著 → 不合法、不能開房（之前會被刪成 125）`);
  ok(/JSON\.stringify\(\{ hostId: playerId\(\), arrangeSec: toServerArrangeSec\(arrangeSec\), totalHands, baseScore \}\)/.test(page), "L5 開房時把底分用 baseScore 送給 /api/thirteen/create");
}

// ---- W 等人畫面（老柯 API：讀最上層的 baseScore，舊房伺服器補 1）----
{
  const view = (baseScore?: number): ThWaitingView => ({ status: "waiting", code: "1234", hostId: "p0", settings: { arrangeSec: 60, totalHands: 8, ...(baseScore && baseScore > 1 ? { baseScore } : {}) }, ...(baseScore !== undefined ? { baseScore } : {}), seats: [{ seat: 0, name: "老闆", playerId: "p0" }] });
  const h = (v: ThWaitingView) => renderToStaticMarkup(createElement(ThWaiting, { view: v, myPlayerId: "p0", onStart: async () => ({ ok: true }), onLeave: async () => ({ ok: true }) })).replace(/<!-- -->/g, "");
  const withBase = h(view(500)), legacy = h(view(1)), none = h(view());
  ok(/<div class="gl-chips"><span>8局<\/span><span>理牌 60 秒<\/span><span>底分 500<\/span><\/div>/.test(withBase), "W1 有底分的房：等人畫面的設定摘要「8局」「理牌 60 秒」「底分 500」（讀最上層的 baseScore）");
  ok(!/底分/.test(legacy) && !/底分/.test(none), "W2 舊房（伺服器補 baseScore=1）或沒有這個欄位：不顯示底分，畫面和改之前一樣");
}

// ---- D 分數照後端回的 ----
{
  const rv = buildCase("gun")!;
  // 假裝是底分 500 的房：伺服器回的數字已經乘好（前端只拿來顯示）
  const server = { front: [1500, -500, -500, -500], middle: [12000, -4000, -4000, -4000], back: [-36000, 12000, 12000, 12000] };
  ok(T.boardDeltas({ ...rv, rowDeltas: server }) === server, "D1 中央看板：伺服器給了 rowDeltas 就原樣用（同一個物件，前端沒有再乘）");
  ok(JSON.stringify(T.boardDeltas(rv)) === JSON.stringify(T.rowDeltas(rv.result)), "D2 舊房沒有 rowDeltas：照舊用前端算的每墩得失分（和改之前一樣）");
  // D3 左欄明細一律讀墩數（stats 本身，老闆 2026-11-19 定案）；就算伺服器另外給了 scored（乘好底分）也不用
  const ex = { rows: -1, bonuses: [{ name: "衝三", points: -3 }, { name: "尾墩同花順", points: -3 }], guns: 1, gunned: 1, gunPoints: 0, homeRun: false, homeRunned: true, homeRunPoints: -3, total: -10,
    scored: { rows: -200, bonuses: [{ name: "衝三", points: -600 }, { name: "尾墩同花順", points: -600 }], gunPoints: 0, shotPoints: 200, shotByPoints: -200, homeRunPoints: -600, total: -2000 } } as Parameters<typeof T.breakdown>[0];
  const want = [["墩分", -1], ["被衝三", -3], ["被尾墩同花順", -3], ["打槍 ×1", 1], ["被打槍 ×1", -1], ["被全壘打", -3]];
  const got = T.breakdown(ex).map((x) => [x.label, x.pts]);
  ok(JSON.stringify(got) === JSON.stringify(want) && got.reduce((a, [, p]) => a + (p as number), 0) === ex.total,
    `D3 左欄墩數：${got.map(([l, p]) => `${l} ${p}`).join("、")}，加起來 ${got.reduce((a, [, p]) => a + (p as number), 0)}（＝stats.total ${ex.total}，沒用 scored）`);
  // 本局結算：左欄（含「本局」）是墩數；右欄四家是伺服器的 scores（已乘底分）；舊房沒有 scores 右欄照舊用 result.totals
  const render = (r: typeof rv, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ThRoundResult, { rv: r, names: ["老闆", "小明", "阿明", "小華"], mySeat: 0, secondsLeft: 30, confirmed: false, onConfirm: () => {}, ...extra })).replace(/<!-- -->/g, "");
  const pts = (h: string) => [...h.matchAll(/data-th-res-seat="(\d)"[\s\S]*?<div class="gr-delta"><b[^>]*>([^<]*)<\/b>/g)].map((m) => m[2]);
  const totals = [24, -72, 24, 24], scores = totals.map((x) => x * 500);
  const stats = rv.stats.map((s, i) => ({ ...s, total: totals[i] }));
  const withScores = render({ ...rv, baseScore: 500, result: { ...rv.result, totals }, stats, scores }), legacy = render({ ...rv, result: { ...rv.result, totals }, stats });
  const items = (h: string) => /本局<\/span><b[^>]*>([^<]*)</.exec(h)?.[1];
  ok(JSON.stringify(pts(withScores)) === JSON.stringify(["+12000", "−36000", "+12000", "+12000"]) && items(withScores) === "+24",
    `S1 右欄四家讀伺服器的 scores（${pts(withScores).join("、")}）；左欄「本局」是墩數 ${items(withScores)}`);
  ok(JSON.stringify(pts(legacy)) === JSON.stringify(["+24", "−72", "+24", "+24"]) && items(legacy) === "+24", `S2 舊房沒有 scores：右欄照舊顯示 result.totals（${pts(legacy).join("、")}）`);
  ok(T.handScore({ result: rv.result, scores }, 1) === -36000 && T.handScore({ result: rv.result }, 1) === rv.result.totals[1], "S3 handScore：有 scores 用 scores、沒有用 result.totals");
  // R 誰按了確認（跟麻將一樣）
  const ready = [{ seat: 0, name: "老闆", ok: true }, { seat: 1, name: "小明", ok: false }, { seat: 2, name: "阿明", ok: true }, { seat: 3, name: "小華", ok: false }];
  const r1 = render(rv, { ready, confirmed: true }), r0 = render(rv, { ready: null });
  ok(/data-th-ready="2"/.test(r1) && />確認 2\/4</.test(r1) && /data-th-ready-seat="1" data-ok="0"/.test(r1) && /data-th-ready-seat="0" data-ok="1"/.test(r1) && /還在等 小明、小華/.test(r1) && />已確認</.test(r1) && !/data-th-ready/.test(r0),
    "R1 本局結算顯示「確認 2/4」、四家各一顆（✓ 已按／… 還沒）、「還在等 小明、小華」；自己按了寫「已確認」；最後一局不顯示");
  // A 名牌大頭照：有 avatarUrl 就放照片（蓋在名字第一個字上，載不到就藏起來）；沒有照舊；名牌結構不變
  const pa = renderToStaticMarkup(createElement(GamePlate, { seat: "b", name: "張育瑋", score: 1500, avatarUrl: "https://example.com/a.jpg" })), pn = renderToStaticMarkup(createElement(GamePlate, { seat: "b", name: "張育瑋", score: 1500 }));
  ok(/<span class="gp-av">張<img class="gp-pic" src="https:\/\/example\.com\/a\.jpg"/.test(pa) && /<span class="gp-av">張<\/span>/.test(pn) && pa.replace(/<link[^>]*>/, "").replace(/<img[^>]*>/, "") === pn,
    "A1 名牌：有 avatarUrl 顯示大頭照，沒有照舊顯示名字第一個字；除了照片，名牌其他部分完全一樣（大小、位置不變）");
  const src = ["components/thirteen/ThTable.tsx", "components/thirteen/ThResult.tsx", "components/thirteen/revealTimeline.ts", "components/thirteen/ThReveal.tsx", "app/thirteen/page.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
  ok(!/baseScore\s*\*|\*\s*baseScore|\*\s*settings\.baseScore/.test(src), "D5 前端程式裡沒有任何「× 底分」的計算");
}

// ---- J 甲案（老闆 2026-11-19：特殊牌型那一墩只算表上的墩數，衝三＝每家 2 墩）：老柯驗證紀錄裡老闆截圖那一局 ----
{
  const { makeCard } = await import("../lib/thirteen/cards");
  const { scoreRound } = await import("../lib/thirteen/score");
  const { handStats } = await import("../lib/thirteen/flow");
  type Card = ReturnType<typeof makeCard>;
  const R: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  let n = 0;
  const c = (x: string): Card => makeCard(x[0] as Card["suit"], R[x.slice(1)] ?? Number(x.slice(1)), (n++ % 2 + 1) as 1 | 2);
  const hand = (f: string, m: string, b: string) => ({ front: f.split(" ").map(c), middle: m.split(" ").map(c), back: b.split(" ").map(c) });
  const arr = [
    hand("SK HQ DT", "S7 S7 SK S8 S6", "SA SK SQ SJ ST"), // Ming
    hand("D7 H7 D9", "CA CJ CT C4 C2", "H3 S3 S3 HQ DQ"), // 張育瑋
    hand("S5 H5 S5", "CJ CT S9 C8 C7", "HA HK H6 H4 H2"), // 偉鉅
    hand("C9 H9 S9", "DA SK SQ HJ HT", "SA S8 S6 S5 S4"), // 莊子緣
  ];
  const base = 50, result = scoreRound(arr, "jia"), stats = handStats(result, "jia"); // 這組測試寫的是甲案（v4 上線後要明確指定）
  const scores = result.totals.map((t) => t * base);
  const rv = { ...buildCase("gun")!, result, stats, scores, baseScore: base };
  delete (rv as { rowDeltas?: unknown }).rowDeltas;
  const names = ["Ming", "張育瑋", "偉鉅", "莊子緣"];
  const h = renderToStaticMarkup(createElement(ThRoundResult, { rv, names, mySeat: 1, secondsLeft: 30, confirmed: false, onConfirm: () => {} })).replace(/<!-- -->/g, "");
  const left = [...h.matchAll(/<span class="n">([^<]+)<\/span><b[^>]*>([^<]*)<\/b>/g)].map((m) => `${m[1]} ${m[2]}`);
  const right = [...h.matchAll(/data-th-res-seat="(\d)"[\s\S]*?<div class="gr-delta"><b[^>]*>([^<]*)<\/b>/g)].map((m) => m[2]);
  ok(JSON.stringify(result.totals) === "[7,-3,-4,0]", `J1 截圖那一局新規則墩數：Ming ${result.totals[0]}、張育瑋 ${result.totals[1]}、偉鉅 ${result.totals[2]}、莊子緣 ${result.totals[3]}（預期 +7、−3、−4、0）`);
  ok(JSON.stringify(left) === JSON.stringify(["墩分 +4", "被尾墩同花順 −3", "被衝三 −4", "本局 −3"]), `J2 張育瑋左欄（墩數）：${left.join("、")}（預期 墩分 +4、被尾墩同花順 −3、被衝三 −4、本局 −3）`);
  ok(JSON.stringify(right) === JSON.stringify(["+350", "−150", "−200", "0"]) && scores.reduce((a, b) => a + b, 0) === 0,
    `J3 右欄（底分 50）：${right.join("、")}＝墩數 × 50，四家總和 0`);
  const d = T.rowDeltas(result, "jia");
  const sums = (["front", "middle", "back"] as const).map((r) => d[r].reduce((a, b) => a + b, 0));
  ok(JSON.stringify(d.front) === "[-5,-3,2,6]" && sums.every((x) => x === 0),
    `J4 甲案房（scoreRule "jia"）沒有 rowDeltas 時的備用看板頭墩 ${d.front.join("／")}：偉鉅、莊子緣都是衝三，每贏一家只算 2 墩（Ming −1−2−2、張育瑋 +1−2−2、偉鉅 +2+2−2、莊子緣 +2+2+2；改之前會是 3 墩）；每墩四家合計 ${sums.join("／")}`);
  // J6 舊房（沒有 scoreRule＝舊規則 v1，老柯 API 0-1c）：備用看板照舊規則 1＋加分，衝三贏一家 3 墩；boardDeltas 會把 rv.scoreRule 傳下去
  const v1 = T.rowDeltas(result);
  ok(JSON.stringify(v1.front) === "[-7,-5,3,9]" && JSON.stringify(T.boardDeltas({ result, scoreRule: "jia" })) === JSON.stringify(d) && JSON.stringify(T.boardDeltas({ result })) === JSON.stringify(v1),
    `J6 舊房沒有 scoreRule：備用看板頭墩 ${v1.front.join("／")}（舊規則衝三 3 墩：Ming −1−3−3、張育瑋 +1−3−3、偉鉅 +3+3−3、莊子緣 +3+3+3）；有 scoreRule "jia" 才用甲案`);
  // J7 前端備用看板和後端 flow.rowDeltas（底分 1）同一條規則：截圖那局＋規則書範例，兩種規則逐墩一樣
  const F = await import("../lib/thirteen/flow");
  const { deal } = await import("../lib/thirteen/cards");
  const { autoArrange } = await import("../lib/thirteen/arrange");
  let same = 0, total = 0;
  for (let k = 0; k < 300; k++) {
    const res = k === 0 ? result : scoreRound(deal().hands.map((h) => autoArrange(h, "legacy")), "jia");
    for (const rule of ["jia", "v1"] as const) { total++; if (JSON.stringify(T.rowDeltas(res, rule === "jia" ? "jia" : undefined)) === JSON.stringify(F.rowDeltas(res, 1, rule))) same++; }
  }
  ok(same === total, `J7 前端備用看板＝後端 flow.rowDeltas（底分 1）：${same}/${total}（截圖那局＋299 副隨機牌 × 甲案、舊規則）`);
  const perSeat = [0, 1, 2, 3].map((i) => d.front[i] + d.middle[i] + d.back[i]);
  const rowsAndBonus = stats.map((st) => st.rows + st.bonuses.reduce((a, b) => a + b.points, 0));
  ok(JSON.stringify(perSeat) === JSON.stringify(rowsAndBonus), `J5 看板三墩相加＝左欄「墩分＋牌型」：${perSeat.join("、")}`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
