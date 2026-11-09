// 後台結清清單標出「老闆同桌」的場次（老闆 2026-11-09：自摸紀錄裡如果老闆也在桌，標記起來，私下跟對方清算）
//   只加標記，不碰金額、合計、已收、打勾、撤回；只有後台看得到（這裡沒有動玩家端的 /api/mahjong/donate、/api/mahjong/records）
//   「同桌」以 match_record_players 實際入座的 4 個座位為準（close_room_with_record 寫入時就只收 4 個座位，從來不收觀戰者，
//   所以「沒同桌」這組案例本身就同時證明了「觀戰不算」——就算老闆觀戰過那場，他也不會出現在 match_record_players，myTable 一樣是 false）
//   T1 老闆同桌的未結清場次：myTable=true；外層清單 myTableCount 算進這場
//   T2 老闆沒同桌的未結清場次：myTable=false；外層清單 myTableCount 不算這場（觀戰不算，見上）
//   T3 已結清區：兩種場次各自結清後，paid 陣列裡每一場的 myTable 各自正確，不受結清動作影響
//   T4 金額、合計、已收、撤回完全不受影響：myTable=true 和 false 的場次應給一樣算、結清／撤回流程一樣跑
import { GET as settleGet, POST as settlePost } from "../../app/api/mahjong/admin/settlements/route";
import { POST as revokePost } from "../../app/api/mahjong/admin/settlements/revoke/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { addMatch, addMatchPlayers, clock, db, users } from "../support/stub-zimofx-store";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const uid = (n: number) => `ec000000-0000-4000-8000-00000000000${n}`;
const rid = (n: number) => `ed000000-0000-4000-8000-00000000000${n}`;
const [A, E, Cc, D] = [1, 2, 3, 4].map(uid);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
for (const [u, n] of [[A, "阿明"], [E, "阿華"], [Cc, "小美"], [D, "小剛"]]) users[u] = { name: n, avatarUrl: null };
for (const u of [BOSS, A, E, Cc, D]) await addUser(u);

const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const call = async (fn: (r: Request) => Promise<Response>, url: string, body?: object, tok = "boss") => {
  const r = await fn(new Request("http://x" + url, body ? { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) } : { headers: auth(tok) }));
  return { status: r.status, body: await r.json() };
};
const d = await db();
let hand = 0;
const win = (room: string, u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, $2, $3, $4)", [room, ++hand, u, new Date(T(at)).toISOString()]);

// R1：老闆同桌（座位 1）；A 自摸 2 次
await addMatch(rid(1), "9001", T("2026-11-09T10:00:00"), T("2026-11-09T11:00:00"));
await addMatchPlayers(rid(1), [A, BOSS, Cc, D]);
await win(rid(1), A, "2026-11-09T10:15:00"); await win(rid(1), A, "2026-11-09T10:45:00");
// R2：老闆沒同桌（四個座位都不是老闆，E 代表「老闆可能觀戰過，但觀戰不算」）；A 自摸 1 次
await addMatch(rid(2), "9002", T("2026-11-09T12:00:00"), T("2026-11-09T13:00:00"));
await addMatchPlayers(rid(2), [A, E, Cc, D]);
await win(rid(2), A, "2026-11-09T12:30:00");

clock.now = T("2026-11-09T14:00:00");

// ---- T1／T2 未結清場次的 myTable、外層清單的 myTableCount ----
const mine = await call(settleGet, `/?userId=${A}`);
const r1 = mine.body.unpaid.find((m: { roomId: string }) => m.roomId === rid(1));
const r2 = mine.body.unpaid.find((m: { roomId: string }) => m.roomId === rid(2));
const outer = await call(settleGet, "/");
const aRow = outer.body.players.find((p: { userId: string }) => p.userId === A);
eq([r1.myTable, r1.due, r2.myTable, r2.due, aRow.matches, aRow.myTableCount, aRow.amount],
  [true, 20, false, 10, 2, 1, 30],
  "T1／T2 R1（老闆同桌）myTable=true、R2（老闆沒同桌，觀戰不算）myTable=false；應給、合計完全不受影響；外層清單：阿明 2 場、其中 1 場有老闆同桌、合計 NT$30 不變");

// ---- T3／T4 結清兩場，已結清區各自的 myTable 和金額都正確 ----
const s1 = await call(settlePost, "/", { userId: A, roomIds: [rid(1), rid(2)] });
const after = await call(settleGet, `/?userId=${A}`);
const p1 = after.body.paid.find((m: { roomId: string }) => m.roomId === rid(1));
const p2 = after.body.paid.find((m: { roomId: string }) => m.roomId === rid(2));
eq([s1.status, s1.body.due, s1.body.amount, p1.myTable, p1.due, p1.batchId, p2.myTable, p2.due, p2.batchId, after.body.unpaid.length],
  [200, 30, 30, true, 20, s1.body.batchId, false, 10, s1.body.batchId, 0],
  "T3 一次結清兩場（應給合計 30，剛好給）：已結清區各自保留正確的 myTable 和應給，同一筆批次；結清流程、金額完全不受 myTable 影響");

// ---- 撤回不受 myTable 影響，兩場一起回到未結清 ----
const rv = await call(revokePost, "/", { batchId: s1.body.batchId, reason: "測試撤回" });
const back = await call(settleGet, `/?userId=${A}`);
const b1 = back.body.unpaid.find((m: { roomId: string }) => m.roomId === rid(1));
const b2 = back.body.unpaid.find((m: { roomId: string }) => m.roomId === rid(2));
eq([rv.status, rv.body.rooms.length, b1.myTable, b2.myTable], [200, 2, true, false],
  "T4 撤回整批：兩場都回到未結清，myTable 標記維持原樣（老闆同桌的還是 true，沒同桌的還是 false），撤回流程不受影響");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
