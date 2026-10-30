// 帳號的自摸特效（老闆 2026-10-25 隕石；2026-10-31 改成特效庫＋後台開通）：
//   座位的 zimoFx 由伺服器在開局、每次打牌／摸牌／動作前查資料庫填上（lib/mahjong/zimoFx/attach.ts），這裡只判斷「這一刻還有效嗎」。
//   自摸時胡牌紀錄帶公開的代號（WinnerEntry.winFx），全桌照代號播；公開座位資料（PublicPlayerState.winFx）也帶代號，開局就能預載素材。
//   只在伺服器用（gameLogic 的 declareWin、db 的 toPublicPlayerState 呼叫），帳號 id 不會送到前端。
import type { PlayerState, WinFx } from "./gameState";
import { zimoFxValid } from "./zimoFx/rules";

/** 這個座位現在自摸要播的特效代號；未設定、過期、被收回時回永久的金色自摸。
 *  還沒查過資料庫的舊牌局（zimoFx 是 undefined）也安全回退金色自摸。 */
export function selfDrawWinFx(player: Pick<PlayerState, "userId" | "zimoFx">, now: number = Date.now()): WinFx | undefined {
  if (!player.userId) return undefined;
  if (player.zimoFx === undefined) return "golden";
  return zimoFxValid(player.zimoFx ?? undefined, now) ?? "golden";
}
