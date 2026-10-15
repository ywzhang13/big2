// 上線「麻將一律要登入」時，一次關掉上線前就有的麻將房：
// 那些房的座位沒有綁 LINE 帳號，上線後沒有人能再操作，留著只會卡在那裡。
// 打過牌的照現有的關房規則留紀錄（closeMahjongRow：打過至少一局記中途解散），沒打過的直接刪除。
// 由 scripts/close-legacy-mahjong-rooms.ts 在上線時執行：先列出來給人確認沒人在打，再執行。
import * as store from "@/lib/records/store";
import type { MahjongRoomRow } from "@/lib/records/store";
import { buildMahjongRecord } from "./build";
import { closeMahjongRow } from "./close";

/** 這段時間內有動作的房間，視為「可能有人在打」 */
export const ACTIVE_WITHIN_MS = 30 * 60 * 1000;

export interface LegacyRoom {
  row: MahjongRoomRow;
  idleMinutes: number;
  active: boolean;
  handsCompleted: number | null; // 打完幾局；上線前（f85aa16 以前）開局的牌局沒有這個欄位
  action: "record_completed" | "record_dissolved" | "delete";
}

/** 舊房＝beforeIso 之前建的、而且沒有任何座位綁帳號（新版程式建的房，入座的人一定有綁） */
export async function findLegacyMahjongRooms(beforeIso: string, nowMs = Date.now()): Promise<LegacyRoom[]> {
  const rows = await store.listMahjongRoomsCreatedBefore(beforeIso);
  return rows
    .filter((r) => r.mj_players.every((p) => !p.user_id))
    .map((row) => {
      const s = row.game_state;
      const idleMs = nowMs - Date.parse(row.updated_at);
      const willRecord = !!s?.players && buildMahjongRecord(row.id, row.code, s, "dissolved") !== null;
      return {
        row,
        idleMinutes: Math.floor(idleMs / 60000),
        active: idleMs < ACTIVE_WITHIN_MS,
        handsCompleted: s?.handsCompleted ?? null,
        action: !willRecord ? "delete" : s?.status === "finished" && s.gameOver ? "record_completed" : "record_dissolved",
      };
    });
}

const ACTION_TEXT: Record<LegacyRoom["action"], string> = {
  record_completed: "記紀錄（整場已打完）後刪除",
  record_dissolved: "記紀錄（中途解散）後刪除",
  delete: "直接刪除（沒打完任何一局，不留紀錄）",
};

/** 給上線的人看的清單：最上面先列「可能有人在打」的房 */
export function formatLegacyReport(rooms: LegacyRoom[]): string {
  const active = rooms.filter((r) => r.active);
  const line = (r: LegacyRoom) => {
    const names = [...r.row.mj_players].sort((a, b) => a.seat - b.seat).map((p) => p.name).join("、") || "（沒有人）";
    return `  房 ${r.row.code}｜${r.row.status}｜最後動作 ${r.idleMinutes} 分鐘前｜打完 ${r.handsCompleted ?? "-"} 局｜${names}｜→ ${ACTION_TEXT[r.action]}`;
  };
  return [
    `舊麻將房共 ${rooms.length} 間（座位都沒有綁 LINE 帳號）`,
    "",
    active.length > 0
      ? `⚠️ 可能有人在打（${ACTIVE_WITHIN_MS / 60000} 分鐘內有動作）：${active.length} 間`
      : `✅ 沒有 ${ACTIVE_WITHIN_MS / 60000} 分鐘內有動作的舊房`,
    ...active.map(line),
    "",
    "全部清單：",
    ...(rooms.length > 0 ? rooms.map(line) : ["  （沒有）"]),
  ].join("\n");
}

/**
 * 關掉清單裡的舊房。有「可能有人在打」的房時，沒加 force 就一間都不動。
 * 每間在刪除當下會再確認房間沒有新動作（row_version），有就跳過（留給閒置清理）。
 */
export async function closeLegacyMahjongRooms(
  rooms: LegacyRoom[],
  opts: { force?: boolean } = {}
): Promise<{ refused: boolean; closed: string[]; skipped: string[] }> {
  if (!opts.force && rooms.some((r) => r.active)) return { refused: true, closed: [], skipped: [] };
  const closed: string[] = [], skipped: string[] = [];
  for (const r of rooms) {
    if (await closeMahjongRow(r.row)) closed.push(r.row.code);
    else skipped.push(r.row.code);
  }
  return { refused: false, closed, skipped };
}
