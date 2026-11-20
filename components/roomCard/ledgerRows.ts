// 全部流水帳的畫面規則（小宜〈房卡 v1.2〉4-4；老柯〈房卡第二批 API〉第 1 節）：
//   一、伺服器扣卡是一把一筆；畫面上把「相鄰、同一個人、同一個遊戲、同一間房」的扣卡併成一列（點了展開每一把）
//   二、統計格的「期間」照台北時間寫成日期範圍
import type { LedgerAllEntry, LedgerPeriod } from "./client";

export type LedgerRowView =
  | { kind: "one"; e: LedgerAllEntry }
  | { kind: "group"; key: string; first: LedgerAllEntry; items: LedgerAllEntry[]; cards: number };

/** entries 是新到舊；併完仍是新到舊。group 的時間、餘額用最新那一把，cards 是合計，items 照把數由小到大 */
export function groupLedger(entries: LedgerAllEntry[]): LedgerRowView[] {
  const out: LedgerRowView[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    const head = last ? (last.kind === "one" ? last.e : last.first) : null;
    const same = !!head && e.kind === "charge" && head.kind === "charge" && head.userId === e.userId && head.game === e.game && head.roomCode === e.roomCode;
    if (!same) { out.push({ kind: "one", e }); continue; }
    if (last.kind === "one") out[out.length - 1] = { kind: "group", key: last.e.cursor, first: last.e, items: [last.e, e], cards: (last.e.cards ?? 0) + (e.cards ?? 0) };
    else { last.items.push(e); last.cards += e.cards ?? 0; }
  }
  for (const r of out) if (r.kind === "group") r.items.sort((a, b) => (a.handNo ?? 0) - (b.handNo ?? 0));
  return out;
}

/** 「期間」：今天 11/20；本週（週一起）11/17～11/20；本月 11/1～11/20；全部＝「全部」 */
export function periodLabel(period: LedgerPeriod, serverNow: number): string {
  if (period === "all") return "全部";
  const d = new Date(serverNow + 8 * 3600_000); // 台北
  const md = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
  if (period === "today") return md(d);
  const from = new Date(d);
  if (period === "week") from.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else from.setUTCDate(1);
  return md(from) === md(d) ? md(d) : `${md(from)}～${md(d)}`;
}
