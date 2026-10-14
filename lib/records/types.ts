// 對局總結算紀錄（只記整場總分，不記每局明細與手牌）

export type GameKind = "mahjong" | "big2";
export type EndReason = "completed" | "dissolved"; // 正常打完／中途解散

export interface MatchRecordPlayer {
  seat: number;
  playerName: string;
  playerId: string; // 原本的匿名玩家 id
  totalScore: number;
}

export interface MatchRecordInput {
  game: GameKind;
  roomId: string; // 同一間房只會有一筆紀錄（重送不會重複）
  roomCode: string;
  startedAt: string | null;
  endReason: EndReason;
  totalRounds: number | null; // 麻將圈數；大老二沒有
  basePoints: number | null; // 麻將底
  fanPoints: number | null; // 麻將每台
  settings: Record<string, unknown>; // 各遊戲自己的設定（大老二目前沒有）
  handsPlayed: number | null; // 打完幾局（大老二無法精確算，填 null）
  players: MatchRecordPlayer[];
}

/** 結束後回給前端的摘要（不含玩家 id，避免外洩身分） */
export interface MatchRecordSummary {
  game: GameKind;
  roomCode: string;
  endReason: EndReason;
  endedAt: string;
  players: { seat: number; playerName: string; totalScore: number }[];
}

/** 等待中閒置多久清掉、進行中閒置多久清掉 */
export const IDLE_WAITING_MS = 2 * 60 * 60 * 1000;
export const IDLE_ACTIVE_MS = 12 * 60 * 60 * 1000;
