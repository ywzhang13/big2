// 麻將開局確認畫面（老馬 2026-11-20；components/mahjong/mjStartConfirmView.ts、共用 components/gameLobby/StartConfirm）：
//   C 四家小牌子照座位、誰同意了、自己標「你」；倒數照伺服器截止時間＋時差
//   N 上一次沒開成的提示：沒按的人名（房主／其他人兩種說法）、房主取消、有人退出、有人被暫停；確認中或沒有上一次不顯示
//   V 共用視窗在大老二的資料下：非房主「同意」、房主「取消開局」
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { mjConfirmSeats, mjConfirmNote } = await import("../components/mahjong/mjStartConfirmView");
const SC = await import("../components/gameLobby/StartConfirm");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const P = [{ id: "pc", name: "阿明", seat: 2 }, { id: "pa", name: "阿華", seat: 0 }, { id: "pb", name: "小美", seat: 1 }, { id: "pd", name: "阿德", seat: 3 }];

{
  const s = mjConfirmSeats(P, new Set(["pa", "pc"]), "pb");
  ok(s.map((x) => x.name).join() === "阿華,小美,阿明,阿德", "C1 小牌子照座位順序");
  ok(s.map((x) => (x.ok ? 1 : 0)).join("") === "1010" && s[1].me && !s[0].me, "C2 誰同意了照 readyIds；自己標 me");
  ok(SC.secondsLeftOf(20_000, 10_000, 0) === 10 && SC.secondsLeftOf(20_000, 5_000, 5_000) === 10 && SC.secondsLeftOf(20_000, 30_000, 0) === 0, "C3 倒數：10 秒整、本機慢 5 秒加時差一樣 10、過了是 0");
}
{
  const t = (missingIds: string[]) => ({ reason: "timeout" as const, missingIds, at: 1 });
  ok(mjConfirmNote(t(["pd"]), false, P, "pa", true) === "阿德 沒按同意，可以再按一次開始遊戲", "N1 房主看到誰沒按、可以再按開始");
  ok(mjConfirmNote(t(["pc", "pd"]), false, P, "pb", false) === "阿明、阿德 沒按同意，等房主重新開始", "N2 其他人看到兩個人名、等房主");
  ok(mjConfirmNote(t(["pd"]), false, P, "pd", false) === "你 沒按同意，等房主重新開始", "N3 沒按的人自己看到「你」");
  ok(mjConfirmNote(t(["gone"]), false, P, "pa", true) === "有人 沒按同意，可以再按一次開始遊戲", "N4 已經離開的人寫「有人」");
  ok(mjConfirmNote({ reason: "host", missingIds: [], at: 1 }, false, P, "pb", false) === "房主取消了開局" && mjConfirmNote({ reason: "seats_changed", missingIds: [], at: 1 }, false, P, "pb", false) === "有人離開了，這次開局取消", "N5 房主取消、有人退出各一句");
  ok(mjConfirmNote({ reason: "suspended", missingIds: [], at: 1 }, false, P, "pb", false) === "有人帳號已暫停，不能開局", "N7 有人被暫停（麻將才有的原因）");
  ok(mjConfirmNote(t(["pd"]), true, P, "pa", true) === null && mjConfirmNote(null, false, P, "pa", true) === null, "N6 確認中、或沒有上一次：不顯示");
}
{
  const html = (myId: string, isHost: boolean) => renderToStaticMarkup(createElement(SC.default, { seats: mjConfirmSeats(P, new Set(["pa"]), myId), secondsLeft: 9, totalSeconds: 10, isHost, onAgree: () => {}, onCancel: () => {} }));
  const other = html("pb", false), host = html("pa", true);
  ok(other.includes("data-start-confirm-agree") && !other.includes("data-start-confirm-cancel") && other.includes("同意 1/4"), "V1 非房主：「同意」鈕、同意 1/4");
  ok(host.includes("data-start-confirm-cancel") && host.includes("已同意，等其他人"), "V2 房主：已同意＋「取消開局」");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
