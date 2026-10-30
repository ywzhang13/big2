// 斗內後台：找玩家。GET ?q=名稱（至少 2 個字）。只有老闆帳號能用。回傳帳號 id（只給老闆）、LINE 名稱、頭像、帳號後四碼
import { fail, ok, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { searchUsers } from "@/lib/mahjong/zimoFx/store";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if ([...q].length < 2 || q.length > 40) return fail(400, "bad_request");
    const players = (await searchUsers(q)).map((u) => ({ ...u, shortId: u.userId.slice(-4) }));
    return ok({ players });
  } catch (err) {
    console.error("[mj-admin] players", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
