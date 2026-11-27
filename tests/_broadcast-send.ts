// 伺服器送廣播改用 httpSend（廣播改寫第 1 批，2026-11-27）：用真的 supabase-js，只把 fetch 換成假的
//   S1 大老二 broadcast：打一次 REST 廣播 API，頻道名、事件名、payload 跟原本一樣
//   S2 麻將 mjBroadcastBatch：公開、座位頻道照原本規則，同一個頻道內照順序送
//   S3 不再印「falling back to REST … deprecated」警告
//   S4 送出失敗（伺服器回 500、網路錯誤）不丟錯，跟舊的 send() 一樣；批次裡失敗一則，後面照送
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";

type Msg = { topic: string; event: string; payload: Record<string, unknown> };
const calls: { url: string; msgs: Msg[] }[] = [];
let mode: "ok" | "500" | "throw" | "fail-first" = "ok";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const msgs = (JSON.parse(String(init?.body ?? "{}")).messages ?? []) as Msg[];
  calls.push({ url, msgs });
  if (mode === "throw" || (mode === "fail-first" && calls.length === 1)) throw new TypeError("fetch failed");
  if (mode === "500") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
  return new Response(null, { status: 202 });
}) as typeof fetch;

const warns: string[] = [];
const origWarn = console.warn;
console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };

const { broadcast } = await import("../lib/broadcast");
const { mjBroadcastBatch } = await import("../lib/mahjong/broadcast");

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const reset = (m: typeof mode) => { calls.length = 0; warns.length = 0; mode = m; };

// S1
reset("ok");
await broadcast("1234", "play_cards", { playerId: "p1", cards: ["3C"] });
ok(calls.length === 1 && new URL(calls[0].url).origin + new URL(calls[0].url).pathname === "https://stub.supabase.co/realtime/v1/api/broadcast", "S1 大老二：打一次 REST 廣播 API");
ok(calls[0]?.msgs.length === 1 && calls[0].msgs[0].topic === "big2-1234" && calls[0].msgs[0].event === "play_cards"
  && JSON.stringify(calls[0].msgs[0].payload) === JSON.stringify({ playerId: "p1", cards: ["3C"] }), "S1 頻道 big2-1234、事件名、payload 不變");
ok(!warns.some((w) => /falling back to REST|deprecated/i.test(w)), "S3 大老二不再印「即將淘汰」警告");

// S2
reset("ok");
await mjBroadcastBatch("5678", [{ event: "a", payload: { n: 1 } }, { event: "b", payload: { n: 2 } }, { event: "c", payload: { n: 3 } }], 7);
const topics = calls.map((c) => c.msgs[0].topic);
const pub = calls.filter((c) => c.msgs[0].topic === "mj-5678").map((c) => c.msgs[0].event);
ok(calls.length === 3 && topics.every((t) => t === "mj-5678"), "S2 麻將公開事件都送到 mj-5678");
ok(JSON.stringify(pub) === JSON.stringify(["a", "b", "c"]), "S2 同一個頻道照原本順序送");
ok(calls.every((c) => c.msgs[0].payload.sv === 7), "S2 版本號 sv 照舊放進 payload");
ok(!warns.some((w) => /falling back to REST|deprecated/i.test(w)), "S3 麻將不再印「即將淘汰」警告");

// S4
for (const m of ["500", "throw"] as const) {
  reset(m);
  let threw = false;
  try { await broadcast("1234", "pass", { playerId: "p2" }); } catch { threw = true; }
  ok(!threw && calls.length === 1, `S4 送出失敗（${m === "500" ? "伺服器回 500" : "網路錯誤"}）不丟錯，API 照常回應`);
  ok(warns.some((w) => w.includes("[broadcast] 送出失敗 pass")), `S4 失敗（${m}）記一行 warn`);
}
reset("fail-first");
let threw = false;
try { await mjBroadcastBatch("5678", [{ event: "a", payload: {} }, { event: "b", payload: {} }]); } catch { threw = true; }
ok(!threw && calls.length === 2 && calls[1].msgs[0].event === "b", "S4 批次第一則失敗，不丟錯、第二則照送（跟舊的 send() 一樣）");

console.warn = origWarn;
for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
