// 測試用：lib/mahjong/leave/store.ts 的記憶體版本。activity[房間][帳號] = 最後一次聊天或丟互動的時間（毫秒）
export const activity: Record<string, Record<string, number>> = {};
export const fail = { on: false };
export async function socialActivityByUser(roomId: string): Promise<Record<string, number>> {
  if (fail.on) throw new Error("模擬資料庫錯誤");
  return { ...(activity[roomId] ?? {}) };
}
