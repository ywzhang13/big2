// 大老二開局確認畫面（老馬 2026-11-20；hooks/big2StartConfirmView.ts、共用 components/gameLobby/StartConfirm）：
//   C 四家小牌子照座位、誰同意了、自己標「你」；倒數照伺服器截止時間＋時差
//   N 上一次沒開成的提示：沒按的人名（房主／其他人兩種說法）、房主取消、有人退出；確認中或沒有上一次不顯示
//   V 共用視窗在大老二的資料下：非房主「同意」、房主「取消開局」
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { big2ConfirmSeats, big2ConfirmNote } = await import("../hooks/big2StartConfirmView");
const SC = await import("../components/gameLobby/StartConfirm");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const P = [{ id: "pc", name: "阿明", seat: 2 }, { id: "pa", name: "阿華", seat: 0 }, { id: "pb", name: "小美", seat: 1 }, { id: "pd", name: "阿德", seat: 3 }];

{
  const s = big2ConfirmSeats(P, new Set(["pa", "pc"]), "pb");
  ok(s.map((x) => x.name).join() === "阿華,小美,阿明,阿德", "C1 小牌子照座位順序");
  ok(s.map((x) => (x.ok ? 1 : 0)).join("") === "1010" && s[1].me && !s[0].me, "C2 誰同意了照 readyIds；自己標 me");
  ok(SC.secondsLeftOf(20_000, 10_000, 0) === 10 && SC.secondsLeftOf(20_000, 5_000, 5_000) === 10 && SC.secondsLeftOf(20_000, 30_000, 0) === 0, "C3 倒數：10 秒整、本機慢 5 秒加時差一樣 10、過了是 0");
}
{
  const t = (missingIds: string[]) => ({ reason: "timeout" as const, missingIds, at: 1 });
  ok(big2ConfirmNote(t(["pd"]), false, P, "pa", true) === "阿德 沒按同意，可以再按一次開始遊戲", "N1 房主看到誰沒按、可以再按開始");
  ok(big2ConfirmNote(t(["pc", "pd"]), false, P, "pb", false) === "阿明、阿德 沒按同意，等房主重新開始", "N2 其他人看到兩個人名、等房主");
  ok(big2ConfirmNote(t(["pd"]), false, P, "pd", false) === "你 沒按同意，等房主重新開始", "N3 沒按的人自己看到「你」");
  ok(big2ConfirmNote(t(["gone"]), false, P, "pa", true) === "有人 沒按同意，可以再按一次開始遊戲", "N4 已經離開的人寫「有人」");
  ok(big2ConfirmNote({ reason: "host", missingIds: [], at: 1 }, false, P, "pb", false) === "房主取消了開局" && big2ConfirmNote({ reason: "seats_changed", missingIds: [], at: 1 }, false, P, "pb", false) === "有人離開了，這次開局取消", "N5 房主取消、有人退出各一句");
  ok(big2ConfirmNote(t(["pd"]), true, P, "pa", true) === null && big2ConfirmNote(null, false, P, "pa", true) === null, "N6 確認中、或沒有上一次：不顯示");
}
{
  const html = (myId: string, isHost: boolean) => renderToStaticMarkup(createElement(SC.default, { seats: big2ConfirmSeats(P, new Set(["pa"]), myId), secondsLeft: 9, totalSeconds: 10, isHost, onAgree: () => {}, onCancel: () => {} }));
  const other = html("pb", false), host = html("pa", true);
  ok(other.includes("data-start-confirm-agree") && !other.includes("data-start-confirm-cancel") && other.includes("同意 1/4"), "V1 非房主：「同意」鈕、同意 1/4");
  ok(host.includes("data-start-confirm-cancel") && host.includes("已同意，等其他人"), "V2 房主：已同意＋「取消開局」");
}

{ // K 入座憑證（老柯第 8 節）：第一次入座回應有 seatKey 才存；重新加入沒有 seatKey 不會蓋掉；依房間分開；沒有就是 null
  const mem = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
  const { saveSeatKey, loadSeatKey, NO_SEAT_KEY_MSG } = await import("../hooks/useGame");
  ok(loadSeatKey("r1") === null, "K1 還沒入座：沒有憑證");
  saveSeatKey({ roomId: "r1", seatKey: "k-abc" });
  ok(loadSeatKey("r1") === "k-abc", "K2 第一次入座：存下 seatKey");
  saveSeatKey({ roomId: "r1" }); // 重新整理、用連結回來：回應沒有 seatKey
  ok(loadSeatKey("r1") === "k-abc", "K3 重新加入（回應沒有 seatKey）：不會蓋掉原本的");
  ok(loadSeatKey("r2") === null && loadSeatKey(null) === null, "K4 別的房間、沒有房間：沒有憑證");
  ok(mem.has("big2_seat_key:r1") && NO_SEAT_KEY_MSG.includes("退出") && NO_SEAT_KEY_MSG.length <= 24, "K5 存在 big2_seat_key:<房間 id>；沒有憑證的提示是一句短話（請他退出再入座）");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
