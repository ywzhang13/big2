// 大牌胡牌特效：哪一手要播、播哪一種（老闆 2026-10-23 定案；畫面在 components/mahjong/BigWinFx.tsx）。
// 只管判斷，不碰 React，node 測試直接跑（tests/_big-win.ts）。
//   ・胡牌的台數明細（score.fans）裡有下面任一牌型就播；同一手有好幾個時播台數最高的，同台數照 BIG_WIN_ORDER 的順序。
//   ・頂級（約 3 秒，金鈴 T2）：天胡、字一色、大四喜；大牌（約 2 秒，金鈴 G3）：大三元、小四喜、清一色、五暗刻、八仙過海、七搶一、MIGI（計分名稱「地聽」）。
//   ・「地胡」不播（老闆：地胡就是 MIGI，特效只分天胡和 MIGI），維持一般胡牌畫面。
//   ・一炮多響：state.winner 就是順位第一那家（gameLogic 照順位排 winners），只看它。
//   ・順序（2026-10-25 老闆定案「大牌先播」，見 lib/mahjong/winShow.ts）：先播這一段，cele=true 的接著播現有的自摸／胡慶祝浮層
//     （或帳號專屬的隕石自摸）再出結算；天胡、八仙過海、七搶一（cele=false）播完這一段就進結算。
//   ・2026-10-25 八台大牌新版：大牌（tier big）7 種改用老闆生成素材的新特效（components/mahjong/BigWin8Fx.tsx，下面的 BIG_WIN8）；
//     頂級 3 種（天胡、字一色、大四喜）照舊用 components/mahjong/BigWinFx.tsx。
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

// ---------------- 八台大牌新版（2026-10-25 老闆定案；畫面 components/mahjong/BigWin8Fx.tsx，預覽站試按台 v1～v4 確認過） ----------------
// 大牌（tier big）7 種：素材在 public/mahjong-fx/bigwin8/（老闆用 AI 生成、老馬轉 WebP），專屬音效是阿妍的推薦款
//（sfx/<牌型>-pc.mp3 一般版、-mobile.mp3 手機加強版），牌型名字型 public/fonts/noto-sans-tc/bigwin8-black.woff2。
// 只有這一手真的是這 7 種之一時才下載那一種的素材（約 0.3～0.6MB），一般牌局不下載。
export type BigWin8Theme = "dasanyuan" | "xiaosixi" | "qing1se" | "wuanke" | "baxian" | "qiqiang1" | "migi";
export const BIG_WIN8_DIR = "/mahjong-fx/bigwin8";
export const BIG_WIN8_FONT = "/fonts/noto-sans-tc/bigwin8-black.woff2";
/** ms＝大牌段總長；hit＝畫面最重那一下（閃光、衝擊波、粒子、牌桌震動，音效的重擊點也對在這裡）；art＝這一種用到的兩張圖 */
export const BIG_WIN8: Record<BigWin8Theme, { ms: number; hit: number; art: [string, string] }> = {
  dasanyuan: { ms: 2200, hit: 820, art: ["dsy-dragons.webp", "dsy-burst.webp"] },
  xiaosixi: { ms: 2180, hit: 740, art: ["xsx-eye.webp", "xsx-clouds.webp"] },
  qing1se: { ms: 2160, hit: 780, art: ["qys-wave.webp", "qys-splash.webp"] },
  wuanke: { ms: 2220, hit: 760, art: ["wak-orbs.webp", "wak-circle.webp"] },
  baxian: { ms: 2360, hit: 720, art: ["bx-sea.webp", "bx-gate.webp"] },
  qiqiang1: { ms: 2180, hit: 720, art: ["qq1-swirl.webp", "qq1-flowers.webp"] },
  migi: { ms: 2120, hit: 220, art: ["migi-ground.webp", "migi-pillar.webp"] },
};
export const isBigWin8 = (theme: BigWinTheme): theme is BigWin8Theme => Object.prototype.hasOwnProperty.call(BIG_WIN8, theme);
/** 這一種要下載的檔：兩張圖、牌型名字型、專屬音效（觸控裝置手機加強版、其他一般版，和隕石一樣） */
export function bigWin8Files(theme: BigWin8Theme, device: "pc" | "mobile") {
  return { art: BIG_WIN8[theme].art.map((f) => `${BIG_WIN8_DIR}/${f}`), font: BIG_WIN8_FONT, sfx: `${BIG_WIN8_DIR}/sfx/${theme}-${device}.mp3` };
}
