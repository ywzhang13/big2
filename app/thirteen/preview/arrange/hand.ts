// 預覽頁的 ?hand= 參數：轉成 13 張牌；不合格回 null（頁面改用 seed 發的預設手牌）
// 先正規化再去重：逗號（全形、頓號）和任何空白都當分隔，大小寫不拘（"sa1" = "SA1"）；
// 有任何一個不是有效牌號就整個拒絕；去重後必須剛好 13 張不同的牌。這樣推薦排法（autoArrange 要 13 張）和逾時送出都不會拋錯。
import { buildDeck, type Card } from "@/lib/thirteen";

export function parseHandParam(param: string | undefined): Card[] | null {
  if (!param) return null;
  const byId = new Map(buildDeck().map((c) => [c.id, c]));
  const tokens = param.split(/[\s,，、]+/).map((t) => t.toUpperCase()).filter(Boolean);
  if (tokens.some((t) => !byId.has(t))) return null;
  const unique = [...new Set(tokens)];
  return unique.length === 13 ? unique.map((t) => byId.get(t)!) : null;
}
