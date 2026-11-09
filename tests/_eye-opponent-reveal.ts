// 老闆回報（2026-11-09）：眼牌時偶爾看不到其他玩家摸的牌，尤其對方也眼牌時更容易發生。
// 根因（實測重現確認）：別家也眼牌時，伺服器在同一個請求裡「摸牌→不能胡就自動打出剛摸到的那張」一次做完，
// eyeViewEvents() 算出來的 opponentHands 快照已經是打出後的狀態（drawnTileId 一律 null）；而且因為摸到的
// 牌＝打出的牌，手牌內容打前打後完全一樣，連「有變化」的蛛絲馬跡都沒有。加上 mj_opponent_hands 原本在
// SLOW_DRAW_PASS 裡、不排隊直接套用，這份「什麼都沒看到」的最終快照在 t=0（mj_draw 剛到）就蓋上去，跟畫面
// 上還在跑的「X 摸牌中」1.8 秒提示完全脫節——使用者盯著提示等，手牌其實早就「靜悄悄」定案，沒有任何畫面
// 證據能看到那張牌。
// 修法（hooks/useMahjong.ts）：
//   ① mj_opponent_hands 移出 SLOW_DRAW_PASS，跟著排隊，不再搶在節奏前面套用
//   ② mj_draw 收到「別家也眼牌」時，記下 pendingEyeRevealSeatRef（前提：我自己也眼牌，看得到這家的手牌）
//   ③ 另外直接訂閱 mj_discard（不進排隊）：打出的那張＝剛摸到的那張（眼牌自動摸打的規則），
//      借它合成一份暫時揭露（手牌多放這張＋標成剛摸到），撐到步驟①延後的權威快照套用為止
// 這裡用一份小 Client 複刻這三段邏輯（跟 tests/_eye-draw-gate.ts、tests/_opponent-drawn-seat.ts 同一種做法：
// hooks/useMahjong.ts 不會另外匯出內部的事件處理函式，所以用同樣規則的小型狀態機重現，直接測試真的會發生的情境）
let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

type Hand = { seat: number; hand: number[]; drawnTileId: number | null };

class Client {
  mySeat = 0;
  eyeSeats = new Set<number>();
  opponentHands: Hand[] | null = null;
  hold = { on: false, queue: [] as (() => void)[] };
  pendingEyeRevealSeat: number | null = null;

  holdFor() { this.hold.on = true; }
  /** 排隊中的事件到點才放行（測試用：直接呼叫，不用真的計時器） */
  release() {
    this.hold.on = false;
    const q = this.hold.queue; this.hold.queue = [];
    this.pendingEyeRevealSeat = null; // 保險：等的這家沒有打出（例如自動自摸整局結束），記號不能留到下一次
    q.forEach((fn) => fn());
  }
  /** 對應 hooks/useMahjong.ts 房間頻道 useEffect 的 cleanup（換房／roomCode 變了會重跑，不是整個元件卸載重建；
   *  座位編號不是跨房間的唯一值，審伯必修：換房沒清掉就會被新房間同一個座位的事件誤套用） */
  leaveRoom() {
    this.hold.on = false;
    this.hold.queue = [];
    this.pendingEyeRevealSeat = null;
    this.opponentHands = null;
  }
  /** mj_draw（別家）：對應 hooks/useMahjong.ts 的節奏判斷＋記下揭露記號 */
  onDraw(seat: number) {
    if (seat !== this.mySeat && this.eyeSeats.has(seat)) {
      this.holdFor();
      this.pendingEyeRevealSeat = this.eyeSeats.has(this.mySeat) ? seat : null;
    } else {
      this.pendingEyeRevealSeat = null;
    }
  }
  /** mj_opponent_hands（排隊版）：對應移出 SLOW_DRAW_PASS 之後的行為 */
  onOpponentHands(hands: Hand[]) {
    const apply = () => { this.opponentHands = hands; };
    if (this.hold.on) this.hold.queue.push(apply); else apply();
  }
  /** mj_discard（另外直接訂閱，不排隊）：打出的那張＝剛摸到的那張，借它合成暫時揭露 */
  onDiscardReveal(seat: number, tile: number) {
    if (this.pendingEyeRevealSeat !== seat) return;
    this.pendingEyeRevealSeat = null;
    if (!this.opponentHands) return;
    const idx = this.opponentHands.findIndex((h) => h.seat === seat);
    if (idx === -1 || this.opponentHands[idx].hand.includes(tile)) return;
    this.opponentHands = this.opponentHands.map((h, i) =>
      i === idx ? { ...h, hand: [...h.hand, tile], drawnTileId: tile } : h
    );
  }
}

const baseHands = (): Hand[] => [
  { seat: 1, hand: [11, 12, 13], drawnTileId: null },
  { seat: 2, hand: [21, 22, 23], drawnTileId: null },
  { seat: 3, hand: [31, 32, 33], drawnTileId: null },
];

// 1. 我也眼牌，別家（也眼牌）摸牌：mj_draw 之後、mj_discard 到之前，opponentHands 還是舊的（排隊中沒有提早洩漏）；
//    mj_discard 一到就能看到剛摸到的那張（暫時揭露），不用等 1.8 秒節奏跑完。
//    審伯必修：權威快照要用「摸前／打後完全相同」的真實案例——眼牌自動摸打的規則是不能胡就打出剛摸到的
//    那張，摸到的牌＝打出的牌，所以打完後 opponentHands 的手牌組成跟摸牌前一模一樣（只是這張牌換到了
//    打出那家的海底），不能用一個內容不同的假快照代替，不然測不出「手牌前後完全沒變、只能靠暫時揭露
//    看到」這個真正的根因情境
{
  const c = new Client();
  c.eyeSeats = new Set([0, 1]); // 我（0）和座位1 都眼牌
  c.opponentHands = baseHands();
  c.onDraw(1);
  check(c.hold.on === true, "A1 別家眼牌摸牌：開始排隊（節奏倒數）");
  check(c.pendingEyeRevealSeat === 1, "A2 我也眼牌：記下等座位1 打出");
  c.onOpponentHands(baseHands()); // 權威快照（已經排隊）：摸到 99 又打出 99，手牌組成跟摸牌前完全相同
  check(c.opponentHands!.find((h) => h.seat === 1)!.hand.join(",") === "11,12,13",
    "A3 權威快照先排隊，不會搶先蓋掉：座位1 的手牌還是摸牌前的舊狀態");
  c.onDiscardReveal(1, 99); // 打出的那張＝剛摸到的那張
  const h1 = c.opponentHands!.find((h) => h.seat === 1)!;
  check(h1.hand.includes(99) && h1.drawnTileId === 99,
    "A4 mj_discard 一到就看得到剛摸到的那張（暫時揭露），不用等排隊放行");
  check(h1.hand.length === 4, "A5 暫時揭露是「多放一張」，不是整份換掉（還留著原本 3 張）");
  c.release(); // 1.8 秒節奏跑完，排隊的權威快照這時才真的套用
  const h1b = c.opponentHands!.find((h) => h.seat === 1)!;
  check(h1b.hand.join(",") === "11,12,13" && h1b.drawnTileId === null,
    "A6 排隊放行後：換成權威快照，手牌跟摸牌前一模一樣（摸到的牌＝打出的牌）——暫時揭露是唯一能看到那張牌的畫面證據");
}

// 2. 連續兩家都眼牌摸牌（老闆特別強調「尤其對方也眼牌時更容易發生」）：每一輪都要看得到，不會因為連續發生就漏掉
{
  const c = new Client();
  c.eyeSeats = new Set([0, 1, 2]);
  c.opponentHands = baseHands();
  // 第一輪：座位1 摸牌→打出
  c.onDraw(1);
  c.onDiscardReveal(1, 14);
  check(c.opponentHands!.find((h) => h.seat === 1)!.drawnTileId === 14, "B1 第一輪（座位1）：看得到摸到的牌");
  c.release();
  // 第二輪：座位2 緊接著摸牌→打出（上一輪的記號不能殘留、也不能擋住這一輪）
  c.onDraw(2);
  check(c.pendingEyeRevealSeat === 2, "B2 第二輪（座位2）：記號正確換成座位2，不是殘留座位1");
  c.onDiscardReveal(2, 24);
  check(c.opponentHands!.find((h) => h.seat === 2)!.drawnTileId === 24, "B3 第二輪（座位2）：連續發生也看得到摸到的牌");
  c.release();
}

// 3. 我不是眼牌：不會誤開這個機制（我看不到任何對手手牌，opponentHands 本來就是 null）
{
  const c = new Client();
  c.eyeSeats = new Set([1]); // 只有座位1 眼牌，我（0）沒有
  c.opponentHands = null;
  c.onDraw(1);
  check(c.pendingEyeRevealSeat === null, "C1 我沒眼牌：不記揭露記號（看不到任何人的手牌，不用猜）");
  c.onDiscardReveal(1, 14); // 不應該丟例外、也不應該生出 opponentHands
  check(c.opponentHands === null, "C2 我沒眼牌：mj_discard 到了也不會生出 opponentHands");
}

// 4. 這家摸牌後沒有打出（例如直接自摸整局結束）：記號不能留到下一次不相干的摸牌
{
  const c = new Client();
  c.eyeSeats = new Set([0, 1, 3]);
  c.opponentHands = baseHands();
  c.onDraw(1); // 座位1 摸到能自摸的牌，整局結束，不會有 mj_discard
  check(c.pendingEyeRevealSeat === 1, "D1 座位1 摸牌：先記下等打出");
  c.release(); // 整局結束／換局時的收尾：沒等到打出也要清掉
  check(c.pendingEyeRevealSeat === null, "D2 沒等到打出（自摸結束）：保險清掉，不留到下一局");
  c.onDraw(3); // 下一局，座位3 摸牌
  c.onDiscardReveal(1, 999); // 座位1 這張晚到的、不相干的打出事件（不應該發生，但防禦一下）
  check(c.opponentHands!.find((h) => h.seat === 1)!.drawnTileId === null,
    "D3 殘留、對不上目前記號的打出事件：不會誤套用到座位1");
}

// 5. 打出的那張剛好已經在暫存的手牌裡（防禦：不重複加）
{
  const c = new Client();
  c.eyeSeats = new Set([0, 1]);
  c.opponentHands = baseHands();
  c.onDraw(1);
  c.onDiscardReveal(1, 12); // 12 本來就在座位1 手牌裡
  check(c.opponentHands!.find((h) => h.seat === 1)!.hand.join(",") === "11,12,13",
    "E1 打出的牌已經在暫存手牌裡：不重複加、不覆蓋 drawnTileId");
}

// 6. 換房（審伯必修）：座位1 在舊房間摸牌、還沒等到打出就離開房間（換房或分頁導去別的房間）；
//    新房間同一個座位編號（1）打出牌，不能被舊房間殘留的揭露記號誤套用到新房間的 opponentHands
{
  const c = new Client();
  c.eyeSeats = new Set([0, 1]);
  c.opponentHands = baseHands();
  c.onDraw(1); // 舊房間：座位1 摸牌，還沒打出
  check(c.pendingEyeRevealSeat === 1, "F1 舊房間：座位1 摸牌，先記下等打出");
  c.leaveRoom(); // 換房：對應 hooks/useMahjong.ts 房間頻道 useEffect 的 cleanup
  check(c.pendingEyeRevealSeat === null, "F2 換房：舊房間殘留的揭露記號要清掉");
  // 新房間：重新訂閱、拿到新房間的眼牌名單和手牌快照（座位編號會重複使用，但跟舊房間無關）
  c.eyeSeats = new Set([0, 1]);
  c.opponentHands = baseHands();
  c.onDiscardReveal(1, 999); // 新房間剛好座位1 也打出一張牌（這次不是先 onDraw，模擬舊記號如果沒清掉會被誤套用）
  check(c.opponentHands!.find((h) => h.seat === 1)!.drawnTileId === null,
    "F3 新房間座位1 打牌：沒有先收到新房間自己的 mj_draw，舊記號已經清掉，不會誤揭露");
  // 新房間照正常流程走一次，確認換房後機制本身還是正常可用，不是被誤關掉
  c.onDraw(1);
  c.onDiscardReveal(1, 888);
  check(c.opponentHands!.find((h) => h.seat === 1)!.drawnTileId === 888,
    "F4 新房間照正常流程摸牌→打出：換房後機制本身照常可用");
}

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
