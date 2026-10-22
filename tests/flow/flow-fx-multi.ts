// 多人同時丟互動特效（2026-10-21 老闆定案：輕組同時播、疊在重組上；發送冷卻分組共用；重組有 10 秒接收保護）
// 端到端：真的 API 路由（記憶體資料庫、真的冷卻 SQL）→ 座位頻道廣播 → 我（p0）的 transport.receiveFx → engine（假 DOM）。
//   M1 三家同時用輕組丟我：三則一起播（不排隊）
//   M2 三家同時用重組丟我：伺服器只收一則，另外兩家 429 target_protected；我只看到一則；這時我回丟輕組，疊在上面一起播
//   M3 三家同時用重組丟同一人（我旁觀）：一樣只播一則；我也想用重組打他 → 對方剛被打過，我的重組按鈕不開始倒數，改打別人照樣送得出去
//   M4 同一人連按同組：第二下 429 cooldown；跨組連按：兩組互不影響
//   每段都檢查：我看到的都播完、沒有被丟掉、重組一次只播一個（輕組可以疊上去）
//   M5 上限：重組一次湧進超過 QUEUE_MAX 則、輕組同時超過 LIGHT_MAX 則，超過的不播、記在 fxLog
import { el, installFakeDom } from "../support/fake-dom";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { clock, db } from "../support/stub-effects-store";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import type { FxKind } from "../../lib/mahjong/fx/engine";

// 前端（mjFetch）要的瀏覽器環境：沒有登入 session，token 由下面的假 fetch 依「現在是誰在送」補上
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
let actor = "p0";
const { POST: effectApi } = await import("../../app/api/mahjong/effect/route");
await db(); // 記憶體 PostgreSQL 要在裝假 window 之前先起來（它看到 window 會以為在瀏覽器）
const assetFetch = async () => ({ ok: true, blob: async () => new Blob(["x"]), text: async () => JSON.stringify({ w: 700, h: 525, fr: 30, op: 121 }), arrayBuffer: async () => new ArrayBuffer(8) });
installFakeDom({
  fetch: async (url: string, init?: RequestInit) => {
    if (url !== "/api/mahjong/effect") return assetFetch();
    const r = await effectApi(new Request("http://x/api/mahjong/effect", { method: "POST", headers: { authorization: `Bearer as:${actor}` }, body: init?.body as string }));
    deliver();
    return r;
  },
});
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = mem(); g.sessionStorage = mem();

const E = await import("../../lib/mahjong/fx/engine");
const T = await import("../../lib/mahjong/fx/transport");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(25); } return true; }

// 桌子：p0（我）坐 0、p1 坐 1、p2 坐 2、p3 坐 3
const ids = ["p0", "p1", "p2", "p3"];
rooms.R = { id: "R", code: "5878", status: "playing", game_state: {
  roomCode: "5878", status: "playing", stateVersion: 3,
  players: ids.map((id, seat) => ({ id, userId: `u:${id}`, name: "名" + id, seat, hand: [], revealed: [], flowers: [], discards: [], isDealer: seat === 0 })),
} as unknown as MahjongGameState };
const ME = 0;
T.setFxRoom("R");
T.setFxTable(ids.map((id, seat) => ({ id, seat })), ME);
// 我這個分頁收到的座位頻道訊息 → receiveFx（和 useMahjong 一樣）；MjFx 收到後排進播放佇列
let delivered = 0;
function deliver() {
  for (; delivered < sent.length; delivered++) {
    const e = sent[delivered];
    if (e.event === "mj_effect" && e.payload.playerId === "p0") T.receiveFx(e.payload.effect as Parameters<typeof T.receiveFx>[0]);
  }
}
const seen: string[] = [];
T.subscribeFx((m) => { seen.push(`${m.fromName}→${m.toName}:${m.kind}`); E.enqueueFx({ kind: m.kind, from: m.from, to: m.to, mySeat: ME, crack: true, muted: true }); });
const API: Record<FxKind, string> = { love: "heart", cash: "money", egg: "egg", water: "water", punch: "punch", clap: "clap" };
// 別人送：直接打 API（他自己的分頁不在這個測試裡），送完把廣播送到我這裡
async function other(from: string, kind: FxKind, to: string) {
  const r = await effectApi(new Request("http://x", { method: "POST", headers: { authorization: `Bearer as:${from}` }, body: JSON.stringify({ roomId: "R", effect: API[kind], to }) }));
  deliver();
  return r.status === 429 ? `429:${((await r.json()) as { reason?: string }).reason}` : String(r.status);
}
// 我送：走真的 transport.sendFx（和按鈕一樣）
async function mine(kind: FxKind, toSeat: number) { actor = "p0"; return T.sendFx(kind, toSeat); }

ok(await E.preloadFx(), "假 DOM 上預載完成");
E.setFxLayer(el() as unknown as HTMLElement);

/** 等這一段播完，回傳這段的播放紀錄（含被丟掉的） */
async function settle(n0: number, expect: number, label: string) {
  const done = await until(() => E.fxLog.length >= n0 + expect && !E.isFxBusy(), 40000);
  const log = E.fxLog.slice(n0);
  const played = log.filter((r) => !r.dropped);
  // 重組一次只播一個；輕組（愛心、砸錢）本來就可以同時播、疊在重組上，不算重疊
  const heavy = played.filter((r) => r.lane === "heavy");
  const overlap = heavy.some((r, i) => i > 0 && r.at < heavy[i - 1].at + heavy[i - 1].ms - 2);
  ok(done && played.length === expect, `${label}：我看到 ${played.length}/${expect} 則，全部播完`);
  ok(log.every((r) => !r.dropped && !r.aborted && r.done === r.anims && r.left === 0), `${label}：沒有被丟掉、沒有被中止、播完畫面乾淨（${log.map((r) => `${r.kind}/${r.view}`).join("、")}）`);
  ok(!overlap, `${label}：重組一次只播一個，前一則播完下一則才開始（輕組可以疊上去）`);
  return log;
}

// ---------- M1 三家同時用輕組丟我：一起播 ----------
{
  clock.now += 60000; const n0 = E.fxLog.length;
  const st = await Promise.all([other("p1", "love", "p0"), other("p2", "cash", "p0"), other("p3", "love", "p0")]);
  ok(st.every((x) => x === "200"), `M1 三家同時用輕組丟我：伺服器三則都收下（${st.join("、")}）`);
  const log = await settle(n0, 3, "M1");
  const ats = log.map((r) => r.at);
  ok(Math.max(...ats) - Math.min(...ats) < 200 && log.every((r) => r.lane === "light"), `M1 三則同時開始播（開始時間相差 ${Math.max(...ats) - Math.min(...ats)}ms），沒有排隊`);
}

// ---------- M2 三家同時用重組丟我：只收一則；這時我回丟輕組，疊在上面 ----------
{
  clock.now += 60000; const n0 = E.fxLog.length;
  const st = await Promise.all([other("p1", "egg", "p0"), other("p2", "water", "p0"), other("p3", "punch", "p0")]);
  ok(st.filter((x) => x === "200").length === 1 && st.filter((x) => x === "429:target_protected").length === 2,
    `M2 三家同時用重組丟我：伺服器收一則，另外兩家「對方剛被打過」（${st.join("、")}）`);
  await sleep(300);
  ok(E.isFxBusy(), "M2 這時候我這邊正在播重組");
  const r = await mine("love", 1);
  ok(r.ok, `M2 重組播放中，我照樣送得出去輕組（${JSON.stringify(r)}）`);
  const log = await settle(n0, 2, "M2");
  const h = log.find((x) => x.lane === "heavy")!, l = log.find((x) => x.lane === "light")!;
  ok(!!h && !!l && l.at < h.at + h.ms && h.view === "victim" && l.view === "sender", `M2 我的愛心疊在正在播的重組上一起播（重組 ${h?.kind} ${h?.at}～${h ? h.at + h.ms : 0}，愛心 ${l?.at} 開始）`);
}

// ---------- M3 三家同時用重組丟 p3（我旁觀）；我也想打 p3 → 對方剛被打過 ----------
{
  clock.now += 60000; const n0 = E.fxLog.length;
  const st = await Promise.all([other("p1", "punch", "p3"), other("p2", "egg", "p3"), other("p3", "water", "p1")]);
  // p3 丟 p1 不受影響（目標不同）；丟 p3 的兩則只收一則
  const toP3 = st.slice(0, 2);
  ok(toP3.filter((x) => x === "200").length === 1 && toP3.includes("429:target_protected") && st[2] === "200",
    `M3 兩家同時用重組打 p3：收一則、另一則「對方剛被打過」；p3 同時打 p1 照收（${st.join("、")}）`);
  const r = await mine("egg", 3);
  ok(!r.ok && r.reason === "target_protected" && (r.leftMs ?? 0) > 0, `M3 我也用重組打 p3：被擋下「對方剛被打過，還要 ${Math.ceil((r.ok ? 0 : r.leftMs ?? 0) / 1000)} 秒」`);
  ok(T.fxCooldownLeft("egg") === 0 && T.fxCooldownLeft("punch") === 0, "M3 被 target_protected 擋下時，我的重組按鈕沒有開始倒數");
  const r2 = await mine("punch", 2);
  ok(r2.ok, "M3 改打 p2 照樣送得出去");
  const L = [T.fxCooldownLeft("love"), T.fxCooldownLeft("cash")], H = [T.fxCooldownLeft("egg"), T.fxCooldownLeft("water"), T.fxCooldownLeft("punch")];
  ok(H.every((x) => x > 9000) && L[0] === L[1] && L[0] < 5000,
    `M3 送出拳擊後重組三顆按鈕一起倒數 10 秒（${H.map((x) => Math.ceil(x / 1000)).join("、")} 秒）；輕組不受影響，還是 M2 那次愛心剩下的 ${Math.ceil(L[0] / 1000)} 秒`);
  await settle(n0, 3, "M3");
}

// ---------- M4 同一人連按同組、跨組連按 ----------
{
  clock.now += 60000; const n0 = E.fxLog.length;
  const same = [await other("p1", "love", "p2"), await other("p1", "cash", "p2"), await other("p1", "egg", "p2"), await other("p1", "punch", "p3")];
  ok(same.join() === "200,429:cooldown,200,429:cooldown", `M4 p1 連按同組：愛心後砸錢、雞蛋後拳擊都 429 cooldown（${same.join("、")}）`);
  clock.now += 60000;
  const cross = [await other("p2", "love", "p1"), await other("p2", "egg", "p1"), await other("p2", "cash", "p1")];
  ok(cross.join() === "200,200,429:cooldown", `M4 p2 跨組連按：愛心後馬上雞蛋照收，再砸錢才 429（${cross.join("、")}）`);
  // 我自己：M3 送的拳擊（重組）還在倒數，這時輕組照樣能送；砸錢送出後愛心馬上變成冷卻中
  clock.now += 60000; await until(() => T.fxCooldownLeft("love") === 0, 6000);
  const heavyLeft = T.fxCooldownLeft("water");
  const a = await mine("cash", 1), b = await mine("love", 2), c = await mine("water", 3);
  ok(heavyLeft > 0 && a.ok && !b.ok && b.reason === "cooldown" && !c.ok && c.reason === "cooldown",
    `M4 我自己：重組還在冷卻時輕組照送；砸錢後愛心「冷卻中」（同組），潑水還是重組自己的冷卻（${[a, b, c].map((x) => (x.ok ? "ok" : x.reason)).join("、")}）`);
  await settle(n0, 2 + 2 + 1, "M4");
}
ok(new Set(seen).size === seen.length, `收到的每一則只處理一次（自己送的：API 回應和廣播是同一則，有去重；共 ${seen.length} 則）`);

// ---------- M5 上限 ----------
{
  const n0 = E.fxLog.length, N = E.QUEUE_MAX + 5;
  const r = Array.from({ length: N }, (_, i) => E.enqueueFx({ kind: "egg", from: 1 + (i % 3), to: 0, mySeat: ME, crack: true, muted: true }));
  const dropped = E.fxLog.slice(n0).filter((x) => x.dropped === "queue_full");
  ok(r.filter((x) => !x).length === N - E.QUEUE_MAX - 1 && dropped.length === N - E.QUEUE_MAX - 1,
    `M5 重組一次湧進 ${N} 則：播 1 則＋排 ${E.QUEUE_MAX} 則，超過的 ${dropped.length} 則不播，fxLog 記成 queue_full`);
  const n1 = E.fxLog.length;
  const rl = Array.from({ length: E.LIGHT_MAX + 2 }, (_, i) => E.enqueueFx({ kind: i % 2 ? "cash" : "love", from: 1 + (i % 3), to: 0, mySeat: ME, crack: true, muted: true }));
  ok(rl.filter((x) => x).length === E.LIGHT_MAX && E.fxLog.slice(n1).filter((x) => x.dropped === "light_full").length === 2,
    `M5 輕組同時 ${E.LIGHT_MAX + 2} 則：${E.LIGHT_MAX} 則一起播，超過的 2 則不播，fxLog 記成 light_full`);
  E.abortFx();
  ok(await until(() => !E.isFxBusy(), 1000), "M5 中止後引擎回到閒置");
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
