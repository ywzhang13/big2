// 房卡後台的查詢：玩家名單（含統計格）、單一玩家明細和流水帳、全部流水帳（2026-11-20 第二批）。只有老闆帳號能用（路由先 requireOwner）。
import { isOwner, OWNER_USER_ID } from "@/lib/mahjong/zimoFx/rules";
import { isCursorTime } from "@/lib/records/cursorTime";
import { actorKind, periodStart, taipeiDayStart, type ActorKind, type CardGame, type FeedPeriod } from "./rules";
import { chargedSince, history, ledgerAll, lineUsers, nowMs, playerRows, type FeedCursor, type FeedKind, type LedgerRow, type LineUser, type PlayerRow } from "@/lib/roomCard/store";

export interface AdminPlayer {
  userId: string; shortId: string; name: string; avatarUrl: string | null;
  balance: number; suspended: boolean; suspendedAt: number | null;
  playing: { game: CardGame; code: string } | null; lastTopupAt: number | null; lastChargeAt: number | null;
}
function toPlayer(u: LineUser, r: PlayerRow | undefined): AdminPlayer {
  return { userId: u.userId, shortId: u.userId.slice(-4), name: u.name, avatarUrl: u.avatarUrl,
    balance: r?.balance ?? 0, suspended: !!r?.suspendedAt, suspendedAt: r?.suspendedAt ?? null,
    playing: r?.playing ?? null, lastTopupAt: r?.lastTopupAt ?? null, lastChargeAt: r?.lastChargeAt ?? null };
}

/** 所有 LINE 玩家（不含老闆、遊客；沒有房卡帳戶的人是 0 張），照餘額由少到多、同餘額照名字；加上統計格 */
export async function playerList(): Promise<{ serverNow: number; stats: { players: number; debtors: number; debtCards: number; suspended: number; chargedToday: number }; players: AdminPlayer[] }> {
  const now = nowMs();
  const [users, rows, chargedToday] = await Promise.all([lineUsers(), playerRows(), chargedSince(taipeiDayStart(now))]);
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const players = users.filter((u) => !isOwner(u.userId)).map((u) => toPlayer(u, byId.get(u.userId)))
    .sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name, "zh-Hant") || a.userId.localeCompare(b.userId));
  const debt = players.filter((p) => p.balance < 0);
  return { serverNow: now, players, stats: { players: players.length, debtors: debt.length, debtCards: -debt.reduce((s, p) => s + p.balance, 0),
    suspended: players.filter((p) => p.suspended).length, chargedToday } };
}

export type Entry =
  | { kind: "topup" | "reclaim"; at: number; cards: number; balanceAfter: number; actor: string }
  | { kind: "charge"; at: number; cards: number; balanceAfter: number; actor: string; game: CardGame; roomId: string; roomCode: string | null; hands: number[] }
  | { kind: "suspend" | "resume"; at: number; cards: null; balanceAfter: null; actor: string };

/** 一個人的流水帳：同一房的扣卡收成一筆（hands 是第幾把，cards 是合計），充值、回收、暫停、恢復各一筆；新的在前 */
export async function playerHistory(u: LineUser, limit = 500): Promise<{ player: AdminPlayer; entries: Entry[] }> {
  const [h, rows] = await Promise.all([history(u.userId, limit), playerRows()]);
  const entries: Entry[] = [];
  const rooms = new Map<string, Extract<Entry, { kind: "charge" }>>();
  for (const l of h.ledger as LedgerRow[]) { // 新的在前
    if (l.kind !== "charge") { entries.push({ kind: l.kind, at: l.at, cards: l.delta, balanceAfter: l.balanceAfter, actor: l.actor }); continue; }
    const key = `${l.game}:${l.roomId}`;
    const g = rooms.get(key);
    if (g) { g.cards += l.delta; g.hands.unshift(l.handNo!); continue; }
    const e = { kind: "charge" as const, at: l.at, cards: l.delta, balanceAfter: l.balanceAfter, actor: l.actor, game: l.game!, roomId: l.roomId!, roomCode: l.roomCode, hands: [l.handNo!] };
    rooms.set(key, e);
    entries.push(e);
  }
  for (const a of h.audit) entries.push({ kind: a.action, at: a.at, cards: null, balanceAfter: null, actor: a.actor });
  entries.sort((a, b) => b.at - a.at);
  return { player: toPlayer(u, rows.find((r) => r.userId === u.userId)), entries };
}

export interface FeedEntry {
  cursor: string; kind: FeedKind; at: number; userId: string; shortId: string; name: string; avatarUrl: string | null;
  cards: number | null; balanceAfter: number | null; game: CardGame | null; roomCode: string | null; handNo: number | null;
  actor: string; actorKind: ActorKind;
}
const encodeCursor = (r: { at: string; src: string; id: number }) => `${r.at}|${r.src}|${r.id}`;
/** 上一頁回傳的 nextCursor 解回來；格式不對回 undefined（路由回 400） */
// 恰好三段「時間|來源|編號」：時間要是真的存在的日期時間（isCursorTime），來源 l／a，編號是正整數；其他一律 undefined（400）
export function decodeCursor(raw: string | null): FeedCursor | null | undefined {
  if (raw === null || raw === "") return null;
  const parts = raw.split("|");
  if (parts.length !== 3) return undefined;
  const [at, src, id] = parts;
  if (!isCursorTime(at) || (src !== "l" && src !== "a") || !/^[1-9]\d{0,14}$/.test(id)) return undefined;
  return { at, src, id: Number(id) };
}

/**
 * 全部流水帳：所有玩家的充值、扣卡、回收、暫停、恢復，新到舊；可以只看一種、只看某段期間，keyset 分頁（nextCursor）。
 * 每一筆附玩家名稱和頭像；老闆帳號的資料不會出現（資料庫函式排除）。stats＝這段期間（不看種類）充值、扣卡、回收各幾張。
 */
export async function ledgerFeed(o: { kind: FeedKind | null; period: FeedPeriod; limit: number; cursor: FeedCursor | null }) {
  const now = nowMs();
  const [res, users] = await Promise.all([
    ledgerAll({ kind: o.kind, since: periodStart(o.period, now), limit: o.limit + 1, cursor: o.cursor, skip: OWNER_USER_ID }),
    lineUsers(),
  ]);
  const byId = new Map(users.map((u) => [u.userId, u]));
  const rows = res.entries.slice(0, o.limit);
  const entries: FeedEntry[] = rows.map((r) => {
    const u = byId.get(r.userId);
    return { cursor: encodeCursor(r), kind: r.kind, at: Date.parse(r.at), userId: r.userId, shortId: r.userId.slice(-4), name: u?.name ?? "（已刪除的帳號）",
      avatarUrl: u?.avatarUrl ?? null, cards: r.cards, balanceAfter: r.balanceAfter, game: r.game, roomCode: r.roomCode, handNo: r.handNo,
      actor: r.actor, actorKind: actorKind(r.actor, OWNER_USER_ID) };
  });
  const last = rows[rows.length - 1];
  return { serverNow: now, period: o.period, kind: o.kind, stats: res.stats, entries,
    nextCursor: res.entries.length > o.limit && last ? encodeCursor(last) : null };
}
