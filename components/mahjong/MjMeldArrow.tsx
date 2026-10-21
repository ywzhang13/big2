import type { Meld } from "@/lib/mahjong/gameState";

const DIRS = ["down", "right", "up", "left"] as const;
const DEG = [90, 0, -90, 180];

/** 碰、明槓（含加槓）的小箭頭：指向打出那張牌的人在「我」畫面上的位置（下＝自己、右＝下家、上＝對家、左＝上家）。
 *  吃、暗槓不畫（暗槓沒有 from，也不會洩漏任何資訊）。
 *  放在這一副裡面、和牌排成一列的一小格（不壓到牌）；指向這一副開頭那一邊時放最前面，其他放最後面。
 *  vertical＝這一副是直排（左右家） */
export function MjMeldArrow({ meld, owner, mySeat, size, vertical }: { meld: Meld; owner: number; mySeat: number; size: number; vertical?: boolean }) {
  if ((meld.type !== "pong" && meld.type !== "kong") || meld.from == null) return null;
  const pos = (meld.from - mySeat + 4) % 4;
  const first = vertical ? pos === 2 : pos === 3;
  return (
    <span
      data-meld-from={DIRS[pos]}
      data-claim-owner={owner}
      style={{
        order: first ? -1 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        ...(vertical ? { height: size } : { width: size }),
      }}
    >
      <svg viewBox="0 0 10 10" width={size} height={size} style={{ transform: `rotate(${DEG[pos]}deg)`, display: "block" }} aria-hidden>
        <path d="M2 1 L9 5 L2 9 Z" fill="#f0d68a" stroke="rgba(0,0,0,.6)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
