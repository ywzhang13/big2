// 十三支亮牌與結算（components/thirteen/revealTimeline.ts、ThTable 亮牌、ThResult）＋老闆 2026-11-18 的小改
//   R 時間軸：照小宜 v5——開始比牌 1.2 秒、每墩照伺服器翻牌順序每組 0.5 秒＋得失分 0.6 秒、牌型特效插播 0.9 秒、打槍每組 1.0 秒、全壘打 2.8 秒（v7 全螢幕）
//   B 牌型徽章與特效判斷：頭墩三條＝衝三（紅金）、同花一對寫「同花」、中尾墩鐵支／同花順／五龍有特效
//   S 分數：每墩得失分、左欄明細加起來一定等於伺服器的本局分數（含打槍、全壘打）；隨機 3000 局
//   V 畫面：亮牌中的牌桌（翻開才換牌面、徽章不跟著牌轉、得失分）、本局結算四家各一列、總結算照總分排名
//   H 首頁三張卡只留遊戲名稱；理牌畫面沒有操作提示字、倒水只留一句短提示
import { register } from "node:module";
import type { HandValue } from "../lib/thirteen";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { autoArrange, deal, revealOrder, scoreRound, SCORING } = await import("../lib/thirteen");
const { handStats, revealDurationMs } = await import("../lib/thirteen/flow");
const T = await import("../components/thirteen/revealTimeline");
const { buildCase } = await import("../app/thirteen/preview/reveal/cases");
const ThTable = (await import("../components/thirteen/ThTable")).default;
const { ThRoundResult, ThFinalResult } = await import("../components/thirteen/ThResult");
const ThArrange = (await import("../components/thirteen/ThArrange")).default;
const Home = (await import("../app/page")).default;
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js"); // 首頁用 useRouter：給一個假的 router

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const must = (name: string) => { const rv = buildCase(name); if (!rv) throw new Error(`預覽牌局 ${name} 找不到`); return rv; };

// ---- R 時間軸 ----
{
  const normal = must("normal");
  const tl = T.buildTimeline(normal);
  ok(tl.end === 9000, `R1 一般局（沒有特效牌型、沒有打槍）：開始比牌到結算面板 9.0 秒（小宜 v5 §4；實際 ${tl.end / 1000}）`);
  const flips = tl.steps.filter((s) => s.kind === "flip");
  ok(JSON.stringify(flips.filter((s) => s.row === "front").map((s) => s.seats)) === JSON.stringify(normal.order.front)
    && flips[0].t0 === 1200 && flips.every((s, i) => i === 0 || s.t0 >= flips[i - 1].t0 + 500),
  "R2 頭墩照伺服器的翻牌順序（最小的先、一樣大的同一組一起翻），開始比牌 1.2 秒後才翻，每組至少 0.5 秒");
  const cs = must("chongsan"), ctl = T.buildTimeline(cs);
  const fx = ctl.steps.find((s) => s.kind === "fx")!;
  const flipOf0 = ctl.steps.find((s) => s.kind === "flip" && s.row === "front" && s.seats.includes(0))!;
  const nextFlip = ctl.steps.find((s) => (s.kind === "flip" || s.kind === "rowScore") && s.t0 > flipOf0.t0)!; // 下一家翻牌（衝三是最大的那家時，就是這墩的得失分）
  ok(fx.kind === "fx" && fx.fx === "chongsan" && fx.t0 === flipOf0.t0 + 500 && nextFlip.t0 >= flipOf0.t0 + 500 + 900,
    "R3 衝三那家先翻開（0.5 秒），接著插播特效 0.9 秒，播完才翻下一家（和伺服器 revealDurationMs 一樣：每個特效完整加 0.9 秒）");
  const gun = must("gun"), gtl = T.buildTimeline(gun);
  ok(gtl.end === 10000 && gtl.steps.filter((s) => s.kind === "gun").every((s) => s.dur === 1000), `R4 有一組打槍：10.0 秒（實際 ${gtl.end / 1000}）`);
  const hr = must("homerun"), htl = T.buildTimeline(hr);
  const guns = htl.steps.filter((s) => s.kind === "gun"), home = htl.steps.find((s) => s.kind === "homerun")!;
  ok(home.kind === "homerun" && home.seat === 0 && home.t0 === guns[guns.length - 1].t0 + 1000 && htl.end === home.t0 + 2800,
    "R5 全壘打接在所有打槍之後、2.8 秒（v7 全螢幕），播完才出結算");
  const f0 = T.frameAt(gtl, 100), fMid = T.frameAt(gtl, 1300);
  ok(f0.active.some((s) => s.kind === "start") && f0.open.every((o) => !o.front && !o.middle && !o.back)
    && fMid.open.filter((o) => o.front).length === gun.order.front[0].length && fMid.glow.length === gun.order.front[0].length && fMid.row === "front",
  "R6 開始比牌時四家都是牌背；1.3 秒只翻開頭墩最小的那組，正在翻的那排有光暈");
  const g = gtl.steps.find((s) => s.kind === "gun")!;
  ok(g.kind === "gun" && T.frameAt(gtl, g.t0 + 500).shot[g.to] === 0 && T.frameAt(gtl, g.t0 + 650).shot[g.to] === 1 && T.frameAt(gtl, g.t0 + 650).row === null,
    "R7 被打槍：打槍播到 0.6 秒才在名字旁出現「−1」；打槍時牌型徽章已收掉");
  const endRow = T.frameAt(gtl, gtl.steps.filter((s) => s.kind === "rowScore")[0].t0 + 10);
  ok(endRow.showRowScore && endRow.row === "front" && endRow.open.every((o) => o.front) && !endRow.open.some((o) => o.middle),
    "R8 頭墩四家都翻完才秀這墩得失分，中墩還沒翻");
}

// ---- B 徽章與特效判斷 ----
{
  const tri: HandValue = { cat: 3, keys: [8, 8, 8] }, pair: HandValue = { cat: 1, keys: [8, 3] };
  ok(T.badgeOf("front", tri).label === "衝三" && T.badgeOf("front", tri).bonus && T.patternFx("front", tri) === "chongsan"
    && T.badgeOf("front", pair).label === "一對" && !T.badgeOf("front", pair).bonus && T.patternFx("front", pair) === null,
  "B1 頭墩三條＝「衝三」紅金徽章、播衝三特效；頭墩一對是一般金色徽章、沒有特效");
  ok(T.badgeOf("middle", { cat: 6, keys: [] }).label === "同花" && T.badgeOf("back", { cat: 7, keys: [] }).label === "同花" && T.badgeOf("middle", { cat: 3, keys: [] }).label === "三條" && !T.badgeOf("middle", { cat: 3, keys: [] }).bonus,
    "B2 同花一對、同花兩對寫「同花」；中墩三條寫「三條」、不是加分牌型");
  ok((["middle", "back"] as const).every((row) => T.patternFx(row, { cat: 9, keys: [] }) === "tiezhi" && T.patternFx(row, { cat: 10, keys: [] }) === "tonghuashun" && T.patternFx(row, { cat: 11, keys: [] }) === "wulong"
    && T.badgeOf(row, { cat: 9, keys: [] }).bonus && !T.badgeOf(row, { cat: 8, keys: [] }).bonus && T.patternFx(row, { cat: 8, keys: [] }) === null),
  "B3 中墩、尾墩的鐵支／同花順／五龍：紅金徽章＋各自的特效；葫蘆沒有");
  ok(["tiezhi", "tonghuashun", "wulong"].every((k) => T.buildTimeline(must(k)).steps.some((s) => s.kind === "fx" && s.fx === k)), "B4 預覽牌局：鐵支、同花順、五龍都會插播各自的特效");
}

// ---- S 分數 ----
{
  let bad = 0, n = 0, badT = 0;
  const check = (rv: { result: ReturnType<typeof scoreRound> }, arr: ReturnType<typeof autoArrange>[]) => {
    n++;
    const d = T.rowDeltas(rv.result);
    for (const row of T.ROWS) if (d[row].reduce((a, b) => a + b, 0) !== 0) bad++;
    const st = handStats(rv.result); // 伺服器同一個函式（亮牌時存進 reveal.stats）
    for (let s = 0; s < 4; s++) if (T.breakdown(st[s]).reduce((a, b) => a + b.pts, 0) !== rv.result.totals[s]) bad++;
    if (T.buildTimeline({ order: revealOrder(arr), result: rv.result }).end !== revealDurationMs(rv.result)) badT++;
  };
  for (const k of ["normal", "chongsan", "tiezhi", "tonghuashun", "wulong", "gun", "homerun"]) { const rv = must(k); check(rv, rv.arrangements); }
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 3000; i++) { const { hands } = deal(rnd); const a = hands.map(autoArrange); check({ result: scoreRound(a) }, a); }
  ok(bad === 0, `S1 ${n} 局（7 個預覽牌局＋3000 局隨機）：每墩四家得失分合計 0；左欄明細加起來＝伺服器算的本局分數（不符 ${bad}）`);
  ok(badT === 0, `S4 ${n} 局：前端亮牌時間軸的總長＝伺服器 revealDurationMs（結算面板出現時間＝settleAt，四家同步；不符 ${badT}）`);
  const hr = must("homerun");
  const b = T.breakdown(hr.stats[0]), lost = T.breakdown(hr.stats[1]);
  ok(b.some((x) => x.label === "衝三" && x.pts > 0) && b.some((x) => x.label === "中墩鐵支") && b.some((x) => x.label === "尾墩同花順")
    && b.some((x) => x.label === "打槍 ×3" && x.pts === 3 * SCORING.GUN_PENALTY) && b.some((x) => x.label === "全壘打" && x.pts === 9)
    && lost.some((x) => x.label === "被全壘打" && x.pts === -3) && lost.some((x) => x.label.startsWith("被打槍")),
  "S2 全壘打那局（明細來自伺服器 stats）：自己的明細有衝三、中墩鐵支、尾墩同花順、打槍 ×3、全壘打 +9；被打的人有被打槍、被全壘打 −3");
  ok(JSON.stringify(revealOrder(hr.arrangements)) === JSON.stringify(hr.order), "S3 預覽牌局的翻牌順序就是伺服器 revealOrder 算的");
}

// ---- V 畫面 ----
{
  const rv = must("gun");
  const view = { status: "playing" as const, code: "1234", sv: 1, phase: "revealed" as const, handNo: 1, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv };
  const tl = T.buildTimeline(rv);
  const rs = tl.steps.find((s) => s.kind === "rowScore")!;
  const h = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, rs.t0 + 100) } }));
  ok(count(h, /<img[^>]*card-front-/g) === 12 && count(h, /<img[^>]*card-back/g) === 40 && count(h, /data-th-badge=/g) === 4 && count(h, /data-th-delta=/g) === 4,
    `V1 頭墩翻完：四家頭墩 12 張牌面、其餘 40 張牌背；四個牌型徽章、四個得失分（牌面 ${count(h, /<img[^>]*card-front-/g)}、徽章 ${count(h, /data-th-badge=/g)}）`);
  ok(/data-th-pos="left"[\s\S]*?th-badge[^"]*" data-th-badge="[^"]+" style="transform:translate\(-50%, -50%\) rotate\(-90deg\)/.test(h) && !/th-clock/.test(h) && !/思考中/.test(h),
    "V2 徽章永遠是正的（左家的牌轉 90°，徽章反轉 −90°）；亮牌時沒有倒數、沒有思考中");
  const done = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, tl.end - 1) } }));
  const g = T.gunsOf(rv.result)[0];
  ok(new RegExp(`data-seat="${g.to}"[\\s\\S]*?data-th-shot="1"`).test(done) && count(done, /data-th-shot=/g) === 1, "V3 打槍播完：被打的那家名字旁小彈孔「−1」，只有他");
  const res = renderToStaticMarkup(createElement(ThRoundResult, { rv, names: ["老闆", "小明", "阿明", "小華"], mySeat: 0, secondsLeft: 30, confirmed: false, onConfirm: () => {} }));
  ok(count(res, /data-th-res-seat=/g) === 4 && count(res, /<img[^>]*card-front-/g) === 52 && /確認（30）/.test(res) && /查看牌桌/.test(res) && /本局結算/.test(res)
    && /th-res-row is-me" data-th-res-seat="0"/.test(res) && /累計/.test(res),
  "V4 本局結算：左欄標題＋明細＋「確認（30）」（倒數到伺服器 nextHandAt）；右欄四家各一列 13 張牌、本局分數、累計；自己那列亮框；右下「查看牌桌」");
  const fin = renderToStaticMarkup(createElement(ThFinalResult, { players: [{ seat: 0, playerName: "老闆", totalScore: -5 }, { seat: 1, playerName: "小明", totalScore: 12 }, { seat: 2, playerName: "阿明", totalScore: 0 }, { seat: 3, playerName: "小華", totalScore: -7 }],
    mySeat: 0, hands: 8, stats: [{ guns: 4, gunned: 0, homeRuns: 1, homeRunned: 0, total: -5 }, { guns: 0, gunned: 2, homeRuns: 0, homeRunned: 1, total: 12 }, { guns: 0, gunned: 1, homeRuns: 0, homeRunned: 1, total: 0 }, { guns: 0, gunned: 1, homeRuns: 0, homeRunned: 1, total: -7 }], onLobby: () => {} }));
  const order = [...fin.matchAll(/data-th-fin-seat="(\d)"/g)].map((m) => m[1]).join("");
  ok(order === "1203" && /共 8 局/.test(fin) && /回十三支大廳/.test(fin) && /打槍 4/.test(fin) && /全壘打 1/.test(fin), `V5 總結算：照總分排名（實際 ${order}）、共幾局、打槍和全壘打次數（伺服器整場累計 stats，不再自己加總）、「回十三支大廳」`);
}

// ---- H 首頁、理牌提示字 ----
{
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const home = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(Home)));
  ok(/大老二/.test(home) && /台灣麻將/.test(home) && /十三支/.test(home) && !/撲克競技|Big Two|16 張制|4 人桌遊|加一色|65 張/.test(home) && !/home-desc/.test(home),
    "H1 首頁三張遊戲卡只留遊戲名稱（拿掉「4 人撲克競技・Big Two」「16 張制・4 人桌遊」「4 人加一色・65 張」）");
  const arr = renderToStaticMarkup(createElement(ThArrange, { cards: deal(() => 0.3).hands[0], deadline: Date.now() + 60_000, onSubmit: () => {} }));
  ok(!/點牌再點墩|快捷鈕放入|可以送出|就能修正/.test(arr) && /class="th-hint" role="status"><\/div>/.test(arr), "H2 理牌畫面一開始沒有操作提示字（提示列是空的）");
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
