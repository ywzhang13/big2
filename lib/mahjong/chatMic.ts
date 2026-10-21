// 「按住說話」的錄音流程（從 MjChat 拿出來，node 測試可以直接跑：tests/_chat-mic.ts）。
// 換場（帳號、房間、玩家、座位改變，或不能再發送）時呼叫 reset()（審伯 2026-10-21 退回①）：
//   ・錄音中：取消（MediaRecorder 停、麥克風 track 全停、10 秒計時器清掉），不上傳
//   ・還在等麥克風權限：權限回來時馬上取消、停掉 track，不顯示錯誤、不上傳
//   ・舊那一場的 callback（錄完、權限結果）一律作廢：靠 gen 判斷，不會把錄音送到新的一場
import type { MicError } from "./chatClient";

export type RecHandle = { stop: () => void; cancel: () => void };
type Start = (onDone: (blob: Blob | null, ms: number) => void) => Promise<RecHandle | MicError>;

export function createChatMic(start: Start, send: (blob: Blob, ms: number) => void) {
  let gen = 0;
  let handle: RecHandle | null = null;
  let starting = false;
  let pending: "stop" | "cancel" | null = null; // 麥克風還沒開好就放開了：開好後照這個意思處理

  return {
    /** 錄音中或正在開麥克風 */
    busy: () => !!handle || starting,
    /** 按下：開麥克風開始錄。onEnd＝這次錄音結束（送出或取消）；回傳 stale＝等權限的時候換場了 */
    async down(onEnd: () => void): Promise<"ok" | "stale" | MicError> {
      const g = gen;
      starting = true;
      pending = null;
      const h = await start((blob, ms) => {
        if (g !== gen) return; // 舊的一場：不送、也不碰畫面
        handle = null;
        onEnd();
        if (blob) send(blob, ms);
      });
      if (g !== gen) { // 等權限的時候換場：錄音器（如果有）馬上取消，track 隨之停掉
        if (typeof h !== "string") h.cancel();
        return "stale";
      }
      starting = false;
      if (typeof h === "string") { pending = null; return h; }
      handle = h;
      const p = pending;
      pending = null;
      if (p === "cancel") h.cancel();
      else if (p === "stop") h.stop();
      return "ok";
    },
    /** 放開：送出或取消（上滑） */
    up(cancel: boolean) {
      if (!handle) { if (starting) pending = cancel ? "cancel" : "stop"; return; }
      if (cancel) handle.cancel(); else handle.stop();
    },
    /** 手勢被打斷（pointercancel）：當成取消 */
    abort() {
      if (handle) handle.cancel(); else if (starting) pending = "cancel";
    },
    /** 換場、卸載：取消目前的錄音，舊的 callback 全部作廢 */
    reset() {
      gen++;
      const h = handle;
      handle = null;
      starting = false;
      pending = null;
      h?.cancel();
    },
  };
}
