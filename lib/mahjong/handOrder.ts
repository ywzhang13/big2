// 手牌的顯示順序：本人畫面（hooks/useMahjong.ts）和觀戰畫面（lib/mahjong/spectateClient.ts）共用這一份，
// 兩邊一定一樣（老闆 2026-10-31 回報觀戰看到的牌沒整理）。伺服器摸牌是接在手牌最後，所以畫面一律重新排序；
// 剛摸的那張由 drawnTileId 在 MjHand 分到右邊。
import { sortTiles, isFlower } from "./tiles";
import type { Tile } from "./tiles";

/** Filter out any flower tiles that shouldn't be in hand (defensive) */
export function safeHand(tiles: Tile[]): Tile[] {
  const filtered = tiles.filter((t) => {
    // Triple check: suit property, isFlower function, and display name
    if (t.suit === "f") return false;
    if (isFlower(t)) return false;
    const flowerNames = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
    if (flowerNames.includes(t.display)) return false;
    return true;
  });
  if (filtered.length !== tiles.length) {
    console.warn("[mj] safeHand filtered flowers:", tiles.length - filtered.length, "removed");
  }
  return sortTiles(filtered);
}
