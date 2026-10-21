// 按了「斗內給阿瑋」：POST /api/mahjong/donate/ack → { count: 0 }，把這個帳號的自摸次數歸零。
// 只記「按下的時間」，不開啟、不確認任何付款。連按、重送都一樣（冪等）。
// 沒登入 401；訪客本來就不計數，直接回 { count: 0 }、不寫入。
import { getAuthUser } from "@/lib/auth";
import { ackDonate } from "@/lib/mahjong/donate/store";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (user.isGuest) return Response.json({ count: 0 });
  try {
    return Response.json({ count: await ackDonate(user.id) });
  } catch (err) {
    console.error("[mj-donate]", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
