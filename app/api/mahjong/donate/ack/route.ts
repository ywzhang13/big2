// 按了「斗內給阿瑋」：POST /api/mahjong/donate/ack → { count }，只是確認提示，回目前的自摸次數。
// 老闆 2026-10-31：玩家只能看和按，不能自己清除；次數要等老闆在後台記一筆斗內才歸零（mj_donation_add）。
// 沒登入 401；訪客本來就不計數，直接回 { count: 0 }。都不寫入任何東西。
import { getAuthUser } from "@/lib/auth";
import { countZimo } from "@/lib/mahjong/donate/store";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (user.isGuest) return Response.json({ count: 0 });
  try {
    return Response.json({ count: await countZimo(user.id) });
  } catch (err) {
    console.error("[mj-donate]", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
