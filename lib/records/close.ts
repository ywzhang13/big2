// 一場結束（打完、解散、閒置）→ 在同一個資料庫交易裡寫對局紀錄＋刪房（close_room_with_record）。
// 寫紀錄失敗：房間和紀錄都維持原狀、不丟錯誤給呼叫端（遊戲不會卡住），之後建房時的清理會再試一次。
import * as store from "@/lib/records/store";
import type { CloseExpect } from "@/lib/records/store";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { broadcast as big2Broadcast } from "@/lib/broadcast";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { buildBig2Record, buildMahjongRecord, type Big2PlayerRow, type Big2RoomRow } from "./build";
import { IDLE_ACTIVE_MS, IDLE_WAITING_MS, type EndReason, type GameKind, type MatchRecordInput } from "./types";

/** 房間關閉時送給前端的內容（mj_room_closed／room_closed 共用；不含玩家 id） */
function closedPayload(endReason: EndReason, rec: MatchRecordInput | null) {
  return {
    endReason,
    recorded: !!rec,
    players: (rec?.players ?? []).map((p) => ({ seat: p.seat, playerName: p.playerName, totalScore: p.totalScore })),
  };
}

/**
 * 寫紀錄（rec 為 null 表示這場不用記）＋刪房，一次完成。
 * 回傳 true＝這次真的關掉了；false＝沒關（房間有新動作、已經被別人關掉、或資料庫錯誤）。
 */
async function closeAtomically(game: GameKind, roomId: string, rec: MatchRecordInput | null, expect: CloseExpect): Promise<boolean> {
  try {
    const result = await store.closeRoom(game, roomId, rec, expect);
    if (result !== "closed") console.info(`[records] ${game} 房 ${roomId} 沒有關閉：${result}`);
    return result === "closed";
  } catch (err) {
    console.error(`[records] 關閉 ${game} 房 ${roomId} 失敗，房間和紀錄都沒變：`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 麻將：結束這場（打完或解散）。一局都沒打完、或是上線前就開局的房間 → 不記，直接刪。
 * expect 預設用牌局狀態的版本號：剛存檔完的版本；如果之後又有人動過這間房，就不關。
 * 關房成功後廣播 mj_room_closed（最終結算畫面照常顯示，前端可以提示「這場已結束」）。
 */
export async function closeMahjongRoom(
  roomId: string,
  roomCode: string,
  s: MahjongGameState,
  endReason: EndReason,
  expect: CloseExpect = { stateVersion: s.stateVersion }
): Promise<boolean> {
  const rec = buildMahjongRecord(roomId, roomCode, s, endReason);
  const closed = await closeAtomically("mahjong", roomId, rec, expect);
  if (closed) {
    try {
      await mjBroadcastBatch(roomCode, [{ event: "mj_room_closed", payload: closedPayload(endReason, rec) }]);
    } catch {
      // 廣播失敗不影響：房間已關，重新整理會拿到「這場已結束」
    }
  }
  return closed;
}

/** 麻將：這局結算後如果整場打完了，就記成 completed 並關房 */
export async function closeMahjongIfOver(roomId: string, roomCode: string, s: MahjongGameState): Promise<void> {
  if (s.status === "finished" && s.gameOver) {
    await closeMahjongRoom(roomId, roomCode, s, "completed");
  }
}

/** 大老二：結束這場（目前只有閒置清除會走到）。expect 用選中時的 row_version */
export async function closeBig2Room(
  room: Big2RoomRow,
  players: Big2PlayerRow[],
  endReason: EndReason,
  expect: CloseExpect
): Promise<boolean> {
  const rec = buildBig2Record(room, players, endReason);
  const closed = await closeAtomically("big2", room.id, rec, expect);
  if (closed) {
    try {
      await big2Broadcast(room.code, "room_closed", closedPayload(endReason, rec));
    } catch {
      // 同上
    }
  }
  return closed;
}

/**
 * 建房時順便清：等待中閒置超過 2 小時、進行中閒置超過 12 小時的房間。
 * 打過至少一局的先記成 dissolved 再刪；一局都沒打完的直接刪。
 * 刪除當下會再確認 row_version 和選中時一樣（中間有人動過就不刪也不記）。每次最多處理 limit 間。
 */
export async function sweepIdleRooms(nowMs = Date.now(), limit = 10): Promise<{ mahjong: number; big2: number }> {
  const waitingBefore = new Date(nowMs - IDLE_WAITING_MS).toISOString();
  const activeBefore = new Date(nowMs - IDLE_ACTIVE_MS).toISOString();
  const done = { mahjong: 0, big2: 0 };
  try {
    for (const r of await store.listIdleMahjongRooms(waitingBefore, activeBefore, limit)) {
      const s = r.game_state;
      const expect = { rowVersion: r.row_version };
      // 整場已打完（之前關房失敗）記 completed，其餘閒置的記 dissolved
      const reason: EndReason = s?.status === "finished" && s.gameOver ? "completed" : "dissolved";
      const ok = s?.players
        ? await closeMahjongRoom(r.id, r.code, s, reason, expect)
        : await closeAtomically("mahjong", r.id, null, expect); // 還在大廳、沒有牌局
      if (ok) done.mahjong++;
    }
  } catch (err) {
    console.error("[records] 清理麻將閒置房失敗：", err instanceof Error ? err.message : err);
  }
  try {
    for (const { room, players } of await store.listIdleBig2Rooms(waitingBefore, activeBefore, limit)) {
      if (await closeBig2Room(room, players, "dissolved", { rowVersion: room.row_version })) done.big2++;
    }
  } catch (err) {
    console.error("[records] 清理大老二閒置房失敗：", err instanceof Error ? err.message : err);
  }
  return done;
}

/** 房間已刪除時（重新整理、晚到的請求）：查這場的紀錄，給前端顯示「這場已結束」 */
export async function endedResponse(
  game: GameKind,
  by: { roomId: string } | { code: string }
): Promise<Response | null> {
  try {
    const record =
      "roomId" in by
        ? await store.findRecordByRoomId(game, by.roomId)
        : await store.findRecentRecordByCode(game, by.code, new Date(Date.now() - IDLE_ACTIVE_MS).toISOString());
    if (!record) return null;
    return Response.json({ error: "這場已結束", ended: true, record }, { status: 410 });
  } catch {
    return null; // 查不到紀錄就照原本的 404
  }
}
