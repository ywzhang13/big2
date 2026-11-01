// 斗內後台：以場結清（老闆 2026-11-02）。只有老闆帳號能用。一場＝一間房；應給＝這場 11/1 00:00（台灣時間）之後的自摸次數 × NT$10。
//   GET：未結清的人 → { price, total, players: [{ userId, name, avatarUrl, matches, zimo, amount }] }（已打完的場次；金額多的在前，同額看最早的場次）
//   GET ?userId=：這個人的場次 → { price, unpaid: [場次], playing: [還在打的場次（不能結清）], paid: [最近 30 天結清的], totalDue }
//   POST { userId, roomIds: [...], amount? }：結清這幾場。amount＝實收（不給＝等於應給）；比應給多的算打賞，和應給記成同一筆斗內。
//     成功 → { batchId, due, amount, tip, rooms: [{ roomId, roomCode, zimo, due }] }
//     409 short { due, amount, shortBy }＝實收不夠；409 not_finished／already_settled／nothing_due（附 roomId）＝那場不能結清；整批都不生效
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { ZIMO_PRICE } from "@/lib/mahjong/zimoFx/rules";
import { lineProfile, lineProfiles, nowMs, settledMatches, settleMatches, unsettledMatches } from "@/lib/mahjong/zimoFx/store";
import { isUuid } from "@/lib/mahjong/spectate/rules";

const PAID_DAYS = 30;
const match = (m: { roomId: string; roomCode: string | null; startedAt: number | null; endedAt: number | null; zimo: number; due: number }) =>
  ({ roomId: m.roomId, roomCode: m.roomCode, startedAt: m.startedAt, endedAt: m.endedAt, zimo: m.zimo, due: m.due });

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const userId = new URL(request.url).searchParams.get("userId");
    if (userId !== null) {
      if (!isUuid(userId)) return fail(400, "bad_request");
      const [rows, paid] = await Promise.all([unsettledMatches(userId), settledMatches(userId, nowMs() - PAID_DAYS * 864e5)]);
      const byEnd = (a: { endedAt: number | null; startedAt: number | null }, b: typeof a) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0);
      const unpaid = rows.filter((r) => r.endedAt !== null).sort(byEnd).map(match);
      const playing = rows.filter((r) => r.endedAt === null).sort(byEnd).map(match);
      return ok({ price: ZIMO_PRICE, unpaid, playing, paid, totalDue: unpaid.reduce((a, r) => a + r.due, 0) });
    }
    const rows = (await unsettledMatches(null)).filter((r) => r.endedAt !== null);
    const per = new Map<string, { matches: number; zimo: number; amount: number; oldest: number }>();
    for (const r of rows) {
      const p = per.get(r.userId) ?? { matches: 0, zimo: 0, amount: 0, oldest: Infinity };
      p.matches++; p.zimo += r.zimo; p.amount += r.due; p.oldest = Math.min(p.oldest, r.endedAt!);
      per.set(r.userId, p);
    }
    const profiles = await lineProfiles([...per.keys()]);
    const players = [...per.entries()].filter(([u]) => profiles.has(u))
      .sort(([, a], [, b]) => b.amount - a.amount || a.oldest - b.oldest)
      .map(([u, p]) => ({ userId: u, ...profiles.get(u)!, matches: p.matches, zimo: p.zimo, amount: p.amount }));
    return ok({ price: ZIMO_PRICE, total: players.reduce((a, p) => a + p.amount, 0), players });
  } catch (err) {
    console.error("[mj-admin] settlements", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const roomIds = Array.isArray(b?.roomIds) ? b.roomIds : [];
    const amount = b?.amount ?? null;
    if (!b || !isUuid(b.userId) || roomIds.length < 1 || roomIds.length > 50 || !roomIds.every(isUuid)
      || (amount !== null && (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 999999))) return fail(400, "bad_request");
    const profile = await lineProfile(b.userId);
    if (!profile) return fail(400, "unknown_player");
    const r = await settleMatches(owner.id, { userId: b.userId, name: profile.name, avatarUrl: profile.avatarUrl, roomIds: roomIds as string[], amount: amount as number | null });
    if (!r.ok) {
      const { ok: _ok, error, ...extra } = r;
      return fail(error === "no_rooms" || error === "duplicate_room" || error === "bad_amount" ? 400 : 409, error, extra);
    }
    const { ok: _ok, ...body } = r;
    return ok(body);
  } catch (err) {
    console.error("[mj-admin] settle", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
