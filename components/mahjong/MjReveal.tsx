"use client";

// 結算攤牌：四家手牌（贏家不含胡的那張）、吃碰槓（暗槓翻開）、花牌；
// 贏家胡的那張單獨放在最後並標示「自摸」或「胡 某某」，聽的牌另外列。
// 舊牌局沒有 winTile／from／waits 時就不畫那部分。

import type { Tile } from "@/lib/mahjong/tiles";
import { sortTiles } from "@/lib/mahjong/tiles";
import type { Meld, WaitTile } from "@/lib/mahjong/gameState";
import MjTile from "./MjTile";

export interface RevealHand {
  seat: number;
  name: string;
  hand: Tile[];
  revealed: Meld[];
  flowers: Tile[];
}

export interface RevealWinner {
  seat: number;
  winTile?: Tile;
  from?: number | null;
  waits?: WaitTile[];
  score: { fans: { name: string }[] };
}

/** 胡的那張的標示：自摸、胡 某某；八仙過海不標 */
export function winLabel(w: RevealWinner, nameOf: (seat: number) => string): string | null {
  if (w.score.fans.some((f) => f.name === "八仙過海")) return null;
  if (w.from == null) return "自摸";
  return `胡 ${nameOf(w.from)}`;
}

const Gap = () => <span style={{ width: 6, flex: "0 0 auto" }} />;

export function RevealTiles({
  h,
  winner,
  nameOf,
  w,
  ht,
}: {
  h: RevealHand;
  winner?: RevealWinner;
  nameOf: (seat: number) => string;
  w: number;
  ht: number;
}) {
  const winTile = winner?.winTile;
  // 花牌胡（八仙過海／七搶一）的那張花不要在花牌裡重複出現
  const flowers = sortTiles(h.flowers.filter((f) => f.id !== winTile?.id));
  const label = winner ? winLabel(winner, nameOf) : null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 1, rowGap: 3, minWidth: 0 }}>
      {sortTiles(h.hand).map((t) => (
        <MjTile key={t.id} tile={t} width={w} height={ht} />
      ))}
      {h.revealed.map((m, mi) => (
        <span key={mi} style={{ display: "contents" }}>
          <Gap />
          {m.tiles.map((t) => (
            <MjTile key={t.id} tile={t} width={w} height={ht} />
          ))}
        </span>
      ))}
      {flowers.length > 0 && <Gap />}
      {flowers.map((f) => (
        <MjTile key={f.id} tile={f} width={w} height={ht} />
      ))}
      {winTile && (
        <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 4, marginLeft: 8, flex: "0 0 auto" }}>
          <span style={{ borderRadius: 3, boxShadow: "0 0 0 2px #fbbf24, 0 0 10px rgba(251,191,36,.5)", lineHeight: 0 }}>
            <MjTile tile={winTile} width={w} height={ht} />
          </span>
          {label && (
            <span style={{ fontSize: 11, fontWeight: 800, color: "#fbbf24", whiteSpace: "nowrap", lineHeight: 1.1 }}>
              {label}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** 聽的牌：「聽」＋小牌面；沒有就不顯示 */
export function WaitsList({ waits, w, ht }: { waits?: WaitTile[]; w: number; ht: number }) {
  if (!waits || waits.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "0 0 auto" }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: "#6ee7b7" }}>聽</span>
      <span style={{ display: "inline-flex", gap: 1 }}>
        {waits.map((t, i) => (
          <MjTile key={i} tile={{ id: -1 - i, suit: t.suit, rank: t.rank, display: t.display }} width={w} height={ht} />
        ))}
      </span>
    </span>
  );
}
