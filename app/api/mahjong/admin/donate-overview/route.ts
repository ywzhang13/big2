// 斗內後台：玩家斗內總覽（老闆 2026-11-08，接續〈斗內次數調查報告-2026-11-08〉的建議②）。只有老闆帳號能用。
//   GET ?userId=<帳號 id> → { totalHands, afterCutoffMatches, settledMatches, unsettledMatches, due }
//   totalHands：這個帳號全部的自摸紀錄（mj_hand_results，含 11/1 以前、也含已結清的，和對戰紀錄頁一致）
//   afterCutoffMatches：11/1 00:00 之後、有自摸的場次數（不重複算房間）
//   settledMatches／unsettledMatches：上面這些場次裡，已經在這個分頁按過「已收」結清、還是沒有
//   due：還欠的金額＝未結清場次的自摸次數加總 × 10（和後台「未結清」清單同一套算法，不是另外算）
//   老闆帳號：規則上不算斗內，settledMatches／unsettledMatches／due 一律是 0，afterCutoffMatches 照實際數字回（讓老闆看得到自己其實打了幾場）
import { fail, ok, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { listMyMahjongMatches } from "@/lib/records/store";
import { matchHandStats, matchZimo, unsettledMatches } from "@/lib/mahjong/zimoFx/store";
import { isOwner } from "@/lib/mahjong/zimoFx/rules";

const CUTOFF = Date.parse("2026-11-01T00:00:00+08:00"); // 和對戰紀錄頁、斗內系統同一個既往不究的分界

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const userId = (new URL(request.url).searchParams.get("userId") ?? "").trim();
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(userId)) return fail(400, "bad_request");

    // 這個帳號全部打過的場次（含我沒自摸的場；一次拿最多 500 場，玩家不會真的打破這個數字）
    const matches = await listMyMahjongMatches(userId, 500, null);
    const roomIds = matches.map((m) => m.roomId);
    // 自摸總次數：和對戰紀錄頁一樣，用 mj_hand_results（每場每個座位的自摸數），不是 mj_zimo_wins
    const stats = await matchHandStats(roomIds);
    let totalHands = 0;
    for (const m of matches) {
      const seat = Object.entries(m.seatUserIds).find(([, u]) => u === userId)?.[0];
      if (seat === undefined) continue;
      const s = stats.find((x) => x.roomId === m.roomId && x.seat === Number(seat));
      if (s) totalHands += s.selfDraws;
    }
    // 11/1 後有沒有結清：用 mj_zimo_wins（won_at 是真正記帳的時間，不是場次結束時間），和調查報告同一套算法
    const wins = await matchZimo(roomIds);
    const afterCutoffRooms = new Set(wins.filter((w) => w.userId === userId && w.wonAt > CUTOFF).map((w) => w.roomId));

    if (isOwner(userId)) {
      return ok({ totalHands, afterCutoffMatches: afterCutoffRooms.size, settledMatches: 0, unsettledMatches: 0, due: 0, isOwner: true });
    }
    const unsettled = await unsettledMatches(userId);
    const unsettledRoomIds = new Set(unsettled.map((u) => u.roomId));
    const due = unsettled.reduce((n, u) => n + u.due, 0);
    const settledCount = Math.max(0, afterCutoffRooms.size - unsettledRoomIds.size);
    return ok({
      totalHands, afterCutoffMatches: afterCutoffRooms.size,
      settledMatches: settledCount, unsettledMatches: unsettledRoomIds.size, due, isOwner: false,
    });
  } catch (err) {
    console.error("[mj-admin] donate-overview", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
