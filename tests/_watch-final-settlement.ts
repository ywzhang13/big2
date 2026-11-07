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

if (failed) process.exit(1);
