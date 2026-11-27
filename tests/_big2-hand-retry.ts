// 大老二開局拿牌失敗要自己恢復（老柯 2026-11-27，審伯〈大老二手牌私有化-9bae916-完整審查〉R1）：
// 手牌不走公開廣播後，前端收到 game_start 才帶入座憑證讀一次狀態拿牌。這次請求失敗（500、網路斷）時，
// 修改前 hooks/useGame.ts 的 4 秒輪詢只在「不是輪到自己」時讀狀態——輪到自己的那一家（拿 3♣ 先出的人）就一直沒牌，全桌卡住。
// 這支真的把 useGame 掛起來跑（React 19 + 假的 Realtime 頻道、假 fetch、手動推進的輪詢計時器）：
//   A 第一局：輪到自己、拿牌請求回 500 → 下一輪輪詢（4 秒內）自己拿到和伺服器一樣的 13 張，能出牌（出牌帶入座憑證）
//   B 下一局：輪到自己、拿牌請求網路斷 → 一樣下一輪輪詢就拿到新的 13 張
//   C 開局前送出、開局後才回來的舊回應（上一局的手牌）不會蓋掉新局；下一輪輪詢拿到新局的牌
//   D 離房、房間關閉後輪詢不再讀狀態；卸載後計時器和頻道都清掉
//   E 開局的請求帶版本標記 proto（伺服器擋舊版前端，R2）；按繼續帶入座憑證
import { register } from "node:module";
const FAKE_SB = new URL("./support/fake-big2-realtime.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return s === "@/lib/supabase" ? n(${JSON.stringify(FAKE_SB)}, c) : n(s, c); }`));

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

// ── 假瀏覽器環境 ──
const g = globalThis as unknown as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;
const mem = new Map<string, string>([["big2_pid", "me"], ["big2_seat_key:R", "k-me"]]);
g.window = globalThis;
g.HTMLIFrameElement = class {};
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
g.document = { activeElement: null, hidden: false, visibilityState: "visible", addEventListener() {}, removeEventListener() {} }; // 沒有 createElement：react-dom 當成非瀏覽器環境，不碰真的 DOM
// 輪詢計時器（useGame 的 setInterval 4 秒）：記下來，測試用 tick() 手動推進
const intervals = new Map<number, { fn: () => void; ms: number }>();
let nextTimer = 1;
g.setInterval = ((fn: () => void, ms: number) => { const id = nextTimer++; intervals.set(id, { fn, ms }); return id; }) as unknown as typeof setInterval;
g.clearInterval = ((id: number) => void intervals.delete(id)) as unknown as typeof clearInterval;

// ── 假伺服器 ──
const ids = ["me", "p1", "p2", "p3"];
const srv = {
  status: "waiting", currentTurn: 0, hand: [] as string[], hostId: "me",
  startConfirm: null as null | Record<string, unknown>,
};
type Mode = "ok" | "500" | "reject" | "hold";
const stateModes: Mode[] = [];
const held: (() => void)[] = [];
const posts: { path: string; body: Record<string, unknown> }[] = [];
let stateCalls = 0;
const snapshot = (key: string | null) => ({
  status: srv.status, currentTurn: srv.currentTurn, lastPlay: null, passCount: 0, roundStarter: srv.currentTurn, scores: {}, hostId: srv.hostId,
  players: ids.map((id, seat) => ({ id, name: id, seat, cardCount: 13, isFinished: false })),
  myHand: key === "k-me" ? [...srv.hand] : [], mySeat: 0, startConfirm: srv.startConfirm, lastStartConfirm: null,
});
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
g.fetch = (async (url: string, init?: RequestInit) => {
  const path = url.split("?")[0];
  if (path === "/api/game/state") {
    stateCalls++;
    const key = new Headers(init?.headers).get("x-big2-seat-key");
    const mode = stateModes.shift() ?? "ok";
    if (mode === "500") return json(500, { error: "伺服器錯誤" });
    if (mode === "reject") throw new TypeError("fetch failed");
    const snap = snapshot(key); // 回應內容是「送出當下」的牌桌
    if (mode === "hold") return new Promise<Response>((r) => held.push(() => r(json(200, snap))));
    return json(200, snap);
  }
  posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
  return json(200, { success: true });
}) as typeof fetch;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useGame } = await import("./../hooks/useGame");
const sb = await import("./support/fake-big2-realtime.mjs");
const { compareCardsDisplay } = await import("../lib/card");

const box: { api?: ReturnType<typeof useGame> } = {};
function Probe() { const v = useGame("1234", "me"); React.useEffect(() => { box.api = v; }); return null; } // 每次畫完把 hook 的回傳值交給測試
const api = new Proxy({} as ReturnType<typeof useGame>, { get: (_t, k) => (box.api as unknown as Record<string | symbol, unknown>)[k] });
const root = createRoot({ nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: g.document, addEventListener() {}, removeEventListener() {} } as unknown as Element);
const flush = async () => { for (let i = 0; i < 5; i++) await React.act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const tick = async () => { await React.act(async () => { for (const t of [...intervals.values()]) if (t.ms === 4000) t.fn(); }); await flush(); };
const sorted = (h: string[]) => [...h].sort(compareCardsDisplay);
const H1 = ["3C", "4D", "5H", "6S", "7C", "8D", "9H", "10S", "JC", "QD", "KH", "AS", "2C"];
const H2 = ["3D", "4C", "5S", "6H", "7D", "8C", "9S", "10H", "JD", "QC", "KS", "AH", "2D"];
const H3 = ["3H", "4S", "5C", "6D", "7H", "8S", "9C", "10D", "JH", "QS", "KC", "AD", "2H"];
const gameStart = () => React.act(async () => { sb.emit("game_start", { currentTurn: 0, roundStarter: 0, players: ids.map((id, seat) => ({ id, name: id, seat, cardCount: 13 })) }); });

await React.act(async () => { root.render(React.createElement(Probe)); });
await React.act(async () => { api.setRoomId("R"); });
await flush();

// E 開局的請求帶 proto
{
  posts.length = 0;
  await React.act(async () => { await api.startGame(); });
  srv.status = "ready_check";
  srv.startConfirm = { id: "c1", startedBy: "me", readyIds: ["me"], seatIds: ids, deadline: Date.now() + 10_000, serverNow: Date.now() };
  await React.act(async () => { api.refreshState(); });
  await flush();
  await React.act(async () => { await api.confirmReady(); });
  const rc = posts.find((p) => p.path === "/api/game/ready-check")?.body, rd = posts.find((p) => p.path === "/api/game/ready")?.body;
  eq([rc?.proto, rc?.seatKey, rd?.proto, rd?.confirmId], [2, "k-me", 2, "c1"], "E1 按開始（ready-check）、按同意（ready）都帶版本標記 proto=2（按開始另帶入座憑證）");
  srv.startConfirm = null;
}

// A 第一局：拿牌回 500
{
  srv.status = "playing"; srv.hand = H1; srv.currentTurn = 0;
  stateModes.push("500");
  await gameStart(); await flush();
  eq([api.state.status, api.isMyTurn, api.state.myHand.length], ["playing", true, 0], "A1 第一局開局、輪到自己，拿牌請求回 500：手上暫時沒牌");
  const before = stateCalls;
  await tick();
  eq([stateCalls - before, api.state.myHand], [1, sorted(H1)], "A2 下一輪輪詢（4 秒）自己再讀一次，拿到和伺服器一樣的 13 張（不用重新整理、不用切背景、不靠別人動作）");
  posts.length = 0;
  let r: { success: boolean } = { success: false };
  await React.act(async () => { r = api.playCards(["3C"]); });
  await flush();
  const play = posts.find((p) => p.path === "/api/game/play")?.body;
  eq([r.success, play?.cards, play?.seatKey], [true, ["3C"], "k-me"], "A3 拿到牌後能出牌（出 3♣，帶入座憑證）");
}

// B 下一局：拿牌網路斷
{
  srv.status = "finished";
  await React.act(async () => { api.refreshState(); }); await flush();
  posts.length = 0;
  await React.act(async () => { await api.continueGame(); });
  eq(posts.find((p) => p.path === "/api/game/continue")?.body.seatKey, "k-me", "E2 按繼續（下一局）帶入座憑證");
  srv.status = "playing"; srv.hand = H2;
  stateModes.push("reject");
  await gameStart(); await flush();
  eq([api.state.status, api.isMyTurn, api.state.myHand.length], ["playing", true, 0], "B1 下一局開局、輪到自己，拿牌請求網路斷：上一局的牌清掉、暫時沒牌");
  await tick();
  eq(api.state.myHand, sorted(H2), "B2 下一輪輪詢就拿到新的 13 張");
}

// C 開局前送出、開局後才回來的舊回應
{
  srv.status = "finished"; srv.hand = H2;
  stateModes.push("hold");
  await React.act(async () => { api.refreshState(); }); await flush(); // 這個請求帶回的是上一局（H2）
  srv.status = "playing"; srv.hand = H3;
  stateModes.push("500");
  await gameStart(); await flush();
  const seen: string[][] = [];
  await React.act(async () => { held.shift()?.(); });
  for (let i = 0; i < 5; i++) { seen.push(api.state.myHand); await flush(); }
  eq([seen.some((h) => h.length > 0), api.state.status], [false, "playing"], "C1 開局前送出的舊回應（上一局的牌、finished）晚到：丟掉，不會把上一局的牌放回手上、也不會變回結束");
  await tick();
  eq(api.state.myHand, sorted(H3), "C2 下一輪輪詢拿到新局的 13 張");
}

// D 停止條件（每一項都先弄成「會一直補讀」的樣子：開局、輪到自己、拿牌失敗沒牌）
{
  stateModes.push("500");
  await gameStart(); await flush();
  await React.act(async () => { api.setRoomId(""); }); await flush();
  const before = stateCalls;
  await tick(); await tick();
  eq([api.state.myHand.length, stateCalls - before], [0, 0], "D1 離房（沒有房間 id）後輪詢不再讀狀態");
  await React.act(async () => { api.setRoomId("R"); }); await flush();
  await React.act(async () => { api.markClosed({ players: [] }); }); await flush();
  const b2 = stateCalls;
  await gameStart(); await flush();
  await tick(); await tick();
  eq([api.state.myHand.length, stateCalls - b2], [0, 0], "D2 房間關閉後輪詢不再讀狀態");
  await React.act(async () => { root.unmount(); });
  eq([[...intervals.values()].filter((t) => t.ms === 4000).length, sb.channels.live], [0, 0], "D3 卸載後輪詢計時器清掉、頻道移除");
}

console.log(results.join("\n"));
process.exit(results.some((x) => x.startsWith("❌")) ? 1 : 0);
