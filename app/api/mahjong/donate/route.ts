// 斗內卡：GET /api/mahjong/donate → { count, show }
//   count＝這個 LINE 帳號目前的自摸次數（還欠的＋上次歸零之後的）；show＝count 比玩家看過的次數多（卡片要出現）。
// 沒登入、訪客、查詢失敗一律回 { count: 0, show: false }，不回錯誤：前端不顯示卡片。和付款無關。
import { getAuthUser } from "@/lib/auth";
import { donateStatus } from "@/lib/mahjong/donate/store";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user || user.isGuest) return Response.json({ count: 0, show: false });
  try {
    const s = await donateStatus(user.id);
    return Response.json({ count: s.count, show: s.count > s.seen });
  } catch (err) {
    console.error("[mj-donate]", err instanceof Error ? err.message : err);
    return Response.json({ count: 0, show: false });
  }
}
