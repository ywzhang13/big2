// 房卡後台「流水帳」畫面規則（components/roomCard/ledgerRows.ts，房卡第二批）：
//   相鄰、同人、同遊戲、同房的扣卡併成一列（時間、餘額用最新那一把，張數合計，展開照把數小到大）；
//   中間夾了別的、換人、換房、換遊戲就不併；充值、回收、暫停、恢復不併；「期間」照台北時間
import { groupLedger, periodLabel } from "../components/roomCard/ledgerRows";
import type { LedgerAllEntry } from "../components/roomCard/client";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

let n = 0;
const E = (p: Partial<LedgerAllEntry>): LedgerAllEntry => ({
  cursor: `c${++n}`, kind: "charge", at: 1_763_600_000_000 - n * 1000, userId: "u1", shortId: "a1", name: "老王", avatarUrl: null,
  cards: -1, balanceAfter: 10, game: "mahjong", roomCode: "4821", handNo: 1, actor: "system", actorKind: "system", ...p,
});

{ // 同人同房連續三把 → 一列
  const rows = groupLedger([E({ handNo: 3, balanceAfter: 7 }), E({ handNo: 2, balanceAfter: 8 }), E({ handNo: 1, balanceAfter: 9 })]);
  ok(rows.length === 1 && rows[0].kind === "group", "同人同房相鄰三把扣卡併成一列");
  if (rows[0].kind === "group") {
    ok(rows[0].cards === -3, "併起來的張數是合計 −3");
    ok(rows[0].first.balanceAfter === 7, "時間、餘額用最新那一把");
    ok(rows[0].items.map((x) => x.handNo).join() === "1,2,3", "展開照把數由小到大");
  }
}
{ // 換人、換房、換遊戲、中間夾回收 → 不併
  const rows = groupLedger([
    E({}), E({ userId: "u2" }), E({ roomCode: "9999" }), E({ game: "thirteen" }),
    E({ kind: "reclaim", cards: -20, game: null, roomCode: null, handNo: null, actorKind: "donate_debt", actor: "斗內欠款轉房卡" }), E({ game: "thirteen" }),
  ]);
  ok(rows.length === 6 && rows.every((r) => r.kind === "one"), "換人、換房、換遊戲、中間夾別的種類都不併");
  ok(rows[4].kind === "one" && rows[4].e.actorKind === "donate_debt", "斗內欠款轉房卡那筆原樣保留（畫面靠 actorKind 標出來）");
}
{ // 充值不併
  const rows = groupLedger([E({ kind: "topup", cards: 50, game: null, roomCode: null }), E({ kind: "topup", cards: 50, game: null, roomCode: null })]);
  ok(rows.length === 2, "相鄰兩筆充值不併");
}
{ // 第二頁接上來：最後一列和新的一把同人同房 → 併進去
  const page1 = [E({ handNo: 5 }), E({ handNo: 4 })];
  const page2 = [E({ handNo: 3 }), E({ userId: "u2" })];
  const rows = groupLedger([...page1, ...page2]);
  ok(rows.length === 2 && rows[0].kind === "group" && rows[0].items.length === 3, "載入更多後整份重算，跨頁相鄰的同場也併在一起");
}
ok(groupLedger([]).length === 0, "沒有紀錄回空陣列");

// 期間：2026-11-20（週五，週一是 11/16）台北 12:00 ＝ UTC 04:00
const NOW = Date.UTC(2026, 10, 20, 4, 0);
ok(periodLabel("today", NOW) === "11/20", "今天 11/20");
ok(periodLabel("week", NOW) === "11/16～11/20", "本週從週一 11/16 起");
ok(periodLabel("month", NOW) === "11/1～11/20", "本月從 1 號起");
ok(periodLabel("all", NOW) === "全部", "全部");
ok(periodLabel("today", Date.UTC(2026, 10, 19, 16, 30)) === "11/20", "UTC 11/19 16:30 已經是台北 11/20");
ok(periodLabel("week", Date.UTC(2026, 10, 16, 1, 0)) === "11/16", "週一當天只寫一天");

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
