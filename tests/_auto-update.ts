// 自動換新版（lib/autoUpdate.ts，老馬 2026-11-26）：安全時機才重整、同版本不重整、失敗不重整、只重整一次；
// 以及三款遊戲和總大廳都有接上、版本查詢不快取
import { readFileSync } from "node:fs";
import * as AU from "../lib/autoUpdate";
const { createUpdater } = AU;
type Fn = (o: Record<string, unknown>) => boolean;
const mjRoomSafe = (AU as unknown as { mjRoomSafe?: Fn }).mjRoomSafe ?? (() => true);
const big2RoomSafe = (AU as unknown as { big2RoomSafe?: Fn }).big2RoomSafe ?? (() => true);

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
function setup(serverV: () => string | null | Error, current = "v1", store = mem()) {
  let reloads = 0;
  const u = createUpdater({
    current,
    fetchVersion: async () => { const v = serverV(); if (v instanceof Error) throw v; return v; },
    reload: () => { reloads++; },
    store,
  });
  return { u, reloads: () => reloads, store };
}

// U1 同版本：怎麼查都不重整
{
  const t = setup(() => "v1");
  t.u.setSafe(1, true);
  await t.u.check(); await t.u.check();
  ok(t.reloads() === 0, "U1 伺服器跟頁面同版本：在大廳查兩次都不重整");
}
// U2 牌局中發現新版：不重整；回到安全時機才重整一次
{
  const t = setup(() => "v2");
  t.u.setSafe(1, false); // 牌局中
  await t.u.check();
  ok(t.reloads() === 0, "U2 牌局中發現新版：不重整");
  await t.u.check();
  ok(t.reloads() === 0, "U2-2 牌局中再查一次：還是不重整");
  t.u.setSafe(1, true); // 整場結束／回大廳
  ok(t.reloads() === 1, "U2-3 回到安全時機（整場結束、大廳）：重整一次");
  t.u.setSafe(1, false); t.u.setSafe(1, true); await t.u.check();
  ok(t.reloads() === 1, "U2-4 之後再切換、再查：不會一直重整");
}
// U3 大廳發現新版：馬上重整
{
  const t = setup(() => "v2");
  t.u.setSafe(1, true);
  await t.u.check();
  ok(t.reloads() === 1, "U3 在大廳（安全）發現新版：馬上重整一次");
}
// U4 查詢失敗、離線、回空值：不重整、不丟錯
{
  for (const [name, v] of [["丟錯（離線）", new Error("offline")], ["回 null（非 200）", null], ["回空字串", ""]] as const) {
    const t = setup(() => v as string | null | Error);
    t.u.setSafe(1, true);
    let threw = false;
    try { await t.u.check(); } catch { threw = true; }
    ok(!threw && t.reloads() === 0, `U4 版本查詢${name}：不重整、不報錯`);
  }
}
// U5 只要有一個元件說不安全就不重整（麻將外層大廳 null、房間 false）；沒有任何回報也不重整
{
  const t = setup(() => "v2");
  await t.u.check();
  ok(t.reloads() === 0, "U5 沒有任何頁面回報安全時機：不重整");
  t.u.setSafe(1, null); t.u.setSafe(2, false);
  ok(t.reloads() === 0, "U5-2 外層不表態、房間說牌局中：不重整");
  t.u.setSafe(2, true);
  ok(t.reloads() === 1, "U5-3 房間變整場結束：重整");
}
{
  const t = setup(() => "v2");
  t.u.setSafe(1, true); t.u.setSafe(2, false);
  await t.u.check();
  ok(t.reloads() === 0, "U5-4 兩個元件一個安全一個不安全：不重整");
  t.u.setSafe(2, null); // 不安全的元件卸載
  ok(t.reloads() === 1, "U5-5 不安全的元件卸載後只剩安全的：重整");
}
// U6 重整後拿到的頁面還是舊版（快取）：同一個新版本這個分頁不再重整，避免無限重整
{
  const store = mem();
  const a = setup(() => "v2", "v1", store);
  a.u.setSafe(1, true); await a.u.check();
  const b = setup(() => "v2", "v1", store); // 重新載入後的頁面，版本還是 v1
  b.u.setSafe(1, true); await b.u.check();
  ok(a.reloads() === 1 && b.reloads() === 0, "U6 重整後拿到的還是舊頁面：同一個新版本只重整一次，不會無限重整");
  const c = setup(() => "v3", "v1", store); // 之後又出了更新的版本
  c.u.setSafe(1, true); await c.u.check();
  ok(c.reloads() === 1, "U6-2 之後又有更新的版本：可以再重整一次");
}
// U7 頁面沒有版本號（開發環境）：整個功能不動、不查詢
{
  let asked = 0;
  const u = createUpdater({ current: "", fetchVersion: async () => { asked++; return "v2"; }, reload: () => { asked += 100; }, store: mem() });
  u.setSafe(1, true); await u.check();
  ok(asked === 0, "U7 頁面沒有版本號：不查詢、不重整");
}

// R3（審伯 2026-11-26）：沒辦法跨載入記住「這版重整過了」時，不能自動重整；同一個目標版本連續三次拿到舊頁面，總共最多重整一次
async function threeLoads(storeFor: () => Parameters<typeof createUpdater>[0]["store"], target = "v2") {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const u = createUpdater({ current: "v1", fetchVersion: async () => target, reload: () => { total++; }, store: storeFor() });
    u.setSafe(1, true);
    await u.check();
  }
  return total;
}
{
  ok(await threeLoads(() => null) === 0, "R3a 拿不到 sessionStorage（store＝null）：三次載入都不重整");
  const getThrows = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
  ok(await threeLoads(() => getThrows) === 0, "R3b getItem 丟錯：三次載入都不重整");
  const setThrows = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  ok(await threeLoads(() => setThrows) === 0, "R3c setItem 丟錯：三次載入都不重整");
  const noop = { getItem: () => null, setItem: () => {} };
  ok(await threeLoads(() => noop) === 0, "R3d setItem 沒真的存起來（寫了讀不回來）：不重整");
  const shared = mem();
  ok(await threeLoads(() => shared) === 1, "R3e 正常儲存：同一個目標版本三次載入總共只重整一次");
  ok(await threeLoads(() => shared, "v3") === 1, "R3f 正常儲存：之後出了不同的新版本，還能再更新一次");
}

// R2、R4：房間的安全時機（頁面用同一支函式判斷）
{
  const base = { nameReady: true, inRoom: true, status: "waiting", confirming: false, finalOverlayShown: false, holdResult: false, closedReason: null };
  ok(!mjRoomSafe({ ...base, inRoom: false }), "R2a 麻將：還沒拿到房間資料（預設 waiting、玩家名單裡沒有自己）不安全");
  ok(!mjRoomSafe({ ...base, nameReady: false }), "R2b 麻將：邀請取名中不安全");
  ok(!mjRoomSafe({ ...base, confirming: true }), "R2c 麻將：開局確認中不安全");
  ok(!mjRoomSafe({ ...base, status: "playing" }), "R2d 麻將：打牌中不安全");
  ok(mjRoomSafe(base), "R2e 麻將：拿到房間資料、確定等人、沒有開局確認 → 安全");
  const b = { nameReady: true, inRoom: true, status: "waiting", confirming: false, closed: false };
  ok(!big2RoomSafe({ ...b, inRoom: false }), "R2f 大老二：還沒拿到房間資料不安全");
  ok(!big2RoomSafe({ ...b, nameReady: false }), "R2g 大老二：邀請取名中不安全");
  ok(!big2RoomSafe({ ...b, confirming: true }) && !big2RoomSafe({ ...b, status: "playing" }), "R2h 大老二：開局確認中、出牌中不安全");
  ok(big2RoomSafe(b) && big2RoomSafe({ ...b, status: "finished" }) && big2RoomSafe({ ...b, inRoom: false, closed: true }), "R2i 大老二：確定等人、這局結束、房間已關 → 安全");

  const fin = { ...base, status: "finished", finalOverlayShown: true };
  ok(!mjRoomSafe({ ...fin, holdResult: true }), "R4a 麻將末局：胡／自摸、大牌、隕石演出中（結算還被擋著）不安全");
  ok(!mjRoomSafe({ ...fin, holdResult: true, closedReason: "completed" }), "R4b 麻將末局：伺服器已經以 completed 關房，演出還沒播完也不安全");
  ok(mjRoomSafe({ ...fin, closedReason: "completed" }), "R4c 麻將末局：演出播完、總結算看得到 → 安全");
  ok(mjRoomSafe({ ...base, inRoom: false, closedReason: "dissolved" }), "R4d 麻將：解散等非 completed 關房（顯示「這場已結束」）→ 安全");
  ok(mjRoomSafe({ ...base, inRoom: false, status: "waiting", closedReason: "completed" }), "R4e 麻將：重新整理時房間早就打完關掉（沒有末局演出，顯示「這場已結束」）→ 安全");
}

// W 入口：版本號、查詢端點、三款遊戲和總大廳都接上
const src = (p: string) => readFileSync(p, "utf8");
ok(/NEXT_PUBLIC_BUILD_VERSION/.test(src("next.config.ts")), "W1 next.config 建置時寫入版本號");
const route = src("app/api/version/route.ts");
ok(/force-dynamic/.test(route) && /no-store/.test(route), "W2 /api/version 不快取（force-dynamic＋no-store）");
ok(/useAutoUpdate\(true\)/.test(src("app/page.tsx")), "W3 總大廳：一直是安全時機");
const th = src("app/thirteen/page.tsx");
ok(/useAutoUpdate\(/.test(th) && /startConfirm/.test(th.slice(th.indexOf("useAutoUpdate("), th.indexOf("useAutoUpdate(") + 400)), "W4 十三支：大廳、等人（沒有開局確認）、整場總結算才安全");
const mj = src("app/mahjong/page.tsx");
ok((mj.match(/useAutoUpdate\(/g) ?? []).length === 2 && /useAutoUpdate\(mjRoomSafe\(/.test(mj), "W5 麻將：大廳一處、房間一處（房間用 mjRoomSafe）");
const b2 = src("app/big2/page.tsx");
ok((b2.match(/useAutoUpdate\(/g) ?? []).length === 2 && /useAutoUpdate\(big2RoomSafe\(/.test(b2), "W6 大老二：大廳一處、房間一處（房間用 big2RoomSafe）");
ok(/inRoom: stateLoaded && /.test(mj) && /inRoom: stateLoaded && /.test(b2) && /setStateLoaded\(true\)/.test(src("hooks/useMahjong.ts")) && /setStateLoaded\(true\)/.test(src("hooks/useGame.ts")),
  "R2j 麻將、大老二：拿到過伺服器的房間快照（GET state）才算在房裡；join 回應湊的名單不算");
// R1：十三支三種表單
const lobby = src("components/thirteen/ThLobby.tsx");
ok(/useAutoUpdate\(screen === "home" \? null : false\)/.test(lobby), "R1a 十三支大廳：建立、加入房間的表單開著時回報不安全");
ok(/!join && !busy && !invite/.test(th), "R1b 十三支：邀請取名中（invite）、送出中（busy）不算大廳的安全時機");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
