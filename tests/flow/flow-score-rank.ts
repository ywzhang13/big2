// 麻將輸贏排行榜（老闆 2026-10-31 定案）GET /api/mahjong/ranks/score?range=week|all，資料是對局紀錄（不改資料庫）
//   S1 本週：只算結束時間在台灣時間週一 00:00～週日 23:59:59 的場次（上週日 23:59:59 不算、週一 00:00 算）；解散的場次也算；不同底台直接加總
//   S2 總輸贏：所有場次；大老二的紀錄不算
//   S3 只列 LINE 帳號：遊客、email 測試帳號、已刪除的帳號都不列；分數 0 也列
//   S4 分數高到低；同分同名次（1、2、3、3），同分照名字排
//   S5 me：帶自己的 token 只有自己那列 true；沒登入、遊客全部 false；回應沒有任何帳號 id、每列只有 5 個欄位
//   S6 每人的總輸贏＝歷史紀錄頁的累計（GET /api/mahjong/records?summary=1）
//   S7 range 亂填 400；這週沒有場次回空的 rows
import { GET as rank } from "../../app/api/mahjong/ranks/score/route";
import { GET as history } from "../../app/api/mahjong/records/route";
import { tokens } from "../support/stub-auth";
import { accounts, clock, records } from "../support/stub-records-store";
import type { EndReason, GameKind } from "../../lib/records/types";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const uid = (n: number) => `5c0e0000-0000-4000-8000-00000000000${n}`;
const [A, B, C, D, G, E, X] = [1, 2, 3, 4, 5, 6, 7].map(uid);
accounts[A] = { name: "Amy", avatarUrl: "https://pic/a", provider: "custom:line" };
accounts[B] = { name: "Ben", avatarUrl: null, provider: "custom:line" };
accounts[C] = { name: "Cindy", avatarUrl: null, provider: "custom:line" };
accounts[D] = { name: "Dora", avatarUrl: null, provider: "custom:line" };
accounts[G] = { name: "遊客1234", avatarUrl: null, provider: "email", guest: true };
accounts[E] = { name: "qa測試", avatarUrl: null, provider: "email" }; // email 建的測試帳號
// X：帳號已刪除（accounts 裡沒有）
tokens.a = { id: A, displayName: "Amy", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "Ben", pictureUrl: null, isGuest: false };
tokens.c = { id: C, displayName: "Cindy", pictureUrl: null, isGuest: false };
tokens.d = { id: D, displayName: "Dora", pictureUrl: null, isGuest: false };
tokens.guest = { id: G, displayName: null, pictureUrl: null, isGuest: true };

let room = 0;
function match(endedAt: string, scores: [string, number][], o: { reason?: EndReason; base?: number; fan?: number; game?: GameKind } = {}) {
  room++;
  records.push({
    game: o.game ?? "mahjong", roomId: `room-${room}`, roomCode: String(1000 + room), startedAt: null, endReason: o.reason ?? "completed",
    totalRounds: 1, basePoints: o.base ?? 100, fanPoints: o.fan ?? 20, settings: {}, handsPlayed: 4, endedAt: new Date(T(endedAt)).toISOString(),
    players: scores.map(([u, s], seat) => ({ seat, playerName: `座位${seat}`, playerId: `p${room}-${seat}`, userId: u, totalScore: s })),
  });
}
clock.now = T("2026-11-04T12:00:00"); // 週三；這週＝11/2 週一 00:00 ～ 11/8 週日 23:59:59
match("2026-11-03T21:00:00", [[A, 900], [B, -300], [C, -300], [D, -300]]);
match("2026-11-04T01:00:00", [[A, -200], [B, 100], [C, 100], [E, 0]], { reason: "dissolved", base: 50, fan: 20 }); // 中途解散、底台不同
match("2026-11-02T00:00:00", [[B, 100], [C, -100], [D, 0], [G, 0]]); // 週一 00:00 整：算這週
match("2026-11-01T23:59:59", [[A, 500], [B, -500], [D, 100], [X, -100]]); // 上週日最後一秒：不算這週
match("2026-11-03T22:00:00", [[A, 9999], [B, -9999], [C, 0], [D, 0]], { game: "big2" }); // 大老二：不算

const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request("http://x" + url, { headers: auth(tok) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const brief = (rows: { rank: number; name: string; score: number }[]) => rows.map((r) => [r.rank, r.name, r.score]);

// ---- S1 本週 ----
const week = await get(rank, "/?range=week", "b");
eq([week.status, week.body.range, week.body.weekStart === T("2026-11-02T00:00:00"), week.body.weekEnd === T("2026-11-09T00:00:00"), brief(week.body.rows)],
  [200, "week", true, true, [[1, "Amy", 700], [2, "Ben", -100], [3, "Cindy", -300], [3, "Dora", -300]]],
  "S1 本週：Amy 900−200＝700、Ben −300＋100＋100＝−100、Cindy −300＋100−100＝−300、Dora −300＋0＝−300；解散場次和週一 00:00 那場算，上週日 23:59:59 那場和大老二不算；同分 3、3");
const def = await get(rank, "/", "b");
eq(JSON.stringify(def.body.rows) === JSON.stringify(week.body.rows) && def.body.range === "week", true, "S1 不帶 range＝本週");

// ---- S2 總輸贏 ----
const all = await get(rank, "/?range=all", "b");
eq([all.status, all.body.range, "weekStart" in all.body, brief(all.body.rows)],
  [200, "all", false, [[1, "Amy", 1200], [2, "Dora", -200], [3, "Cindy", -300], [4, "Ben", -600]]],
  "S2 總輸贏：加上上週的場次（Amy＋500、Ben−500、Dora＋100）；大老二 ±9999 不算；沒有 weekStart");

// ---- S3 只列 LINE 帳號 ----
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
eq([names(week.body.rows), names(all.body.rows)], [["Amy", "Ben", "Cindy", "Dora"], ["Amy", "Ben", "Cindy", "Dora"]],
  "S3 遊客（遊客1234）、email 測試帳號（qa測試）、已刪除的帳號都不列；分數 0 的場次照樣算進去");

// ---- S5 me、不外露帳號 id ----
const meOf = (b: { rows: { name: string; me: boolean }[] }) => b.rows.filter((r) => r.me).map((r) => r.name);
const anon = await get(rank, "/?range=all");
const guest = await get(rank, "/?range=all", "guest");
const ids = [A, B, C, D, G, E, X];
eq([meOf(week.body), meOf(all.body), meOf((await get(rank, "/?range=all", "d")).body), meOf(anon.body), meOf(guest.body), anon.status,
  [week, all, anon, guest].some((r) => ids.some((id) => r.text.includes(id)) || /userId|user_id/.test(r.text)),
  [...new Set(all.body.rows.map((r: object) => Object.keys(r).sort().join()))]],
  [["Ben"], ["Ben"], ["Dora"], [], [], 200, false, ["avatarUrl,me,name,rank,score"]],
  "S5 帶 Ben 的 token 只有 Ben 那列 me；帶 Dora 的就是 Dora；沒登入、遊客都沒有 me（照樣看得到榜）；回應沒有任何帳號 id；每列只有 rank、name、avatarUrl、score、me");

// ---- S6 和歷史紀錄的累計一致 ----
const totals: Record<string, number> = Object.fromEntries(all.body.rows.map((r: { name: string; score: number }) => [r.name, r.score]));
const hist: Record<string, number> = {};
for (const [tok, name] of [["a", "Amy"], ["b", "Ben"], ["c", "Cindy"], ["d", "Dora"]]) hist[name] = (await get(history, "/?summary=1&limit=1", tok)).body.summary.totalScore;
const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
eq(sorted(hist), sorted(totals), "S6 四個人的總輸贏都等於自己歷史紀錄頁的累計（含解散的場次）");

// ---- S7 參數錯、空資料 ----
const bad = await get(rank, "/?range=month");
clock.now = T("2026-11-20T12:00:00");
const empty = await get(rank, "/?range=week");
eq([bad.status, bad.body, empty.status, empty.body.rows], [400, { error: "bad_request" }, 200, []], "S7 range 亂填 400 bad_request；那一週沒有場次回空的 rows");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
