// 麻將「打出去畫面回朔／按白皮變西風」（老闆 2026-10-25；調查與重現見老馬報告）：
// 打出前送出、打出後才回來的 state 回應，不能把手牌、海底、最後打出的牌、輪到誰蓋回打出前；改成馬上重抓，最後和伺服器一致。
// 下面的 Client 照 useMahjong 的接法模擬（樂觀打出、mj_discard 廣播、輪詢套用／重抓），用的是真的 StateRequestGate。
// 修改前的 StateRequestGate 沒有 noteLocalChange／beginLocal／endLocal：呼叫不到，情境 A、B、C 會失敗（用 ?. 呼叫，讓舊版也跑得到斷言）
import { StateRequestGate, MAX_STALE_REFETCH, LOCAL_PENDING_MAX_MS } from "../lib/mahjong/stateSync";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

type Tile = { id: number; face: string };
type View = { hand: Tile[]; lastDiscard: { tile: Tile; from: number } | null; currentTurn: number; hasDrawn: boolean };
type Gate = StateRequestGate & { noteLocalChange?: () => void; beginLocal?: (now?: number) => void; endLocal?: () => boolean };
type Req = { id: number; holdGen: number };

class Client {
  gate: Gate = new StateRequestGate();
  hold = { on: false, gen: 0 };
  view: View;
  sent: Req[] = [];
  constructor(v: View) { this.view = v; }
  /** 輪詢、切回前景、重新連線：送出 state 請求 */
  sendPoll(): Req { const r = { id: this.gate.begin(), holdGen: this.hold.gen }; this.sent.push(r); return r; }
  /** 回應到了：照 fetchState（apply 整份蓋掉；refetchNow 馬上重抓） */
  respond(req: Req, snap: View) {
    const v = this.gate.settle(req.id, req.holdGen, this.hold);
    if (v === "apply") this.view = { ...snap };
    if (v === "refetchNow") this.sendPoll();
    return v;
  }
  /** 按「打出」：照 discardTile 的樂觀更新（打牌請求送出） */
  discard(tile: Tile, mySeat: number) {
    this.gate.beginLocal?.();
    this.view = { ...this.view, hand: this.view.hand.filter((t) => t.id !== tile.id), lastDiscard: { tile, from: mySeat }, hasDrawn: false };
  }
  /** 打牌請求的回應到了（discardTile 的 finally）：在路上時丟掉過輪詢就補抓 */
  serverDone() { if (this.gate.endLocal?.()) this.sendPoll(); }
  /** mj_discard 廣播（onHeld 收到任何廣播都記一次變更） */
  onDiscardEvent(tile: Tile, seat: number, mySeat: number, next: number) {
    this.gate.noteLocalChange?.();
    this.view = { ...this.view, lastDiscard: { tile, from: seat }, currentTurn: next, hand: seat === mySeat ? this.view.hand.filter((t) => t.id !== tile.id) : this.view.hand };
  }
}

const ME = 0, LEFT = 3, RIGHT = 1;
const HAKU: Tile = { id: 133, face: "白" }, SHAA: Tile = { id: 118, face: "西" }, X: Tile = { id: 7, face: "七萬" }, Y: Tile = { id: 30, face: "四筒" };
const afterMine: View = { hand: [X], lastDiscard: { tile: HAKU, from: ME }, currentTurn: RIGHT, hasDrawn: false };

// ---- 情境 A：打出前送出的輪詢，比 mj_discard 廣播晚回來 ----
{
  const before: View = { hand: [X, HAKU], lastDiscard: null, currentTurn: ME, hasDrawn: true };
  const c = new Client(before);
  const req = c.sendPoll();
  c.discard(HAKU, ME);
  c.onDiscardEvent(HAKU, ME, ME, RIGHT);
  c.respond(req, before);
  check(!c.view.hand.some((t) => t.id === HAKU.id), "情境 A：舊回應後到，打出的白皮不能回到手上");
  check(c.view.lastDiscard?.tile.id === HAKU.id, "情境 A：中央還是我打出的白皮");
  check(c.view.currentTurn === RIGHT, "情境 A：輪到下家，不能變回輪到我");
  c.serverDone();
  check(c.sent.length === 2, "情境 A：舊回應丟掉後重抓一次（打牌請求回來時）");
  check(c.sent.length === 2 && c.respond(c.sent[1], afterMine) === "apply" && c.view.currentTurn === RIGHT && c.view.hand.length === 1, "情境 A：重抓的回應照常套用（和伺服器一致）");
}

// ---- 情境 B：上家剛打出西風時送出的請求，我打出白皮後、廣播前回來 ----
{
  const atLeftDiscard: View = { hand: [X, HAKU], lastDiscard: { tile: SHAA, from: LEFT }, currentTurn: ME, hasDrawn: false };
  const c = new Client(atLeftDiscard);
  const req = c.sendPoll();
  c.view = { ...c.view, hasDrawn: true };
  c.discard(HAKU, ME);
  c.respond(req, atLeftDiscard);
  c.serverDone();
  check(c.view.lastDiscard?.tile.id === HAKU.id, "情境 B：中央不能變回上家的西風（按白皮打出卻顯示西風）");
  check(!c.view.hand.some((t) => t.id === HAKU.id), "情境 B：打出的白皮不能回到手上");
}

// ---- 情境 C：打出之後才送出、但比打牌請求先到伺服器的請求（伺服器還沒處理打牌，回的是打出前的狀態）----
// （第一版修正後實測仍閃 29ms：重抓的請求比打牌請求先被處理）
{
  const before: View = { hand: [X, HAKU], lastDiscard: null, currentTurn: ME, hasDrawn: true };
  const c = new Client(before);
  c.discard(HAKU, ME);
  const req = c.sendPoll();                 // 打出後馬上送出（例如定時輪詢剛好到）
  const v = c.respond(req, before);         // 伺服器還沒處理打牌：回打出前的狀態
  check(v !== "apply" && !c.view.hand.some((t) => t.id === HAKU.id), "情境 C：打牌請求還在路上時回來的 state 回應不能套用");
  c.serverDone();                           // 打牌請求回來了
  check(c.sent.length === 2 && c.respond(c.sent[1], afterMine) === "apply" && c.view.currentTurn === RIGHT, "情境 C：打牌請求回來後補抓一次，照常套用");
}

// ---- 對照：打牌完成之後才送出的請求照常套用 ----
{
  const c = new Client({ hand: [X, HAKU], lastDiscard: null, currentTurn: ME, hasDrawn: true });
  c.discard(HAKU, ME);
  c.serverDone();
  const req = c.sendPoll();
  check(c.respond(req, afterMine) === "apply" && c.view.currentTurn === RIGHT, "對照：打出之後才送出的請求照常套用");
}

// ---- 真正的新狀態不能漏：漏接廣播時，輪詢照樣補上 ----
{
  const c = new Client({ hand: [X, HAKU], lastDiscard: null, currentTurn: LEFT, hasDrawn: false });
  const req = c.sendPoll(); // 這期間上家打出四筒，但廣播漏接（沒有任何本機變更）
  const missed: View = { hand: [X, HAKU], lastDiscard: { tile: Y, from: LEFT }, currentTurn: ME, hasDrawn: false };
  check(c.respond(req, missed) === "apply" && c.view.lastDiscard?.tile.id === Y.id, "漏接廣播：輪詢回來照常補上別人打的牌");
}

// ---- 重新連線（頻道重新訂閱時重抓）：之後沒有變更就照常套用 ----
{
  const c = new Client({ hand: [X, HAKU], lastDiscard: null, currentTurn: ME, hasDrawn: true });
  c.discard(HAKU, ME); // 斷線前打出
  c.serverDone();
  const req = c.sendPoll(); // 重新連線後重抓
  check(c.respond(req, afterMine) === "apply" && c.view.hand.length === 1, "重新連線後的重抓照常套用");
}

// ---- 廣播一直來：連續重抓有上限，不會一直重抓；停下來後下一次輪詢照常套用 ----
{
  const c = new Client({ hand: [X], lastDiscard: null, currentTurn: LEFT, hasDrawn: false });
  let req = c.sendPoll();
  const verdicts: string[] = [];
  for (let i = 0; i <= MAX_STALE_REFETCH; i++) {
    c.gate.noteLocalChange?.(); // 回應回來前又來一個廣播
    verdicts.push(c.respond(req, c.view));
    req = c.sent[c.sent.length - 1];
  }
  check(verdicts.slice(0, MAX_STALE_REFETCH).every((v) => v === "refetchNow") && verdicts[MAX_STALE_REFETCH] === "drop", `廣播一直來：最多連續重抓 ${MAX_STALE_REFETCH} 次就先停（${verdicts.join("、")}）`);
  const quiet = c.sendPoll();
  check(c.respond(quiet, { ...c.view, currentTurn: ME }) === "apply", "停下來之後，下一次定時輪詢（期間沒有新廣播）照常套用");
}

// ---- 打牌請求卡住（沒回應也沒錯誤）：超過 LOCAL_PENDING_MAX_MS 就不再擋輪詢，畫面不會一直不更新 ----
{
  const g: Gate = new StateRequestGate();
  const t0 = 1_000_000;
  g.beginLocal?.(t0);
  const early = g.begin();
  const v1 = g.settle(early, 0, { on: false, gen: 0 }, t0 + 1000);
  const late = g.begin();
  const v2 = g.settle(late, 0, { on: false, gen: 0 }, t0 + LOCAL_PENDING_MAX_MS + 1);
  check(v1 === "drop" && v2 === "apply", `打牌請求卡住：1 秒時輪詢先不套用，超過 ${LOCAL_PENDING_MAX_MS / 1000} 秒後照常套用（${v1}、${v2}）`);
}

// ---- 後送先回照舊丟掉 ----
{
  const c = new Client({ hand: [X], lastDiscard: null, currentTurn: LEFT, hasDrawn: false });
  const r1 = c.sendPoll(), r2 = c.sendPoll();
  check(c.respond(r2, { ...c.view, currentTurn: ME }) === "apply" && c.respond(r1, { ...c.view, currentTurn: LEFT }) === "drop" && c.view.currentTurn === ME, "後送先回：比較舊的回應照舊丟掉");
}

if (failed) { console.log(`❌ 共 ${failed} 項失敗`); process.exit(1); }
