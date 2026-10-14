// 房間關閉（整場打完或解散後刪房）：mj_room_closed／room_closed 事件、或 state／join 回 410 時的資料

export interface RoomClosedInfo {
  endReason?: "completed" | "dissolved";
  players: { seat: number; playerName: string; totalScore: number }[]; // 沒有紀錄時是空陣列
}

type RawPlayers = { seat?: unknown; playerName?: unknown; totalScore?: unknown }[] | undefined;

function toInfo(endReason: unknown, players: RawPlayers): RoomClosedInfo {
  return {
    endReason: endReason === "completed" || endReason === "dissolved" ? endReason : undefined,
    players: (players ?? [])
      .filter((p) => typeof p.seat === "number" && typeof p.totalScore === "number")
      .map((p) => ({ seat: p.seat as number, playerName: String(p.playerName ?? ""), totalScore: p.totalScore as number })),
  };
}

/** mj_room_closed／room_closed 的 payload */
export function closedFromEvent(payload: unknown): RoomClosedInfo {
  const p = (payload ?? {}) as { endReason?: unknown; players?: RawPlayers };
  return toInfo(p.endReason, p.players);
}

/** 410「這場已結束」的回應內容（record 可能沒有） */
export function closedFromResponse(body: unknown): RoomClosedInfo {
  const r = ((body ?? {}) as { record?: { endReason?: unknown; players?: RawPlayers } }).record;
  return toInfo(r?.endReason, r?.players);
}
