// 單元測試（老闆 2026-11-08）：觀戰最後一把的結算畫面。整場打完伺服器會刪房，下一次 pull() 一定會
// 拿到 404／410；在這之前要先讓觀戰者看到結算（誰胡、胡什麼、台數、輸贏），不能一胡就直接被踢回錯誤頁。
// 這裡對照 app/mahjong/watch/page.tsx 的 shouldExitOnRoomGone()（跟實際程式是同一個函式）。
import { shouldExitOnRoomGone } from "../app/mahjong/watch/page";

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

if (failed) process.exit(1);
