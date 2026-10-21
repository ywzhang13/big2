// 名牌選單的「關閉互動」（小宜〈設定整併與雙音量及關閉互動〉；老闆 2026-10-21）：
// 不播放某位玩家丟給自己的 5 種特效（動畫和聲音都不播）。只記在這個分頁的記憶體裡、綁「這一房」：
// 房間、自己的玩家 id 或座位一變就清空（換房、離開、重新整理都恢復）。不影響聊天、語音、自己丟出去的特效，也不通知對方。
import { useSyncExternalStore } from "react";

let roomKey: string | null = null;
let blocked = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** 告訴它「現在是哪一房的哪個座位」（null＝不在房裡）；變了就清空 */
export function bindFxBlockRoom(key: string | null) {
  if (key === roomKey) return;
  roomKey = key;
  if (blocked.size) { blocked = new Set(); emit(); }
}

export function setFxBlocked(playerId: string, on: boolean) {
  if (!roomKey || on === blocked.has(playerId)) return;
  blocked = new Set(blocked);
  if (on) blocked.add(playerId); else blocked.delete(playerId);
  emit();
}

export const isFxBlocked = (playerId: string) => blocked.has(playerId);

/** 收到的這則要不要播：被關閉互動的玩家丟給我的就不播 */
export const shouldPlayFx = (m: { fromId: string; to: number }, mySeat: number) => !(m.to === mySeat && blocked.has(m.fromId));

export function useFxBlocked(playerId: string | undefined): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => !!playerId && blocked.has(playerId),
    () => false,
  );
}
