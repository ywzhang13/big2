// 大牌胡牌特效：哪一手要播、播哪一種（老闆 2026-10-23 定案；畫面在 components/mahjong/BigWinFx.tsx）。
// 只管判斷，不碰 React，node 測試直接跑（tests/_big-win.ts）。
//   ・胡牌的台數明細（score.fans）裡有下面任一牌型就播；同一手有好幾個時播台數最高的，同台數照 BIG_WIN_ORDER 的順序。
//   ・頂級（約 3 秒，金鈴 T2）：天胡、字一色、大四喜；大牌（約 2 秒，金鈴 G3）：大三元、小四喜、清一色、五暗刻、八仙過海、七搶一、MIGI（計分名稱「地聽」）。
//   ・「地胡」不播（老闆：地胡就是 MIGI，特效只分天胡和 MIGI），維持一般胡牌畫面。
//   ・一炮多響：state.winner 就是順位第一那家（gameLogic 照順位排 winners），只看它。
//   ・順序（2026-10-25 對調，見 lib/mahjong/winShow.ts）：天胡、八仙過海、七搶一（cele=false）只播這一段就進結算；
//     其他（cele=true）先播現有的自摸／胡慶祝浮層（或帳號專屬的隕石自摸），再播這一段。
export type BigWinTheme = "tianhu" | "zi1se" | "dasixi" | "dasanyuan" | "xiaosixi" | "qing1se" | "wuanke" | "baxian" | "qiqiang1" | "migi";
export type BigWinTier = "top" | "big";

/** 計分名稱 → 特效；陣列順序＝同台數時的優先順序 */
export const BIG_WIN_ORDER: { fan: string; theme: BigWinTheme; title: string; tier: BigWinTier; cele: boolean }[] = [
  { fan: "天胡", theme: "tianhu", title: "天胡", tier: "top", cele: false }, // 天胡一定是自摸，不再接自摸浮層
  { fan: "字一色", theme: "zi1se", title: "字一色", tier: "top", cele: true },
  { fan: "大四喜", theme: "dasixi", title: "大四喜", tier: "top", cele: true },
  { fan: "大三元", theme: "dasanyuan", title: "大三元", tier: "big", cele: true },
  { fan: "小四喜", theme: "xiaosixi", title: "小四喜", tier: "big", cele: true },
  { fan: "清一色", theme: "qing1se", title: "清一色", tier: "big", cele: true },
  { fan: "五暗刻", theme: "wuanke", title: "五暗刻", tier: "big", cele: true },
  { fan: "八仙過海", theme: "baxian", title: "八仙過海", tier: "big", cele: false }, // 花牌胡沒有自摸放槍
  { fan: "七搶一", theme: "qiqiang1", title: "七搶一", tier: "big", cele: false },
  { fan: "地聽", theme: "migi", title: "MIGI", tier: "big", cele: true },
];

export type BigWinPick = { theme: BigWinTheme; title: string; tier: BigWinTier; fan: number; cele: boolean };

type WinnerLike = { seat: number; score: { fans: { name: string; value: number }[] } } | null | undefined;

/** 這一手要播哪一種大牌特效；不用播（沒人胡、流局、沒有上面的牌型）回傳 null */
export function pickBigWin(winner: WinnerLike): BigWinPick | null {
  if (!winner || winner.seat < 0) return null;
  let best: BigWinPick | null = null;
  for (const def of BIG_WIN_ORDER) {
    const f = winner.score.fans.find((x) => x.name === def.fan);
    if (!f) continue;
    // 台數高的優先；同台數保留先出現（順序在前）的
    if (!best || f.value > best.fan) best = { theme: def.theme, title: def.title, tier: def.tier, fan: f.value, cele: def.cele };
  }
  return best;
}

/** 「這一局的這一次胡牌」的識別：同一個房間、同一局（圈－局－連莊）、同一位贏家、同一張胡的牌。
 *  重新整理或斷線重連時拿來判斷播過了沒有 */
export function bigWinKey(roomId: string, hand: string, winner: { seat: number; winTile?: { id: number } } | null | undefined): string | null {
  if (!roomId || !winner || winner.seat < 0) return null;
  return `${roomId}|${hand}|${winner.seat}|${winner.winTile?.id ?? "-"}`;
}

const PLAYED_KEY = "mj.bigwin.played";
const PLAYED_MEM = new Set<string>(); // 存不了 sessionStorage（例如無痕模式）時，至少這次開著的頁面記得
const PLAYED_MAX = 20;
type KV = Pick<Storage, "getItem" | "setItem">;
const store = (): KV | null => {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
};

/** 這一手播過了沒（存在這個分頁的 sessionStorage：重新整理、斷線重連都還在，關掉分頁就清掉）。
 *  sessionStorage 不能用、寫不進去或內容壞掉時記在頁面裡（PLAYED_MEM）；兩邊任一處記過就算播過 */
export function bigWinPlayed(key: string, kv: KV | null = store()): boolean {
  if (PLAYED_MEM.has(key)) return true;
  if (!kv) return false;
  try { return (JSON.parse(kv.getItem(PLAYED_KEY) ?? "[]") as string[]).includes(key); } catch { return false; }
}

/** 記下這一手已經播過（開始播就記，播到一半重新整理也不會再播一次）；只留最近 20 手。
 *  寫不進 sessionStorage（容量滿、隱私模式 setItem 拋錯）或原本的內容壞掉時改記在頁面裡，結算浮層才不會一直被擋住 */
export function markBigWinPlayed(key: string, kv: KV | null = store()): void {
  if (!kv) { PLAYED_MEM.add(key); return; }
  try {
    const list = JSON.parse(kv.getItem(PLAYED_KEY) ?? "[]") as unknown;
    if (!Array.isArray(list)) throw new Error("bad");
    const next = [...list.filter((k) => k !== key), key];
    kv.setItem(PLAYED_KEY, JSON.stringify(next.slice(-PLAYED_MAX)));
  } catch { PLAYED_MEM.add(key); }
}
