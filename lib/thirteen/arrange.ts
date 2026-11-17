// 排牌：倒水檢查、送出檢查、逾時自動排牌（規則書 2.3、2.4、2.6）。
import type { Card } from "./cards";
import { compareValue, evalFive, evalThree, type HandValue } from "./hand";

/** 一家排好的三道：頭道 3 張、中道 5 張、尾道 5 張 */
export interface Arrangement {
  front: Card[];
  middle: Card[];
  back: Card[];
}

export type ArrangeError =
  | "bad_input"           // 送來的資料格式不對（不是物件、某道不是陣列、牌 id 不是字串）
  | "bad_size"            // 張數不對（頭 3、中 5、尾 5）
  | "duplicate_card"      // 同一張牌（同一個 id）送了兩次
  | "not_your_card"       // 送出的牌不是發給這位玩家的
  | "foul_front_middle"   // 倒水：頭道比中道大
  | "foul_middle_back";   // 倒水：中道比尾道大

export type ArrangeFail = { ok: false; error: ArrangeError; message: string };
export type ArrangeCheck = { ok: true; values: { front: HandValue; middle: HandValue; back: HandValue } } | ArrangeFail;

const MESSAGES: Record<ArrangeError, string> = {
  bad_input: "送出的資料格式不對",
  bad_size: "頭道要 3 張、中道和尾道各 5 張",
  duplicate_card: "同一張牌不能用兩次",
  not_your_card: "有不是你的牌",
  foul_front_middle: "倒水：頭道不能比中道大",
  foul_middle_back: "倒水：中道不能比尾道大",
};
const fail = (error: ArrangeError): ArrangeFail => ({ ok: false, error, message: MESSAGES[error] });

/** 倒水檢查（前端拿來決定能不能按送出、提示哪兩道順序錯）：頭 > 中 或 中 > 尾 才算倒水，相等不算 */
export function checkArrangement(a: Arrangement): ArrangeCheck {
  if (a.front.length !== 3 || a.middle.length !== 5 || a.back.length !== 5) return fail("bad_size");
  const front = evalThree(a.front), middle = evalFive(a.middle), back = evalFive(a.back);
  if (compareValue(front, middle) > 0) return fail("foul_front_middle");
  if (compareValue(middle, back) > 0) return fail("foul_middle_back");
  return { ok: true, values: { front, middle, back } };
}

/**
 * 伺服器收到送出時的完整檢查：送來的是 13 個牌 id（頭 3、中 5、尾 5），每一張都必須是發給這位玩家的牌
 * （加一色每人 16 張，挑 13 張；沒送的 3 張就是不用的），不能重複、不能有別人或沒發出去的牌，也不能倒水。
 * 通過時回傳換成牌物件的排法（只有這 13 張，不用的 3 張不在裡面）。
 */
export function validateSubmission(
  dealt: Card[],
  ids: unknown,
): { ok: true; arrangement: Arrangement } | ArrangeFail {
  // 審伯 2026-11-13 必修：送來的內容來自網路，先驗結構，任何怪輸入都回失敗、不能丟錯
  if (!isSubmission(ids)) return fail("bad_input");
  if (ids.front.length !== 3 || ids.middle?.length !== 5 || ids.back?.length !== 5) return fail("bad_size");
  const all = [...ids.front, ...ids.middle, ...ids.back];
  if (new Set(all).size !== all.length) return fail("duplicate_card");
  const byId = new Map(dealt.map((c) => [c.id, c]));
  if (all.some((id) => !byId.has(id))) return fail("not_your_card");
  const pick = (xs: string[]) => xs.map((id) => byId.get(id)!);
  const arrangement = { front: pick(ids.front), middle: pick(ids.middle), back: pick(ids.back) };
  const check = checkArrangement(arrangement);
  if (!check.ok) return check;
  return { ok: true, arrangement };
}

type SubmissionIds = { front: string[]; middle: string[]; back: string[] };
/** 必須是物件，三道都是真的陣列（不接受只有 length 的假陣列），每個元素都是字串 */
function isSubmission(x: unknown): x is SubmissionIds {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (["front", "middle", "back"] as const).every((k) => Array.isArray(o[k]) && (o[k] as unknown[]).every((id) => typeof id === "string"));
}

/** 從 cards 裡挑 5 張最大的組合：回傳一樣大的全部選法（同點數不同張、例如兩張 ♠K 或不同花色的 K，會留下不同的牌給下一墩） */
function bestFives(cards: Card[]): { picks: Card[][]; value: HandValue } {
  let best: { picks: Card[][]; value: HandValue } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const pick = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      const value = evalFive(pick);
      const cmp = best ? compareValue(value, best.value) : 1;
      if (cmp > 0) best = { picks: [pick], value };
      else if (cmp === 0) best!.picks.push(pick);
    }
  return best!;
}

/** 從 cards 裡挑 3 張最大的組合（頭道） */
function bestThree(cards: Card[]): { pick: Card[]; value: HandValue } {
  let best: { pick: Card[]; value: HandValue } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    const pick = [cards[a], cards[b], cards[c]];
    const value = evalThree(pick);
    if (!best || compareValue(value, best.value) > 0) best = { pick, value };
  }
  return best!;
}

/**
 * 理牌時間到了（或斷線）由系統自動排牌：從手牌（加一色每人 16 張；也收 13 張）挑 13 張，排出「最好」的三墩，保證不倒水。
 * 「最好」的判準（規則書 2.7，小測 2026-11-18 要求寫清楚）：在所有不倒水的排法裡，先比尾道，尾道一樣大再比中道，
 * 中道也一樣再比頭道，取最大的一組（字典序最大）。沒挑到的牌就是不用的。不考慮對手，也不額外追特殊加分。
 * 做法：
 *   1. 尾道＝手牌裡最大的 5 張。同樣大的選法可能不只一種（例如葫蘆用哪幾張 K、順子用哪個花色），每一種都試。
 *   2. 每種尾道，中道＝剩下的牌裡最大的 5 張；一樣大的選法也每一種都試。
 *   3. 頭道＝再剩下的牌裡最大的 3 張。
 *   比完所有組合取字典序最大的。不倒水：尾道是全部手牌最大的 5 張，一定不小於中道；中道是剩下牌裡最大的 5 張，
 *   頭道 3 張也在剩下的牌裡，所以中道不小於「頭道＋任意 2 張」，也就不小於頭道。
 * 一樣大的選法通常只有幾種，16 張一手約幾毫秒。
 */
export function autoArrange(cards: Card[]): Arrangement {
  if (cards.length < 13) throw new Error("自動排牌至少要 13 張");
  const backs = bestFives(cards);
  let best: { arr: Arrangement; middle: HandValue; front: HandValue } | null = null;
  for (const back of backs.picks) {
    const rest = cards.filter((c) => !back.includes(c));
    const middles = bestFives(rest);
    for (const middle of middles.picks) {
      const front = bestThree(rest.filter((c) => !middle.includes(c)));
      const better = !best || compareValue(middles.value, best.middle) > 0
        || (compareValue(middles.value, best.middle) === 0 && compareValue(front.value, best.front) > 0);
      if (better) best = { arr: { front: front.pick, middle, back }, middle: middles.value, front: front.value };
    }
  }
  return best!.arr;
}
