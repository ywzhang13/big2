// 自摸特效庫＋斗內的規則（老闆 2026-10-31）：週界線、特效有效判斷、本週排行榜
//   R1 一週＝台北週一 00:00 到週日 23:59:59：週日 23:59:59 還在這週，週一 00:00:00 是下一週
//   R2 特效有效到 until：最後一秒有效、到期那一刻失效；老闆永久
//   R6 開通到期＝開通當週的下一週結束（老闆 2026-10-31）：週一、週四、週日開通都用到下週日 23:59:59
//   R3 沒選過、沒有有效開通或代號不認得＝金色自摸回退；老闆可永久選六種特效
//   R5 總斗內：累計所有週的有效斗內；作廢不算；名稱、頭像用最新一筆「有效」斗內的；沒有帳號 id
//   R4 排行榜只算本週有效：作廢的不算、上週的不算；同額較早達到的在前；顯示最新一筆的 LINE 名稱和頭像、沒有帳號 id
import { allTimeBoard, grantExpiresAt, OWNER_USER_ID, resolveZimoFx, weekOf, weeklyBoard, zimoFxValid } from "../lib/mahjong/zimoFx/rules";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const MON = T("2026-10-26T00:00:00"), NEXT = T("2026-11-02T00:00:00");
eq([T("2026-10-26T00:00:00"), T("2026-10-29T12:00:00"), T("2026-11-01T23:59:59")].map((t) => weekOf(t).start === MON && weekOf(t).end === NEXT), [true, true, true],
  "R1 週一 00:00、週四中午、週日 23:59:59 都在 10/26 這週（結束＝11/2 週一 00:00）");
eq([weekOf(T("2026-11-02T00:00:00")).start === NEXT, weekOf(T("2026-10-25T23:59:59")).end === MON], [true, true], "R1 週一 00:00:00 是下一週；前一個週日 23:59:59 是上一週");
eq(weekOf(Date.parse("2026-11-01T16:00:00Z")).start === NEXT, true, "R1 用 UTC 看是週日 16:00、台北已經是週一 00:00：算下一週");
const g = resolveZimoFx("u:a", { fx: "storm", until: NEXT });
eq([zimoFxValid(g, T("2026-11-01T23:59:59")), zimoFxValid(g, T("2026-11-02T00:00:00")) ?? null, zimoFxValid(resolveZimoFx(OWNER_USER_ID, { fx: "thunder", until: null }), T("2099-01-01T00:00:00"))],
  ["storm", null, "thunder"], "R2 開通到週日 23:59:59 還有效、週一 00:00:00 失效；老闆選雷霆永久有效");
eq([resolveZimoFx(OWNER_USER_ID, undefined), resolveZimoFx("u:a", undefined) ?? null, resolveZimoFx("u:a", { fx: "storm", until: null }) ?? null, resolveZimoFx(null, { fx: "storm", until: NEXT }) ?? null, resolveZimoFx("u:a", { fx: "rainbow", until: NEXT }) ?? null],
  [{ code: "golden", until: null }, { code: "golden", until: null }, { code: "golden", until: null }, null, { code: "golden", until: null }], "R3 老闆或一般帳號沒選、一般帳號選未開通特效、不認得代號＝金色自摸；沒綁帳號仍沒有特效");
const N2 = T("2026-11-09T00:00:00");
eq([T("2026-10-26T00:00:00"), T("2026-10-29T12:00:00"), T("2026-11-01T23:59:59")].map((t) => grantExpiresAt(t) === N2).concat(grantExpiresAt(T("2026-11-02T00:00:00")) === T("2026-11-16T00:00:00")),
  [true, true, true, true], "R6 10/26 週一、10/29 週四、11/1 週日 23:59:59 開通都到 11/8 週日 23:59:59（11/9 週一 00:00 失效）；11/2 週一 00:00 開通就到 11/15");
const row = (userId: string, amount: number, at: string, o: { voided?: boolean; name?: string } = {}) =>
  ({ userId: `uid-${userId}`, name: o.name ?? userId, avatarUrl: `https://pic/${userId}`, amount, donatedAt: T(at), voided: !!o.voided });
const now = T("2026-10-30T12:00:00");
const board = weeklyBoard([
  row("A", 500, "2026-10-27T10:00:00"), row("A", 300, "2026-10-28T10:00:00"), row("B", 800, "2026-10-26T09:00:00"),
  row("C", 2000, "2026-10-29T10:00:00", { voided: true }), row("D", 900, "2026-10-25T23:59:59"), row("E", 400, "2026-10-29T10:00:00", { name: "E舊名" }),
  row("E", 100, "2026-10-29T11:00:00"), row("F", 1, "2026-11-02T00:00:00"),
], now);
eq(board.map((r) => [r.rank, r.name, r.amount, r.avatarUrl]), [[1, "B", 800, "https://pic/B"], [2, "A", 800, "https://pic/A"], [3, "E", 500, "https://pic/E"]],
  "R4 本週：B 800（10/26 就到）排在 A 800（10/28 才到）前面；C 作廢不算、D 上週日不算、F 下週一不算；E 兩筆合計 500、名稱用最新一筆的");
const all = allTimeBoard([
  row("A", 500, "2026-10-12T10:00:00", { name: "阿明舊名" }), row("A", 300, "2026-10-27T10:00:00", { name: "阿明" }), row("A", 999, "2026-10-30T10:00:00", { name: "阿明作廢名", voided: true }),
  row("B", 700, "2026-10-01T10:00:00"), row("B", 100, "2026-11-20T10:00:00"), row("C", 800, "2026-10-05T10:00:00"), row("D", 5000, "2026-10-29T10:00:00", { voided: true }),
]);
eq([all.map((r) => [r.rank, r.name, r.amount, r.avatarUrl]), JSON.stringify(all).includes("uid-"), Object.keys(all[0]).sort()],
  [[[1, "C", 800, "https://pic/C"], [2, "阿明", 800, "https://pic/A"], [3, "B", 800, "https://pic/B"]], false, ["amount", "avatarUrl", "name", "rank"]],
  "R5 總斗內：A 跨 3 週 500＋300＝800（999 作廢不算，名稱用最新一筆有效的「阿明」）、B 跨月 800、C 800、D 全作廢不上榜；同額依較早達到排（C 10/5、A 10/27、B 11/20）；沒有帳號 id");
eq([JSON.stringify(board).includes("uid-"), Object.keys(board[0]).sort()], [false, ["amount", "avatarUrl", "name", "rank"]], "R4 排行榜每列只有名次、名稱、頭像、金額，沒有帳號 id");
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
