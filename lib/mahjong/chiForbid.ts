// 吃牌限制（老闆 2026-10-21）：吃牌後這一輪，和吃牌用的兩張能湊成順子的牌不能打。
// 例：手上六七八條，用六、七條吃上家的五條 → 這輪五條、八條都不能打。
// 哪些牌不能打由伺服器決定（牌局狀態、mj_hand_update 的 chiForbidden，牌型字串同 tileKey，例如 "s5"），前端只負責顯示和擋點擊。
import { useEffect, useState } from "react";
import { tileKey, type Tile } from "./tiles";

/** 伺服器給的 chiForbidden（不是字串陣列就當沒有限制） */
export const chiKinds = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];

/** 這張牌現在不能打 */
export const isChiForbidden = (tile: Tile, kinds: readonly string[]) => kinds.length > 0 && kinds.includes(tileKey(tile));

/** 點到不能打的牌時的提示（不用 emoji） */
export const CHI_FORBID_HINT = "剛吃的牌，這輪不能打同一搭";

/** 點到不能打的牌：提示亮 ms 毫秒（再點一次重新計時）。回傳 [現在要不要顯示, 叫它顯示] */
export function useChiHint(ms = 2000): [boolean, () => void] {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setN(0), ms);
    return () => clearTimeout(t);
  }, [n, ms]);
  return [n > 0, () => setN((x) => x + 1)];
}
