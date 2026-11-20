// 三款共用的「我的歷史紀錄」查詢（老柯 2026-11-20；規劃 v1 第 3 節）。函式 my_matches 在 20261120_match_history.sql。
// 只查「登入的人有入座」的場次；不回房卡（老闆決定紀錄不顯示每局扣幾張）、不回帳號 id。
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type HistoryGame = "all" | "mahjong" | "thirteen" | "big2";
export const HISTORY_GAMES: readonly HistoryGame[] = ["all", "mahjong", "thirteen", "big2"];
export const isHistoryGame = (x: unknown): x is HistoryGame => (HISTORY_GAMES as readonly unknown[]).includes(x);

export interface HistoryItem {
  id: string; game: "mahjong" | "thirteen" | "big2"; roomCode: string; endedAt: string; endReason: "completed" | "dissolved";
  totalRounds: number | null; totalHands: number | null; handsPlayed: number | null; myScore: number;
  players: { seat: number; playerName: string; totalScore: number; isMe: boolean }[];
}
export interface HistoryPage {
  items: HistoryItem[];
  counts: Record<HistoryGame, number>;
  summary: { matches: number; totalScore: number | null };
}

export async function myMatchHistory(userId: string, game: HistoryGame, limit: number, cursor: { endedAt: string; id: string } | null): Promise<HistoryPage> {
  const { data, error } = await getSupabaseAdmin().rpc("my_matches", {
    p_user_id: userId, p_game: game, p_limit: limit, p_cursor_ended_at: cursor?.endedAt ?? null, p_cursor_id: cursor?.id ?? null,
  });
  if (error) throw new Error(`查詢歷史紀錄失敗：${error.message}`);
  return data as HistoryPage;
}
