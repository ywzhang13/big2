// 自動摸牌重試（老闆 2026-11-04：輪到某人摸牌卻卡住）：假時鐘＋假伺服器，照伺服器 /draw 的規則走
import { AutoDrawer, classifyDrawError, DRAW_CONFIRM_MS, DRAW_FIRST_MS, DRAW_IN_FLIGHT_MAX_MS, type DrawOutcome } from "../lib/mahjong/autoDraw";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

/** plan：每次請求怎麼回；伺服器和畫面的狀態分開，模擬事件和回應遺失 */
function setup(plan: (n: number) => "ok" | "lost" | "okNoEvent" | "hang" | DrawOutcome | "stale-auto") {
  let t = 0, nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const srv = { hand: 16, hasDrawn: false }, ui = { needsDraw: true }, stats = { reqs: 0, syncs: 0, maxConcurrent: 0, inFlight: 0, hidden: false };
  const hangs: ((o: DrawOutcome) => void)[] = [];
  const d = new AutoDrawer<number>({
    now: () => t,
    isHidden: () => stats.hidden,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    sync: () => { stats.syncs++; if (srv.hasDrawn) { ui.needsDraw = false; d.stop(); } },
    draw: () => {
      stats.reqs++; stats.inFlight++; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.inFlight);
      const p = plan(stats.reqs);
      const done = (o: DrawOutcome) => { stats.inFlight--; return o; };
      if (p === "hang") return new Promise((r) => { hangs.push((o) => r(done(o))); });
      // 伺服器的規則：摸過了就回 400，不會再發牌
      if (p === "ok" || p === "lost" || p === "okNoEvent") {
        if (srv.hasDrawn) return Promise.resolve(done("stale"));
        srv.hasDrawn = true; srv.hand++;
        if (p === "ok") { ui.needsDraw = false; d.stop(); }
        return p === "lost" ? Promise.reject(new TypeError("Failed to fetch")).finally(() => { stats.inFlight--; }) : Promise.resolve(done("ok"));
      }
      return Promise.resolve(done(p === "stale-auto" ? "stale" : p));
    },
  });
  const run = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    t = end;
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { d, srv, ui, stats, run, hangs, pendingTimers: () => timers.size };
}

void (async () => {
// A 網路失敗後自動恢復
{
  const s = setup((n) => (n <= 2 ? "retry" : "ok")); s.d.start(); await s.run(DRAW_FIRST_MS);
  check(s.stats.reqs === 1 && s.srv.hand === 16, "A1 第一次失敗沒有摸到");
  await s.run(1000); check(s.stats.reqs === 2, "A2 1 秒後重試");
  await s.run(2000); check(s.stats.reqs === 3 && s.srv.hand === 17 && !s.ui.needsDraw, "A3 再 2 秒後摸到，只多一張");
  await s.run(60000); check(s.stats.reqs === 3 && s.pendingTimers() === 0, "A4 摸到後不再送");
}
// B 回 400（非預期的錯誤文字）也會恢復
{
  check(classifyDrawError(Object.assign(new Error('{"error":"怪錯誤"}'), { status: 400 })) === "retry", "B1 不認得的 400 算可重試");
  const s = setup((n) => (n === 1 ? "retry" : "ok")); s.d.start(); await s.run(DRAW_FIRST_MS + 1000);
  check(s.srv.hand === 17, "B2 400 後自動摸到");
}
// C 回前景馬上補摸，背景期間不打
{
  const s = setup((n) => (n === 1 ? "retry" : "ok")); s.stats.hidden = true; s.d.start(); await s.run(DRAW_FIRST_MS);
  check(s.stats.reqs === 1, "C1 背景裡照舊送第一次");
  await s.run(120000); check(s.stats.reqs === 1, "C2 失敗後在背景停手");
  s.d.kick(); await s.run(0); check(s.stats.reqs === 1, "C3 還在背景時叫 kick 不動作");
  s.stats.hidden = false; s.d.kick(); await s.run(0); check(s.stats.reqs === 2 && s.srv.hand === 17, "C4 回前景立刻補摸");
}
// D 退避中重連：不等退避
{
  const s = setup((n) => (n <= 4 ? "retry" : "ok")); s.d.start(); await s.run(DRAW_FIRST_MS + 1000 + 2000 + 4000);
  check(s.stats.reqs === 4, "D1 退到要等 8 秒");
  s.d.kick(); await s.run(0); check(s.stats.reqs === 5 && s.srv.hand === 17, "D2 網路恢復馬上補");
}
// E 回應遺失（伺服器其實摸了）：重送不多摸，靠重抓對齊
{
  const s = setup(() => "lost"); s.d.start(); await s.run(DRAW_FIRST_MS);
  check(s.srv.hand === 17 && s.ui.needsDraw, "E1 伺服器摸了、畫面還不知道");
  await s.run(1000);
  check(s.srv.hand === 17, "E2 重送沒有多摸");
  check(s.stats.syncs === 1 && !s.ui.needsDraw, "E3 拿到「已經摸過」後重抓，畫面對齊");
  await s.run(60000); check(s.stats.reqs === 2, "E4 對齊後不再送");
}
// F 事件掉了（請求成功但畫面沒更新）：重抓對齊
{
  const s = setup(() => "okNoEvent"); s.d.start(); await s.run(DRAW_FIRST_MS);
  check(s.srv.hand === 17 && s.ui.needsDraw, "F1 請求成功、事件沒到");
  await s.run(DRAW_CONFIRM_MS); check(s.stats.syncs >= 1 && !s.ui.needsDraw && s.srv.hand === 17, "F2 等一下就重抓對齊，沒有多摸");
}
// G 不猛打伺服器：一直失敗 60 秒
{
  const s = setup(() => "retry"); s.d.start(); await s.run(60000);
  check(s.stats.reqs >= 5 && s.stats.reqs <= 10, `G1 60 秒只送 ${s.stats.reqs} 次`);
  check(s.stats.maxConcurrent === 1, "G2 同時只有一個請求");
}
// H 請求卡住：同時只有一個，超過上限才重送；舊的晚回來不算數
{
  const s = setup((n) => (n === 1 ? "hang" : "retry")); s.d.start(); await s.run(DRAW_FIRST_MS);
  await s.run(DRAW_IN_FLIGHT_MAX_MS - 1); check(s.stats.reqs === 1, "H1 卡住期間不重送");
  await s.run(1); check(s.stats.reqs === 2, "H2 超過上限才重送");
  const before = s.pendingTimers(); s.hangs[0]("ok"); await s.run(0); check(s.pendingTimers() === before, "H3 舊請求晚回來不影響排程");
}
// I 不該摸了就停
{
  const s = setup(() => "retry"); s.d.start(); await s.run(DRAW_FIRST_MS); s.d.stop(); await s.run(60000);
  check(s.stats.reqs === 1 && s.pendingTimers() === 0, "I1 stop 後不再送");
  s.d.kick(); await s.run(1000); check(s.stats.reqs === 1, "I2 沒在摸牌時 kick 不動作");
  const q = setup(() => "ok"); q.d.start(); q.d.stop(); await q.run(1000); check(q.stats.reqs === 0, "I3 250ms 內條件變掉（吃碰按鈕到了）就不送");
}
// J 其他結果
{
  const s = setup(() => "fatal"); s.d.start(); await s.run(60000); check(s.stats.reqs === 1, "J1 沒權限不重試");
  const w = setup((n) => (n <= 2 ? "wait" : "ok")); w.d.start(); await w.run(DRAW_FIRST_MS + 3000); check(w.stats.reqs === 2, "J2 等吃碰時隔 3 秒才再問");
  check(classifyDrawError(new Error('{"error":"等待其他玩家動作中"}')) === "wait", "J3 等待分類");
  check(classifyDrawError(new Error('{"error":"已經摸過牌了"}')) === "stale", "J4 摸過分類");
  check(classifyDrawError(new Error('{"error":"還沒輪到你"}')) === "stale", "J5 沒輪到分類");
  check(classifyDrawError(new TypeError("Failed to fetch")) === "retry", "J6 網路分類");
  check(classifyDrawError(Object.assign(new Error("x"), { status: 403 })) === "fatal", "J7 權限分類");
  check(classifyDrawError(Object.assign(new Error('{"error":"找不到遊戲"}'), { status: 404 })) === "stale", "J8 找不到遊戲（房間關了）：重抓狀態，不一直重送");
  check(classifyDrawError(Object.assign(new Error("Internal Server Error"), { status: 500 })) === "retry", "J9 伺服器 500：退避重試");
}

{ // W 接線（2026-11-27 接到 6df6949 的 useMahjong）：自動摸牌真的由 AutoDrawer 負責，不是舊的「條件成立送一次」
  const { readFileSync } = await import("node:fs");
  const hook = readFileSync("hooks/useMahjong.ts", "utf8");
  check(/new AutoDrawer</.test(hook) && /if \(shouldAutoDraw\) autoDraw\.start\(\); else autoDraw\.stop\(\);/.test(hook), "W1 該摸牌時 start、不該摸時 stop");
  check(!/setTimeout\(\(\) => \{\s*drawTileAction\(\);\s*\}, 250\)/.test(hook), "W2 舊的只送一次（setTimeout 250 呼叫 drawTileAction）已拿掉");
  check(/const shouldAutoDraw = needsDraw && state\.mySeat >= 0 && state\.availableActions\.length === 0 && !justDiscarded;/.test(hook), "W3 該摸牌的條件跟原本一樣（有吃碰按鈕、剛打出時不摸）");
  check(["visibilitychange", "pageshow", "online"].every((e) => new RegExp(`addEventListener\\("${e}", kick\\)`).test(hook)) && /autoDrawKickRef\.current\(\); \/\/ 斷線期間該摸的牌/.test(hook), "W4 回前景、網路恢復、即時連線重連都會馬上補摸");
  check(/classifyDrawError\(err\)/.test(hook) && /return "ok";\n  \}, \[myId, call, holdFor, releaseHold\]\)/.test(hook), "W5 摸牌把結果回報給 AutoDrawer（錯誤分類、成功回 ok）");
}

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
})();
