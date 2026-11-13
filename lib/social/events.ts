// 三個遊戲（麻將、大老二、十三支）共用的聊天與互動事件格式（老闆 2026-11-13：聊天、互動拉成共用）。
// 目前只有麻將接上；之後其他遊戲照同一份格式送，前端聊天框、互動特效元件就能共用。說明見 lib/social/README.md。
// 這裡只放型別和事件名稱，不放任何遊戲的規則或資料庫存取。

/** 即時事件名稱（Realtime broadcast 的 event） */
export const SOCIAL_EVENTS = {
  chat: "mj_chat",     // 一則聊天（文字、快捷短語、語音）；麻將沿用既有名稱，其他遊戲接上時用同一個 payload 格式
  effect: "mj_effect", // 一次互動特效（愛心、砸錢、拍手、雞蛋、潑水、拳擊）
} as const;

/** 一則聊天訊息（即時事件、歷史 API 都是這個格式） */
export interface ChatMessage {
  id: string;                 // 伺服器產生的 uuid，前端用來去重（即時事件和歷史可能各收到一次）
  kind: "text" | "voice";
  from: string;               // 發送者在這一桌的 playerId（伺服器依登入帳號認定，不信任前端）
  fromName: string;
  fromSeat: number;           // 座位 0～3
  text?: string;              // 文字；快捷短語也放這裡，另外帶 phrase
  phrase?: string;            // 快捷短語代號（nice、wait、hurry、thanks）
  url?: string | null;        // 語音：播放網址（有效期限有限；歷史 API 每次重新簽發，檔案已清掉時是 null）
  durationMs?: number;        // 語音長度
  ts: number;                 // 伺服器時間（毫秒）
}

/** 一次互動特效 */
export interface EffectEvent {
  id: string;
  effect: string;             // heart、money、egg、water、punch、clap
  from: string; fromName: string; fromSeat: number;
  to: string; toName: string; toSeat: number;
  ts: number;
}

/** 即時事件的 payload：
 *  ・送到座位頻道時 playerId＝收件的座位（前端可以忽略）
 *  ・送到觀戰頻道（每位已同意觀戰者各自一個）時 playerId＝"*spectators" */
export type ChatEventPayload = { playerId: string; message: ChatMessage };
export type EffectEventPayload = { playerId: string; effect: EffectEvent };
