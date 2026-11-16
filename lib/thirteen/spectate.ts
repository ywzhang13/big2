// 十三支觀戰（只在伺服器）：申請、同意、收回的規則和資料表都沿用麻將（lib/mahjong/spectate：mj_spectate 表、30 秒有效、30 秒冷卻、
// 同意到房間結束、可以隨時收回；房間 id 是 uuid，十三支和麻將的列不會撞）。十三支和麻將不同的地方：
//   ・觀戰畫面亮牌前誰的牌都看不到（連同意他的那位玩家的手牌也看不到），只看得到「送出了沒」；亮牌後才看得到四家三墩
//   ・申請通知只送到被申請那位玩家的座位頻道（th_spectate_request），人數變化送公開頻道（th_spectators）
//   ・同意後能讀聊天、收聊天（觀戰頻道），不能發言（/api/thirteen/chat 回 403 not_in_room）
import { loadPlayers, type ThirteenGameState, type ThRoom } from "./db";
import { isOver } from "./flow";
import { fail } from "./server";

/** 房間要存在、已開局、整場還沒打完 */
export function startedThirteen(room: ThRoom | null): ThirteenGameState | Response {
  if (!room) return fail(404, "room_not_found");
  const s = room.game_state;
  if (!s || room.status === "waiting" || s.players?.length !== 4) return fail(409, "not_started");
  if (isOver(s)) return fail(410, "room_ended");
  return s;
}

/** 這個帳號在這桌有沒有座位（牌局座位或 th_players 任一個綁著他就算）：自己這桌不能申請觀戰 */
export async function atThirteenTable(roomId: string, s: ThirteenGameState, userId: string): Promise<boolean> {
  if (s.players.some((p) => p.userId === userId)) return true;
  return (await loadPlayers(roomId)).some((p) => p.user_id === userId);
}
