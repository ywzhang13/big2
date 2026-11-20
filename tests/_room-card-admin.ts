// 房卡後台頁（app/admin/cards/page.tsx）回歸測試（審伯 2026-11-20〈房卡後端複審暨前端初審〉兩項必修）：
//   A 張數欄位：走真的輸入框 onChange、真的表單 onSubmit；非法值（貼上、逐字打）都不能產生寫入，畫面寫原因，輸入框保留原字；
//     合法 1／10／100000 與快捷 10／50／100／500 送精確值；負餘額回收預覽、送出中連按／失敗重試同一個 opId 照舊
//   B 換帳號：老闆 in→一般帳號 in、老闆 in→out→一般帳號 in；切換那一次畫面就沒有前一個人的名單、統計、明細、視窗、提示；
//     換帳號 id 會重問權限；新帳號驗證中、403、500、網路失敗都不顯示前一個人的；老闆晚到的回應不寫回；一般玩家直開 401／403 沒有權限
// 做法：沒有 DOM 套件，所以把頁面原始檔用專案的 typescript 轉成 JS，React hooks 換成這裡的小型實作（useState／useEffect／useMemo），
//   登入（useMjAuth）、後台 API（client）換成記憶體假的；元件函式本身、輸入／送出／點擊的 handler 都是頁面原本的程式。
// 用 RC_ADMIN_PAGE=<檔案> 可以對別的版本跑（修改前的頁面存在 .tmp/room-card-ui/補件2/ev/page-修改前.tsx）。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const ROOT = process.cwd();
const PAGE = path.resolve(ROOT, process.env.RC_ADMIN_PAGE ?? "app/admin/cards/page.tsx");
const url = (p: string) => pathToFileURL(path.resolve(ROOT, p)).href;

// ---------- 小型 React（只夠這一頁用） ----------
type Props = Record<string, unknown> & { children?: unknown };
type Host = { type: string; props: Props; children: Node[] };
type Node = Host | string;
type Slot = { v?: unknown; set?: (x: unknown) => void; deps?: unknown[]; cleanup?: (() => void) | void };
type Inst = { slots: Slot[] };
const insts = new Map<string, Inst>();
let cur: Inst = { slots: [] }, hi = 0, dirty = false;
let effects: Array<() => void> = [];
const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const slot = () => (cur.slots[hi] ??= {}, cur.slots[hi++]);
const mini = {
  useState(init: unknown) {
    const s = slot();
    if (!s.set) {
      s.v = typeof init === "function" ? (init as () => unknown)() : init;
      s.set = (x: unknown) => { const nv = typeof x === "function" ? (x as (p: unknown) => unknown)(s.v) : x; if (!Object.is(nv, s.v)) { s.v = nv; dirty = true; } };
    }
    return [s.v, s.set];
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const s = slot();
    if (!same(s.deps, deps)) { s.v = fn(); s.deps = deps; }
    return s.v;
  },
  useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
    const s = slot();
    if (deps && same(s.deps, deps)) return;
    s.deps = deps;
    effects.push(() => { if (typeof s.cleanup === "function") s.cleanup(); s.cleanup = fn(); });
  },
};
(globalThis as Record<string, unknown>).__mini = mini;
// 明細的 Esc 關閉會掛 window 的 keydown；這裡只要能掛、能拆
(globalThis as Record<string, unknown>).window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "/" } };

const req = createRequire(path.join(ROOT, "package.json"));
const jsxRt = req("react/jsx-runtime") as { Fragment: symbol };
type El = { type: unknown; props: Props; key: string | null };
let seen = new Set<string>();
function expand(node: unknown, at: string, out: Node[]) {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return; }
  if (Array.isArray(node)) { node.forEach((c, i) => expand(c, `${at}[${(c as El | null)?.key ?? i}]`, out)); return; }
  const { type, props, key } = node as El;
  const id = `${at}/${typeof type === "function" ? type.name : String(type)}${key != null ? `#${key}` : ""}`;
  if (type === jsxRt.Fragment) { expand(props.children, id, out); return; }
  if (typeof type === "function") {
    seen.add(id);
    let inst = insts.get(id);
    if (!inst) { inst = { slots: [] }; insts.set(id, inst); }
    cur = inst; hi = 0;
    expand((type as (p: Props) => unknown)(props), id, out);
    return;
  }
  const h: Host = { type: String(type), props, children: [] };
  expand(props.children, id, h.children);
  out.push(h);
}
let Page: () => unknown;
let tree: Node[] = [];
/** 同步畫一次（含跑 effect、effect 同步改 state 就再畫），不等任何回應 */
function render() {
  for (let n = 0; n < 30; n++) {
    seen = new Set(); dirty = false; effects = [];
    const out: Node[] = [];
    expand({ type: Page, props: {}, key: null }, "", out);
    tree = out;
    for (const [id, inst] of insts) if (!seen.has(id)) { for (const s of inst.slots) if (typeof s.cleanup === "function") s.cleanup(); insts.delete(id); }
    const fx = effects; effects = [];
    fx.forEach((f) => f());
    if (!dirty) return;
  }
  throw new Error("render loop");
}
const tick = () => new Promise<void>((r) => setImmediate(r));
/** 等回應（微任務）再畫，直到沒有變化 */
async function flush() { for (let i = 0; i < 6; i++) { await tick(); render(); } }
function unmountAll() { for (const inst of insts.values()) for (const s of inst.slots) if (typeof s.cleanup === "function") s.cleanup(); insts.clear(); }

const hosts = (ns: Node[] = tree): Host[] => ns.flatMap((n) => (typeof n === "string" ? [] : [n, ...hosts(n.children)]));
const text = (ns: Node[] = tree): string => ns.map((n) => (typeof n === "string" ? n : text(n.children))).join("");
const q = (attr: string, val?: string) => hosts().find((h) => attr in h.props && (val === undefined || String(h.props[attr]) === val));
const call = (h: Host | undefined, ev: string, arg: unknown) => { if (!h) throw new Error(`沒有元素可以 ${ev}`); (h.props[ev] as (a: unknown) => void)(arg); render(); };
const click = (h: Host | undefined) => call(h, "onClick", { stopPropagation() {}, preventDefault() {} });
const type = (v: string) => call(q("data-rc-cards"), "onChange", { target: { value: v } });
const submit = () => call(q("data-rc-form"), "onSubmit", { preventDefault() {} });

// ---------- 假的登入與後台 API ----------
type Res = { ok: true; data: unknown } | { ok: false; status: number; error: string };
type Def = { resolve: (r: Res) => void; promise: Promise<Res> };
const deferred = (): Def => { let resolve!: (r: Res) => void; const promise = new Promise<Res>((r) => { resolve = r; }); return { resolve, promise }; };
const api = {
  players: [] as Def[], writes: [] as { op: string; body: Record<string, unknown>; d: Def }[], auto: null as null | (() => Res), autoWrite: true,
  getCardPlayers() { const d = deferred(); api.players.push(d); if (api.auto) d.resolve(api.auto()); return d.promise; },
  getCardLedger: () => Promise.resolve<Res>({ ok: true, data: { entries: [] } }),
  cardWrite(op: string, body: Record<string, unknown>) { const d = deferred(); api.writes.push({ op, body, d }); if (api.autoWrite) d.resolve({ ok: true, data: { balance: 0 } }); return d.promise; },
};
const g = globalThis as Record<string, unknown>;
g.__api = api;
type Auth = { status: string; user: { id: string } | null };
const setAuth = (a: Auth) => { g.__auth = { ...a, signOut: async () => {} }; };
const IN = (id: string): Auth => ({ status: "in", user: { id } });
const OUT: Auth = { status: "out", user: null };

const SECRET = ["私密名單甲", "私密名單乙"];
const ownerData = (bal = 3): Res => ({
  ok: true, data: {
    serverNow: 0, stats: { players: 2, debtors: 1, debtCards: 4, suspended: 0, chargedToday: 7 },
    players: [
      { userId: "u-a", shortId: "A001", name: SECRET[0], avatarUrl: null, balance: bal, suspended: false, suspendedAt: null, playing: null, lastTopupAt: null, lastChargeAt: null },
      { userId: "u-b", shortId: "B002", name: SECRET[1], avatarUrl: null, balance: -4, suspended: false, suspendedAt: null, playing: null, lastTopupAt: null, lastChargeAt: null },
    ],
  },
});
const DENY = (status: number): Res => ({ ok: false, status, error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 0 ? "network" : "server_error" });

// ---------- 載入頁面（轉譯原始檔，換掉 react／登入／API） ----------
{
  const dir = mkdtempSync(path.join(tmpdir(), "rc-admin-"));
  const put = (name: string, src: string) => { const f = path.join(dir, name); writeFileSync(f, src); return pathToFileURL(f).href; };
  const map: Record<string, string> = {
    react: put("react.mjs", "const R = globalThis.__mini; export const useState = (...a) => R.useState(...a); export const useMemo = (...a) => R.useMemo(...a); export const useEffect = (...a) => R.useEffect(...a);"),
    "react/jsx-runtime": put("jsx.mjs", `import { createRequire } from "node:module"; const m = createRequire(${JSON.stringify(path.join(ROOT, "package.json"))})("react/jsx-runtime"); export const jsx = m.jsx, jsxs = m.jsxs, Fragment = m.Fragment;`),
    "@/hooks/useMjAuth": put("auth.mjs", "export const useMjAuth = () => globalThis.__auth;"),
    "@/components/mahjong/fxshop/FxsAvatar": put("avatar.mjs", "export function FxsAvatar() { return null; }"),
    "@/components/roomCard/client": put("client.mjs", `export * from ${JSON.stringify(url("components/roomCard/client.ts"))};
export const getCardPlayers = (...a) => globalThis.__api.getCardPlayers(...a);
export const getCardLedger = (...a) => globalThis.__api.getCardLedger(...a);
export const cardWrite = (...a) => globalThis.__api.cardWrite(...a);`),
    "@/components/roomCard/adminState": url("components/roomCard/adminState.ts"),
  };
  let js = ts.transpileModule(readFileSync(PAGE, "utf8"), {
    fileName: "page.tsx", compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/^import\s+"[^"]+\.css";\s*$/gm, "").replace(/from\s+"([^"]+)"/g, (m, spec: string) => {
    if (!map[spec]) throw new Error(`頁面多了沒處理的 import：${spec}`);
    return `from ${JSON.stringify(map[spec])}`;
  });
  Page = (await import(put("page.mjs", js))).default as () => unknown;
}
function mount(a: Auth, auto: null | (() => Res) = null) {
  unmountAll();
  api.players = []; api.writes = []; api.auto = auto; api.autoWrite = true;
  setAuth(a);
  render();
}
const access = () => String(q("data-rc-admin")?.props["data-rc-admin"]);
const leaks = () => SECRET.some((s) => text().includes(s)) || !!q("data-rc-sum") || !!q("data-rc-sheet") || !!q("data-rc-form") || !!q("data-rc-toast") || !!q("data-rc-player");

// ---------- A 張數欄位 ----------
const BAD = ["", "0", "12.5", "-5", "+5", "1e3", "12a5", "100001", "1000000", "99999999999", "   ", "１０"];
async function openForm(op: "topup" | "reclaim") {
  if (q("data-rc-form")) click(hosts().find((h) => h.type === "button" && text(h.children) === "取消"));
  if (op === "topup") click(q("data-rc-topup", "A001"));
  else { click(q("data-rc-player", "A001")); click(q("data-rc-op", "reclaim")); }
  await flush();
}
for (const op of ["topup", "reclaim"] as const) {
  mount(IN("owner"), () => ownerData(3));
  await flush();
  const name = op === "topup" ? "充值" : "回收";
  for (const how of ["貼上", "逐字輸入"] as const) {
    const bad: string[] = [];
    for (const v of BAD) {
      await openForm(op);
      const before = api.writes.length;
      if (how === "貼上") type(v);
      else { type(""); for (let i = 1; i <= v.length; i++) type(v.slice(0, i)); }
      const input = q("data-rc-cards"), btn = q("data-rc-ok", op), hint = q("data-rc-cards-err");
      submit(); submit();
      await flush();
      const kept = input?.props.value === v;
      const shows = v === "" ? true : !!hint && text(hint.children).length > 0;
      if (api.writes.length !== before || btn?.props.disabled !== true || !kept || !shows || q("data-rc-preview"))
        bad.push(`「${v}」→ 欄位「${String(input?.props.value)}」、送出 ${api.writes.length - before} 次${api.writes.length > before ? `（cards=${String(api.writes.at(-1)?.body.cards)}）` : ""}、按鈕${btn?.props.disabled ? "停用" : "可按"}、原因${shows ? "有" : "沒有"}`);
    }
    ok(bad.length === 0, `A ${name}／${how}：空白、0、12.5、-5、+5、1e3、12a5、100001、1000000、99999999999、全形１０ 都不送（POST 0 次），欄位保留原字、寫出原因${bad.length ? `：${bad.join("；")}` : ""}`);
  }
  const sent: string[] = [];
  for (const v of ["1", "10", "100000"]) {
    await openForm(op);
    const before = api.writes.length;
    type(v); submit(); await flush();
    const w = api.writes.slice(before);
    if (w.length !== 1 || w[0].body.cards !== Number(v) || w[0].op !== op) sent.push(`「${v}」→ ${w.map((x) => `${x.op}:${String(x.body.cards)}`).join(",") || "沒送"}`);
  }
  ok(sent.length === 0, `A ${name}：1、10、100000 各送 1 次、張數精確${sent.length ? `：${sent.join("；")}` : ""}`);
  if (op === "topup") {
    const chips: string[] = [];
    for (const c of [10, 50, 100, 500]) {
      await openForm(op);
      const before = api.writes.length;
      click(hosts().find((h) => h.type === "button" && text(h.children) === String(c)));
      submit(); await flush();
      const w = api.writes.slice(before);
      if (w.length !== 1 || w[0].body.cards !== c) chips.push(`${c} → ${w.map((x) => String(x.body.cards)).join(",") || "沒送"}`);
    }
    ok(chips.length === 0, `A 充值快捷 10／50／100／500 送精確值${chips.length ? `：${chips.join("；")}` : ""}`);
  } else {
    await openForm(op);
    type("5");
    const after = q("data-rc-after");
    ok(String(after?.props["data-rc-after"]) === "-2" && String(after?.props.className) === "neg" && text(after?.children ?? []) === "−2", "A 回收預覽：餘額 3 回收 5 → −2（紅字）");
    // 送出中連按、失敗重試：同一個 opId，只送出一次直到回應
    api.autoWrite = false;
    const before = api.writes.length;
    submit(); submit(); submit();
    const first = api.writes.slice(before);
    first[0]?.d.resolve(DENY(500)); await flush();
    const failed = !!q("data-rc-err") && !!q("data-rc-form");
    submit(); await flush();
    const all = api.writes.slice(before);
    ok(first.length === 1 && failed && all.length === 2 && all[1].body.opId === all[0].body.opId && all[1].body.cards === 5,
      `A 送出中連按 3 下只送 1 次；失敗後視窗留著、重試用同一個 opId（送 ${first.length} 次、重試 ${all.length - first.length} 次）`);
    all[1]?.d.resolve({ ok: true, data: { balance: -2 } }); await flush();
  }
}

// ---------- B 換帳號 ----------
/** 老闆讀到名單、打開明細和充值視窗、有成功提示；名單重讀中（還沒回）→ 回傳那個還在路上的請求 */
async function ownerLoaded(): Promise<Def> {
  mount(IN("owner"));
  api.players[0].resolve(ownerData()); await flush();
  click(q("data-rc-topup", "A001")); type("10"); submit(); await flush(); // 成功：有提示、名單重讀（不回）
  const late = api.players.at(-1)!;
  click(q("data-rc-player", "A001")); click(q("data-rc-op", "topup")); await flush();
  return late;
}
{
  const late = await ownerLoaded();
  const ready = access() === "ok" && SECRET.every((s) => text().includes(s)) && !!q("data-rc-sheet") && !!q("data-rc-form") && !!q("data-rc-toast") && !!q("data-rc-sum");
  ok(ready, "B0 前提：老闆畫面有名單、統計、明細、充值視窗、成功提示");
  const n0 = api.players.length;
  setAuth(IN("rcz")); render(); // 同一頁直接換成一般帳號（status 一直是 in）
  ok(access() !== "ok" && !leaks(), `B1 老闆 in→一般帳號 in：換的那一次畫面就沒有前一個人的名單／統計／明細／視窗／提示（data-rc-admin=${access()}）`);
  await flush();
  ok(api.players.length === n0 + 1, `B1 帳號 id 換了會重問權限（名單請求 ${n0}→${api.players.length}）`);
  late.resolve(ownerData()); await flush();
  ok(access() !== "ok" && !leaks(), `B1 老闆晚到的名單回應不寫回（data-rc-admin=${access()}）`);
  api.players.at(-1)!.resolve(DENY(403)); await flush();
  ok(access() === "denied" && !leaks() && text().includes("沒有權限"), `B1 新帳號 403 → 沒有權限，沒有前一個人的資料（data-rc-admin=${access()}）`);
}
for (const [label, res] of [["驗證延遲中", null], ["500", DENY(500)], ["網路失敗", DENY(0)], ["403", DENY(403)]] as const) {
  const late = await ownerLoaded();
  setAuth(OUT); render();
  const outOk = access() === "denied" && !leaks();
  await flush();
  setAuth(IN("rcz")); render();
  const inOk = access() !== "ok" && !leaks();
  await flush();
  late.resolve(ownerData()); await flush();
  const lateOk = access() !== "ok" && !leaks();
  if (res) { api.players.at(-1)!.resolve(res); await flush(); }
  const want = res === null ? "checking" : res.ok ? "ok" : res.status === 403 ? "denied" : "error";
  ok(outOk && inOk && lateOk && access() === want && !leaks(),
    `B2 老闆 in→out→一般帳號 in（新帳號${label}）：登出那一次、換人那一次、老闆晚到回應之後都沒有前一個人的資料；最後 data-rc-admin=${access()}（應為 ${want}）`);
}
{
  // 老闆第一次讀名單還沒回就換人：老闆的回應晚到不能讓一般帳號看到
  mount(IN("owner"));
  const first = api.players[0];
  setAuth(IN("rcz")); render(); await flush();
  first.resolve(ownerData()); await flush();
  const mid = access() !== "ok" && !leaks();
  api.players.at(-1)!.resolve(DENY(403)); await flush();
  ok(mid && access() === "denied" && !leaks(), `B3 老闆名單請求還在路上就換成一般帳號：老闆回應晚到不寫回，新帳號 403 → 沒有權限（data-rc-admin=${access()}）`);
}
{
  mount(IN("rcz")); api.players[0].resolve(DENY(403)); await flush();
  const a403 = access() === "denied" && !leaks();
  mount(IN("rcz")); api.players[0].resolve(DENY(401)); await flush();
  const a401 = access() === "denied" && !leaks();
  mount(OUT); await flush();
  ok(a403 && a401 && access() === "denied" && api.players.length === 0, "B4 一般玩家直開：403、401 → 沒有權限；沒登入不打後台 API");
}
{
  // 同一個老闆：正常操作照舊（充值成功 → 名單重讀，顯示新餘額）
  mount(IN("owner"));
  api.players[0].resolve(ownerData(3)); await flush();
  click(q("data-rc-topup", "A001")); type("10"); submit(); await flush();
  api.players.at(-1)!.resolve(ownerData(13)); await flush();
  ok(access() === "ok" && String(q("data-rc-player", "A001") && hosts().find((h) => "data-rc-bal" in h.props)?.props["data-rc-bal"]) === "13" && !!q("data-rc-toast"),
    "B5 同一個老闆：充值成功 → 提示、名單重讀、餘額 13");
}
unmountAll();

console.log(`頁面：${path.relative(ROOT, PAGE)}`);
console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
