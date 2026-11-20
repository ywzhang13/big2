// 測試用（老柯 2026-11-19 v4；2026-11-20 加 v5）：從資料庫讀這一房、這一局的牌型判斷規則，給測試裡的推薦排法用。
// v4 的房要帶這一局的彩金點數：沒帶的話，手上有彩金牌型時推薦出來的排法可能被伺服器判倒水（例如頭墩彩金衝三、中墩一般三條）。
import type { HandRule } from "../../lib/thirteen/hand";
import type { Card } from "../../lib/thirteen/cards";

type Db = { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> };
export async function ruleOf(db: Db, roomId: string): Promise<HandRule> {
  const r = (await db.query<{ rule: string | null; lucky: Card | null }>(
    `select game_state->'settings'->>'scoreRule' rule, game_state->'rest'->0 lucky from th_rooms where id = $1`, [roomId])).rows[0];
  return r?.rule === "v4" || r?.rule === "v5" ? { lucky: r.lucky?.rank ?? null } : "legacy"; // v5（2026-11-20 起新房）牌型同 v4
}
