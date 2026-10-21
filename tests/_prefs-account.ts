// 偏好設定跟著帳號（lib/mahjong/prefs.ts）：審伯 2026-10-20 退回「syncing、accountMode 跨帳號殘留」的回歸測試。
//   ・訪客、沒登入只用這台；LINE 帳號用帳號的（伺服器＋這台的快取）
//   ・換帳號、登出：立刻換成新主人的設定，不沿用上一個帳號的；上一個帳號晚回來的讀取作廢；還沒送出的修改帶上一個帳號的 id 送出
// 在 node 裡跑真的 prefs.ts：假的 localStorage、<html> 的 style，伺服器換成可以控制回應時間的假 IO。
import type { PrefsIO } from "../lib/mahjong/prefs"; // 只拿型別（不會先載入 prefs，假的 localStorage、document 要先裝好）
const store = new Map<string, string>();
const vars = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  document: { documentElement: { style: { setProperty: (k: string, v: string) => void vars.set(k, v) } } },
});

const P = await import("../lib/mahjong/prefs");
type Res = { account: string; persisted: boolean; prefs: unknown };
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 假伺服器：GET 由測試決定什麼時候回、回什麼；PUT 記下來
let gets: { resolve: (r: Res | null) => void }[] = [];
const puts: { account: string; prefs: unknown }[] = [];
const io: PrefsIO = {
  get: () => new Promise<Res | null>((resolve) => gets.push({ resolve })),
  put: async (account: string, prefs: unknown) => void puts.push({ account, prefs: { ...(prefs as object) } }),
};
const back = () => vars.get("--mj-back-2"); // 畫面上現在的牌背（CSS 變數）
const BACK = (id: keyof typeof P.BACKS) => P.BACKS[id].c[1];
const reset = () => { P.__testPrefs(io); gets = []; puts.length = 0; };
/** v4 格式（和 prefs.ts、伺服器的欄位順序一樣），沒給的用預設 */
const V4 = (o: { back?: string; felt?: string; voiceVol?: number; voiceMuted?: boolean; fxVol?: number; fxMuted?: boolean; autoVoice?: boolean }) =>
  ({ v: 4, back: o.back ?? "jade", felt: o.felt ?? "green", voiceVol: o.voiceVol ?? 70, voiceMuted: o.voiceMuted ?? false, fxVol: o.fxVol ?? 70, fxMuted: o.fxMuted ?? false, autoVoice: o.autoVoice ?? true });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const A = { id: "aaaa-line" }, B = { id: "bbbb-line" }, G = { id: "gggg-guest", isGuest: true };

// ---------- 訪客、沒登入：只用這台 ----------
reset(); store.clear();
P.bindPrefsAccount(null);
ok(back() === BACK("jade") && gets.length === 0, "P1 沒登入：用這台的（第一次是預設翡翠綠），不去問伺服器");
P.bindPrefsAccount(G);
P.setPrefs({ back: "sakura" });
await sleep(1100);
ok(back() === BACK("sakura") && JSON.parse(store.get("mj.prefs.v4")!).back === "sakura" && gets.length === 0 && puts.length === 0, "P2 訪客換成櫻花粉：存在這台（mj.prefs.v4），完全不呼叫偏好設定 API");

// ---------- LINE 帳號 A：用帳號的，不沿用訪客的 ----------
P.bindPrefsAccount(A);
ok(back() === BACK("jade"), "P3 換成 LINE 帳號 A（這台沒有 A 的快取）：立刻變回預設，不沿用訪客的櫻花粉");
ok(gets.length === 1, "P4 LINE 帳號：去伺服器讀 A 的設定");
gets[0].resolve({ account: A.id, persisted: true, prefs: V4({ back: "coral", felt: "night", voiceVol: 100, fxVol: 40, fxMuted: true, autoVoice: false }) });
await sleep(0);
ok(back() === BACK("coral") && vars.get("--mj-felt-1") === P.FELTS.night.table[0], "P5 伺服器回 A 的珊瑚粉／靜夜藍：套用到畫面");
ok(same(JSON.parse(store.get("mj.prefs.v4:aaaa-line")!), V4({ back: "coral", felt: "night", voiceVol: 100, fxVol: 40, fxMuted: true, autoVoice: false })) && P.getPrefs().autoVoice === false && P.getPrefs().voiceVol === 100 && P.getPrefs().fxVol === 40 && P.getPrefs().fxMuted === true, "P6 A 的設定另外快取在這台（mj.prefs.v4:<A>），聲音設定也跟著帳號（語音 100、互動音效 40 且靜音、自動播放關），重整時先套用");
P.bindPrefsAccount(A);
ok(gets.length === 1, "P7 同一個帳號重複綁定：不重讀");

// ---------- A 改了還沒送出就換成 B ----------
P.setPrefs({ back: "rosepink" });
ok(puts.length === 0, "P8 A 改成玫瑰粉：先改畫面，停手 1 秒才存");
P.bindPrefsAccount(B);
ok(puts.length === 1 && puts[0].account === A.id && (puts[0].prefs as { back: string }).back === "rosepink", "P9 換成 B：A 還沒送出的修改立刻帶 A 的 id 送出（伺服器 session 已經是 B 會回 409，不會寫進 B）");
ok(back() === BACK("jade"), "P10 換成 B：畫面立刻換成 B 的（這台沒有 B 的快取＝預設），不沿用 A 的玫瑰粉");
await sleep(1100);
ok(puts.length === 1, "P11 之後不會再補送 A 的修改");

// ---------- 晚回來的讀取 ----------
reset(); store.clear();
P.bindPrefsAccount(A);
const lateA = gets[0];
P.bindPrefsAccount(B);
lateA.resolve({ account: A.id, persisted: true, prefs: V4({ back: "vermilion", felt: "wine" }) });
await sleep(0);
ok(back() === BACK("jade") && !store.has("mj.prefs.v4:bbbb-line"), "P12 A 的讀取在換成 B 之後才回來：作廢，B 的畫面和快取都不會變成 A 的");
gets[1].resolve({ account: A.id, persisted: true, prefs: V4({ back: "ink", felt: "black" }) });
await sleep(0);
ok(back() === BACK("jade"), "P13 綁定 B 時送出的讀取，回來的卻是 A 的（session 還沒換過來）：不套用");

// ---------- 登出 ----------
reset(); store.clear();
store.set("mj.prefs.v3", JSON.stringify({ v: 3, back: "indigo", felt: "night", autoVoice: true, voiceVol: "mid" }));
store.set("mj.prefs.v3:aaaa-line", JSON.stringify({ v: 3, back: "brass", felt: "black", autoVoice: true, voiceVol: "mid" }));
P.bindPrefsAccount(A);
ok(back() === BACK("brass"), "P14 重整後登入 A：先用 A 在這台的快取（金棕），不用等伺服器");
P.bindPrefsAccount(null);
ok(back() === BACK("indigo"), "P15 登出：換回這台的設定（靛青藍），不沿用 A 的金棕");
gets[0].resolve({ account: A.id, persisted: true, prefs: V4({ back: "coral", felt: "green" }) });
await sleep(0);
ok(back() === BACK("indigo"), "P16 登出之後 A 的讀取才回來：不套用");

// ---------- 讀取途中自己改了 ----------
reset(); store.clear();
P.bindPrefsAccount(A);
P.setPrefs({ felt: "wine" });
gets[0].resolve({ account: A.id, persisted: true, prefs: V4({}) });
await sleep(0);
ok(vars.get("--mj-felt-1") === P.FELTS.wine.table[0], "P17 讀取還沒回來時自己換了桌布：伺服器的舊值不蓋掉剛改的");
await sleep(1100);
ok(puts.length === 1 && puts[0].account === A.id && same(puts[0].prefs, V4({ felt: "wine" })), "P18 1 秒後存到 A：格式是完整 v4 { v: 4, back, felt, voiceVol, voiceMuted, fxVol, fxMuted, autoVoice }，沒有 face（和伺服器格式一樣）");

// ---------- 帳號還沒存過、讀不到、格式不合 ----------
reset(); store.clear();
store.set("mj.prefs.v3:aaaa-line", JSON.stringify({ v: 3, back: "sakura", felt: "night", autoVoice: true, voiceVol: "mid" }));
P.bindPrefsAccount(A);
gets[0].resolve({ account: A.id, persisted: true, prefs: null });
await sleep(0);
ok(back() === BACK("sakura"), "P19 帳號還沒存過（prefs:null）：沿用這台的快取");
reset();
P.bindPrefsAccount(A);
gets[0].resolve(null);
await sleep(0);
ok(back() === BACK("sakura"), "P20 讀取失敗：照用這台的快取，不報錯");
ok(P.normalizePrefs({ v: 5, back: "jade", felt: "green" }) === null && P.normalizePrefs(null) === null && P.normalizePrefs({ v: 3, back: "nope", felt: "green", autoVoice: "x", voiceVol: "max" })?.back === "jade" && P.normalizePrefs({ v: 3, back: "jade", felt: "green", autoVoice: "x", voiceVol: "max" })?.voiceVol === 70, "P21 版本不符回 null；不認得的欄位用預設（v3 不認得的音量＝70）");
ok([101, -1, 3.5, "70", null].every((x) => P.normalizePrefs({ ...V4({ fxVol: 20 }), voiceVol: x })?.voiceVol === 70) && P.normalizePrefs({ ...V4({}), fxMuted: "yes" })?.fxMuted === false, "P21c v4 的音量不是 0～100 的整數、靜音不是布林：用預設（70、不靜音）");
ok(same(P.normalizePrefs({ v: 2, back: "coral", felt: "wine" }), V4({ back: "coral", felt: "wine" })), "P21b 讀到 v2：牌背、桌布照用，聲音全部補預設，轉成 v4");
ok(same(P.normalizePrefs({ v: 1, back: "coral", face: "rice", felt: "wine" }), V4({ back: "coral", felt: "wine" })), "P23 讀到舊格式 v1（有 face）：照樣讀牌背和桌布，face 丟掉，轉成 v4");
ok((["low", "mid", "high"] as const).map((x) => P.normalizePrefs({ v: 3, back: "sakura", felt: "night", autoVoice: false, voiceVol: x })).every((p, i) => same(p, V4({ back: "sakura", felt: "night", autoVoice: false, voiceVol: [35, 70, 100][i] }))),
  "P29 v3 升級：語音音量 low→35、mid→70、high→100，加上 voiceMuted:false、fxVol:70、fxMuted:false，牌背、桌布、自動播放照舊");
reset(); store.clear(); vars.clear();
store.set("mj.prefs.v1", JSON.stringify({ v: 1, back: "rosepink", face: "celadon", felt: "black" }));
P.bindPrefsAccount(null);
ok(back() === BACK("rosepink") && vars.get("--mj-felt-1") === P.FELTS.black.table[0] && !vars.has("--mj-face-bg"), "P24 這台只有改格式前存的舊設定：牌背、桌布照用，牌面底色不套用（沒有 --mj-face-bg）");
P.setPrefs({ back: "coral" });
ok(same(JSON.parse(store.get("mj.prefs.v4")!), V4({ back: "coral", felt: "black" })), "P25 之後再改就存成新格式（mj.prefs.v4）");
reset(); store.clear(); vars.clear();
store.set("mj.prefs.v2", JSON.stringify({ v: 2, back: "sakura", felt: "night" }));
P.bindPrefsAccount(null);
ok(back() === BACK("sakura") && P.getPrefs().autoVoice === true && P.getPrefs().voiceVol === 70, "P27 這台只有 v2 存的設定：牌背照用，聲音用預設");
P.setPrefs({ autoVoice: false, voiceVol: 35 });
ok(same(JSON.parse(store.get("mj.prefs.v4")!), V4({ back: "sakura", felt: "night", voiceVol: 35, autoVoice: false })), "P28 關掉自動播放、語音拉到 35：存成 v4");
P.setPrefs({ voiceMuted: true });
ok(P.getPrefs().voiceVol === 35 && P.voiceGain(P.getPrefs()) === 0, "P30 語音靜音：音量值保留 35，實際播放音量 0");
P.setPrefs({ voiceMuted: false });
ok(P.getPrefs().voiceVol === 35 && Math.abs(P.voiceGain(P.getPrefs()) - 0.35) < 1e-9, "P31 取消靜音：回到原本的 35（播放音量 0.35）");
P.setPrefs({ fxMuted: true });
ok(P.fxGain(P.getPrefs()) === 0 && P.getPrefs().fxVol === 70 && P.getPrefs().voiceMuted === false, "P32 互動音效靜音：特效總音量 0，互動音效音量值保留，語音不受影響");
P.setPrefs({ fxMuted: false, fxVol: 70 });
ok(P.fxGain(P.getPrefs()) === 1 && Math.abs(P.fxGain({ ...P.getPrefs(), fxVol: 35 }) - 0.5) < 1e-9 && P.fxGain({ ...P.getPrefs(), fxVol: 0 }) === 0, "P33 互動音效 70（預設）＝原本的音量 1.0、35＝一半、0＝不出聲");
reset(); store.clear(); vars.clear();
P.bindPrefsAccount(null);
for (const t of P.THEMES) P.setPrefs({ back: t.back, felt: t.felt });
ok(!vars.has("--mj-face-bg") && P.THEMES.every((t) => !("face" in t)), "P26 5 個快速主題都只有牌背和桌布，套用哪一個都不會改到牌面顏色");
ok(["sakura", "rosepink", "coral"].every((id) => id in P.BACKS) && P.THEMES.some((t) => t.id === "sakuranight" && t.back === "sakura" && t.felt === "night"), "P22 牌背有櫻花粉、玫瑰粉、珊瑚粉；快速主題有「櫻花夜」");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
