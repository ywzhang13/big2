// 麻將一律要 LINE 登入，存取控制：
//   1. 每個動作確認「送請求的登入使用者」就是 playerId 那個座位的主人
//   2. 只給本人的事件（手牌、摸到的牌、可以吃碰槓胡）改走每個座位專屬的頻道，不在房間公開頻道廣播
// 上線前就有的房間（座位沒有綁帳號）沒人能操作，上線時用 scripts/close-legacy-mahjong-rooms.ts 一次關掉。
import { createHmac } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import type { MahjongGameState } from "./gameState";

export const notLoggedIn = () => Response.json({ error: "not_logged_in" }, { status: 401 });
export const notYourSeat = () => Response.json({ error: "not_your_seat" }, { status: 403 });

/**
 * 確認請求的人是 playerId 這個座位的主人；沒登入 401、不是本人（含座位沒綁帳號的舊房）403；是本人 → null。
 * owner：開局前（還沒有牌局狀態）由呼叫端從 mj_players 查好傳進來；開局後從牌局狀態的座位讀。
 */
export async function seatOwnerError(
  request: Request,
  gs: Partial<Pick<MahjongGameState, "players">> | null | undefined,
  playerId: string,
  owner?: string | null
): Promise<Response | null> {
  const user = await getAuthUser(request);
  if (!user) return notLoggedIn();
  const bound = owner !== undefined ? owner : gs?.players?.find((p) => p.id === playerId)?.userId;
  if (!bound || bound !== user.id) return notYourSeat();
  return null;
}

// ---------------------------------------------------------------------------
// 廣播頻道
// ---------------------------------------------------------------------------

/** 只給 payload.playerId 那個人看的事件。mj_effect（互動特效）、mj_chat（聊天、語音）也走座位頻道：同桌每人各送一份，外人收不到。
 *  mj_spectate_request：有人申請觀戰，只通知被申請的那位（帶申請者的 LINE 本名、頭像） */
export const PRIVATE_EVENTS = new Set(["mj_deal_hand", "mj_draw_tile", "mj_hand_update", "mj_available_actions", "mj_opponent_hands", "mj_effect", "mj_chat", "mj_spectate_request"]);

/**
 * 座位專屬頻道名稱：用伺服器金鑰做 HMAC，只有伺服器算得出來，
 * 只透過「本人」的 join／state 回應告訴前端；知道房號或別人的玩家 id 也猜不到。
 */
export function privateChannelName(roomCode: string, playerId: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定，無法建立座位專屬頻道");
  const h = createHmac("sha256", key).update(`mj-private:${roomCode}:${playerId}`).digest("base64url").slice(0, 32);
  return `mj-${roomCode}-p-${h}`;
}

/** 送到觀戰頻道的事件，payload.playerId 都是這個（前端可以忽略） */
export const SPECTATORS = "*spectators";

/**
 * 觀戰頻道名稱：每位「已同意觀戰」的人各一個，綁這一場（房間 id）＋觀戰者帳號，用伺服器金鑰做 HMAC。
 * 只透過讀聊天紀錄 API 告訴本人（審伯 2026-11-13 必修 1、5）：
 *   ・綁房間 id：房號重用開新場，名稱就不同，舊觀戰者收不到新場
 *   ・每人一個：Realtime 的廣播頻道用公開金鑰也能發，觀戰者頂多能對「自己的」頻道發假訊息，騙不到別人
 *   ・同意被收回後，伺服器下一則就不再送到他的頻道
 * 觀戰者在這裡只收聊天和互動特效（牌局狀態照舊走觀戰 API）。
 */
export function spectatorChannelName(roomCode: string, roomId: string, userId: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定，無法建立觀戰頻道");
  const h = createHmac("sha256", key).update(`mj-spectator:${roomId}:${userId}`).digest("base64url").slice(0, 32);
  return `mj-${roomCode}-s-${h}`;
}

/** 每個事件的 payload 加上這次存檔後的牌局版本號 sv（沒給就原樣）。
 *  前端記住看過的最大版本，跳號＝中間漏了事件，立刻補抓一次狀態（lib/mahjong/syncPolicy.ts；老馬 2026-11-01） */
export function withVersion<T extends { event: string; payload: Record<string, unknown> }>(events: T[], sv?: number): T[] {
  return sv === undefined ? events : events.map((e) => ({ ...e, payload: { ...e.payload, sv } }));
}

/** 每個事件要送到哪個頻道：私人事件送到本人頻道，其他都送房間公開頻道 */
export function routeEvents(
  roomCode: string,
  events: { event: string; payload: Record<string, unknown>; channel?: string }[]
): { channel: string; event: string; payload: Record<string, unknown> }[] {
  return events.map(({ event, payload, channel }) => {
    if (channel) return { channel, event, payload }; // 呼叫端已經指定頻道（觀戰者各自的頻道）
    const pid = payload.playerId;
    const isPrivate = PRIVATE_EVENTS.has(event);
    if (isPrivate && typeof pid !== "string") throw new Error(`私人事件 ${event} 缺少 playerId`);
    return {
      channel: isPrivate ? privateChannelName(roomCode, pid as string) : `mj-${roomCode}`,
      event,
      payload,
    };
  });
}
