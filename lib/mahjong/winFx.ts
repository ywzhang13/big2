// 帳號專屬的自摸特效（老闆 2026-10-25）：設定表裡的帳號自摸時，胡牌紀錄帶上公開的特效代號（WinnerEntry.winFx），
// 全桌照代號播放；公開座位資料（PublicPlayerState.winFx）也帶代號，開局就能預載素材。
// 只在伺服器用（gameLogic 的 declareWin、db 的 toPublicPlayerState 呼叫），帳號 id 不會送到前端。
// 之後幫別人加特效：在下面加一筆「帳號 id: 代號」就好（新代號要先在 gameState.ts 的 WinFx 加上、前端做好播放）。
import type { WinFx } from "./gameState";

const WIN_FX_BY_USER: Readonly<Record<string, WinFx>> = {
  "c5707922-f6f0-4c10-9c87-3532fdbf6b72": "meteor", // 張育瑋（LINE 登入；正式庫 2026-10-25 用 33 場麻將對局紀錄比對確認）
};

/** 這個帳號自摸時要播的特效代號；沒有設定（或座位沒綁帳號）回 undefined */
export function selfDrawWinFx(userId: string | null | undefined): WinFx | undefined {
  return userId ? WIN_FX_BY_USER[userId] : undefined;
}
