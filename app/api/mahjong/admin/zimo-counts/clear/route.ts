// 斗內後台：手動清除自摸次數。POST { userId } → { ok: true, cleared, resetAt }。只有老闆帳號能用。
//   同一個交易裡歸零並寫 zimo_clear 操作紀錄（{ cleared }）。不是 LINE 帳號／遊客 400 unknown_player；已經是 0 回 409 nothing_to_clear，什麼都不寫。
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { clearZimo, lineProfile, nowMs } from "@/lib/mahjong/zimoFx/store";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    if (!b || typeof b.userId !== "string") return fail(400, "bad_request");
    if (!(await lineProfile(b.userId))) return fail(400, "unknown_player");
    const cleared = await clearZimo(owner.id, b.userId);
    if (cleared === 0) return fail(409, "nothing_to_clear");
    return ok({ ok: true, cleared, resetAt: nowMs() });
  } catch (err) {
    console.error("[mj-admin] zimo clear", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
