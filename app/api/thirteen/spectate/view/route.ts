// 十三支觀戰畫面：GET ?roomId=…&target=<playerId>（要被那位玩家同意，每次都重新檢查；收回、房間結束後下一次就拿不到）。
// 內容和不在桌上的人看到的一樣（flow.ts viewFor(s, null)）：亮牌前誰的手牌、三墩都沒有，只有「送出了沒」；亮牌後才有四家三墩。
// 同一位觀戰者、同一房每秒最多 10 次（同麻將），超過 429 rate_limited。只讀，不推進牌局（推進由玩家的讀取、tick 負責）
import { spectatorChannelName } from "@/lib/mahjong/access";
import { spectatorUser } from "@/lib/mahjong/spectate/server";
import { takeView, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs } from "@/lib/mahjong/spectate/store";
import { loadRoom } from "@/lib/thirteen/db";
import { clock, viewFor } from "@/lib/thirteen/flow";
import { fail, goneResponse, json, publicChannel } from "@/lib/thirteen/server";
import { startedThirteen } from "@/lib/thirteen/spectate";

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const roomId = q.get("roomId"), target = q.get("target");
    if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId) || !target) return fail(400, "bad_request");
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    const wait = takeView(roomId, user.id, nowMs());
    if (wait > 0) return fail(429, "rate_limited", undefined, { retryAfterMs: wait });
    const room = await loadRoom(roomId);
    if (!room) return goneResponse(roomId);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    const t = s.players.find((p) => p.id === target);
    const rows = await loadRoomSpectate(roomId);
    if (!t || !rows.some((r) => r.spectatorId === user.id && r.targetPlayerId === target && r.status === "approved")) return fail(403, "not_approved");
    return json({ roomId: room.id, code: room.code, status: room.status, sv: s.stateVersion,
      target: { playerId: t.id, name: t.name, seat: t.seat },
      spectatorCounts: viewerCounts(rows, s.players.map((p) => p.id)),
      channels: { public: publicChannel(room.code), spectator: spectatorChannelName(room.code, room.id, user.id) },
      ...viewFor(s, null, clock.now()) });
  } catch (err) {
    console.error("[th-spectate] view", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
