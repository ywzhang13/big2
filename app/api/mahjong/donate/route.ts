// 斗內卡：GET /api/mahjong/donate → { count }（這個 LINE 帳號上次按斗內之後的自摸次數）
// 沒登入、訪客、查詢失敗一律回 { count: 0 }，不回錯誤：前端看到 0 就不顯示卡片。和付款無關。
import { getAuthUser } from "@/lib/auth";
import { countZimo } from "@/lib/mahjong/donate/store";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user || user.isGuest) return Response.json({ count: 0 });
  try {
    return Response.json({ count: await countZimo(user.id) });
  } catch (err) {
    console.error("[mj-donate]", err instanceof Error ? err.message : err);
    return Response.json({ count: 0 });
  }
}
