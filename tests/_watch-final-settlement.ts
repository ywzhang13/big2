// 單元測試（老闆 2026-11-08）：觀戰最後一把的結算畫面。整場打完伺服器會刪房，下一次 pull() 一定會
// 拿到 404／410；在這之前要先讓觀戰者看到結算（誰胡、胡什麼、台數、輸贏），不能一胡就直接被踢回錯誤頁。
// 這裡對照 app/mahjong/watch/page.tsx 的 shouldExitOnRoomGone()（跟實際程式是同一個函式）。
// 另外對照 applyGameOverEvent()：伺服器會「先廣播 mj_game_over、才刪房」，所以廣播一定送得到；
// 這個函式直接用廣播內容蓋出結算畫面，不用等注定會撲空的下一次輪詢。
import { applyGameOverEvent, shouldExitOnRoomGone, type GameOverPayload } from "../app/mahjong/watch/page";
import type { SpectateView } from "../lib/mahjong/spectateClient";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// 情境 1：還沒看過最後一把結算時，404／410 照舊視為房間中途關閉，自動退出（規格④：行為不變）
check(shouldExitOnRoomGone(404, false) === true, "還沒看過結算：404 照舊自動退出");
check(shouldExitOnRoomGone(410, false) === true, "還沒看過結算：410 照舊自動退出");

// 情境 2：已經看過最後一把的結算（gameOver＋winner）之後，404／410 是伺服器把打完的房間刪掉，
// 不是中途關閉，結算畫面要留著，不能自動退出
check(shouldExitOnRoomGone(404, true) === false, "已看過最後一把結算：404 不自動退出，結算留著");
check(shouldExitOnRoomGone(410, true) === false, "已看過最後一把結算：410 不自動退出，結算留著");

// 情境 3：403（主動收回觀戰權限）不受「已看過結算」影響，一律立刻退出
check(shouldExitOnRoomGone(403, false) === true, "403（收回權限）：還沒看過結算時照舊退出");
check(shouldExitOnRoomGone(403, true) === true, "403（收回權限）：就算已看過最後一把結算也照舊退出，不因為結算而留著");

// 情境 4：applyGameOverEvent() 把廣播內容套進畫面——誰胡、台數、輸贏、整場結算都要出現
{
  const before = {
    status: "playing", currentTurn: 3, lastDiscard: null, playerScores: [0, 0, 0, 0],
  } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: 2, winnerName: "小林", score: { fan: 5, points: 100 },
    winners: [{ seat: 2, name: "小林", score: { fan: 5, points: 100 } }],
    settlement: { seat2: 300, seat0: -100 }, playerScores: [-100, 0, 300, -200],
    roundInfo: { currentRound: 2, currentGame: 4, dealerConsecutive: 0 }, gameOver: true,
    remainingWall: [], handStats: { zimo: [0, 0, 1, 0] },
  };
  const after = applyGameOverEvent(before, payload);
  check(after !== null, "套用廣播後：view 不是 null");
  check(after?.status === "finished", "套用廣播後：status 變成 finished");
  check(after?.winner?.seat === 2, "套用廣播後：winner.seat 是真的胡牌的那家");
  check(after?.winner?.name === "小林", "套用廣播後：winner.name 正確");
  check(after?.gameOver === true, "套用廣播後：gameOver 是 true（整場打完，不是只有這一局）");
  check(JSON.stringify(after?.playerScores) === JSON.stringify([-100, 0, 300, -200]), "套用廣播後：playerScores（輸贏）正確");
  check(after?.settlement !== undefined, "套用廣播後：settlement（結算明細）有值");
}

// 情境 5：view 還是 null（還沒拿過任何一次視角）時不套，等正常的 pull() 建立基線，不會用半份資料硬湊畫面
{
  const payload: GameOverPayload = {
    winnerSeat: 0, winnerName: "阿德", score: {}, winners: [], settlement: {}, roundInfo: null, gameOver: true,
  };
  check(applyGameOverEvent(null, payload) === null, "view 還是 null 時：applyGameOverEvent 回傳 null，不硬湊畫面");
}

// 對照 app/mahjong/watch/page.tsx 的 mj_game_over handler：next=applyGameOverEvent(view,p)；
// 只有 next 不是 null（真的套用成功）而且 p.gameOver===true 才設最終旗標（審伯必修①）
const wouldMarkFinal = (view: SpectateView | null, p: GameOverPayload): boolean =>
  applyGameOverEvent(view, p) !== null && p.gameOver === true;

const midGameView = { status: "playing", currentTurn: 1, lastDiscard: null, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;

// 情境 6（審伯必修①）：不是整場最後一局（gameOver=false）的 mj_game_over，不能設最終旗標；
// 之後收到 404／410 要照舊自動退出，不能被誤留在這一局的結算畫面上
{
  const midHandPayload: GameOverPayload = {
    winnerSeat: 1, winnerName: "老王", score: { fans: ["平胡"], totalFan: 1 }, winners: [],
    settlement: {}, playerScores: [0, 100, -50, -50], roundInfo: { currentRound: 1, currentGame: 2, dealerConsecutive: 0 }, gameOver: false,
  };
  const applied = applyGameOverEvent(midGameView, midHandPayload);
  check(applied !== null, "不是最後一局：事件照樣套用，結算畫面會正常顯示這一局的結果");
  check(applied?.status === "finished", "不是最後一局：status 一樣變成 finished（這一局的結算）");
  check(wouldMarkFinal(midGameView, midHandPayload) === false, "不是最後一局（gameOver=false）：不設最終旗標");
  check(shouldExitOnRoomGone(404, wouldMarkFinal(midGameView, midHandPayload)) === true, "不是最後一局之後收到 404：照舊自動退出");
  check(shouldExitOnRoomGone(410, wouldMarkFinal(midGameView, midHandPayload)) === true, "不是最後一局之後收到 410：照舊自動退出");
}

// 情境 7（審伯必修②）：最後一局是流局——score 是 null、winnerSeat 是 -1，要能正常顯示不壞畫面，
// allHands（四家攤牌）要帶進去；之後收到 404／410 要留在結算畫面
{
  const allHands = [
    { seat: 0, name: "阿德", hand: [], revealed: [], flowers: [] },
    { seat: 1, name: "阿美", hand: [], revealed: [], flowers: [] },
    { seat: 2, name: "小林", hand: [], revealed: [], flowers: [] },
    { seat: 3, name: "老王", hand: [], revealed: [], flowers: [] },
  ];
  const drawPayload: GameOverPayload = {
    winnerSeat: -1, winnerName: null, score: null, winners: [], allHands,
    settlement: { seat0: 0, seat1: 0, seat2: 0, seat3: 0 }, playerScores: [0, 0, 0, 0],
    roundInfo: { currentRound: 2, currentGame: 4, dealerConsecutive: 3 }, gameOver: true,
  };
  const after = applyGameOverEvent(midGameView, drawPayload);
  check(after !== null, "流局：applyGameOverEvent 照樣套用，不是 null");
  check(after?.winner?.seat === -1, "流局：winner.seat 是 -1（跟玩家自己畫面同一套流局標記）");
  check(JSON.stringify(after?.winner?.score) === JSON.stringify({ fans: [], totalFan: 0 }), "流局：score 用空值 {fans:[],totalFan:0}，不是 null，不會讓 MjResultMobile 讀 score.fans 壞掉");
  check(Array.isArray(after?.winner?.allHands) && after!.winner!.allHands!.length === 4, "流局：allHands（四家攤牌）正確帶入 winner.allHands");
  check(wouldMarkFinal(midGameView, drawPayload) === true, "整場最後一局是流局（gameOver=true）：照樣設最終旗標");
  check(shouldExitOnRoomGone(404, wouldMarkFinal(midGameView, drawPayload)) === false, "最後一局流局之後收到 404：不自動退出，留在結算畫面");
  check(shouldExitOnRoomGone(410, wouldMarkFinal(midGameView, drawPayload)) === false, "最後一局流局之後收到 410：不自動退出，留在結算畫面");
}

// 情境 8（審伯必修①）：事件比第一次 view 還早到（view 還是 null）——不設最終旗標，也不會卡在「載入中」
// 以外的狀態（applyGameOverEvent 回傳 null，程式不會呼叫 setView，畫面維持原本的載入流程）
{
  const lastHandPayload: GameOverPayload = {
    winnerSeat: 0, winnerName: "阿德", score: { fans: ["大三元"], totalFan: 16 }, winners: [],
    settlement: {}, roundInfo: null, gameOver: true,
  };
  check(applyGameOverEvent(null, lastHandPayload) === null, "事件比第一次 view 早到：applyGameOverEvent 回傳 null（不會硬湊一份不完整的畫面）");
  check(wouldMarkFinal(null, lastHandPayload) === false, "事件比第一次 view 早到：就算 gameOver=true 也不設最終旗標");
  check(shouldExitOnRoomGone(404, wouldMarkFinal(null, lastHandPayload)) === true, "事件比第一次 view 早到、接著收到 404：照舊自動退出（不會卡住不動）");
}

// 情境 9（審伯必修①）：資料缺欄位（gameOver 不是 true，例如事件格式有缺或還沒帶上這個欄位）——
// 就算有 winnerSeat、view 也不是 null，照舊不設最終旗標，避免把不確定是不是最後一局的事件誤判成整場結束
{
  const incompletePayload = {
    winnerSeat: 2, winnerName: "小林", score: { fans: ["碰碰胡"], totalFan: 4 }, winners: [],
    settlement: {}, roundInfo: null,
  } as unknown as GameOverPayload; // 缺 gameOver 欄位
  const applied = applyGameOverEvent(midGameView, incompletePayload);
  check(applied !== null, "資料缺 gameOver 欄位：還是有 view 可以套用，畫面不會空白");
  check(wouldMarkFinal(midGameView, incompletePayload) === false, "資料缺 gameOver 欄位：不設最終旗標（gameOver !== true）");
  check(shouldExitOnRoomGone(404, wouldMarkFinal(midGameView, incompletePayload)) === true, "資料缺欄位之後收到 404：照舊自動退出，不會誤留在畫面上");
}

if (failed) process.exit(1);
