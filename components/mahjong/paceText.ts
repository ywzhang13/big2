/** 牌局節奏的等待提示（手機和電腦共用）：補花、眼牌摸牌的特效播放中，四家都在等 */
export function paceText(note: { kind: "eye" | "flower" | "wait" }, name: string): string {
  return note.kind === "eye" ? `${name} 摸牌中…` : note.kind === "flower" ? `${name} 補花中…` : "等待中…";
}
