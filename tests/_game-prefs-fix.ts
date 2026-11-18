// 共用設定面板複審（審伯 2 項必修＋1 項建議，小測要的驗收入口）：
//   F 舊的 th_sfx 轉換：同一個帳號的設定真的載入完才轉、只改互動音效靜音；逾時、失敗、換帳號、卸載都不寫；只生效一次
//   B 大老二綁登入帳號：直接進入、重新整理、從十三支切過來、換帳號、登出
//   V 震動開關：storage 讀寫都失敗時，關掉後這一頁就不再震
//   P /thirteen/preview/settings：預覽站可開、正式站 404
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const store = new Map<string, string>();
let storageBroken = false;
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.document = { documentElement: { style: { setProperty() {} } }, addEventListener() {} };
g.localStorage = {
  getItem: (k: string) => { if (storageBroken) throw new Error("SecurityError"); return store.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (storageBroken) throw new Error("QuotaExceededError"); store.set(k, v); },
  removeItem: (k: string) => { if (storageBroken) throw new Error("SecurityError"); store.delete(k); },
};
const vib: unknown[] = [];
Object.defineProperty(globalThis, "navigator", { value: { vibrate: (p: unknown) => { vib.push(p); return true; } }, configurable: true });

const P = await import("../lib/mahjong/prefs");
const S = await import("../components/thirteen/sfx");
type Res = { account: string; persisted: boolean; prefs: unknown } | null;

// 假的伺服器：每個帳號一份設定；get 可以設定延遲、失敗
const server = new Map<string, unknown>();
let who = "u1", getDelay = 0, getFail = false, gets = 0;
const puts: { account: string; prefs: Record<string, unknown> }[] = [];
const io = {
  get: () => { gets++; const me = who; return new Promise<Res>((res, rej) => setTimeout(() => (getFail ? rej(new Error("network")) : res({ account: me, persisted: server.has(me), prefs: server.get(me) ?? null })), getDelay)); },
  put: async (account: string, prefs: unknown) => { puts.push({ account, prefs: prefs as Record<string, unknown> }); },
};
const ACC = { ...P.DEFAULT_PREFS, fxVol: 40, voiceVol: 30 };
function fresh(opts: { delay?: number; fail?: boolean; saved?: boolean } = {}) {
  store.clear(); puts.length = 0; server.clear(); gets = 0; who = "u1";
  getDelay = opts.delay ?? 0; getFail = !!opts.fail;
  if (opts.saved !== false) server.set("u1", ACC);
  P.__testPrefs(io);
  store.set("th_sfx", "0");
}
const migrate = (account: string | null, extra: Record<string, unknown> = {}) =>
  (S.migrateOldSfxSwitch as unknown as (o: Record<string, unknown>) => Promise<unknown>)({ account, io, ...extra });
const vols = () => `fxVol ${P.getPrefs().fxVol}、voiceVol ${P.getPrefs().voiceVol}、fxMuted ${P.getPrefs().fxMuted}`;

// ---- F 舊 th_sfx 轉換 ----
// F1 帳號設定 4.3 秒才回來（超過 4 秒上限）：不寫回帳號、th_sfx 留著下次再轉；伺服器回來後是帳號原本的 40／30
{
  fresh({ delay: 4300 }); P.bindPrefsAccount({ id: "u1" });
  await migrate("u1"); await wait(1500);
  ok(puts.length === 0 && P.getPrefs().fxVol === 40 && P.getPrefs().voiceVol === 30 && P.getPrefs().fxMuted === false && store.get("th_sfx") === "0",
    `F1 帳號設定超過 4 秒才回來：寫回帳號 ${puts.length} 次（要 0）；${vols()}；th_sfx=${store.get("th_sfx")}（留著下次轉）`);
}
// F2 請求失敗：不寫、th_sfx 留著
{
  fresh({ fail: true }); P.bindPrefsAccount({ id: "u1" });
  await migrate("u1"); await wait(1200);
  ok(puts.length === 0 && P.getPrefs().fxMuted === false && store.get("th_sfx") === "0", `F2 帳號設定請求失敗：寫回 ${puts.length} 次（要 0）、fxMuted ${P.getPrefs().fxMuted}、th_sfx 留著`);
}
// F3 帳號從來沒存過：照這台目前的設定（預設）只把互動音效設成靜音，其他欄位一樣
{
  fresh({ saved: false }); P.bindPrefsAccount({ id: "u1" }); await wait(20);
  const before = { ...P.getPrefs() };
  await migrate("u1"); await wait(1200);
  const after = P.getPrefs(), same = (Object.keys(before) as (keyof typeof before)[]).every((k) => k === "fxMuted" || before[k] === after[k]);
  ok(after.fxMuted && same && puts.length === 1 && puts[0].prefs.fxMuted === true && !store.has("th_sfx"), `F3 帳號沒存過：只改 fxMuted（其他欄位${same ? "都沒變" : "被改了"}），寫回 ${puts.length} 次`);
}
// F4 帳號有存過 40／30：等設定真的載入（畫面上是 40／30）才轉；結果 40／30＋靜音，只寫一次
{
  fresh({ delay: 120 }); P.bindPrefsAccount({ id: "u1" });
  await migrate("u1"); await wait(1200);
  ok(P.getPrefs().fxMuted && P.getPrefs().fxVol === 40 && P.getPrefs().voiceVol === 30 && puts.length === 1 && puts[0].prefs.fxVol === 40 && puts[0].prefs.voiceVol === 30 && puts[0].prefs.fxMuted === true && !store.has("th_sfx"),
    `F4 帳號 40／30：轉完 ${vols()}；寫回 ${puts.length} 次（${JSON.stringify({ fxVol: puts[0]?.prefs.fxVol, voiceVol: puts[0]?.prefs.voiceVol, fxMuted: puts[0]?.prefs.fxMuted })}）`);
}
// F5 等待期間換帳號（u1 → u2，並取消 u1 的轉換）：兩個帳號都不寫、都不變成靜音
{
  fresh({ delay: 200 }); server.set("u2", { ...P.DEFAULT_PREFS, fxVol: 90 });
  P.bindPrefsAccount({ id: "u1" });
  const ctrl = new AbortController(); const job = migrate("u1", { signal: ctrl.signal });
  await wait(50); ctrl.abort(); who = "u2"; P.bindPrefsAccount({ id: "u2" });
  await job; await wait(1300);
  ok(puts.length === 0 && P.getPrefs().fxVol === 90 && P.getPrefs().fxMuted === false && store.get("th_sfx") === "0",
    `F5 等待中換成 u2：寫回 ${puts.length} 次（要 0）；u2 是 fxVol ${P.getPrefs().fxVol}、fxMuted ${P.getPrefs().fxMuted}（沒被 u1 的轉換改到）`);
}
// F6 頁面卸載（只取消、沒換人）：不寫
{
  fresh({ delay: 200 }); P.bindPrefsAccount({ id: "u1" });
  const ctrl = new AbortController(); const job = migrate("u1", { signal: ctrl.signal });
  await wait(30); ctrl.abort(); await job; await wait(1300);
  ok(puts.length === 0 && P.getPrefs().fxMuted === false && P.getPrefs().fxVol === 40, `F6 卸載時取消：寫回 ${puts.length} 次、${vols()}`);
}
// F7 重複執行（同時兩次，做完再一次）：只生效一次、只寫回一次
{
  fresh({ delay: 120 }); P.bindPrefsAccount({ id: "u1" });
  const a = migrate("u1"), b = migrate("u1");
  await Promise.all([a, b]); await migrate("u1"); await wait(1200);
  ok(puts.length === 1 && P.getPrefs().fxMuted && P.getPrefs().fxVol === 40 && !store.has("th_sfx"), `F7 重複執行三次：寫回 ${puts.length} 次（要 1）、${vols()}`);
}
// F8 訪客：立刻轉，只改互動音效靜音，存在這台
{
  fresh(); P.bindPrefsAccount(null); P.setPrefs({ fxVol: 55 });
  await migrate(null);
  const dev = JSON.parse(store.get("mj.prefs.v4") ?? "{}");
  ok(dev.fxMuted === true && dev.fxVol === 55 && puts.length === 0 && !store.has("th_sfx"), `F8 訪客：這台 mj.prefs.v4 fxMuted=${dev.fxMuted}、fxVol=${dev.fxVol}，不寫伺服器`);
}

// ---- B 大老二綁登入帳號 ----
let B: { prefsOwnerOf: (a: { status: string; user: { id: string; isGuest?: boolean } | null }) => { id: string; isGuest?: boolean } | null | undefined } | null = null;
try { B = await import("../components/gamePrefs/accountBinding"); } catch (e) { ok(false, `B0 找不到共用的帳號綁定（components/gamePrefs/accountBinding）：${(e as Error).message.slice(0, 80)}`); }
if (B) {
  const own = B.prefsOwnerOf;
  ok(own({ status: "checking", user: null }) === undefined && own({ status: "out", user: null }) === null && JSON.stringify(own({ status: "in", user: { id: "u1" } })) === '{"id":"u1","isGuest":false}'
    && JSON.stringify(own({ status: "in", user: { id: "g1", isGuest: true } })) === '{"id":"g1","isGuest":true}',
    "B1 登入狀態 → 設定的主人：還在確認＝先不綁；沒登入＝這台；LINE 帳號＝帳號；訪客＝這台（bindPrefsAccount 對訪客只用這台）");
  // B2 直接進入大老二（已登入 u1）：讀到帳號的 40
  fresh({ delay: 30 }); store.delete("th_sfx"); P.bindPrefsAccount(own({ status: "in", user: { id: "u1" } })!); await wait(80);
  const direct = P.getPrefs().fxVol;
  // B3 重新整理：模組狀態歸零，再綁一次 → 不用等伺服器，這台的帳號快取就是 40
  P.__testPrefs(io); P.bindPrefsAccount(own({ status: "in", user: { id: "u1" } })!); const refreshed = P.getPrefs().fxVol;
  await wait(80);
  // B4 從十三支切到大老二（同一個分頁、同一個帳號）：重複綁定不做事，值不變、不多打一次伺服器
  const getsBefore = gets; P.bindPrefsAccount(own({ status: "in", user: { id: "u1" } })!); const switched = P.getPrefs().fxVol, extraGets = gets - getsBefore;
  P.setPrefs({ fxVol: 65 }); // 在大老二調，存到 u1
  await wait(1100);
  const savedToU1 = puts.some((p) => p.account === "u1" && p.prefs.fxVol === 65);
  // B5 換帳號 u2（沒存過）：是預設，不殘留 u1 的 65；登出：這台的設定，也不殘留
  who = "u2"; P.bindPrefsAccount(own({ status: "in", user: { id: "u2" } })!); await wait(80); const u2 = P.getPrefs().fxVol;
  P.bindPrefsAccount(own({ status: "out", user: null }) ?? null); const out = P.getPrefs().fxVol;
  ok(direct === 40 && refreshed === 40 && switched === 40 && extraGets === 0 && savedToU1 && u2 === 70 && out === 70,
    `B2～B5 直接進入 ${direct}、重新整理 ${refreshed}、從十三支切過來 ${switched}（多打伺服器 ${extraGets} 次）、在大老二調 65 存到 u1：${savedToU1}；換成 u2 是 ${u2}、登出是 ${out}（都不殘留 u1 的 65）`);
}
{
  const src = readFileSync("app/big2/page.tsx", "utf8");
  const home = src.slice(src.indexOf("export default function Home()"), src.indexOf("function RoomView"));
  ok(/useGamePrefsAccount\(useSessionAuth\(\)\)/.test(home) && !/useMjAuth|loginReturnUrl|signInWithOAuth/.test(src),
    "B6 大老二頁面一進來（Home，所有畫面共用）就用登入狀態綁定共用設定；只讀登入狀態，沒有登入入口（不用 useMjAuth，同 _login-return-url L4）");
}

// ---- V 震動開關：storage 讀寫都失敗 ----
{
  const V = await import("../components/gamePrefs/vibrate");
  vib.length = 0; storageBroken = true;
  V.setVibrateOn(false);
  const on = V.vibrateOn(), fired = V.gameVibrate(200);
  storageBroken = false;
  ok(on === false && fired === false && vib.length === 0, `V1 storage 讀寫都拋錯：關掉震動後 vibrateOn=${on}、vibrate 叫了 ${vib.length} 次（要 0）`);
  V.setVibrateOn(true); V.gameVibrate(200);
  ok(vib.length === 1, `V2 再打開：又會震（${vib.length} 次）`);
}

// ---- P /thirteen/preview/settings 預覽頁開關 ----
{
  const env = process.env as Record<string, string | undefined>;
  let Page: (() => unknown) | null = null;
  try { Page = (await import("../app/thirteen/preview/settings/page")).default as () => unknown; } catch (e) { ok(false, `P0 找不到 /thirteen/preview/settings：${(e as Error).message.slice(0, 80)}`); }
  if (Page) {
    const open = (nodeEnv: string, flag: string | undefined) => {
      const saved = { n: env.NODE_ENV, f: env.THIRTEEN_PREVIEW };
      env.NODE_ENV = nodeEnv; if (flag === undefined) delete env.THIRTEEN_PREVIEW; else env.THIRTEEN_PREVIEW = flag;
      try { Page!(); return "rendered"; } catch (e) { return (e as { digest?: string }).digest ?? String(e); }
      finally { env.NODE_ENV = saved.n; if (saved.f === undefined) delete env.THIRTEEN_PREVIEW; else env.THIRTEEN_PREVIEW = saved.f; }
    };
    const NF = "NEXT_HTTP_ERROR_FALLBACK;404";
    ok(open("production", undefined) === NF && open("production", "0") === NF && open("production", "1") === "rendered",
      "P1 /thirteen/preview/settings：正式站（沒設、設成 0）404；預覽站（THIRTEEN_PREVIEW=1）可開");
    const src = readFileSync("app/thirteen/preview/settings/page.tsx", "utf8");
    ok(/force-dynamic/.test(src) && /ThFeltMenu/.test(src), "P2 執行時才判斷開關（force-dynamic，build 時不會先算成 404）；掛的是十三支同一個 ≡ 選單");
  }
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
