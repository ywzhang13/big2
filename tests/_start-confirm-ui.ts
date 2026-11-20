// 開局確認畫面（老馬 2026-11-20；共用 components/gameLobby/StartConfirm、十三支 ThWaiting）：
//   C 四家小牌子照座位、誰同意了；倒數照伺服器截止時間＋時差、不會小於 0
//   N 上一次沒開成的提示：沒按同意的人名、房主取消、有人離開、被暫停；確認進行中不顯示
//   V 畫面：非房主沒按＝「同意」、按了＝「已同意，等其他人」；房主多「取消開局」；時間到「同意」不能按；沒有確認就不蓋視窗
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { confirmSeats, secondsLeftOf, lastConfirmNote } = await import("../components/thirteen/ThWaiting");
const ThWaiting = (await import("../components/thirteen/ThWaiting")).default;
const StartConfirm = (await import("../components/gameLobby/StartConfirm")).default;
import type { ThWaitingView } from "../components/thirteen/useThirteenRoom";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const base: ThWaitingView = {
  status: "waiting", code: "1234", hostId: "pa", settings: { arrangeSec: 60, totalHands: 8 }, baseScore: 100,
  seats: [{ seat: 2, name: "阿明", playerId: "pc" }, { seat: 0, name: "阿華", playerId: "pa" }, { seat: 1, name: "小美", playerId: "pb" }, { seat: 3, name: "阿德", playerId: "pd" }],
  startConfirm: null, lastStartConfirm: null,
};
const confirming = (ready: string[]): ThWaitingView => ({ ...base, startConfirm: { id: "c1", startedBy: "pa", readyIds: ready, seatIds: ["pa", "pb", "pc", "pd"], deadline: 20_000, serverNow: 10_000 } });

{ // C
  const s = confirmSeats(confirming(["pa", "pc"]), "pb");
  ok(s.map((x) => x.name).join() === "阿華,小美,阿明,阿德", "C1 小牌子照座位順序");
  ok(s.map((x) => (x.ok ? 1 : 0)).join("") === "1010" && s[1].me, "C2 誰同意了照 readyIds；自己標 me");
  ok(secondsLeftOf(20_000, 10_000, 0) === 10 && secondsLeftOf(20_000, 10_001, 0) === 10 && secondsLeftOf(20_000, 19_001, 0) === 1, "C3 剩幾秒進位（10 秒整、剛過一點還是 10、最後一秒是 1）");
  ok(secondsLeftOf(20_000, 5_000, 5_000) === 10, "C4 本機慢 5 秒：加上時差後一樣是伺服器的 10 秒");
  ok(secondsLeftOf(20_000, 25_000, 0) === 0, "C5 過了截止時間是 0，不會變負數");
}
{ // N
  const last = (reason: "timeout" | "host" | "seats_changed" | "suspended", missingIds: string[] = []) => ({ ...base, lastStartConfirm: { at: 1, reason, missingIds } });
  ok(lastConfirmNote(last("timeout", ["pc", "pd"]), "pa") === "阿明、阿德 沒按同意，可以再按一次開始遊戲", "N1 時間到：房主看到誰沒按、可以再按開始");
  ok(lastConfirmNote(last("timeout", ["pb"]), "pc") === "小美 沒按同意，等房主重新開始", "N2 時間到：其他人看到誰沒按、等房主");
  ok(lastConfirmNote(last("timeout", ["pb"]), "pb") === "你 沒按同意，等房主重新開始", "N3 沒按的人自己看到「你」");
  ok(lastConfirmNote(last("timeout", ["gone"]), "pa") === "有人 沒按同意，可以再按一次開始遊戲", "N4 沒按的人已經離開（找不到名字）寫「有人」");
  ok(lastConfirmNote(last("host"), "pb") === "房主取消了開局" && lastConfirmNote(last("seats_changed"), "pb") === "有人離開了，這次開局取消" && lastConfirmNote(last("suspended"), "pb") === "有人帳號已暫停，不能開局", "N5 房主取消、有人離開、被暫停各有一句");
  ok(lastConfirmNote({ ...confirming(["pa"]), lastStartConfirm: { at: 1, reason: "timeout", missingIds: ["pb"] } }, "pa") === null && lastConfirmNote(base, "pa") === null, "N6 確認進行中、或沒有上一次：不顯示提示");
}
{ // V
  const seats = (ready: boolean[], meIdx: number) => ["阿華", "小美", "阿明", "阿德"].map((name, i) => ({ key: i, name, ok: ready[i], me: i === meIdx }));
  const html = (p: Partial<Parameters<typeof StartConfirm>[0]>) => renderToStaticMarkup(createElement(StartConfirm, { seats: seats([true, false, false, false], 1), secondsLeft: 7, totalSeconds: 10, isHost: false, onAgree: () => {}, onCancel: () => {}, ...p }));
  const notYet = html({});
  ok(notYet.includes("data-start-confirm-agree") && notYet.includes(">同意<") && !notYet.includes("data-start-confirm-cancel"), "V1 非房主還沒按：「同意」鈕、沒有取消");
  ok(notYet.includes("同意 1/4") && notYet.includes('data-start-confirm-sec="7"') && notYet.includes(">你<"), "V2 顯示同意 1/4、剩 7 秒、自己寫「你」");
  const agreed = html({ seats: seats([true, true, false, false], 1) });
  ok(agreed.includes("已同意，等其他人") && !agreed.includes("data-start-confirm-agree"), "V3 按了以後：「已同意，等其他人」、沒有同意鈕");
  const host = html({ seats: seats([true, false, false, false], 0), isHost: true });
  ok(host.includes("data-start-confirm-cancel") && host.includes("已同意，等其他人"), "V4 房主：已同意＋「取消開局」");
  const timeUp = html({ secondsLeft: 0 });
  ok(/data-start-confirm-agree[^>]*disabled|disabled[^>]*data-start-confirm-agree/.test(timeUp), "V5 時間到 0：「同意」不能按（等伺服器回到等人）");
  const w = (v: ThWaitingView) => renderToStaticMarkup(createElement(ThWaiting, { view: v, myPlayerId: "pb", onStart: async () => ({ ok: true }), onLeave: async () => ({ ok: true }) }));
  ok(!w(base).includes("data-start-confirm") && w(confirming(["pa"])).includes("data-start-confirm"), "V6 十三支等人：沒有確認不蓋視窗；房主按了開始才蓋");
  const note = w({ ...base, lastStartConfirm: { at: 1, reason: "timeout", missingIds: ["pd"] } });
  ok(note.includes('data-th-start-note="timeout"') && note.includes("阿德 沒按同意"), "V7 十三支等人：上一次沒開成，上面有一條提示");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
