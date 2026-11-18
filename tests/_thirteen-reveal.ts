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

// ---- R 時間軸（老闆 2026-11-18 定案新節奏、小宜 v12 §5：開始比牌 1.7、每家 1.5、換墩不停、大牌多 0.3、每槍 1.5、全壘打 3.2、結算前停 1.2；數字讀伺服器 REVEAL_TIMING） ----
{
  const { REVEAL_TIMING: RT } = await import("../lib/thirteen/flow");
  const normal = must("normal");
  const tl = T.buildTimeline(normal);
  ok(tl.end === 20900 && RT.START_MS === 1700 && RT.PLAY_MS === 1500 && RT.ROW_WAIT_MS === 0, `R1 一般局（沒有大牌、沒有打槍）：開始比牌到結算面板 20.9 秒（實際 ${tl.end / 1000}）`);
  const flips = tl.steps.filter((s) => s.kind === "flip");
  ok(JSON.stringify(flips.filter((s) => s.row === "front").map((s) => s.seats[0])) === JSON.stringify(normal.order.front.flat())
    && flips.every((s) => s.seats.length === 1) && flips[0].t0 === RT.START_MS && flips.every((s, i) => i === 0 || s.t0 === flips[i - 1].t0 + RT.PLAY_MS),
  "R2 頭墩照伺服器的翻牌順序（最小的先），開始比牌 1.7 秒後才出；每家 1.5 秒、換墩不停（12 家等距）");
  const cs = must("chongsan"), ctl = T.buildTimeline(cs);
  const fx = ctl.steps.find((s) => s.kind === "fx")!;
  const flipOf0 = ctl.steps.find((s) => s.kind === "flip" && s.row === "front" && s.seats.includes(0))!;
  const nextFlip = ctl.steps.find((s) => s.kind === "flip" && s.t0 > flipOf0.t0)!;
  ok(fx.kind === "fx" && fx.fx === "chongsan" && fx.t0 === flipOf0.t0 + 500 && fx.dur === 1500 && nextFlip.t0 === flipOf0.t0 + RT.PLAY_MS + RT.SPECIAL_MS && fx.t0 + fx.dur > nextFlip.t0,
    "R3 衝三那家出牌後 0.5 秒播大字 1.5 秒；那家多佔 0.3 秒（1.8 秒後換下一家），大字和下一家出牌重疊");
  const gun = must("gun"), gtl = T.buildTimeline(gun);
  ok(gtl.end === 22400 && gtl.steps.filter((s) => s.kind === "gun").every((s) => s.dur === 1500), `R4 有一槍：22.4 秒（實際 ${gtl.end / 1000}）`);
  const hr = must("homerun"), htl = T.buildTimeline(hr);
  const guns = htl.steps.filter((s) => s.kind === "gun"), home = htl.steps.find((s) => s.kind === "homerun")!;
  ok(home.kind === "homerun" && home.seat === 0 && home.t0 === guns[guns.length - 1].t0 + 1500 && htl.end === home.t0 + 3200 + 1200,
    "R5 全壘打接在所有打槍之後、3.2 秒，再停 1.2 秒出結算");
  const f0 = T.frameAt(tl, 100), fMid = T.frameAt(tl, 1800);
  ok(f0.active.some((s) => s.kind === "start") && f0.open.every((o) => !o.front && !o.middle && !o.back) && !f0.board.show
    && fMid.open.filter((o) => o.front).length === 1 && fMid.glow.length === 1 && fMid.board.show,
  "R6 開始比牌時四家都還沒出、看板還沒出現；1.8 秒只出了頭墩最小的那一家，正在出的有光暈、看板已淡入");
  const g = gtl.steps.find((s) => s.kind === "gun")!;
  ok(g.kind === "gun" && T.frameAt(gtl, g.t0 + 200).shot[g.to] === 0 && T.frameAt(gtl, g.t0 + 300).shot[g.to] === 1 && T.frameAt(gtl, gtl.end - 1).shot[g.to] === 1
    && !T.frameAt(gtl, g.t0 + 10).board.show,
    "R7 被打槍：0.26 秒中彈多一個彈孔，彈孔留到結算；打槍時看板淡出");
  ok(T.revealDurationV8(0, 0, false) === 20900 && T.revealDurationV8(2, 3, true) === 29200, `R9 前端公式：一般局 20.9 秒、最長例（衝三＋鐵支＋三槍＋全壘打）29.2 秒（實際 ${T.revealDurationV8(2, 3, true) / 1000}）`);
}

// ---- K 中央看板（小宜 v12）：牌型落定才出、加分四家出完才出，留到下一墩第一家落定；加分時長都是正的 ----
{
  const tl = T.buildTimeline(must("normal"));
  const fl = tl.steps.filter((s) => s.kind === "flip");
  const first = fl[0], landed = T.frameAt(tl, first.t0 + 349), popped = T.frameAt(tl, first.t0 + 350);
  ok(landed.board.pats.every((p) => p === null) && popped.board.pats.filter(Boolean).length === 1 && popped.board.scoreAt === null,
    "K1 第一家的牌落定（0.35 秒）才在看板跳出牌型；還沒有加分");
  const w = T.scoreWindows(tl);
  const fourth = fl[3], midFirst = fl[4];
  ok(w[0].from === fourth.t0 + 350 + 300 + 100 && w[0].to === midFirst.t0 + 350 && w[2].to === tl.end
    && T.frameAt(tl, w[0].from - 1).board.scoreAt === null && T.frameAt(tl, w[0].from).board.scoreAt !== null
    && T.frameAt(tl, w[0].to - 1).board.scoreAt !== null && T.frameAt(tl, w[0].to - 1).board.row === "front"
    && T.frameAt(tl, w[0].to).board.scoreAt === null && T.frameAt(tl, w[0].to).board.row === "middle",
    `K2 頭墩加分：第四家牌型跳完 0.1 秒後出現，留到中墩第一家的牌落定（${w[0].from}～${w[0].to}ms，${(w[0].to - w[0].from) / 1000} 秒）才清空並換「中墩」；尾墩加分留到結算`);
  let minDur = Infinity, n = 0, bad = 0;
  const check = (rv: { order: Record<"front" | "middle" | "back", number[][]>; result: ReturnType<typeof scoreRound> }) => {
    const t2 = T.buildTimeline(rv);
    for (const x of T.scoreWindows(t2)) { n++; minDur = Math.min(minDur, x.to - x.from); if (!(x.to > x.from) || T.frameAt(t2, x.to - 1).board.scoreAt === null) bad++; }
  };
  for (const k of ["normal", "chongsan", "tiezhi", "tonghuashun", "wulong", "gun", "homerun"]) check(must(k));
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 3000; i++) { const { hands } = deal(rnd); const a = hands.map(autoArrange); check({ order: revealOrder(a), result: scoreRound(a) }); }
  ok(bad === 0 && minDur > 0, `K3 ${n} 墩（3,007 局）加分顯示的時長都大於 0、出現後一直留到清空前一刻（最短 ${minDur}ms；不符 ${bad}）`);
  // K4 審伯必修 1（老闆定案「大字播完中央也要顯示」）：四種大牌的紅金牌型名一定在大字結束後才出現，而且確實顯示過——
  //   原本順序、把大牌那家挪到那一墩最後一家（接著換墩）、全壘打那局把尾墩大牌挪到最後一家（接著打槍）都要成立
  type Rv = { order: Record<"front" | "middle" | "back", number[][]>; result: ReturnType<typeof scoreRound> };
  const lastOf = (rv: Rv, row: "front" | "middle" | "back", seat: number): Rv =>
    ({ ...rv, order: { ...rv.order, [row]: [...rv.order[row].flat().filter((x) => x !== seat).map((x) => [x]), [seat]] } });
  const variants: [string, Rv][] = [];
  for (const k of ["chongsan", "tiezhi", "tonghuashun", "wulong", "homerun"]) {
    const rv = must(k);
    variants.push([k, rv]);
    for (const f of T.buildTimeline(rv).steps) if (f.kind === "fx") variants.push([`${k}／${T.ROW_NAME[f.row]}大牌挪到最後一家`, lastOf(rv, f.row, f.seat)]);
  }
  const k4bad: string[] = [];
  let k4n = 0, sawGunAfter = false, sawRowChange = false;
  for (const [name, rv] of variants) {
    const tl = T.buildTimeline(rv);
    for (const f of tl.steps) {
      if (f.kind !== "fx") continue;
      k4n++;
      const fxEnd = f.t0 + f.dur, before = T.frameAt(tl, fxEnd - 1), after = T.frameAt(tl, fxEnd);
      const shownBefore = before.board.row === f.row && before.board.pats[f.seat] !== null;
      const shownAfter = after.board.show && after.board.row === f.row && after.board.pats[f.seat]?.big === true;
      if (shownBefore || !shownAfter) k4bad.push(`${name}：${T.ROW_NAME[f.row]} ${f.seat} 號（大字前${shownBefore ? "已出現" : "未出現"}、大字後${shownAfter ? "有" : "沒有"}）`);
      const flips = tl.steps.filter((x) => x.kind === "flip"), mine = flips.find((x) => x.kind === "flip" && x.row === f.row && x.seats.includes(f.seat))!;
      const next = flips[flips.indexOf(mine) + 1];
      if (!next && tl.steps.some((x) => x.kind === "gun")) sawGunAfter = true;
      if (next && next.kind === "flip" && next.row !== f.row) sawRowChange = true;
    }
  }
  ok(k4bad.length === 0 && sawGunAfter && sawRowChange,
    `K4 ${variants.length} 種出牌順序、${k4n} 個大牌：大字結束前看板沒有那家的牌型名，大字一結束就顯示紅金牌型名（含大牌接著換墩${sawRowChange ? "✓" : "✗"}、尾墩最後一家大牌接著打槍${sawGunAfter ? "✓" : "✗"}）${k4bad.length ? "；不符：" + k4bad.join("、") : ""}`);
  let k5min = Infinity, k5bad = 0;
  for (const [, rv] of variants) {
    const tl = T.buildTimeline(rv);
    if (tl.end !== revealDurationMs(rv.result)) k5bad++;
    for (const w of T.scoreWindows(tl)) { k5min = Math.min(k5min, w.to - w.from); if (!(w.to > w.from) || T.frameAt(tl, w.to - 1).board.scoreAt === null || !T.frameAt(tl, w.to - 1).board.show) k5bad++; }
  }
  ok(k5bad === 0 && k5min > 0, `K5 上面這些出牌順序：加分顯示時長都大於 0（最短 ${k5min}ms）、整局總長仍等於伺服器公式（不符 ${k5bad}）`);
}

// ---- B 徽章與特效判斷 ----
{
  const tri: HandValue = { cat: 3, keys: [8, 8, 8] }, pair: HandValue = { cat: 1, keys: [8, 3] };
  ok(T.badgeOf("front", tri).label === "衝三" && T.badgeOf("front", tri).bonus && T.patternFx("front", tri) === "chongsan"
    && T.badgeOf("front", pair).label === "一對" && !T.badgeOf("front", pair).bonus && T.patternFx("front", pair) === null,
  "B1 頭墩三條＝「衝三」紅金徽章、播衝三特效；頭墩一對是一般金色徽章、沒有特效");
  ok(T.badgeOf("middle", { cat: 6, keys: [] }).label === "同花一對" && T.badgeOf("back", { cat: 7, keys: [] }).label === "同花兩對" && T.badgeOf("middle", { cat: 3, keys: [] }).label === "三條" && !T.badgeOf("middle", { cat: 3, keys: [] }).bonus,
    "B2 同花一對、同花兩對照實寫（比同花大，老闆 2026-11-18）；中墩三條寫「三條」、不是加分牌型");
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
    if (T.buildTimeline({ order: revealOrder(arr), result: rv.result }).end !== revealDurationMs(rv.result)) badT++; // 伺服器 settleAt 用的同一個函式（老柯 dd0602a）
  };
  for (const k of ["normal", "chongsan", "tiezhi", "tonghuashun", "wulong", "gun", "homerun"]) { const rv = must(k); check(rv, rv.arrangements); }
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 3000; i++) { const { hands } = deal(rnd); const a = hands.map(autoArrange); check({ result: scoreRound(a) }, a); }
  ok(bad === 0, `S1 ${n} 局（7 個預覽牌局＋3000 局隨機）：每墩四家得失分合計 0；左欄明細加起來＝伺服器算的本局分數（不符 ${bad}）`);
  ok(badT === 0, `S4 ${n} 局：前端亮牌時間軸的總長＝伺服器 revealDurationMs（dd0602a；結算面板＝settleAt，四家同步；不符 ${badT}）`);
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
  const w0 = T.scoreWindows(tl)[0];
  const h = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, w0.from + 10) } }));
  ok(count(h, /<img[^>]*card-front-/g) === 12 && count(h, /<img[^>]*card-back/g) === 40 && count(h, /data-th-board-pt=/g) === 4 && count(h, /data-th-board-sc=/g) === 4 && count(h, /data-th-hand/g) === 4
    && !/th-cardlabel|th-rowlabel|data-th-delta/.test(h),
    `V1 頭墩四家出完：出牌區 12 張牌面、手牌區剩 40 張牌背；看板 4 個牌型＋4 個加分；牌面上和出牌區旁不再有字（牌面 ${count(h, /<img[^>]*card-front-/g)}、牌背 ${count(h, /<img[^>]*card-back/g)}、看板牌型 ${count(h, /data-th-board-pt=/g)}、加分 ${count(h, /data-th-board-sc=/g)}）`);
  ok(/th-seat2" style="left:328px;top:185px;transform:rotate\(90deg\)/.test(h) && /th-seat2" style="left:422px;top:267px;transform:rotate\(0deg\)/.test(h) && /th-seat2" style="left:422px;top:107px;transform:rotate\(180deg\)/.test(h)
    && /data-th-board="front"/.test(h) && !/th-clock/.test(h) && !/思考中/.test(h),
    "V2 四家出牌區原點＝頭墩中間那張牌（v13：左家 328,185 轉 90°、自己 422,267、對家 422,107）；亮牌時沒有倒數、沒有思考中");
  ok(count(h, /class="th-fan-card"/g) === 12 && count(h, /data-th-back=/g) === 8 && count(h, /data-th-mid/g) === 4,
    `V2b 扇形：翻開的 12 張每張各自定位（th-fan-card）；每家剩中墩、尾墩兩組牌背（${count(h, /data-th-back=/g)} 組）`);
  const done = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, tl.end - 1) } }));
  const g = T.gunsOf(rv.result)[0];
  ok(new RegExp(`data-seat="${g.to}"[\\s\\S]*?data-gp-shot="1"`).test(done) && count(done, /data-gp-shot=/g) === 1 && count(done, /data-th-hole=/g) === 1
    && count(done, /data-th-hole-big=/g) === (g.to === 0 ? 1 : 0), "V3 打槍播完：被打的那家出牌區留一個彈孔、名字旁「−1」；被打的是自己才有第一人稱大彈孔");
  const res = renderToStaticMarkup(createElement(ThRoundResult, { rv, names: ["老闆", "小明", "阿明", "小華"], mySeat: 0, secondsLeft: 30, confirmed: false, onConfirm: () => {} }));
  ok(count(res, /data-th-res-seat=/g) === 4 && count(res, /<img[^>]*card-front-/g) === 52 && /確認（30）/.test(res) && /查看牌桌/.test(res) && /本局結算/.test(res)
    && /th-res-row is-me" data-th-res-seat="0"/.test(res) && /累計/.test(res),
  "V4 本局結算：左欄標題＋明細＋「確認（30）」（倒數到伺服器 nextHandAt）；右欄四家各一列 13 張牌、本局分數、累計；自己那列亮框；右下「查看牌桌」");
  const fin = renderToStaticMarkup(createElement(ThFinalResult, { players: [{ seat: 0, playerName: "老闆", totalScore: -5 }, { seat: 1, playerName: "小明", totalScore: 12 }, { seat: 2, playerName: "阿明", totalScore: 0 }, { seat: 3, playerName: "小華", totalScore: -7 }],
    mySeat: 0, hands: 8, stats: [{ guns: 4, gunned: 0, homeRuns: 1, homeRunned: 0, total: -5 }, { guns: 0, gunned: 2, homeRuns: 0, homeRunned: 1, total: 12 }, { guns: 0, gunned: 1, homeRuns: 0, homeRunned: 1, total: 0 }, { guns: 0, gunned: 1, homeRuns: 0, homeRunned: 1, total: -7 }], onLobby: () => {} }));
  const order = [...fin.matchAll(/data-th-fin-seat="(\d)"/g)].map((m) => m[1]).join("");
  ok(order === "1203" && /共 8 局/.test(fin) && /回十三支大廳/.test(fin) && /打槍 4/.test(fin) && /全壘打 1/.test(fin), `V5 總結算：照總分排名（實際 ${order}）、共幾局、打槍和全壘打次數（伺服器整場累計 stats，不再自己加總）、「回十三支大廳」`);
}

// ---- O 亮牌時每墩照牌型排好（老闆 2026-11-18：A Q A A Q → A A A Q Q；用引擎 evalRow 的比較序） ----
{
  const { parseCards } = await import("../lib/thirteen");
  const show = (t: string) => T.rowDisplayOrder(parseCards(t)).map((c) => c.id.slice(1, 2)).join(" ");
  const fh = show("AD QD AS AH QS"), tp = show("3S KH 3D KC 9S"), qd = show("7S 2H 7D 7C 7H"), st = show("9S 5H 7D 8C 6H"), one = show("4S QD 4H");
  ok(fh === "A A A Q Q" && tp === "K K 3 3 9" && qd === "7 7 7 7 2" && st === "9 8 7 6 5" && one === "4 4 Q",
    `O1 葫蘆 A A A Q Q、兩對 K K 3 3 9、鐵支 7 7 7 7 2、順子 9 8 7 6 5、頭墩一對 4 4 Q（實際：${fh}／${tp}／${qd}／${st}／${one}）`);
  const rv = must("normal");
  const tl = T.buildTimeline(rv);
  const view = { status: "playing" as const, code: "1234", sv: 1, phase: "revealed" as const, handNo: 1, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv };
  const h = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, tl.end - 1) } }));
  const imgs = [...h.matchAll(/<img[^>]*src="[^"]*card-front-([a-z]+)-(\w+)\.v\d\.webp"/g)].map((m) => m[2]);
  const want = [0, 1, 2, 3].flatMap((s) => T.ROWS.flatMap((r) => T.rowDisplayOrder(rv.arrangements[s][r]).map((c) => ({ 14: "a", 13: "k", 12: "q", 11: "j" } as Record<number, string>)[c.rank] ?? String(c.rank))));
  ok(imgs.length === 52 && imgs.join(",") === want.join(","), `O2 牌桌亮開的 52 張照這個排列畫（${imgs.length} 張）`);
}

// ---- L 看板格子固定、大牌只出紅金牌型名 ----
{
  const rv = must("tiezhi"), tl = T.buildTimeline(rv);
  const view = { status: "playing" as const, code: "1234", sv: 1, phase: "revealed" as const, handNo: 1, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv };
  const fx = tl.steps.find((x) => x.kind === "fx")!;
  const w = T.scoreWindows(tl).find((x) => fx.kind === "fx" && x.row === fx.row)!;
  const h = renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, w.from + 10) } }));
  const pos = ["bottom", "right", "top", "left"][fx.kind === "fx" ? fx.seat : 0];
  ok(new RegExp(`data-th-board-cell="${pos}"><span class="th-board-pt is-bonus[^"]*" data-th-board-pt="鐵支"`).test(h) && ["bottom", "right", "top", "left"].every((p) => h.includes(`data-th-board-cell="${p}"`)),
    "L2 鐵支那一家：大字播完後看板那一格是紅金「鐵支」；四家各有固定的格子（上對家、左左家、右右家、下自己）");
}

// ---- P 老闆第 9 輪回饋（2026-11-18）：牌型寫在牌面上、得失分等四家出完、同花一對照實寫、大彈孔在畫面內 ----
{
  const { parseCards, evalFive } = await import("../lib/thirteen");
  const { readFileSync } = await import("node:fs");
  const fp = T.badgeOf("middle", evalFive(parseCards("9S 9S KS 5S 3S"))), ftp = T.badgeOf("back", evalFive(parseCards("9S 9S KS KS 3S"))), fl = T.badgeOf("back", evalFive(parseCards("AH QH 9H 5H 2H")));
  ok(fp.label === "同花一對" && ftp.label === "同花兩對" && fl.label === "同花", `P1 同花一對、同花兩對照計分引擎寫，不再一律「同花」（實際：${fp.label}／${ftp.label}／${fl.label}）`);
  const rv = must("normal"), tl = T.buildTimeline(rv);
  const view = { status: "playing" as const, code: "1234", sv: 1, phase: "revealed" as const, handNo: 1, settings: { arrangeSec: 60, totalHands: 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv };
  const at = (t: number) => renderToStaticMarkup(createElement(ThTable, { view, now: 0, clockSkew: 0, reveal: { rv, frame: T.frameAt(tl, t) } }));
  const flips = tl.steps.filter((x) => x.kind === "flip" && x.row === "middle"), wm = T.scoreWindows(tl)[1];
  const mid = at(flips[1].t0 + 400), full = at(wm.from + 10);
  ok(count(mid, /data-th-board-pt="/g) === 2 && count(mid, /data-th-board-sc=/g) === 0 && count(full, /data-th-board-pt="/g) === 4 && count(full, /data-th-board-sc=/g) === 4,
    `P2 中墩出到第 2 家：看板 2 個牌型、還沒有加分；四家出完後 4 個牌型＋4 個加分（${count(mid, /data-th-board-pt="/g)}/${count(mid, /data-th-board-sc=/g)} → ${count(full, /data-th-board-pt="/g)}/${count(full, /data-th-board-sc=/g)}）`);
  const css = readFileSync("components/thirteen/thReveal.css", "utf8"), tsx = readFileSync("components/thirteen/ThTable.tsx", "utf8");
  const size = Number(/\.th-hole-big \{[^}]*width: (\d+)px/.exec(css)?.[1]);
  const at3 = JSON.parse(/const BIG_HOLE_AT = (\[[^;]+\]);/.exec(tsx)![1]) as number[][], rot = JSON.parse(/const HOLE_ROT = (\[[^;]+\]);/.exec(tsx)![1]) as number[];
  const boxes = at3.map(([x, y], i) => { const r = rot[i] * Math.PI / 180, half = size / 2 * (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r))); return [x - half, y - half, x + half, y + half].map(Math.round); });
  ok(boxes.every(([l, t, r, b]) => l >= 0 && t >= 0 && r <= 844 && b <= 390) && /th-hole-big \{[^}]*rotate\(var\(--hr/.test(css) && !/rotate: `\$\{HOLE_ROT/.test(tsx),
    `P3 被打三槍的三個大彈孔（含轉角度後的外框）都在 844×390 牌桌裡：${boxes.map((b) => b.join(",")).join("／")}；角度放在 transform 裡、置中後才轉`);
  ok(css.includes(".th-hole, .th-blk img.th-hole { position: absolute; width: 58px; height: 58px; max-width: none; margin: 0; box-shadow: none; border-radius: 0;"),
    "P4 出牌區的小彈孔不套用牌的陰影、圓角、寬高和疊牌左邊距（之前陰影轉了角度就是矩形／菱形邊）");
}

// ---- H9 全壘打打擊者畫面（小宜 v9，老闆素材 2026-11-18） ----
{
  const { readFileSync, existsSync } = await import("node:fs");
  const { REVEAL_TIMING } = await import("../lib/thirteen/flow");
  ok(T.MS.homerun === 3200 && REVEAL_TIMING.HOME_RUN_MS === 3200, `H9-1 全壘打總長維持 3.2 秒，前端和伺服器同一個常數（前端 ${T.MS.homerun}、伺服器 ${REVEAL_TIMING.HOME_RUN_MS}）`);
  const list = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, string>;
  const files = [["hrfield", "v1"], ["hrbatter", "v2"], ["hrstar", "v1"]].flatMap(([n, v]) => ["m", "d"].map((z) => `/tiles/thirteen/fx/th-fx-${n}.${v}.${z}.webp`)); // hrbatter v2：老闆第 12 輪新揮棒圖
  ok(files.every((f) => existsSync(`public${f}`) && f in list), "H9-2 球場背景、打擊者、十字星（手機 .m、桌機 .d）都在，也登記了長期快取雜湊");
  const css = readFileSync("components/thirteen/thReveal.css", "utf8");
  const num = (re: RegExp) => Number(re.exec(css)?.[1]);
  const bLeft = num(/\.th-hr9-batter \{ left: ([\d.]+)vw/), bH = /height: min\((\d+)vh, (\d+)vw\)/.exec(css.slice(css.indexOf(".th-hr9-batter {")))!;
  const wCx = num(/\.th-hr9-title \{[^}]*left: ([\d.]+)vw/), wW = num(/\.th-hr9 \.th-hr9-word \{[^}]*width: ([\d.]+)vw/);
  const AR = 0.9073; // 打擊者素材寬÷高（v2 新揮棒圖，整理素材時量的）
  const gaps = [[844, 390], [932, 430], [1440, 900], [1920, 1080], [2560, 1260]].map(([W, H]) => {
    const right = W * bLeft / 100 + Math.min(H * +bH[1] / 100, W * +bH[2] / 100) * AR;
    return Math.round(W * (wCx - wW / 2) / 100 - right);
  });
  ok(gaps.every((g) => g > 0), `H9-3 打擊者右緣和「全壘打」大字左緣不重疊（844×390、932×430、1440×900、1920×1080、2560×1260 間隔：${gaps.join("、")}px）`);
  const dur = [...css.matchAll(/@keyframes (th-hr9-[a-z]+)/g)].map((m) => m[1]);
  ok(dur.length >= 9 && /\.th-hr9 > \*, \.th-hr9 picture > img, \.th-hr9-name \{ animation-duration: 3\.2s/.test(css) && /\.th-hr9 \{[^}]*animation: th-hr9-out 3\.2s/.test(css),
    `H9-4 打擊者畫面每一層的動畫都是 3.2 秒的時間軸（${dur.length} 組 keyframes），結束時一起淡出`);
  const { sfxEvents } = await import("../components/thirteen/sfx");
  const hr = must("homerun"), tl = T.buildTimeline(hr), home = tl.steps.find((x) => x.kind === "homerun")!;
  const inHr = sfxEvents(tl.steps, 0, "r3-a").filter((e) => e.t >= home.t0 && e.t < home.t0 + home.dur).map((e) => e.k);
  ok(inHr.join(",") === "bat", `H9-5 全壘打 3.2 秒內只有擊球聲（選了大牌音效也一樣，集氣不播）；實際：${inHr.join("、")}`);
  const fxTsx = readFileSync("components/thirteen/ThRevealFx.tsx", "utf8");
  const ready = ["m", "d"].map((z) => `/tiles/thirteen/fx/th-fx-hrready.v1.${z}.webp`);
  ok(ready.every((f) => existsSync(`public${f}`) && f in list) && /Pic name="hrready"/.test(fxTsx) && !/Pic name="bat"/.test(fxTsx) && /@keyframes th-ready/.test(css) && !/@keyframes th-bat/.test(css),
    "H9-6 集氣改用打擊者準備姿勢圖（老闆第 10 輪，取代只有球棒的圖），手機、桌機兩張都登記了雜湊");
  const readyKf = /@keyframes th-ready \{([\s\S]*?)\n\}/.exec(css)![1];
  const tf = [...readyKf.matchAll(/transform: ([^;]+);/g)].map((m) => m[1]);
  ok(tf.length >= 4 && tf.every((t) => /^translate\(-50%,-50%\) scale\([\d.]+\)$/.test(t)) && !/rotate|var\(--face/.test(readyKf) && /scaleX\(-1\)/.test(fxTsx),
    `H9-7 集氣準備姿勢固定不動：動畫只有放大（${tf.map((t) => /scale\(([\d.]+)\)/.exec(t)![1]).join("→")}）和透明度，沒有旋轉、沒有水平位移；左右鏡射放在不動的外層`);
  const vw = (sel: string) => Number(new RegExp(`${sel.replace(/\./g, "\\.")} \\{[^}]*?left: ([\\d.]+)vw`).exec(css)?.[1]);
  const pairs: [string, string][] = [[".th-hr9-ballpath", ".th-hr9.is-flip .th-hr9-ballpath"], [".th-hr9-star", ".th-hr9.is-flip .th-hr9-star"], [".th-hr9-title", ".th-hr9.is-flip .th-hr9-title"]];
  const mirrored = pairs.every(([a, b]) => Math.abs(vw(a) + vw(b) - 100) < 0.01);
  ok(mirrored && /\.th-hr9\.is-flip \.th-hr9-batter \{ left: auto; right: 7vw;/.test(css) && /@keyframes th-hr9-batter-r[\s\S]*?28\.125%, 100% \{ transform: translate\(0, 0\) scale\(1\) scaleX\(-1\)/.test(css)
    && /th-hr9\$\{h\.face < 0 \? " is-flip" : ""\}/.test(fxTsx),
    `H9-8 右家、對家（人物朝左）的打擊者畫面左右對調：打擊者靠右、球和星星和大字以中線鏡射（${pairs.map(([a, b]) => `${vw(a)}→${vw(b)}`).join("、")}vw），間隔和原版一樣；自己、左家不變`);
}
{
  const { readFileSync } = await import("node:fs");
  const room = readFileSync("components/thirteen/thRoom.css", "utf8");
  ok(/\.th-seat2 \.th-blk-row \+ \.th-blk-row \{ margin-top: 0; \}/.test(room),
    "V9 出牌區中墩、尾墩不再吃舊版面的負 margin-top（老闆第 10 輪：第二副壓住第一副太多）；每墩只由 top: r × --off 決定");
}

// ---- F 扇形出牌（小宜 v13）、四家牌背往中間靠攏（v14.2）、大牌大字分級（v14）：幾何數字和設計說明逐項對 ----
{
  const L = await import("../components/thirteen/fanLayout");
  const near = (a: number, b: number, e = 0.6) => Math.abs(a - b) <= e;
  const P = ["bottom", "right", "top", "left"] as const;
  // F1 頭墩中間那張牌（v13 §2）；中墩、尾墩往玩家方向錯開 36／31／30／31（v14.2 §6）
  const head = { bottom: [422, 267], right: [516, 185], top: [422, 107], left: [328, 185] };
  const mid = { bottom: [422, 303], right: [547, 185], top: [422, 77], left: [297, 185] };
  ok(P.every((p) => { const g = L.SEAT_GEO[p], a = L.toStage(g, 0, 0), b = L.toStage(g, 0, g.off); return near(a[0], head[p][0]) && near(a[1], head[p][1]) && near(b[0], mid[p][0]) && near(b[1], mid[p][1]); }),
    "F1 四家頭墩、中墩中間那張牌的中心和 v13／v14.2 一致（自己錯開 36、對家 30、左右家 31）");
  // F2 扇形：夾角 4°、半徑 430／358、兩邊的牌往玩家方向收
  const R = (p: (typeof P)[number]) => L.SEAT_GEO[p].step / (2 * Math.sin(2 * Math.PI / 180));
  const e0 = L.cardPose(L.SEAT_GEO.bottom, 0, 0, 5), e4 = L.cardPose(L.SEAT_GEO.bottom, 0, 4, 5), c2 = L.cardPose(L.SEAT_GEO.bottom, 0, 1, 3);
  ok(near(R("bottom"), 430, 0.5) && near(R("top"), 358, 0.5) && e0.deg === -8 && e4.deg === 8 && c2.deg === 0 && c2.x === 0 && near(e4.y, 430 * (1 - Math.cos(8 * Math.PI / 180)), 0.01) && e4.y > 0,
    `F2 扇形：半徑自己 ${R("bottom").toFixed(1)}、他家 ${R("top").toFixed(1)}；五張展開 −8°～+8°、三張 −4°～+4°，兩邊往玩家方向收 ${e4.y.toFixed(2)}`);
  // F3 牌背組中心（v14.2 §3 兩張表）
  const backs = (p: (typeof P)[number], gone: number) => L.backGroupX(L.SEAT_GEO[p], gone).map((x) => x === null ? null : L.toStage(L.SEAT_GEO[p], x, L.backY(L.SEAT_GEO[p])).map((v) => Math.round(v)).join(","));
  const want: Record<string, string[][]> = {
    bottom: [["322,361", "406,361", "506,361"], ["372,361", "472,361"], ["422,361"]],
    top: [["510,26", "436,26", "348,26"], ["466,26", "378,26"], ["422,26"]],
    right: [["732,273", "732,199", "732,111"], ["732,229", "732,141"], ["732,185"]],
    left: [["112,97", "112,171", "112,259"], ["112,141", "112,229"], ["112,185"]],
  };
  const got = P.map((p) => [0, 1, 2].map((gone) => backs(p, gone).filter((v) => v !== null)));
  ok(P.every((p, i) => JSON.stringify(got[i]) === JSON.stringify(want[p])), `F3 四家剩下的牌背永遠在牌背區正中間，起訖座標和 v14.2 §3 一致：${JSON.stringify(got[0])}`);
  // F4 前端動畫時間：飛牌最後一張、牌背滑動都在出牌落定（0.35 秒）前結束
  ok(L.FAN_FLY_MS === 290 && L.FAN_STAGGER_MS === 15 && L.BACK_SLIDE_MS === 200 && L.FAN_FLY_MS + 4 * L.FAN_STAGGER_MS <= T.MS.flip && L.BACK_SLIDE_MS <= T.MS.flip,
    "F4 飛牌 0.29 秒、每張晚 0.015 秒（五張 0.35 秒落定）、牌背滑 0.2 秒，都 ≤ 出牌落定 0.35 秒");
  // F5 大字分級（v14 §3）：寬度、中心
  const K = ["wulong", "tonghuashun", "tiezhi", "chongsan"] as const;
  const w = (p: (typeof P)[number]) => K.map((k) => Math.round(L.fxWidth(p, k)));
  const cx = (p: "left" | "right") => K.map((k) => Math.round(L.fxCenter(p, k)[0]));
  ok(JSON.stringify(w("top")) === "[210,189,168,105]" && JSON.stringify(w("bottom")) === "[270,243,216,135]"
    && JSON.stringify(cx("right")) === "[595,584,573,547]" && JSON.stringify(cx("left")) === "[249,260,271,297]"
    && near(L.fxCenter("bottom", "wulong")[1], 303) && near(L.fxCenter("top", "wulong")[1], 77),
    `F5 大字寬：他家 ${w("top")}、自己 ${w("bottom")}（五龍＞同花順＞鐵支＞衝三）；左右家中心 x ${cx("left")}／${cx("right")}`);
  const fxTsx = (await import("node:fs")).readFileSync("components/thirteen/ThRevealFx.tsx", "utf8");
  ok(!/bh \* 1\.5/.test(fxTsx) && /fxWidth\(pos, step\.fx\)/.test(fxTsx), "F6 拿掉衝三原本的 1.5 倍框高，大字寬改用 fxWidth");
}

// ---- A 理牌最後 10 秒提醒、牌型配音（老闆 2026-11-18） ----
{
  const { readFileSync, existsSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const S = await import("../components/thirteen/sfx");
  const { CAT } = await import("../lib/thirteen");
  // A1 倒數 60→0：剩 10、3、2、1 秒各一次共 4 次；送出就停
  const fire = (submitAt: number | null) => { const out: number[] = []; for (let left = 60; left >= 0; left--) if (S.remindAt(left, submitAt !== null && left <= submitAt)) out.push(left); return out; };
  ok(fire(null).join(",") === "10,3,2,1" && fire(6).join(",") === "10" && fire(2).join(",") === "10,3" && [10, 3, 2, 1].map(S.remindIsDouble).join() === "true,false,false,false", `A1 理牌提醒：剩 10、3、2、1 秒各一次共 ${fire(null).length} 次，9～4 秒安靜；剩 6 秒送出只有 10 秒那 1 次（${fire(6).join(",")}）；剩 2 秒送出只有 10、3（${fire(2).join(",")}）；剩 10 秒是整個檔案（滴滴）、3、2、1 秒只播第一個短音`);
  // A2 提醒聲和震動照麻將（共用 turn-remind.mp3、vibrate 200ms），聲音受音效開關控制、震動不受
  const w = globalThis as unknown as Record<string, unknown>;
  const saved = { window: w.window, localStorage: w.localStorage, Audio: w.Audio, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  const store = new Map<string, string>(), played: string[] = [], vib: number[] = [];
  class FakeAudio { src: string; preload = ""; volume = 1; constructor(src: string) { this.src = src; } cloneNode() { return new FakeAudio(this.src); } play() { played.push(this.src); return Promise.resolve(); } }
  w.window = globalThis; w.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }; w.Audio = FakeAudio;
  Object.defineProperty(globalThis, "navigator", { value: { vibrate: (ms: number) => { vib.push(ms); return true; } }, configurable: true });
  S.setSfxOn(true); S.arrangeRemind(); const onPlayed = played.slice(), onVib = vib.length;
  S.setSfxOn(false); played.length = 0; S.arrangeRemind(); S.playSrc(S.voiceSrc("back", { cat: CAT.FOUR_KIND, keys: [] } as unknown as HandValue)); const offPlayed = played.length, offVib = vib.length - onVib;
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true }); S.setSfxOn(true); played.length = 0; S.arrangeRemind(); const iosPlayed = played.length;
  w.window = saved.window; w.localStorage = saved.localStorage; w.Audio = saved.Audio; if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
  ok(onPlayed.join() === S.REMIND_SRC && S.REMIND_SRC === "/mahjong-fx/s/turn-remind.mp3" && existsSync(`public${S.REMIND_SRC}`) && onVib === 1 && vib[0] === 200 && offPlayed === 0 && offVib === 1 && iosPlayed === 1,
    `A2 提醒：音效開著播麻將提醒聲＋震 200ms（單聲截停見 _thirteen-remind-clip.ts）；⚙ 音效關掉時提醒聲和配音都不播（播了 ${offPlayed} 個），震動照常；不支援震動的裝置只有聲音（${iosPlayed} 聲）`);
  // A3 每墩牌落定唸那一家的牌型（12 次）；大牌和大字同時開始；同花一對照實唸、頭墩三條唸衝三
  for (const name of ["normal", "chongsan", "wulong"]) {
    const rv = must(name), tl = T.buildTimeline(rv), vs = S.sfxEvents(tl.steps, 0, null, rv.result.values).filter((e) => e.k === "voice");
    const flips = tl.steps.filter((x): x is Extract<typeof x, { kind: "flip" }> => x.kind === "flip");
    const want = flips.map((f) => ({ t: f.big ? f.t0 + T.MS.fxDelay : f.t0 + T.MS.flip, src: S.voiceSrc(f.row, rv.result.values[f.seats[0]][f.row]) })).sort((a, b) => a.t - b.t);
    ok(vs.length === 12 && JSON.stringify(vs.map((e) => [e.t, e.src])) === JSON.stringify(want.map((e) => [e.t, e.src])),
      `A3 ${name}：12 墩各唸一次，一般牌在落定（出牌後 0.35 秒）、大牌在大字出現（0.5 秒）；${vs.map((e) => e.src!.replace(/.*th-voice-|\.v1\.mp3/g, "")).join(" ")}`);
  }
  ok(S.voiceSrc("front", { cat: CAT.THREE_KIND } as HandValue).endsWith("th-voice-chongsan.v1.mp3") && S.voiceSrc("back", { cat: CAT.THREE_KIND } as HandValue).endsWith("th-voice-cat3.v1.mp3")
    && S.voiceSrc("middle", { cat: CAT.FLUSH_PAIR } as HandValue).endsWith("th-voice-cat6.v1.mp3"), "A4 頭墩三條唸衝三、中尾墩唸三條；同花一對唸 cat6（照計分程式）");
  // A5 13 個檔都在、登記雜湊；三條是新錄的版本（不是三條-舊）
  const list = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, string>;
  const files = [...Array.from({ length: 12 }, (_, i) => `cat${i}`), "chongsan"].map((k) => `/tiles/thirteen/voice/th-voice-${k}.v1.mp3`);
  const sha1 = (f: string) => createHash("sha1").update(readFileSync(`public${f}`)).digest("hex");
  ok(files.every((f) => existsSync(`public${f}`) && f in list) && new Set(files.map(sha1)).size === 13
    && sha1(files[3]) === "795510a19b760ffce3165f83940fa1996e7980c5" && sha1(files[3]) !== "00e5f7deefcd85f81c53f2c2c833a7c8c99121bd" && existsSync("public/tiles/thirteen/voice/SOURCE.txt"),
    "A5 13 個配音檔都在、內容都不同、登記了雜湊；三條是新版（sha1 7955…，不是三條-舊 00e5…）；來源寫在 SOURCE.txt");
}

// ---- Z 審伯必修 2：結算面板和倒數照伺服器的 settleAt／nextHandAt（同一個時差換算），舊局不被新時間軸延後 ----
{
  const ThReveal = (await import("../components/thirteen/ThReveal")).default;
  const rv0 = must("normal");
  const view = (over: boolean) => ({ status: "playing" as const, code: "1234", sv: 1, phase: "revealed" as const, handNo: 1, settings: { arrangeSec: 60, totalHands: over ? 1 : 8 }, serverNow: 0, arrangeDeadline: null,
    players: ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: true })), me: { seat: 0, hand: [], arrangement: rv0.arrangements[0] }, reveal: rv0 });
  // 伺服器時間＝本機時間＋skew；畫面收到的 startAt、settleAt、confirmBy 都已經減掉 skew（app/thirteen/page.tsx）
  const render = (o: { refreshAt: number; settleAfter: number | null; nextAfter: number | null; over?: boolean }) => {
    const startAt = Date.now() - o.refreshAt;
    return renderToStaticMarkup(createElement(ThReveal, { view: view(!!o.over), rv: { ...rv0, over: !!o.over }, startAt,
      settleAt: o.settleAfter === null ? null : startAt + o.settleAfter, confirmBy: o.nextAfter === null ? null : startAt + o.nextAfter,
      confirmed: false, onConfirm: () => {}, confirmLabel: o.over ? "看總結算" : "確認" }));
  };
  const panel = (h: string) => /本局結算/.test(h);
  const left = (h: string) => Number(/（(\d+)）<\/button>/.exec(h)?.[1] ?? NaN);
  // 舊局（改節奏前 12.5 秒就結算）：13 秒重新整理
  const old13 = render({ refreshAt: 13_000, settleAfter: 12_500, nextAfter: 42_500 });
  ok(panel(old13) && left(old13) === 30, `Z1 舊局 settleAt＝亮牌後 12.5 秒、13 秒重新整理：馬上顯示本局結算（新時間軸要 20.9 秒），確認倒數照 nextHandAt 剩 ${left(old13)} 秒（29.5 秒進位）`);
  const old12 = render({ refreshAt: 12_000, settleAfter: 12_500, nextAfter: 42_500 });
  ok(!panel(old12), "Z2 同一個舊局 12 秒時還沒到 settleAt：還在亮牌、沒有結算面板");
  // 一般局（新節奏）：settleAt＝20.9 秒
  const n20 = render({ refreshAt: 20_800, settleAfter: 20_900, nextAfter: 50_900 }), n21 = render({ refreshAt: 21_000, settleAfter: 20_900, nextAfter: 50_900 });
  ok(!panel(n20) && panel(n21) && left(n21) === 30, `Z3 一般局：20.8 秒還在亮牌、21 秒（過了 settleAt 20.9）顯示結算，倒數照 nextHandAt 剩 ${left(n21)} 秒`);
  // 最後一局：沒有 nextHandAt（伺服器亮牌就關房），結算照 settleAt，倒數＝settleAt＋30 秒
  const f13 = render({ refreshAt: 13_000, settleAfter: 12_500, nextAfter: null, over: true });
  ok(panel(f13) && /看總結算（30）/.test(f13), "Z4 最後一局（舊局時間）13 秒重新整理：照 settleAt 顯示結算，「看總結算」倒數從 settleAt 起算 30 秒");
  const noSrv = render({ refreshAt: 13_000, settleAfter: null, nextAfter: null });
  ok(!panel(noSrv), "Z5 沒有伺服器 settleAt 的舊紀錄：才退回前端時間軸（20.9 秒），13 秒還在亮牌");
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
