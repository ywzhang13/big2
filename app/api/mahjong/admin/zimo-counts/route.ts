// 斗內後台：自摸次數清單。GET → { price, players: [...] }。只有老闆帳號能用。
//   每人：帳號 id（只給老闆）、帳號後四碼、LINE 名稱和頭像、目前次數、應斗金額（次數 × NT$10）、上次歸零的時間／方式（donation＝記一筆、clear＝手動清除）／清掉幾次。
//   有自摸紀錄、或曾經被歸零過的 LINE 帳號；不含遊客。一次回全部，排序和搜尋由前端做。
import { fail, ok, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { ZIMO_PRICE } from "@/lib/mahjong/zimoFx/rules";
import { lineProfiles, zimoCounts } from "@/lib/mahjong/zimoFx/store";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const rows = await zimoCounts();
    const profiles = await lineProfiles(rows.map((r) => r.userId));
    const players = rows.filter((r) => profiles.has(r.userId)).map((r) => ({
      userId: r.userId, shortId: r.userId.slice(-4), ...profiles.get(r.userId)!,
      count: r.count, owed: r.count * ZIMO_PRICE,
      lastResetAt: r.lastResetAt, lastResetSource: r.lastResetSource, lastResetCleared: r.lastResetCleared,
    }));
    return ok({ price: ZIMO_PRICE, players });
  } catch (err) {
    console.error("[mj-admin] zimo-counts", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
