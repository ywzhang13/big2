// 審伯退件兩項（stateSync）：①按下一局的樂觀「已同意」不能殘留到新局 ②回前景連發只多抓一次、舊回應不能蓋掉新的，
// 慢慢摸牌期間照樣延後、結束只重抓一次，花牌紀錄不倒退。下面的 Client 照 useMahjong 的 fetchState／nextGame 接法模擬。
import { StateRequestGate, readyAfterNextGame, type HoldSnapshot } from "../lib/mahjong/stateSync";
import { FlowerTracker, gameKeyOf } from "../lib/mahjong/flowerTracker";
import type { RoundInfo } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const round = (currentRound: number, currentGame: number, dealerConsecutive: number): RoundInfo => ({ currentRound, currentGame, dealerConsecutive, initialDealerSeat: 0 });
const flower = (id: number): Tile => ({ id, suit: "f", rank: 1, display: "春" } as Tile);
type View = { status: string; roundInfo: RoundInfo; nextGameReady: string[]; flowers: Tile[] };

/** 照 hook 的接法：state 請求、慢慢摸牌排隊、回前景、套用輪詢（含花牌基線） */
class Client {
  gate = new StateRequestGate();
  hold: HoldSnapshot & { refetch?: () => void } = { on: false, gen: 0 };
  tracker = new FlowerTracker();
  view: View;
  sent: { id: number; holdGen: number }[] = [];
  constructor(v: View) { this.view = v; this.tracker.onPoll([{ seat: 0, flowers: v.flowers }], v.roundInfo); }
  fetchState() {
    if (this.hold.on) { this.hold.refetch = () => this.fetchState(); return; }
    this.sent.push({ id: this.gate.begin(), holdGen: this.hold.gen });
  }
  onResume(now: number) { if (this.gate.allowResume(now)) this.fetchState(); }
  respond(req: { id: number; holdGen: number }, snap: View) {
    const v = this.gate.settle(req.id, req.holdGen, this.hold);
    if (v === "refetchAfterHold") { this.hold.refetch = () => this.fetchState(); return v; }
    if (v === "refetchNow") { this.fetchState(); return v; }
    if (v === "apply") { this.tracker.onPoll([{ seat: 0, flowers: snap.flowers }], snap.roundInfo); this.view = { ...snap }; }
    return v;
  }
  holdFor() { if (!this.hold.on) this.hold.gen++; this.hold.on = true; }
  release() { this.hold.on = false; const r = this.hold.refetch; this.hold.refetch = undefined; r?.(); }
}

// ---- ① 下一局：樂觀已同意 ----
const G1 = round(2, 1, 0), G2 = round(2, 2, 0);
{
  const fin = { status: "finished", roundInfo: G1, nextGameReady: [] as string[] };
  check(JSON.stringify(readyAfterNextGame(fin, "p0", { started: false }, gameKeyOf(G1))) === '["p0"]', "N1 第 1 個按：HTTP 成功就馬上顯示已同意");
  const two = { ...fin, nextGameReady: ["p1", "p2"] };
  check(JSON.stringify(readyAfterNextGame(two, "p0", { started: false }, gameKeyOf(G1))) === '["p1","p2","p0"]', "N2 第 3 個按：加在後面，馬上顯示已同意");
  check(readyAfterNextGame({ ...fin, nextGameReady: ["p0"] }, "p0", {}, gameKeyOf(G1)) === null, "N3 已經在名單裡（廣播先到）：不重複加");
  // 審伯的情境：第 4 位的請求還在途中就先收到 mj_game_start，之後才收到 HTTP 成功（started:true）
  const afterStart = { status: "playing", roundInfo: G2, nextGameReady: [] as string[] };
  const r4 = readyAfterNextGame(afterStart, "p0", { started: true }, gameKeyOf(G1));
  check(r4 === null, "N4 第 4 位：mj_game_start 先到、HTTP 後到（started）→ 新局 nextGameReady 不殘留自己");
  const nextSettle = { status: "finished", roundInfo: G2, nextGameReady: r4 ?? afterStart.nextGameReady };
  check(!nextSettle.nextGameReady.includes("p0"), "N5 新局打完的下一次結算：名單裡沒有自己，下一局按鈕可以按");
  check(readyAfterNextGame({ status: "finished", roundInfo: G1, nextGameReady: ["p1", "p2", "p3"] }, "p0", { started: true }, gameKeyOf(G1)) === null,
    "N6 第 4 位：HTTP（started）比 mj_game_start 先到 → 也不加，等開局事件換畫面");
  // 第 3 位的回應晚到，這時第 4 位已經開了新局（伺服器回 started:false，但畫面已經是新局）
  check(readyAfterNextGame(afterStart, "p0", { started: false }, gameKeyOf(G1)) === null, "N7 第 3 位回應比別人開的新局晚到：不把自己加進新局");
  // 新局開局就八仙過海直接結束：畫面已是新局的結算，上一局的成功回應不能算到這一局
  check(readyAfterNextGame({ status: "finished", roundInfo: G2, nextGameReady: [] }, "p0", { started: false }, gameKeyOf(G1)) === null, "N8 回應到之前已經是別局的結算：不動");
}

// ---- ② state 請求：回前景連發、後送先回、慢慢摸牌 ----
const S = (n: number, fl: Tile[] = []): View => ({ status: "playing", roundInfo: G1, nextGameReady: [], flowers: fl, ...({ turn: n } as object) });
{
  const c = new Client(S(0));
  c.onResume(1000); c.onResume(1004); // visibilitychange、pageshow 連發
  check(c.sent.length === 1, `R1 visibilitychange＋pageshow 連發：只多送 1 個 state 請求（${c.sent.length}）`);
  c.onResume(5000);
  check(c.sent.length === 2, "R2 下一次回前景（隔了幾秒）照常再抓一次");
}
{
  // 前一個輪詢還在途中就回前景：第二個先回、第一個後回
  const c = new Client(S(0));
  c.fetchState(); c.onResume(1000);
  const [first, second] = c.sent;
  check(c.respond(second, S(2)) === "apply" && c.respond(first, S(1)) === "drop", "R3 第二個先回、第一個後回：舊的那份被丟掉");
  check((c.view as unknown as { turn: number }).turn === 2, "R4 畫面停在比較新的狀態，沒有被蓋回去");
}
{
  const c = new Client(S(0));
  c.fetchState(); c.onResume(1000);
  const [first, second] = c.sent;
  check(c.respond(first, S(1)) === "apply" && c.respond(second, S(2)) === "apply" && (c.view as unknown as { turn: number }).turn === 2,
    "R5 照順序回來：兩份都套用，最後是最新的");
}
{
  // 慢慢摸牌：兩個請求送出後開始排隊，回應在排隊中回來，又連發回前景
  const X = flower(140), Y = flower(141);
  const c = new Client(S(0, [X]));
  c.fetchState(); c.onResume(1000);
  const [a, b] = c.sent;
  c.holdFor();
  const va = c.respond(a, S(3, [X, Y])), vb = c.respond(b, S(3, [X, Y]));
  c.onResume(3000); c.onResume(3003);
  check(va === "refetchAfterHold" && vb === "refetchAfterHold" && (c.view as unknown as { turn: number }).turn === 0 && c.sent.length === 2,
    "R6 慢慢摸牌期間：回應不套用、回前景也不送新請求，延後到排隊結束");
  c.release();
  check(c.sent.length === 3, `R7 排隊結束後只重抓 1 次（總共送出 ${c.sent.length} 個）`);
  c.respond(c.sent[2], S(4, [X, Y]));
  check((c.view as unknown as { turn: number }).turn === 4 && c.tracker.onEvent(0, [X, Y]).length === 0, "R8 重抓的結果套用，花牌基線有 X、Y（不重播）");
  // 排隊前就送出、排隊結束後才回來的兩份舊回應：只有最新的那個請求負責重抓，不會連抓兩次
  const c2 = new Client(S(0, [X]));
  c2.fetchState(); c2.fetchState();
  const [o1, o2] = c2.sent;
  c2.holdFor(); c2.release();
  const v1 = c2.respond(o1, S(1)), v2 = c2.respond(o2, S(1));
  check(v1 === "drop" && v2 === "refetchNow" && c2.sent.length === 3, `R9 排隊前送出的兩份在排隊結束後才回：丟掉舊的、只重抓 1 次（${v1}／${v2}）`);
  // 花牌不倒退：新的回應（有 Y）先套用，舊的回應（沒有 Y）晚到被丟掉，Y 不會被當成新補的再播一次
  const c3 = new Client(S(0, [X]));
  c3.fetchState(); c3.fetchState();
  const [p1, p2] = c3.sent;
  c3.respond(p2, S(2, [X, Y])); c3.respond(p1, S(1, [X]));
  check(c3.view.flowers.length === 2 && c3.tracker.onEvent(0, [X, Y]).length === 0, "R10 舊回應晚到：畫面的花還是 2 張、Y 不會重播（花牌紀錄不倒退）");
}

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
