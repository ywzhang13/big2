// 十三支整塊縮放（components/thirteen/stageScale.ts）審伯〈十三支鍵盤觸控與丟道具-完整審查 2026-11-27〉R1、R2 回歸：
//   R1 收鍵盤時剛好換畫面：等高度恢復的輪詢不能跟著舊畫面不見，新畫面要接著等、高度回來就恢復正常倍數
//   R2 離開頁面（卸載）後：focusout 排進去的延後回呼要一起取消，不能再寫樣式、不能再開輪詢
// 計時器換成假時鐘（globalThis 的 setTimeout／setInterval），手動推進
export {};
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

// ---- 假時鐘 ----
let now = 0, seq = 0;
type T = { at: number; every: number | null; f: () => void };
const timers = new Map<number, T>();
const g = globalThis as unknown as Record<string, unknown>;
g.setTimeout = (f: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, every: null, f }); return id; };
g.setInterval = (f: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, every: Math.max(1, ms), f }); return id; };
g.clearTimeout = g.clearInterval = (id: number) => { timers.delete(id); };
const advance = (ms: number) => {
  const end = now + ms;
  for (;;) {
    const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, x] = next; now = x.at;
    if (x.every != null) x.at += x.every; else timers.delete(id);
    x.f();
  }
  now = end;
};
const intervals = () => [...timers.values()].filter((x) => x.every != null).length;

const { attachStageScale, RECHECK_MS, RECHECK_TIMES } = await import("../components/thirteen/stageScale");

// ---- 假 window／document ----
type Fn = () => void;
function make(w = 932, h = 430) {
  const ls = new Map<string, Set<Fn>>(), vls = new Map<string, Set<Fn>>();
  const add = (m: Map<string, Set<Fn>>) => (t: string, f: Fn) => { if (!m.has(t)) m.set(t, new Set()); m.get(t)!.add(f); };
  const del = (m: Map<string, Set<Fn>>) => (t: string, f: Fn) => { m.get(t)?.delete(f); };
  const win = { innerWidth: w, innerHeight: h, addEventListener: add(ls) as unknown as Window["addEventListener"], removeEventListener: del(ls) as unknown as Window["removeEventListener"],
    visualViewport: { addEventListener: add(vls) as unknown as VisualViewport["addEventListener"], removeEventListener: del(vls) as unknown as VisualViewport["removeEventListener"] } };
  let writes = 0;
  const vars: Record<string, string> = {};
  const body = { tagName: "BODY", isContentEditable: false }, input = { tagName: "INPUT", isContentEditable: false };
  const d = { activeElement: body as unknown, documentElement: { style: { setProperty: (k: string, v: string) => { vars[k] = v; writes++; } } } };
  const fire = (t: string) => [...(ls.get(t) ?? [])].forEach((f) => f());
  const listeners = () => [...ls.values(), ...vls.values()].reduce((n, s) => n + s.size, 0);
  return { win, doc: d as unknown as Document, d, body, input, vars, fire, listeners, writes: () => writes };
}
const S = (v: Record<string, string>) => `${v["--th-s"]}/${v["--th-s2"]}`;

// ===== R1：照審伯的步驟 =====
{
  const h = make();
  let detach = attachStageScale(h.win, h.doc);
  ok(S(h.vars) === "1.1026/1.1026", `R1-1 932×430 掛上：1.1026（${S(h.vars)}）`);
  h.d.activeElement = h.input; h.win.innerHeight = 176; h.fire("resize");
  ok(S(h.vars) === "1.1026/1.1026", `R1-2 打字中鍵盤打開：維持 1.1026（${S(h.vars)}）`);
  h.d.activeElement = h.body; h.fire("focusout"); advance(0);
  ok(S(h.vars) === "0.4513/0.4513" && intervals() === 1, `R1-3 焦點離開、鍵盤還在收：先縮成 0.4513、開始等高度恢復（輪詢 ${intervals()} 個）`);
  detach(); detach = attachStageScale(h.win, h.doc); // 換畫面：卸載後立刻掛上新畫面，高度仍是 176
  ok(intervals() === 1, `R1-4 換畫面後新畫面接著等（輪詢 ${intervals()} 個）`);
  h.win.innerHeight = 430; // 收鍵盤，不送任何事件
  advance(RECHECK_MS);
  ok(S(h.vars) === "1.1026/1.1026", `R1-5 高度回到 430、沒有任何事件：一個輪詢週期內恢復 1.1026（${S(h.vars)}）`);
  advance(RECHECK_MS * 2);
  ok(intervals() === 0, `R1-6 恢復後輪詢停掉（剩 ${intervals()} 個）`);
  detach();
  ok(h.listeners() === 0 && timers.size === 0, `R1-7 卸載後監聽、計時器都清乾淨（監聽 ${h.listeners()}、計時器 ${timers.size}）`);
}
// R1 變化：縮小後連續換兩次畫面；恢復時先 176→300 再 →430
{
  const h = make();
  let detach = attachStageScale(h.win, h.doc);
  h.d.activeElement = h.input; h.win.innerHeight = 176; h.fire("resize");
  h.d.activeElement = h.body; h.fire("focusout"); advance(0);
  detach(); detach = attachStageScale(h.win, h.doc);
  detach(); detach = attachStageScale(h.win, h.doc);
  ok(intervals() === 1, `R1-8 連續換兩次畫面：還在等（輪詢 ${intervals()} 個）`);
  h.win.innerHeight = 300; advance(RECHECK_MS);
  ok(h.vars["--th-s"] === (300 / 390).toFixed(4) && intervals() === 1, `R1-9 高度先回到 300：跟著放大到 ${h.vars["--th-s"]}，還沒到 430 繼續等`);
  h.win.innerHeight = 430; advance(RECHECK_MS);
  ok(S(h.vars) === "1.1026/1.1026", `R1-10 再回到 430：恢復 1.1026（${S(h.vars)}）`);
  advance(RECHECK_MS * 2);
  ok(intervals() === 0, "R1-11 恢復後輪詢停掉");
  detach();
}
// R1 變化：高度一直不回來 → 最多查 RECHECK_TIMES 次就停（換畫面也不會一直重新等）
{
  const h = make();
  let detach = attachStageScale(h.win, h.doc);
  h.d.activeElement = h.input; h.win.innerHeight = 176; h.fire("resize");
  h.d.activeElement = h.body; h.fire("focusout"); advance(0);
  advance(RECHECK_MS * 10);
  detach(); detach = attachStageScale(h.win, h.doc); // 中途換畫面，不重新算 40 次
  advance(RECHECK_MS * (RECHECK_TIMES - 10) + 1);
  ok(intervals() === 0, `R1-12 高度一直不回來：總共查 ${RECHECK_TIMES} 次後停（剩輪詢 ${intervals()} 個）`);
  detach(); detach = attachStageScale(h.win, h.doc);
  ok(intervals() === 1, "R1-13 放棄之後又換畫面、高度還是比正常矮：新畫面重新等一輪（鍵盤可能其實還開著）");
  advance(RECHECK_MS * RECHECK_TIMES + 1);
  ok(intervals() === 0, `R1-13b 這一輪一樣最多查 ${RECHECK_TIMES} 次就停`);
  h.win.innerHeight = 430; h.fire("resize");
  ok(S(h.vars) === "1.1026/1.1026", "R1-13c 之後高度回來（有事件）照常恢復");
  detach();
}
// R1 變化（瀏覽器實測的情況）：結算時焦點先離開、鍵盤一直開著超過 10 秒（等到放棄）→ 下一局換畫面 → 收鍵盤沒有任何事件
{
  const h = make();
  let detach = attachStageScale(h.win, h.doc);
  h.d.activeElement = h.input; h.win.innerHeight = 176; h.fire("resize");
  h.d.activeElement = h.body; h.fire("focusout"); advance(0);
  advance(RECHECK_MS * RECHECK_TIMES + 1); // 結算等了 10 秒以上，這一輪放棄
  detach(); detach = attachStageScale(h.win, h.doc); // 下一局：換畫面
  h.win.innerHeight = 430; advance(RECHECK_MS);
  ok(S(h.vars) === "1.1026/1.1026", `R1-16 等到放棄後才換畫面、收鍵盤沒事件：新畫面重新等，一個週期內恢復（${S(h.vars)}）`);
  advance(RECHECK_MS * 2);
  ok(intervals() === 0, "R1-17 恢復後輪詢停掉");
  detach();
}
// R1 保留：真的把視窗拉矮（沒在打字）→ 照常縮小，不會被「恢復目標」拉回去
{
  const h = make();
  const detach = attachStageScale(h.win, h.doc);
  h.win.innerHeight = 300; h.fire("resize");
  advance(RECHECK_MS * (RECHECK_TIMES + 1));
  ok(h.vars["--th-s"] === (300 / 390).toFixed(4) && intervals() === 0, `R1-14 視窗真的變矮：照常縮小（${h.vars["--th-s"]}），等完 ${RECHECK_TIMES} 次就停`);
  h.win.innerWidth = 430; h.win.innerHeight = 932; h.fire("orientationchange");
  ok(h.vars["--th-s"] === (430 / 844).toFixed(4), `R1-15 轉向：照新寬高（${h.vars["--th-s"]}）`);
  h.win.innerWidth = 932; h.win.innerHeight = 430; h.fire("resize");
  detach();
}

// ===== R2：卸載後 focusout 的延後回呼不能再動 =====
{
  const h = make();
  const detach = attachStageScale(h.win, h.doc);
  h.win.innerHeight = 176; // 焦點已在 BODY
  h.fire("focusout");
  const w0 = h.writes();
  detach();
  advance(RECHECK_MS * (RECHECK_TIMES + 2));
  ok(h.writes() === w0 && intervals() === 0 && timers.size === 0 && h.listeners() === 0,
    `R2-1 focusout 後卸載：不再寫樣式（多寫 ${h.writes() - w0} 次）、不開輪詢（${intervals()}）、計時器 ${timers.size}、監聽 ${h.listeners()}`);
  h.win.innerHeight = 430;
}
{
  const h = make();
  const detach = attachStageScale(h.win, h.doc);
  h.win.innerHeight = 176;
  h.fire("focusout"); h.fire("focusout"); h.fire("focusout");
  const w0 = h.writes();
  detach();
  advance(RECHECK_MS * 3);
  ok(h.writes() === w0 && intervals() === 0 && timers.size === 0, `R2-2 連送 3 次 focusout 後卸載：同樣不再寫樣式、不開輪詢（多寫 ${h.writes() - w0}、計時器 ${timers.size}）`);
  h.win.innerHeight = 430;
}
{
  // 舊畫面 focusout 後卸載、新畫面用不同尺寸掛上，再跑舊回呼：不能蓋掉新畫面的倍數
  const h = make();
  const detach = attachStageScale(h.win, h.doc);
  h.win.innerHeight = 176; h.fire("focusout");
  detach();
  h.win.innerWidth = 1920; h.win.innerHeight = 1080;
  const detach2 = attachStageScale(h.win, h.doc);
  const fresh = S(h.vars);
  advance(RECHECK_MS * 3);
  ok(S(h.vars) === fresh && fresh === "2.2749/2.2749" && intervals() === 0, `R2-3 新畫面 1920×1080 掛上後跑舊回呼：倍數維持 ${S(h.vars)}，不開輪詢`);
  detach2();
  h.win.innerWidth = 932; h.win.innerHeight = 430;
}
{
  // 沒卸載的 focusout 照樣延後重算
  const h = make();
  const detach = attachStageScale(h.win, h.doc);
  h.d.activeElement = h.input; h.win.innerHeight = 176; h.fire("resize");
  h.d.activeElement = h.body; h.win.innerHeight = 430; h.fire("focusout");
  advance(0);
  ok(S(h.vars) === "1.1026/1.1026", `R2-4 沒卸載的 focusout：延後重算照常（${S(h.vars)}）`);
  detach();
  ok(timers.size === 0 && h.listeners() === 0, "R2-5 全部卸載後：計時器、監聽都是 0");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
