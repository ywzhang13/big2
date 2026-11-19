// 排牌：倒水檢查、送出檢查、逾時自動排牌（規則書 2.3、2.4、2.6）。
import type { Card } from "./cards";
import { compareValue, evalFive, evalThree, V4_NO_LUCKY, type HandRule, type HandValue } from "./hand";
import { bonusOf } from "./score";

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

/** 倒水檢查（前端拿來決定能不能按送出、提示哪兩道順序錯）：頭 > 中 或 中 > 尾 才算倒水，相等不算。rule：牌型判斷規則（見 hand.ts，沒指定＝v4、沒有彩金牌） */
export function checkArrangement(a: Arrangement, rule: HandRule = V4_NO_LUCKY): ArrangeCheck {
  if (a.front.length !== 3 || a.middle.length !== 5 || a.back.length !== 5) return fail("bad_size");
  const front = evalThree(a.front, rule), middle = evalFive(a.middle, rule), back = evalFive(a.back, rule);
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
  rule: HandRule = V4_NO_LUCKY,
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
  const check = checkArrangement(arrangement, rule);
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

// 每個組合記成位元遮罩（第 i 張牌＝第 i 個位元），判斷「有沒有用到同一張牌」只要一個 &
type Pick = { pick: Card[]; value: HandValue; mask: number };
const desc = (a: Pick, b: Pick) => compareValue(b.value, a.value);
/** cards 裡所有 k 張（5 或 3）的組合，由大到小；整手只算一次 */
function combos(cards: Card[], k: 3 | 5, rule: HandRule): Pick[] {
  const out: Pick[] = [];
  const n = cards.length, idx: number[] = [];
  const rec = (start: number) => {
    if (idx.length === k) {
      const pick = idx.map((i) => cards[i]);
      out.push({ pick, value: k === 5 ? evalFive(pick, rule) : evalThree(pick, rule), mask: idx.reduce((m, i) => m | (1 << i), 0) });
      return;
    }
    for (let i = start; i < n; i++) { idx.push(i); rec(i + 1); idx.pop(); }
  };
  rec(0);
  return out.sort(desc);
}

type Plan = { front: Pick; middle: Pick; back: Pick; bonus: number };
/** 新判準：牌型加分合計多的好；一樣多再比尾、中、頭（字典序） */
function better(a: Plan, b: Plan): boolean {
  return a.bonus !== b.bonus ? a.bonus > b.bonus
    : (compareValue(a.back.value, b.back.value) || compareValue(a.middle.value, b.middle.value) || compareValue(a.front.value, b.front.value)) > 0;
}
const planOf = (front: Pick, middle: Pick, back: Pick, rule: HandRule): Plan =>
  ({ front, middle, back, bonus: bonusOf("front", front.value, rule) + bonusOf("middle", middle.value, rule) + bonusOf("back", back.value, rule) });

/**
 * 有幾墩已經指定好時，把其他墩補成「尾、中、頭字典序最大」又不倒水的排法；排不出來回 null。
 * all5、all3 是整手由大到小排好的組合：尾道一組一組（同樣大的每一種都試）往下找，第一組排得出來的就是答案；中道、頭道同理。
 */
function complete(all5: Pick[], all3: Pick[], used: number, fixed: { front?: Pick; middle?: Pick; back?: Pick }, rule: HandRule): Plan | null {
  const free = (list: Pick[], m: number) => list.filter((x) => !(x.mask & m)); // 由大到小的順序不變
  const backs = fixed.back ? [fixed.back] : free(all5, used);
  for (let i = 0; i < backs.length;) {
    let j = i + 1; while (j < backs.length && compareValue(backs[j].value, backs[i].value) === 0) j++; // 同樣大的一組
    let found: Plan | null = null;
    for (let bi = i; bi < j; bi++) {
      const back = backs[bi];
      const u1 = used | back.mask;
      const mids = fixed.middle ? [fixed.middle] : free(all5, u1);
      const fronts = fixed.front ? [fixed.front] : free(all3, u1);
      for (let k = 0; k < mids.length;) {
        let l = k + 1; while (l < mids.length && compareValue(mids[l].value, mids[k].value) === 0) l++;
        let midFound: Plan | null = null;
        if (compareValue(mids[k].value, back.value) <= 0) {
          for (let mi = k; mi < l; mi++) {
            const middle = mids[mi];
            const front = fronts.find((t) => !(t.mask & middle.mask) && compareValue(t.value, middle.value) <= 0);
            if (front) { const p = planOf(front, middle, back, rule); if (!midFound || better(p, midFound)) midFound = p; }
          }
        }
        if (midFound) { if (!found || better(midFound, found)) found = midFound; break; }
        k = l;
      }
    }
    if (found) return found;
    i = j;
  }
  return null;
}

/**
 * 理牌時間到了（或斷線）由系統自動排牌，前端的「推薦排法」也是它：從手牌（加一色每人 16 張；也收 13 張）挑 13 張排成三墩，保證不倒水。
 * 「最好」的判準（阿哲 2026-11-18 拍板；說明見 API.md）：在所有不倒水的排法裡，
 *   1. 先比三墩的牌型加分合計（照計分規則的加分表：頭墩三條＝衝三、中墩和尾墩的鐵支／同花順／五龍）——有機會拿加分時，
 *      不會為了讓尾墩或中墩大一點而把衝三、鐵支拆掉；
 *   2. 加分一樣多，再比尾道、中道、頭道，取最大的（字典序最大）。
 * 只看自己的牌，不考慮對手。沒挑到的牌就是不用的。
 * 做法：最好的排法裡，有拿加分的那幾墩一定是「拿得到加分的組合」之一（頭墩的三條、中尾墩的鐵支／同花順／五龍，數量不多）。
 *   所以把「每一墩要不要指定成某個加分組合」的所有搭配都試一次，其他墩補成字典序最大又不倒水的排法（complete），
 *   全部比完取最好的。沒有任何加分組合時，只有「全都不指定」一種，結果和原本的判準一樣。
 *   加分多的搭配先試；一個搭配就算其他墩都拿到最多加分也比不過目前最好的，就跳過。
 * 已用窮舉所有不倒水排法的對照測試證明結果相同（tests/_thirteen-arrange-bonus.ts、_thirteen-deal16.ts G7）。
 */
export function autoArrange(cards: Card[], rule: HandRule = V4_NO_LUCKY): Arrangement {
  if (cards.length < 13) throw new Error("自動排牌至少要 13 張");
  if (cards.length > 30) throw new Error("自動排牌最多 30 張");
  const all5 = combos(cards, 5, rule), all3 = combos(cards, 3, rule);
  const special5 = all5.filter((x) => bonusOf("middle", x.value, rule) > 0 || bonusOf("back", x.value, rule) > 0);
  const trips = all3.filter((x) => bonusOf("front", x.value, rule) > 0);
  // 每一墩最多還能拿多少加分（剪枝用）
  const maxFront = trips.length ? Math.max(...trips.map((t) => bonusOf("front", t.value, rule))) : 0;
  const maxMiddle = special5.length ? Math.max(...special5.map((t) => bonusOf("middle", t.value, rule))) : 0;
  const maxBack = special5.length ? Math.max(...special5.map((t) => bonusOf("back", t.value, rule))) : 0;
  const plans: { front?: Pick; middle?: Pick; back?: Pick; used: number; fixedBonus: number; upper: number }[] = [];
  for (const front of [undefined, ...trips]) for (const middle of [undefined, ...special5]) for (const back of [undefined, ...special5]) {
    const fm = front?.mask ?? 0, mm = middle?.mask ?? 0, bm = back?.mask ?? 0;
    if ((fm & mm) || (fm & bm) || (mm & bm)) continue;
    if (middle && back && compareValue(middle.value, back.value) > 0) continue;
    const above = middle ?? back;
    if (front && above && compareValue(front.value, above.value) > 0) continue;
    const fb = (front ? bonusOf("front", front.value, rule) : 0) + (middle ? bonusOf("middle", middle.value, rule) : 0) + (back ? bonusOf("back", back.value, rule) : 0);
    plans.push({ front, middle, back, used: fm | mm | bm, fixedBonus: fb, upper: fb + (front ? 0 : maxFront) + (middle ? 0 : maxMiddle) + (back ? 0 : maxBack) });
  }
  plans.sort((a, b) => b.fixedBonus - a.fixedBonus); // 加分多的先試，比較快找到好答案、剪掉其他
  let best: Plan | null = null;
  for (const pl of plans) {
    if (best && pl.upper < best.bonus) continue;
    const p = complete(all5, all3, pl.used, pl, rule);
    if (p && (!best || better(p, best))) best = p;
  }
  if (!best) throw new Error("排不出不倒水的三墩（不應該發生）");
  return { front: best.front.pick, middle: best.middle.pick, back: best.back.pick };
}
