// 大老二開局確認畫面要的資料（純函式，給 app/big2/page.tsx 和測試用）：
//   四家小牌子（照座位、誰同意了）、上一次沒開成的提示（誰沒按同意、房主取消、有人退出）
import type { StartConfirmSeat } from "@/components/gameLobby/StartConfirm";
import type { Big2LastStartConfirm } from "./useGame";

type P = { id: string; name: string; seat: number };

export function big2ConfirmSeats(players: P[], readyIds: Iterable<string>, myId: string): StartConfirmSeat[] {
  const ready = new Set(readyIds);
  return [...players].sort((a, b) => a.seat - b.seat).map((p) => ({ key: p.seat, name: p.name, ok: ready.has(p.id), me: p.id === myId }));
}

/** 上一次開局沒開成的提示；確認進行中、或沒有上一次＝null */
export function big2ConfirmNote(last: Big2LastStartConfirm | null, confirming: boolean, players: P[], myId: string, isHost: boolean): string | null {
  if (!last || confirming) return null;
  if (last.reason === "host") return "房主取消了開局";
  if (last.reason === "seats_changed") return "有人離開了，這次開局取消";
  if (last.reason === "cancelled") return `${last.by === myId ? "你" : (players.find((p) => p.id === last.by)?.name ?? "有人")} 取消了對戰`; // v3c：誰按了取消對戰（倒數中、倒數後一樣）
  const names = last.missingIds.map((id) => (id === myId ? "你" : players.find((p) => p.id === id)?.name)).filter((n): n is string => !!n);
  const who = names.length ? names.join("、") : "有人";
  return isHost ? `${who} 沒按同意，可以再按一次開始遊戲` : `${who} 沒按同意，等房主重新開始`;
}
