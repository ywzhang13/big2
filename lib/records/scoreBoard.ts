// 麻將輸贏排行榜（老闆 2026-10-31 定案）：純函式，不連資料庫。
//   每人淨分＝期間內所有麻將場次的整場輸贏加總（和歷史紀錄的「累計」同一個算法；打完、解散都算；不同底台直接加總）
//   只列 accounts 裡有的帳號（LINE、不是遊客、帳號還在）；分數 0 也列
//   分數高到低；同分同名次（1、2、2、4），同分照名字排。每列不含帳號 id，me 標出登入的本人
export interface ScoreRow { rank: number; name: string; avatarUrl: string | null; score: number; me: boolean }

export function scoreBoard(
  rows: { userId: string; score: number }[],
  accounts: Map<string, { name: string; avatarUrl: string | null }>,
  meId: string | null
): ScoreRow[] {
  const sum = new Map<string, number>();
  for (const r of rows) if (accounts.has(r.userId)) sum.set(r.userId, (sum.get(r.userId) ?? 0) + r.score);
  const list = [...sum.entries()]
    .map(([id, score]) => ({ id, score, ...accounts.get(id)! }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-Hant") || (a.id < b.id ? -1 : 1));
  let rank = 0;
  return list.map((p, i) => {
    if (i === 0 || list[i - 1].score !== p.score) rank = i + 1; // 同分沿用前一位的名次
    return { rank, name: p.name, avatarUrl: p.avatarUrl, score: p.score, me: !!meId && p.id === meId };
  });
}
