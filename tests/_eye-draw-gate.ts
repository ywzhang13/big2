// 審伯退件（眼牌摸牌）：摸到的牌從「摸牌 API 回應」和「座位頻道 mj_draw_tile」兩個來源到，同一次摸牌只能處理一次；
// 綁定這一次摸牌，下一次（含下一局同一個牌 id）照常處理。下面的 Client 照 useMahjong 的 drawTileAction／mj_draw_tile 接法模擬，
// 用假時鐘跑排隊（翻牌 0.8 秒＋停 1 秒）和排隊中的自動打出。
import { EyeDrawGate } from "../lib/mahjong/stateSync";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const SLOW = 1800, WAIT = 6000;

class Client {
  now = 0;
  timers: { at: number; fn: () => void; id: number }[] = [];
  seq = 0;
  gate = new EyeDrawGate();
  hold: { on: boolean; timer?: number; queue: (() => void)[]; slowTile?: number } = { on: false, queue: [] };
  hand: number[] = [1, 2, 3];
  pond: number[] = [];
  hasDrawn = false;
  drawnTileId: number | null = null;
  flips = 0; // 開始翻牌的次數
  holdStarts: number[] = []; // 每次（重新）計時的時間
  setTimer(ms: number, fn: () => void) { const id = ++this.seq; this.timers.push({ at: this.now + ms, fn, id }); return id; }
  clearTimer(id?: number) { this.timers = this.timers.filter((t) => t.id !== id); }
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const t = this.timers[0];
      if (!t || t.at > end) break;
      this.timers.shift(); this.now = t.at; t.fn();
    }
    this.now = end;
  }
  release() { this.clearTimer(this.hold.timer); if (!this.hold.on) return; this.hold.on = false; this.hold.slowTile = undefined; const q = this.hold.queue; this.hold.queue = []; q.forEach((f) => f()); }
  holdFor(ms: number) { this.hold.on = true; this.clearTimer(this.hold.timer); this.holdStarts.push(this.now); this.hold.timer = this.setTimer(ms, () => this.release()); }
  /** 送出摸牌：回傳 API 回應的處理函式 */
  draw(): (tileId: number) => void {
    const token = this.gate.start(true);
    this.holdFor(WAIT);
    return (tileId) => {
      if (!this.gate.claimResponse(token, tileId)) return;
      if (!this.hold.on) return;
      this.holdFor(SLOW); this.hold.slowTile = tileId; this.flips++;
      if (!this.hand.includes(tileId)) this.hand = [...this.hand, tileId];
      this.hasDrawn = true; this.drawnTileId = tileId;
    };
  }
  /** 座位頻道 mj_draw_tile（不排隊） */
  drawTileEvent(tileId: number, serverHand: number[]) {
    if (!this.gate.claimEvent(tileId)) return;
    const slow = this.hold.on;
    if (slow && this.hold.slowTile !== tileId) { this.holdFor(SLOW); this.hold.slowTile = tileId; this.flips++; }
    this.hand = serverHand; this.hasDrawn = true; this.drawnTileId = tileId;
  }
  /** 房間頻道 mj_discard（排隊中就排隊） */
  discardEvent(tileId: number) {
    const apply = () => { this.hand = this.hand.filter((t) => t !== tileId); this.pond = [...this.pond, tileId]; this.hasDrawn = false; this.drawnTileId = null; };
    if (this.hold.on) this.hold.queue.push(apply); else apply();
  }
}
const X = 140; // 摸到的牌（不能胡，伺服器自動打出）

// 1. API 先到 → 1.8 秒動畫播完、自動打出已套用 → 私人事件才晚到
{
  const c = new Client();
  const onResponse = c.draw();
  c.advance(300); c.discardEvent(X); onResponse(X); // 房間頻道的打出先到並排隊、API 回應到 → 開始翻
  check(c.flips === 1 && c.hand.includes(X) && c.pond.length === 0, "A1 API 先到：開始翻牌，打出還在排隊");
  c.advance(1799);
  check(c.pond.length === 0, "A2 翻牌＋停 1 秒還沒播完：海底還沒出現打出的牌");
  c.advance(1);
  check(c.pond.includes(X) && !c.hand.includes(X) && c.hasDrawn === false, `A3 播完 1.8 秒才打出（第 ${c.now - 300}ms）`);
  c.advance(700); c.drawTileEvent(X, [1, 2, 3, X]); // 動畫結束後才到的私人事件
  check(!c.hand.includes(X) && c.hasDrawn === false && c.drawnTileId === null && c.flips === 1 && c.holdStarts.length === 2,
    "A4 動畫結束後才到的私人事件：不加回手牌、不改 hasDrawn／drawnTileId、不重播、不重新計時");
}
// 2. 私人事件先到 → API 回應晚到（動畫中、以及動畫結束後）
for (const late of [900, 2600]) {
  const c = new Client();
  const onResponse = c.draw();
  c.advance(200); c.drawTileEvent(X, [1, 2, 3, X]); c.discardEvent(X);
  const startedAt = c.now;
  c.advance(late); onResponse(X);
  check(c.flips === 1 && c.holdStarts.length === 2, `B1 私人事件先到、API 晚 ${late}ms 到：不重播、不重新計時`);
  c.advance(4000);
  check(c.pond.includes(X) && !c.hand.includes(X) && c.hasDrawn === false && c.drawnTileId === null,
    `B2 私人事件先到、API 晚 ${late}ms：打出在第 ${1800}ms 套用後不被蓋回（手牌沒有 ${X}、hasDrawn=false）`);
  void startedAt;
}
// 3. 綁定這一次摸牌：下一局用到同一個牌 id 照常翻牌
{
  const c = new Client();
  let onResponse = c.draw();
  c.advance(200); onResponse(X); c.discardEvent(X); c.advance(2000); c.drawTileEvent(X, [1, 2, 3, X]);
  c.gate.reset(); // mj_game_start
  c.hand = [1, 2, 3]; c.pond = [];
  onResponse = c.draw();
  c.advance(200); c.drawTileEvent(X, [1, 2, 3, X]);
  check(c.flips === 2 && c.hand.includes(X), "C1 下一局摸到同一個牌 id：私人事件照常處理、照常翻牌");
  c.discardEvent(X); onResponse(X); c.advance(2000);
  check(c.pond.includes(X) && !c.hand.includes(X), "C2 下一局那次的 API 回應晚到：同樣只處理一次，打出照常套用");
}
// 4. 同一局的下一次摸牌（新的一次 start）摸到別張：照常處理；上一次的 API 回應晚到不能影響這一次
{
  const c = new Client();
  const first = c.draw();
  c.advance(200); c.drawTileEvent(X, [1, 2, 3, X]); c.discardEvent(X); c.advance(2000);
  const second = c.draw();
  first(X); // 上一次摸牌的 API 回應非常晚才到
  check(c.flips === 1 && !c.hand.includes(X), "D1 上一次摸牌的 API 回應晚到：不碰這一次（token 已換）");
  c.advance(200); second(141);
  check(c.flips === 2 && c.hand.includes(141), "D2 這一次的 API 回應照常開始翻牌");
}
// 5. 不是眼牌者：私人事件一律照常處理
{
  const g = new EyeDrawGate();
  g.start(false);
  check(g.claimEvent(X) && g.claimEvent(X), "E1 不是眼牌者：mj_draw_tile 照常處理（不去重）");
}

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
