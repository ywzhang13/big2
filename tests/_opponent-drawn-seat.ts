// 單元測試（老闆 2026-11-08 第二次更正）：別家手牌欄「摸到的那張空一格」不再用張數 % 3 猜，
// 改成照 hooks/useMahjong.ts 的事件真的推出 drawnSeat（只有這個座位可以同時間持有）。
// 這裡用一份小 reducer 原樣對應 hooks/useMahjong.ts 這幾個事件處理裡「drawnSeat 怎麼變」的規則
// （mj_draw 設、mj_discard／mj_action／mj_game_start 清），重現六種真的會發生的情境：
//   摸牌、吃、碰、連續吃碰（吃完又碰）、槓後補牌（明槓→補牌）、補花完成後（補花鏈最後一張收尾）
// 每一步都驗證：只有真的摸進那張的座位 drawnSeat 會指到它，吃／碰／槓完成（還沒摸補牌前）一律是 null（貼緊）。
import { SyncPolicy } from "../lib/mahjong/syncPolicy";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

type MiniState = { drawnSeat: number | null };

/** 對應 hooks/useMahjong.ts 的 mj_draw handler：drawnSeat 設成剛摸牌的座位（含槓後、補花後補牌） */
const onDraw = (s: MiniState, seat: number): MiniState => ({ ...s, drawnSeat: seat });
/** 對應 mj_discard handler：打出的那家如果正持有 drawnSeat 就清掉 */
const onDiscard = (s: MiniState, seat: number): MiniState => ({ ...s, drawnSeat: s.drawnSeat === seat ? null : s.drawnSeat });
/** 對應 mj_action（chi/pong/kong/concealed_kong）handler：吃碰槓都不是摸牌，清掉 */
const onAction = (s: MiniState, seat: number): MiniState => ({ ...s, drawnSeat: s.drawnSeat === seat ? null : s.drawnSeat });
/** 對應 mj_game_start handler：新局開始，莊家的 17 張是發的不是摸的 */
const onGameStart = (): MiniState => ({ drawnSeat: null });
/** 對應 fetchState 套用權威快照那次 setState（審伯複審必修）：快照沒有「誰剛摸牌」這個欄位，
 *  沒辦法分辨是不是漏接了 mj_discard／mj_action，一律歸零，之後只靠新的 mj_draw 設回來 */
const onSnapshot = (s: MiniState): MiniState => ({ ...s, drawnSeat: null });

const A = 0, B = 1, C = 2, D = 3; // 四個座位

// 情境 1：單純摸牌——只有摸牌的那家空一格，其他三家一律 null（貼緊）
{
  let s: MiniState = onGameStart();
  s = onDraw(s, A);
  check(s.drawnSeat === A, "摸牌：摸牌的那家 drawnSeat 指到自己");
  check(s.drawnSeat !== B && s.drawnSeat !== C && s.drawnSeat !== D, "摸牌：其他三家不會被誤判成摸牌");
}

// 情境 2：吃——A 打牌，B 吃走：B 吃完待出牌時要貼緊（drawnSeat 不是 B）
{
  let s: MiniState = onGameStart();
  s = onDraw(s, A);
  s = onDiscard(s, A); // A 打出，自己的摸牌格收回
  check(s.drawnSeat === null, "A 打牌後：drawnSeat 收回，貼緊");
  s = onAction(s, B); // B 吃
  check(s.drawnSeat === null, "吃：B 吃完待出牌，drawnSeat 不是 B（貼緊，不是摸牌的空格）");
}

// 情境 3：碰——同上，碰的人待出牌一樣要貼緊
{
  let s: MiniState = onGameStart();
  s = onDraw(s, A);
  s = onDiscard(s, A);
  s = onAction(s, C); // C 碰
  check(s.drawnSeat === null, "碰：C 碰完待出牌，drawnSeat 不是 C（貼緊）");
}

// 情境 4：連續吃碰——B 吃完打牌，C 馬上碰：兩次都要貼緊，中間 B 打牌也不會誤設成摸牌
{
  let s: MiniState = onGameStart();
  s = onDraw(s, A);
  s = onDiscard(s, A);
  s = onAction(s, B); // B 吃
  check(s.drawnSeat === null, "連續吃碰 1/2：B 吃完，貼緊");
  s = onDiscard(s, B); // B 吃完打牌
  check(s.drawnSeat === null, "連續吃碰：B 打牌後 drawnSeat 仍是 null（打牌前就已經是 null，不會被打亂）");
  s = onAction(s, C); // C 碰 B 剛打出的牌
  check(s.drawnSeat === null, "連續吃碰 2/2：C 緊接著碰，貼緊，不會因為 B 的動作殘留成 C 摸牌");
}

// 情境 5：槓後補牌——D 明槓（mj_action）之後，伺服器會再送一次 mj_draw 補牌：槓的當下貼緊，補牌那一刻才空格
{
  let s: MiniState = onGameStart();
  s = onDraw(s, A);
  s = onDiscard(s, A);
  s = onAction(s, D); // D 明槓（吃掉 A 打的那張）
  check(s.drawnSeat === null, "槓：剛明槓完，drawnSeat 不是 D（還沒補牌，貼緊）");
  s = onDraw(s, D); // 槓後補牌：伺服器再送一次 mj_draw
  check(s.drawnSeat === D, "槓後補牌：補到牌的那一刻，D 的 drawnSeat 指到自己，空一格");
}

// 情境 6：補花完成後——A 連續補兩張花，每次 mj_draw 都重設 drawnSeat；補花鏈收尾後，A 真的補到一張普通牌，
// 仍然只有 A 空格，其他家不受影響（且前一輪留下的 drawnSeat 不會在補花過程中錯誤殘留給別家）
{
  let s: MiniState = onGameStart();
  s = onDraw(s, B); // 上一位 B 先摸過一次（drawnSeat=B，確保接下來不是巧合地剛好是 null）
  s = onDiscard(s, B);
  s = onDraw(s, A); // A 摸到第一張花
  check(s.drawnSeat === A, "補花鏈 1/2：A 摸到花，drawnSeat 先指到 A");
  s = onDraw(s, A); // 補花後再補一張（可能又是花，伺服器一樣送 mj_draw）
  check(s.drawnSeat === A, "補花鏈 2/2：連續補花期間，drawnSeat 一直是 A，沒有被清掉或指到別家");
  s = onDraw(s, A); // 補花鏈收尾：補到一張普通牌，一樣是同一個座位的 mj_draw
  check(s.drawnSeat === A, "補花完成後：補到普通牌，A 仍然空一格");
  check(s.drawnSeat !== C && s.drawnSeat !== D, "補花完成後：沒摸牌的 C、D 不會被誤判成摸牌");
  s = onDiscard(s, A); // A 打出
  check(s.drawnSeat === null, "A 打出補花後補到的牌：drawnSeat 收回，貼緊");
}

// 情境 7：套用權威快照（重新整理、切回前景、中途進房、觀戰）——審伯複審必修：先讓某家處在
// 「剛摸牌」狀態，套用快照後這個狀態一定要被清掉，不能殘留給錯的座位
{
  let s: MiniState = onGameStart();
  s = onDraw(s, B); // B 摸牌，drawnSeat=B（故意先設成非空，確認快照真的會歸零，不是本來就是 null）
  check(s.drawnSeat === B, "套用快照前：drawnSeat 先是 B（確保接下來不是巧合地剛好是 null）");
  s = onSnapshot(s); // fetchState 拿到權威快照（可能漏收了 B 打牌或被吃碰的事件）
  check(s.drawnSeat === null, "套用權威快照後：drawnSeat 一律歸零，不會把空格錯留在 B 身上");
  s = onDraw(s, C); // 快照之後，真的收到 C 摸牌的事件
  check(s.drawnSeat === C, "快照之後新的 mj_draw：drawnSeat 正確設回真正摸牌的 C");
}

// 情境 8～10（老闆 2026-11-08 必修）：情境 7 的 onSnapshot 是舊做法（快照一律歸零），用來對照
// 「漏收事件」這個規則本身沒有變。新規則是：套用快照前先用 hooks/useMahjong.ts 真的在用的
// SyncPolicy.isAtLatest 比對版本（stateSv === 目前靠事件推出來的最新版本，才算沒有漏事件），
// 不是只看快照本身——所以這裡直接用真的 SyncPolicy，不是重寫一個簡化版，確保測的是真邏輯。
// 對應 onHeld（事件走這裡）＋ fetchState（套用權威快照走這裡，isAtLatest 的呼叫順序一定要在
// noteVersion(sv,{fromState:true}) 之前，不然比不出來）這兩段真正的程式流程。
const makeRoom = () => {
  const sync = new SyncPolicy();
  let s: MiniState = { drawnSeat: null };
  const event = (sv: number, apply: (s: MiniState) => MiniState) => {
    if (sync.isStale(sv)) return; // 亂序晚到的舊事件：不套用（跳號補抓不是這份測試的重點，見 _sync-policy.ts）
    s = apply(s);
    sync.noteVersion(sv);
  };
  const draw = (sv: number, seat: number) => event(sv, (st) => onDraw(st, seat));
  const discard = (sv: number, seat: number) => event(sv, (st) => onDiscard(st, seat));
  const action = (sv: number, seat: number) => event(sv, (st) => onAction(st, seat));
  const snapshot = (stateSv: number) => {
    const caughtUp = sync.isAtLatest(stateSv); // 一定要在 noteVersion(fromState) 之前比
    sync.noteVersion(stateSv, { fromState: true });
    s = { ...s, drawnSeat: caughtUp ? s.drawnSeat : null };
  };
  return { get drawnSeat() { return s.drawnSeat; }, draw, discard, action, snapshot };
};

// 情境 8：自己打牌後觸發的 fetchState，比下一家的 mj_draw 晚回來（沒有漏任何事件，只是請求比較慢）——
// 空格要保留，不能被這份「過時但沒漏事件」的快照清掉
{
  const room = makeRoom();
  room.draw(1, A); // A 摸牌
  room.discard(2, A); // A 打出（我方），這一步在真的程式裡會觸發 fetchState(rid) 送出
  room.draw(3, B); // 下一家 B 馬上摸牌，mj_draw 廣播先到，drawnSeat=B
  check(room.drawnSeat === B, "情境8：B 摸牌，drawnSeat 先指到 B");
  room.snapshot(3); // 我方那次 fetchState 現在才回來，伺服器回的版本剛好是 3（已經涵蓋 B 摸牌，沒有漏事件）
  check(room.drawnSeat === B, "情境8：fetchState 比下一家 mj_draw 晚回來但版本追上了，B 的空格不會被清掉");
}

// 情境 9：快照版本領先已經收到的事件版本（真的漏了還沒收到的事件，例如重新整理、斷線重連）——
// 空格要清掉，不能留在錯的座位上
{
  const room = makeRoom();
  room.draw(1, A);
  room.discard(2, A);
  room.draw(3, B); // B 摸牌，drawnSeat=B，目前看過的版本是 3
  check(room.drawnSeat === B, "情境9：B 摸牌，drawnSeat 先指到 B");
  room.snapshot(5); // 快照版本是 5，比看過的 3 新了 2 版：中間漏了（例如 B 打牌、C 的動作）我們沒收到的事件
  check(room.drawnSeat === null, "情境9：快照版本領先事件版本（漏收事件），空格要清掉，不會錯留在 B 身上");
}

// 情境 10：一般情況（沒有競速）——fetchState 剛好在下一家摸牌之前就回來，版本跟事件一樣新，
// 保留目前正確的值（null），之後收到的新摸牌事件照樣能正確設回來，確認新規則不影響平常的情況
{
  const room = makeRoom();
  room.draw(1, A);
  room.discard(2, A); // A 打出，drawnSeat 收回成 null，目前版本是 2
  room.snapshot(2); // fetchState 剛好在 B 摸牌之前回來，版本跟事件一樣是 2：沒有漏事件
  check(room.drawnSeat === null, "情境10：沒有競速時，快照version追上，drawnSeat 維持原本正確的 null");
  room.draw(3, B); // 之後才收到 B 摸牌
  check(room.drawnSeat === B, "情境10：收到新的 mj_draw 之後，照樣正確設回摸牌的 B");
}

// 情境 11～12（老闆 2026-11-08 複審必修）：漏收事件之後，即使之後更晚的事件把版本追上了，版本號
// 相等也不能當成「沒漏事件」——漏掉的那個事件可能正好會改掉 drawnSeat，只有真的套用一次完整快照
// 才能保證資料正確。對應 isAtLatest 內部新增的 missedSinceState 記號（見 _sync-policy.ts）

// 情境 11：漏收 mj_discard（B 打牌）之後，收到更晚的事件（C 的動作），再套用同版本快照——
// 版本剛好等於目前版本，但這段時間真的漏過事件，drawnSeat 還是要清掉，不能留在 B 身上
{
  const room = makeRoom();
  room.draw(3, B); // B 摸牌，sv=3，drawnSeat=B
  check(room.drawnSeat === B, "情境11：B 摸牌，drawnSeat 先指到 B");
  // 漏收 B 打牌（sv=4，mj_discard）：不呼叫 room.discard(4, B)，模擬這個事件真的沒收到
  room.action(5, C); // C 的動作（sv=5）先到：版本從 3 直接跳到 5，中間漏了 4
  check(room.drawnSeat === B, "情境11：漏收期間，C 的動作不影響 B 的 drawnSeat（C 不是 B，不會被清掉）");
  room.snapshot(5); // 快照版本剛好是 5，等於目前看過的最新版本——但這段時間真的跳過號
  check(room.drawnSeat === null, "情境11：漏 mj_discard 之後版本追上，快照還是要清掉 drawnSeat，不能錯留在 B 身上");
}

// 情境 12：漏收 mj_action（例如槓）之後，收到更晚的事件（D 摸牌），再套用同版本快照——
// 版本剛好等於目前版本，但一樣要清掉（即使 D 摸牌事件本身是真的收到、drawnSeat 目前剛好是對的）
{
  const room = makeRoom();
  room.draw(3, B); // B 摸牌，sv=3，drawnSeat=B
  check(room.drawnSeat === B, "情境12：B 摸牌，drawnSeat 先指到 B");
  // 漏收 B 的動作（sv=4，例如明槓）：不呼叫 room.action(4, B)
  room.draw(5, D); // D 摸牌（sv=5）先到：版本從 3 跳到 5，中間漏了 4
  check(room.drawnSeat === D, "情境12：D 摸牌事件本身有收到，drawnSeat 先正確指到 D");
  room.snapshot(5); // 快照版本剛好是 5，等於目前版本——但這段時間一樣漏過號
  check(room.drawnSeat === null, "情境12：漏 mj_action 之後版本追上，即使目前的 drawnSeat 剛好正確，快照還是要清掉，不能僥倖留著");
}

if (failed) process.exit(1);
