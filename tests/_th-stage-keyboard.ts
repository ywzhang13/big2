// 十三支整塊縮放（components/thirteen/stageScale.ts）遇到 iPhone 鍵盤（阿妍〈十三支縮小與卡住-調查報告 2026-11-27〉問題一）：
// 打字打到一半換畫面（元件重新掛上、重算倍數）時鍵盤還開著，innerHeight 只剩 176 → 原本算成 0.45 倍；
// 收鍵盤時 iPhone 不送 window 的 resize → 一直縮著。用假的 window／document 走一遍
import { attachStageScale } from "../components/thirteen/stageScale";
export {};

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

type Fn = () => void;
const make = () => {
  const ls = new Map<string, Set<Fn>>();
  const on = (t: string, f: Fn) => { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t)!.add(f); };
  const off = (t: string, f: Fn) => { ls.get(t)?.delete(f); };
  const vls = new Map<string, Set<Fn>>();
  const win = {
    innerWidth: 932, innerHeight: 430,
    addEventListener: on as unknown as Window["addEventListener"], removeEventListener: off as unknown as Window["removeEventListener"],
    visualViewport: {
      addEventListener: ((t: string, f: Fn) => { if (!vls.has(t)) vls.set(t, new Set()); vls.get(t)!.add(f); }) as unknown as VisualViewport["addEventListener"],
      removeEventListener: ((t: string, f: Fn) => { vls.get(t)?.delete(f); }) as unknown as VisualViewport["removeEventListener"],
    },
  };
  const vars: Record<string, string> = {};
  const body = { tagName: "BODY", isContentEditable: false };
  const input = { tagName: "INPUT", isContentEditable: false };
  const doc = { activeElement: body as unknown, documentElement: { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } } };
  const fire = (t: string) => [...(ls.get(t) ?? [])].forEach((f) => f());
  const fireVV = (t: string) => [...(vls.get(t) ?? [])].forEach((f) => f());
  const count = () => [...ls.values()].reduce((n, s) => n + s.size, 0) + [...vls.values()].reduce((n, s) => n + s.size, 0);
  return { win, doc: doc as unknown as Document, d: doc, body, input, vars, fire, fireVV, count };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

const h = make();
// 1. 理牌開始：932×430 → 1.1026
let detach = attachStageScale(h.win, h.doc);
ok(h.vars["--th-s"] === "1.1026" && h.vars["--th-s2"] === "1.1026", `K1 進畫面：932×430 → 1.1026（實際 ${h.vars["--th-s"]}）`);

// 2. 結算時點輸入框打字：鍵盤開著，innerHeight 變 176，iPhone 不送 window resize（只送 visualViewport resize）
h.d.activeElement = h.input; h.win.innerHeight = 176;
h.fireVV("resize");
ok(h.vars["--th-s"] === "1.1026", `K2 打字中鍵盤打開：牌桌不跟著縮（實際 ${h.vars["--th-s"]}）`);

// 3. 打到一半，下一局自動開始＝換畫面：舊畫面卸載、新畫面重新掛上，這時鍵盤還開著
detach();
detach = attachStageScale(h.win, h.doc);
ok(h.vars["--th-s"] === "1.1026", `K3 鍵盤還開著時換畫面：倍數維持 1.1026，不會變成 0.4513（實際 ${h.vars["--th-s"]}）`);

// 4. 收鍵盤：焦點離開輸入框、innerHeight 回 430；iPhone 只送 visualViewport 的 resize（沒有 window resize）
h.d.activeElement = h.body; h.win.innerHeight = 430;
h.fireVV("resize");
ok(h.vars["--th-s"] === "1.1026", `K4 收鍵盤後是正常大小，不用手動送 resize（實際 ${h.vars["--th-s"]}）`);

// 5. 收鍵盤只送 focusout（WebView 有時不送 visualViewport resize）：等這一輪事件結束後重算
h.d.activeElement = h.input; h.win.innerHeight = 176; h.fireVV("resize");
detach(); detach = attachStageScale(h.win, h.doc);
h.d.activeElement = h.body; h.win.innerHeight = 430;
h.fire("focusout");
await tick();
ok(h.vars["--th-s"] === "1.1026", `K5 只有 focusout：等一下就重算回正常大小（實際 ${h.vars["--th-s"]}）`);

// 6. 沒在打字、畫面真的變矮（桌機把視窗拉矮）：照常縮小
h.win.innerHeight = 300; h.fire("resize");
ok(h.vars["--th-s"] === (300 / 390).toFixed(4), `K6 沒在打字、視窗真的變矮：照常縮小（實際 ${h.vars["--th-s"]}）`);
h.win.innerHeight = 430; h.fire("resize");

// 7. 打字中轉向（寬度變了）：照新的大小算，不沿用舊高度
h.d.activeElement = h.input; h.win.innerWidth = 430; h.win.innerHeight = 932; h.fire("orientationchange");
ok(h.vars["--th-s"] === (430 / 844).toFixed(4), `K7 打字中轉向：照新的寬高重算（實際 ${h.vars["--th-s"]}）`);
h.d.activeElement = h.body; h.win.innerWidth = 932; h.win.innerHeight = 430; h.fire("resize");

// 8. 從背景回來（pageshow）也會重算
h.win.innerHeight = 390; h.fire("pageshow");
ok(h.vars["--th-s"] === (Math.min(932 / 844, 390 / 390)).toFixed(4), `K8 pageshow 重算（實際 ${h.vars["--th-s"]}）`);

// 10. 換畫面時輸入框已經被拆掉（焦點回 body）、鍵盤還在收：掛上那一刻高度只剩 176 → 先算成小的；
//     之後收鍵盤什麼事件都不送（只有 innerHeight 變回 430）→ 250ms 內自己看到、重算回正常大小
h.d.activeElement = h.input; h.win.innerHeight = 176; h.fireVV("resize");
detach();
h.d.activeElement = h.body;
detach = attachStageScale(h.win, h.doc);
const shrunk = h.vars["--th-s"];
h.win.innerHeight = 430; // 沒有任何事件
await new Promise((r) => setTimeout(r, 300));
ok(shrunk === "0.4513" && h.vars["--th-s"] === "1.1026", `K10 焦點已離開、鍵盤收起沒送任何事件：0.3 秒內自己恢復 1.1026（掛上時 ${shrunk}，之後 ${h.vars["--th-s"]}）`);

// 9. 卸載：監聽全部拆乾淨
detach();
ok(h.count() === 0, `K9 卸載後監聽拆乾淨（剩 ${h.count()} 個）`);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
