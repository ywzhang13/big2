// 大老二「出牌後畫面回朔」（老闆 2026-10-25，和麻將同一個原因）：hooks/useGame.ts 不是自己回合時每 4 秒輪詢、整份覆蓋，
// 修改前完全沒有擋舊回應——輪到我之前送出的輪詢，在我出牌之後才回來，就會把剛出的牌放回手上、又變回輪到我。
// 修好後 useGame 和麻將共用 StateRequestGate：出牌、過、收到任何廣播都記一次變更，變更前送出的回應改成重抓。
// 下面的 Client 照 useGame 的接法模擬（輪詢、樂觀出牌、play_cards 廣播）
import { StateRequestGate } from "../lib/mahjong/stateSync";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

type View = { myHand: string[]; currentTurn: number; lastPlay: string[] | null };
type Gate = StateRequestGate & { noteLocalChange?: () => void; beginLocal?: () => void; endLocal?: () => boolean };
const NO_HOLD = { on: false, gen: 0 };

class Big2Client {
  gate: Gate = new StateRequestGate();
  view: View;
  sent: number[] = [];
  constructor(v: View) { this.view = v; }
  poll() { const id = this.gate.begin(); this.sent.push(id); return id; }
  respond(id: number, snap: View) {
    const v = this.gate.settle(id, NO_HOLD.gen, NO_HOLD);
    if (v === "apply") this.view = { ...snap };
    if (v === "refetchNow") this.poll();
    return v;
  }
  /** playCards：樂觀拿掉出的牌（出牌請求送出） */
  play(cards: string[]) { this.gate.beginLocal?.(); this.view = { ...this.view, myHand: this.view.myHand.filter((c) => !cards.includes(c)) }; }
  /** 出牌請求回來了 */
  serverDone() { if (this.gate.endLocal?.()) this.poll(); }
  /** play_cards 廣播 */
  onPlay(cards: string[], next: number) { this.gate.noteLocalChange?.(); this.view = { ...this.view, lastPlay: cards, currentTurn: next }; }
}

const ME = 0, NEXT = 1, PREV = 3;
{
  // 上家出牌前（還不是我的回合）送出的輪詢，在我出完 3♣ 之後才回來
  const atPrevTurn: View = { myHand: ["3C", "5D", "KS"], currentTurn: PREV, lastPlay: null };
  const c = new Big2Client(atPrevTurn);
  const req = c.poll();
  c.onPlay(["4H"], ME);      // 上家出 4♥，輪到我
  c.play(["5D"]);            // 我出 5♦
  c.onPlay(["5D"], NEXT);    // 廣播：輪到下家
  c.respond(req, atPrevTurn);
  check(!c.view.myHand.includes("5D"), "大老二：出牌前送出的輪詢後到，剛出的 5♦ 不能回到手上");
  check(c.view.currentTurn === NEXT && c.view.lastPlay?.[0] === "5D", "大老二：不能變回上家的回合、桌上還是我出的 5♦");
  c.serverDone();
  check(c.sent.length === 2, "大老二：舊回應丟掉後重抓一次（出牌請求回來時）");
  const fresh: View = { myHand: ["3C", "KS"], currentTurn: NEXT, lastPlay: ["5D"] };
  check(c.sent.length === 2 && c.respond(c.sent[1], fresh) === "apply" && c.view.myHand.length === 2, "大老二：重抓的回應照常套用");
}
{
  // 後送先回（修改前大老二連這個都沒擋）
  const c = new Big2Client({ myHand: ["3C"], currentTurn: PREV, lastPlay: null });
  const r1 = c.poll(), r2 = c.poll();
  check(c.respond(r2, { myHand: ["3C"], currentTurn: ME, lastPlay: ["4H"] }) === "apply" && c.respond(r1, { myHand: ["3C"], currentTurn: PREV, lastPlay: null }) === "drop" && c.view.currentTurn === ME, "大老二：比較舊的輪詢回應不能蓋掉比較新的");
}
{
  // 漏接廣播：輪詢照樣補上
  const c = new Big2Client({ myHand: ["3C"], currentTurn: PREV, lastPlay: null });
  const r = c.poll();
  check(c.respond(r, { myHand: ["3C"], currentTurn: ME, lastPlay: ["4H"] }) === "apply" && c.view.currentTurn === ME, "大老二：漏接廣播時輪詢照常補上");
}

if (failed) { console.log(`❌ 共 ${failed} 項失敗`); process.exit(1); }
