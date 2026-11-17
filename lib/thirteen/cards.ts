// 十三支（4 人加一色）的牌組：一副 52 張再加第二組黑桃 13 張，共 65 張。
// 規則書〈十三支-四人加一色-規則書-定案版 v2／v3〉2.1、2.2、2.6 節。純函式，前後端都能用。
//
// 每張牌有唯一 id，分得出第一副、第二副：例如 "SA1"（第一副黑桃 A）、"SA2"（第二副黑桃 A）、"HT1"（紅心 10）。
// 比大小只看點數和牌型，不看是哪一副，也不比花色。

export type Suit = "S" | "H" | "D" | "C"; // 黑桃、紅心、方塊、梅花
export interface Card {
  id: string;     // 唯一 id：花色＋點數字母＋第幾副，例如 "SA2"
  suit: Suit;
  rank: number;   // 2～14（11=J、12=Q、13=K、14=A）
  deck: 1 | 2;    // 第幾副；只有黑桃有第 2 副
}

export const RANK_CHARS = "23456789TJQKA";
export const rankChar = (rank: number) => RANK_CHARS[rank - 2];
const SUITS: Suit[] = ["S", "H", "D", "C"];

export function makeCard(suit: Suit, rank: number, deck: 1 | 2): Card {
  return { id: `${suit}${rankChar(rank)}${deck}`, suit, rank, deck };
}

/** 65 張：四種花色 2～A 各一張（第一副），再加黑桃 2～A 第二副 */
export function buildDeck(): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) for (let r = 2; r <= 14; r++) out.push(makeCard(suit, r, 1));
  for (let r = 2; r <= 14; r++) out.push(makeCard("S", r, 2));
  return out;
}

/**
 * 密碼學安全的隨機整數 0～n-1（審伯 2026-11-13 必修：洗牌不能用 Math.random，可被預測）。
 * 用 Web Crypto（瀏覽器、Node 19+ 的 globalThis.crypto）；取不到就直接丟錯，絕不退回 Math.random。
 * 用拒絕取樣避免取餘數造成的偏差。
 */
export function secureRandomInt(n: number): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("沒有密碼學安全的亂數來源（crypto.getRandomValues），不能洗牌");
  if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new Error("secureRandomInt：n 必須是 1～2^32 的整數");
  const limit = 0x100000000 - (0x100000000 % n); // 小於 limit 的值才收，確保每個結果機率相同
  const buf = new Uint32Array(1);
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Fisher-Yates 洗牌。預設用密碼學安全亂數（secureRandomInt）。
 * rng 只給測試明確注入固定種子用（回傳 0 ≤ x < 1）；正式流程不要傳。
 */
export function shuffle<T>(xs: readonly T[], rng?: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng ? Math.floor(rng() * (i + 1)) : secureRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 每人發幾張（老闆 2026-11-18 拍板：加一色每人 16 張，自己挑 13 張理牌，另外 3 張不用、不公開） */
export const HAND_SIZE = 16;

/** 洗 65 張、4 家各發 16 張；剩下 1 張收起（不公開、不續用）。rng 同 shuffle，只給測試用 */
export function deal(rng?: () => number): { hands: Card[][]; rest: Card[] } {
  const d = shuffle(buildDeck(), rng);
  return { hands: [0, 1, 2, 3].map((i) => d.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)), rest: d.slice(4 * HAND_SIZE) };
}

/** 文字寫法 → 牌（測試、除錯用）："AS" "TD" "9H"；同一手裡第二次出現的黑桃自動當第 2 副 */
export function parseCards(text: string, used: Set<string> = new Set()): Card[] {
  return text.trim().split(/\s+/).map((t) => {
    const rank = RANK_CHARS.indexOf(t[0].toUpperCase()) + 2;
    const suit = t[1].toUpperCase() as Suit;
    if (rank < 2 || !SUITS.includes(suit)) throw new Error(`看不懂的牌：${t}`);
    for (const deck of [1, 2] as const) {
      const c = makeCard(suit, rank, deck);
      if (deck === 2 && suit !== "S") break;
      if (!used.has(c.id)) { used.add(c.id); return c; }
    }
    throw new Error(`牌用超過張數：${t}`);
  });
}
