// 純函式：從房間現況組出一筆對局紀錄；不該記的情況回 null
import type { MahjongGameState } from "../mahjong/gameState";
import type { Card } from "../constants";
import { big2RoundScores } from "../scoring";
import type { EndReason, MatchRecordInput } from "./types";

/**
 * 麻將：只記「這次上線後開局、而且至少打完一局」的場次。
 * handsCompleted 只有新版開局才會有（上線前開局的房間沒有這個欄位 → 不補記）。
 */
export function buildMahjongRecord(
  roomId: string,
  roomCode: string,
  s: MahjongGameState,
  endReason: EndReason
): MatchRecordInput | null {
  if (s.handsCompleted === undefined || s.handsCompleted < 1) return null;
  const scores = s.playerScores ?? [0, 0, 0, 0];
  return {
    game: "mahjong",
    roomId,
    roomCode,
    startedAt: s.startedAt ?? null,
    endReason,
    totalRounds: s.roomSettings?.totalRounds ?? null,
    basePoints: s.roomSettings?.basePoints ?? null,
    fanPoints: s.roomSettings?.fanPoints ?? null,
    settings: {},
    handsPlayed: s.handsCompleted,
    players: s.players.map((p) => ({
      seat: p.seat,
      playerName: p.name,
      playerId: p.id,
      totalScore: scores[p.seat] ?? 0,
    })),
  };
}

export interface Big2RoomRow {
  id: string;
  code: string;
  status: string;
  created_at: string;
  records_enabled?: boolean; // 新版程式建房時寫 true；上線前建的房沒有／false → 不補記
  scores: Record<string, number> | null;
}
export interface Big2PlayerRow {
  player_id: string;
  name: string;
  seat: number;
  hand: Card[];
}

/**
 * 大老二：分數平常在「四家同意下一局」時才加進總分；房間停在剛打完（status=finished）時，
 * 把這一局也算進去。只記「新版程式建的房間」（records_enabled）而且至少打完一局。
 */
export function buildBig2Record(
  room: Big2RoomRow,
  players: Big2PlayerRow[],
  endReason: EndReason
): MatchRecordInput | null {
  if (room.records_enabled !== true) return null;
  const totals: Record<string, number> = { ...(room.scores ?? {}) };
  const playedBefore = Object.keys(totals).length > 0;
  const justFinished = room.status === "finished" && players.length === 4;
  if (!playedBefore && !justFinished) return null;
  if (justFinished) {
    const round = big2RoundScores(players);
    for (const p of players) totals[p.player_id] = (totals[p.player_id] ?? 0) + (round[p.player_id] ?? 0);
  }
  return {
    game: "big2",
    roomId: room.id,
    roomCode: room.code,
    startedAt: room.created_at,
    endReason,
    totalRounds: null,
    basePoints: null,
    fanPoints: null,
    settings: {},
    handsPlayed: null,
    players: [...players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, playerName: p.name, playerId: p.player_id, totalScore: totals[p.player_id] ?? 0 })),
  };
}
