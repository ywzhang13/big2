// 麻將回放：呼叫老柯的兩支 API（lib/mahjong/replay/API.md），把錯誤碼換成畫面狀態（小宜〈分階段設計補充〉第一階段狀態表）
import { mjFetch } from "@/lib/mahjong/clientAuth";
import type { ReplayResult, ReplayView } from "@/lib/mahjong/replay/log";

export interface ReplayHandSummary {
  handNo: number;
  round: number | null;
  game: number | null;
  wind: number;
  dealer: number;
  reason: ReplayResult["reason"];
  winners: { seat: number; from: number | null; selfDraw: boolean; totalFan: number }[];
  deltas: number[];
  steps: number;
  durationMs: number;
}

export interface ReplayList {
  matchId: string;
  roomCode: string;
  endedAt: string;
  expiresAt: string;
  mySeat: number;
  players: { seat: number; name: string }[];
  hands: ReplayHandSummary[];
}

export interface ReplayHand {
  expiresAt: string;
  mySeat: number;
  replay: ReplayView;
}

/** 畫面上要顯示的錯誤狀態 */
export type ReplayError = "not_logged_in" | "not_finished" | "not_player" | "expired" | "no_data" | "failed";

export type ReplayResultOf<T> = { ok: true; data: T } | { ok: false; error: ReplayError };

async function get<T>(path: string): Promise<ReplayResultOf<T>> {
  let res: Response;
  try {
    res = await mjFetch(path, { method: "GET" });
  } catch {
    return { ok: false, error: "failed" };
  }
  if (res.ok) {
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, error: "failed" };
    }
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) return { ok: false, error: "not_logged_in" };
  if (res.status === 410) return { ok: false, error: "expired" };
  if (res.status === 404) return { ok: false, error: "no_data" };
  if (res.status === 403) return { ok: false, error: body.error === "not_player" ? "not_player" : "not_finished" };
  return { ok: false, error: "failed" };
}

export const fetchReplayList = (matchId: string) =>
  get<ReplayList>(`/api/mahjong/replay?matchId=${encodeURIComponent(matchId)}`);

export const fetchReplayHand = (matchId: string, hand: number) =>
  get<ReplayHand>(`/api/mahjong/replay/hand?matchId=${encodeURIComponent(matchId)}&hand=${hand}`);

/** 錯誤狀態的文字（小宜定稿） */
export const ERROR_TEXT: Record<ReplayError, string> = {
  not_logged_in: "請重新登入後觀看回放",
  not_finished: "牌局結束後才能觀看回放。",
  not_player: "只有這場上桌的玩家可以觀看回放。",
  expired: "回放已過期。回放保留 7 天。",
  no_data: "這場沒有回放資料。",
  failed: "回放載入失敗，請再試一次。",
};
