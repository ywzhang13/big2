// 十三支路由共用（只在伺服器）：房間鎖＋樂觀鎖重試、頻道、廣播、座位檢查、「推進牌局→存檔→廣播→整場結束就關房」。
// 沿用麻將的工具，不另寫一套（阿妍〈十三支-可重用架構地圖〉①）：
//   ・房間鎖 withRoomLock（lib/mahjong/cache.ts）：鍵是房間 uuid，和麻將房不會撞
//   ・廣播 mjBroadcastBatch（lib/mahjong/broadcast.ts）：每個事件都明確指定十三支自己的頻道（th-房號、座位頻道），
//     不走麻將的 mj- 頻道（房號都是 4 碼，會和麻將房撞名）；帶 sv（存檔版本），前端照麻將的 SyncPolicy 跳號補抓
//   ・登入 getAuthUser（lib/auth.ts）
import { createHmac } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { withRoomLock } from "@/lib/mahjong/cache";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { SPECTATORS, spectatorChannelName } from "@/lib/mahjong/access";
import type { Member } from "@/lib/mahjong/effects/members";
import type { ChatMessage } from "@/lib/social/events";
import { deleteRoomSpectate } from "@/lib/mahjong/spectate/store";
import { IDLE_ACTIVE_MS, IDLE_WAITING_MS } from "@/lib/records/types";
import { deleteThirteenChat } from "./chat";
import { buildThirteenRecord, closeThirteen, findThirteenRecord, listIdleThirteenRooms, loadPlayers, loadRoom, saveGameStateIfUnchanged, StateConflictError,
  type CloseResult, type ThirteenGameState, type ThRoom } from "./db";
import { advance, cancelIfDenied, clock, evaluateLeave, luckyCardOf, revealPayload, isOver } from "./flow";

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const fail = (status: number, error: string, message?: string, extra: Record<string, unknown> = {}) => json({ error, ...(message ? { message } : {}), ...extra }, status);

/** 公開頻道：房裡每個人（含觀戰）都收得到，只放不洩漏手牌的事件 */
export const publicChannel = (code: string) => `th-${code}`;
/**
 * 座位專屬頻道：用伺服器金鑰算出名稱，只有伺服器和本人（入座時拿到）知道；手牌只送這裡。
 * 綁「這一場」（房間 uuid，房號會被重用、uuid 不會）和「座位主人帳號」：房號、playerId 被下一場重用時頻道也不同，
 * 舊場的人收不到新場的手牌；同一個帳號重連算出來的還是同一個（審伯 2026-11-16 必修 1）
 */
export function privateChannel(roomId: string, code: string, playerId: string, userId: string | null): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定，無法建立座位專屬頻道");
  const h = createHmac("sha256", key).update(`th-private:${roomId}:${userId ?? ""}:${playerId}`).digest("base64url").slice(0, 32);
  return `th-${code}-p-${h}`;
}

type Ev = { event: string; payload: Record<string, unknown>; to?: { playerId: string; userId: string | null } }; // to：送到那個座位頻道
export async function send(room: Pick<ThRoom, "id" | "code">, events: Ev[], sv?: number): Promise<void> {
  if (events.length === 0) return;
  try {
    await mjBroadcastBatch(room.code, events.map((e) => ({ event: e.event, payload: e.payload,
      channel: e.to ? privateChannel(room.id, room.code, e.to.playerId, e.to.userId) : publicChannel(room.code) })), sv);
  } catch (err) {
    console.error("[th-broadcast] 送出失敗（前端保底輪詢會補上）：", err instanceof Error ? err.message : err);
  }
}

/** 登入的人是不是這個座位的主人：401 沒登入、403 不是本人；是本人回 null */
export async function seatOwnerError(request: Request, s: ThirteenGameState, playerId: unknown): Promise<Response | null> {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const p = typeof playerId === "string" ? s.players.find((x) => x.id === playerId) : undefined;
  if (!p || !p.userId || p.userId !== user.id) return fail(403, "not_your_seat");
  return null;
}

/** 房間已經關掉：有紀錄回 410（附總結算），沒有回 404 */
export async function goneResponse(roomId: string): Promise<Response> {
  const rec = await findThirteenRecord(roomId);
  return rec ? json({ error: "ended", record: rec }, 410) : fail(404, "room_not_found");
}

/**
 * 在房間鎖裡「讀 → 處理 → 條件寫入」；寫入時有人先寫了（StateConflictError）就重讀重做，最多 5 次。
 * 和麻將 retryOnConflict 一樣，只是讀的是十三支的房間、抓的是十三支的 StateConflictError。
 */
export async function withRoom(roomId: unknown, handler: (room: ThRoom & { game_state: ThirteenGameState }) => Promise<Response>): Promise<Response> {
  if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId)) return fail(400, "bad_request");
  try {
    return await withRoomLock(roomId, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const room = await loadRoom(roomId);
        if (!room || !room.game_state) return goneResponse(roomId);
        try {
          return await handler(room as ThRoom & { game_state: ThirteenGameState });
        } catch (err) {
          if (err instanceof StateConflictError) continue;
          throw err;
        }
      }
      return fail(409, "busy", "同時有太多動作，請再試一次");
    });
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}

/**
 * 存檔並廣播這次的變化；整場打完就寫紀錄、關房（版本對不上代表有人剛存了新的，留給下一個請求再關）。
 * extra：路由自己的事件（例如「某家送出了」）。回傳存好的版本號。
 */
export async function saveAndAnnounce(room: ThRoom, s: ThirteenGameState, baseVersion: number,
  happened: { autoSeats: number[]; revealed: boolean; nextStarted: boolean }, extra: Ev[] = [], status?: ThRoom["status"]): Promise<number> {
  const sv = await saveGameStateIfUnchanged(room.id, baseVersion, s, status);
  const events: Ev[] = [...extra];
  if (happened.autoSeats.length) events.push({ event: "th_auto_arranged", payload: { seats: happened.autoSeats } });
  if (happened.revealed) events.push({ event: "th_reveal", payload: revealPayload(s) });
  if (happened.nextStarted) events.push(...dealEvents(s));
  await send(room, events, sv);
  if (isOver(s)) await finishMatch(room, s, sv, "completed");
  return sv;
}

/** 開新的一局：公開頻道只說第幾局和截止時間；每家的 13 張只送到自己的座位頻道 */
export function dealEvents(s: ThirteenGameState): Ev[] {
  return [
    { event: "th_hand_start", payload: { handNo: s.handNo, arrangeDeadline: s.arrangeDeadline, serverNow: clock.now(), luckyCard: luckyCardOf(s) } },
    ...s.players.map((p) => ({ event: "th_deal_hand", payload: { playerId: p.id, handNo: s.handNo, hand: p.hand }, to: { playerId: p.id, userId: p.userId } })),
  ];
}

/** 寫紀錄＋關房（整場打完、或解散）；成功就廣播房間關了和總結算 */
export async function finishMatch(room: ThRoom, s: ThirteenGameState, sv: number, endReason: "completed" | "dissolved", before: Ev[] = []): Promise<string> {
  const rec = buildThirteenRecord(room.id, room.code, s, endReason);
  // 審伯 2026-11-16 必修 4：最後亮的那一局（四家三墩、翻牌順序、結算）跟著紀錄存下來，關房後漏收廣播、重新整理還補得回來。
  // 只有已經亮牌的牌（52 張發出去的），沒發出去的 13 張不在裡面；紀錄只寫一次（close_room_with_record 重送不會重寫）
  if (rec && s.phase === "revealed") rec.settings = { ...rec.settings, finalHand: revealPayload(s) };
  const r = await closeThirteen(room.id, rec, sv);
  if (r === "closed") await afterClosed(room, endReason, rec, before);
  return r;
}

/**
 * 房間剛關掉之後：清這房的聊天紀錄和觀戰申請／同意（和麻將關房一樣只保存在這一場），再廣播房間關了。
 * 清除失敗只記 log（房間已經關了；聊天孤兒由 mj_chat_append 清，觀戰列由 mj_spectate_request／麻將關房清舊的）
 */
async function afterClosed(room: Pick<ThRoom, "id" | "code">, endReason: "completed" | "dissolved",
  rec: ReturnType<typeof buildThirteenRecord>, before: Ev[] = []): Promise<void> {
  for (const [what, fn] of [["聊天", deleteThirteenChat], ["觀戰", deleteRoomSpectate]] as const) {
    try { await fn(room.id); } catch (err) { console.error(`[th-close] 房 ${room.id} 刪除${what}資料失敗：`, err instanceof Error ? err.message : err); }
  }
  await send(room, [...before, { event: "th_room_closed", payload: { endReason, recorded: !!rec,
    players: (rec?.players ?? []).map((p) => ({ seat: p.seat, playerName: p.playerName, totalScore: p.totalScore })),
    stats: (rec?.settings as { stats?: unknown } | undefined)?.stats ?? null } }]); // 整場累計（總結算畫面用）
}

/** 等人階段最後一個人離開、房間已由 th_lobby_leave 刪掉之後：清聊天和觀戰資料、通知（一局都沒打，沒有紀錄） */
export const emptyLobbyClosed = (room: Pick<ThRoom, "id" | "code">) => afterClosed(room, "dissolved", null);

/**
 * 閒置清除的一間（規則同麻將 lib/records/close.ts closeMahjongRow）：整場已打完記 completed、打過至少一局記 dissolved、一局都沒打完直接刪。
 * 用選中時的 row_version 關：選中之後有任何寫入（有人送出、入座後開局、投票…）就不關（回 changed），進行中的房不會被刪
 */
export async function closeIdleRoom(r: ThRoom & { row_version: number }): Promise<CloseResult> {
  const s = r.game_state;
  const reason = s && isOver(s) ? "completed" : "dissolved";
  const rec = s ? buildThirteenRecord(r.id, r.code, s, reason) : null;
  if (rec && s?.phase === "revealed") rec.settings = { ...rec.settings, finalHand: revealPayload(s) };
  const res = await closeThirteen(r.id, rec, null, r.row_version);
  if (res === "closed") await afterClosed(r, reason, rec);
  return res;
}

/** 清閒置房（開房時在回應送出後順便跑，同麻將）：等人中超過 2 小時、開局後超過 12 小時沒有任何寫入。回傳關掉幾間 */
export async function sweepIdleThirteenRooms(nowMs = Date.now(), limit = 10): Promise<number> {
  let n = 0;
  try {
    const rows = await listIdleThirteenRooms(new Date(nowMs - IDLE_WAITING_MS).toISOString(), new Date(nowMs - IDLE_ACTIVE_MS).toISOString(), limit);
    for (const r of rows) if ((await closeIdleRoom(r)) === "closed") n++;
  } catch (err) {
    console.error("[th-sweep] 清理十三支閒置房失敗：", err instanceof Error ? err.message : err);
  }
  return n;
}

/** 解散投票已經成立（沒閒置的人都同意了；票已經存檔，判定只看存好的票和伺服器時間） */
export const leaveGranted = (s: ThirteenGameState) => evaluateLeave(s, clock.now())?.result === "granted";

/**
 * 讀狀態、送出、下一局之前都先推進一次牌局（截止代排、亮牌、時間到開下一局）；有變化就存檔並廣播。
 * 該關房卻還沒關（整場打完、或解散投票已經成立——包括投完票之後有人超過 3 分鐘沒動作、變成不計票）就先關：
 * closed＝這次把房間關掉了，呼叫端回 410。
 */
export async function advanceAndSave(room: ThRoom & { game_state: ThirteenGameState }): Promise<{ s: ThirteenGameState; sv: number; closed: boolean }> {
  const s = room.game_state;
  const base = s.stateVersion;
  const pending = leaveGranted(s) ? "dissolved" : isOver(s) ? "completed" : null;
  if (pending) {
    const r = await finishMatch(room, s, base, pending, pending === "dissolved" ? [{ event: "th_leave_vote", payload: { result: "granted" } }] : []);
    if (r === "changed") throw new StateConflictError();
    return { s, sv: base, closed: true };
  }
  const leaveCancelled = cancelIfDenied(s, clock.now()); // 保險：投票若已被否決（有人恢復投票權）就取消，不讓它卡著
  const happened = advance(s, clock.now());
  if (!leaveCancelled && !happened.autoSeats.length && !happened.revealed && !happened.nextStarted) return { s, sv: base, closed: false };
  const sv = await saveAndAnnounce(room, s, base, happened, leaveCancelled ? [{ event: "th_leave_vote", payload: { result: "denied" } }] : []);
  return { s, sv, closed: false };
}

/** 聊天用：這房和同桌的人（開局後以牌局狀態的座位為準，開局前用 th_players）；房間不在回 404 */
export async function chatMembers(roomId: unknown): Promise<(Pick<ThRoom, "id" | "code"> & { members: Member[] }) | Response> {
  if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId)) return fail(400, "bad_request");
  const room = await loadRoom(roomId);
  if (!room) return fail(404, "room_not_found");
  const gs = room.game_state;
  const members: Member[] = gs?.players?.length
    ? gs.players.map((p) => ({ playerId: p.id, name: p.name, seat: p.seat, userId: p.userId }))
    : (await loadPlayers(roomId)).map((p) => ({ playerId: p.player_id, name: p.name, seat: p.seat, userId: p.user_id }));
  return { id: room.id, code: room.code, members };
}

/** 一則聊天送給同桌四人各自的十三支座位頻道＋每位已同意觀戰者自己的觀戰頻道（事件名稱、格式和麻將一樣：mj_chat） */
export async function sendChat(room: Pick<ThRoom, "id" | "code"> & { members: Member[] }, spectators: string[], message: ChatMessage): Promise<void> {
  try {
    await mjBroadcastBatch(room.code, [
      ...room.members.map((m) => ({ event: "mj_chat", payload: { playerId: m.playerId, message }, channel: privateChannel(room.id, room.code, m.playerId, m.userId) })),
      ...spectators.map((u) => ({ event: "mj_chat", payload: { playerId: SPECTATORS, message }, channel: spectatorChannelName(room.code, room.id, u) })),
    ]);
  } catch (err) {
    console.error("[th-chat] 廣播失敗（歷史紀錄已存，重新整理補得回來）：", err instanceof Error ? err.message : err);
  }
}
