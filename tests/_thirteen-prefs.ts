// 十三支接上三款共用設定（小宜〈共用設定面板 v1〉§8）：舊的音效開關 th_sfx 第一次載入時轉成互動音效靜音；
//   沒登入（訪客）立刻轉、存在這台 mj.prefs.v4（登入帳號的轉換見 tests/_game-prefs-fix.ts F1～F7）；
//   三款讀寫同一份聲音設定（十三支改了，大老二／麻將讀到同一個值）
export {};
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.document = { documentElement: { style: { setProperty() {} } }, addEventListener() {} };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

const P = await import("../lib/mahjong/prefs");
const S = await import("../components/thirteen/sfx");
const device = () => JSON.parse(store.get("mj.prefs.v4") ?? "null") as Record<string, unknown> | null;
const puts: { account: string; prefs: Record<string, unknown> }[] = [];
const io = {
  get: async () => ({ account: "u1", persisted: false, prefs: null }),
  put: async (account: string, prefs: unknown) => { puts.push({ account, prefs: prefs as Record<string, unknown> }); },
};
const fresh = () => { store.clear(); puts.length = 0; P.__testPrefs(io); };

// M1 沒登入、舊開關是關（"0"）：立刻轉成互動音效靜音，存在這台 mj.prefs.v4，th_sfx 刪掉
{
  fresh(); store.set("th_sfx", "0");
  P.bindPrefsAccount(null);
  const muted = (await S.migrateOldSfxSwitch({ account: null })) === "muted";
  ok(muted && P.getPrefs().fxMuted === true && device()?.fxMuted === true && !store.has("th_sfx") && P.getPrefs().fxVol === 70,
    `M1 訪客 th_sfx="0" → 互動音效靜音（這台 mj.prefs.v4 fxMuted=${device()?.fxMuted}）、音量數值不變 ${P.getPrefs().fxVol}、th_sfx 已刪`);
}
// M2 舊開關是開（"1"）：不改設定，只把 th_sfx 刪掉
{
  fresh(); store.set("th_sfx", "1");
  P.bindPrefsAccount(null);
  const muted = (await S.migrateOldSfxSwitch({ account: null })) === "muted";
  ok(!muted && P.getPrefs().fxMuted === false && !store.has("th_sfx"), `M2 th_sfx="1"：互動音效維持開（fxMuted=${P.getPrefs().fxMuted}），th_sfx 已刪`);
}
// M3 沒有舊開關：什麼都不做
{
  fresh(); P.bindPrefsAccount(null); P.setPrefs({ fxVol: 55 });
  const muted = (await S.migrateOldSfxSwitch({ account: null })) === "muted";
  ok(!muted && P.getPrefs().fxVol === 55 && P.getPrefs().fxMuted === false, "M3 沒有 th_sfx：設定不動");
}
// M4、M5（登入帳號的轉換）移到 tests/_game-prefs-fix.ts 的 F1～F7（逾時、失敗、沒存過、換帳號、卸載、重複執行）
// M6 三款同一份：十三支用 setPrefs 調的互動音效，換成大老二、麻將讀 getPrefs 也是同一個值（同一個模組、同一個 key）
{
  fresh(); P.bindPrefsAccount(null); P.setPrefs({ fxVol: 85, voiceVol: 20 });
  P.__testPrefs(io); // 模擬重新整理／換到另一款遊戲：模組狀態歸零，從這台重新讀
  const p = P.getPrefs();
  ok(p.fxVol === 85 && p.voiceVol === 20 && device()?.fxVol === 85, `M6 調完重新讀這台的設定：互動音效 ${p.fxVol}、語音 ${p.voiceVol}（三款都讀 mj.prefs.v4）`);
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
