// 開局確認的共用規則（lib/lobby/startConfirm.ts，三款之後都用；老闆 2026-11-20 定案：10 秒、四家都同意才開、沒按完不開）
//   U1 發起：房主自己算同意、截止＝現在＋10 秒
//   U2 同意：重複按不重複記；不在這次確認座位裡的人不算
//   U3 狀態：全員同意＝go；截止那一刻還有人沒按＝overtime（v3：繼續等、不作廢、不自動同意）；座位變了＝seats_changed（優先）；其他＝waiting
//   U4 取消（v3）：倒數中 counting（含房主）；倒數結束後座位裡任何一家 null＝可以；不在座位裡 not_in_confirm
import { addStartReady, beginStartConfirm, START_CONFIRM_MS, startCancelBlock, startConfirmStatus } from "../lib/lobby/startConfirm";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const seats = ["h", "p1", "p2", "p3"], T = 1_000_000;
const c0 = beginStartConfirm("h", seats, T);
eq([START_CONFIRM_MS, c0.readyIds, c0.deadline - T, c0.seatIds], [10_000, ["h"], 10_000, seats], "U1 發起：房主自己算同意，截止＝現在＋10 秒");
const c1 = addStartReady(addStartReady(addStartReady(c0, "p1"), "p1"), "stranger");
eq([c1.readyIds, addStartReady(c1, "p1") === c1], [["h", "p1"], true], "U2 重複按只記一次；不在座位裡的人不算");
const all = ["p1", "p2", "p3"].reduce((c, p) => addStartReady(c, p), c0);
eq([startConfirmStatus(c1, seats, T + 9_999), startConfirmStatus(c1, seats, T + 10_000), startConfirmStatus(all, seats, T + 5_000), startConfirmStatus(all, ["h", "p1", "p2", "p9"], T + 5_000),
  startConfirmStatus(c1, ["p3", "p2", "p1", "h"], T + 1)],
  ["waiting", "overtime", "go", "seats_changed", "waiting"], "U3 截止前 waiting；截止那一刻還有人沒按＝overtime（v3：繼續等、不自動同意）；全員同意＝go；有人換掉＝seats_changed；座位順序不影響");
eq([startCancelBlock(c1, "h"), startCancelBlock(c1, "p2"), startCancelBlock(c1, "p3"), startCancelBlock(c1, "p9")],
  [null, null, null, "not_in_confirm"], "U4 取消（v3b）：座位裡任何一家隨時都可以（倒數中、倒數後一樣）；不在座位裡不行");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
