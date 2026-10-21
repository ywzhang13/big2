// 每天一次的語音檔保底清除（vercel.json 的 crons 呼叫）：房間已經不在的語音整包刪、房間還在的刪超過 24 小時的。
// 平常關房就會刪（lib/records/close.ts），建房時的閒置清理也會順便跑；這支是兩者都漏掉時的保底。
// 只接受 Vercel Cron 帶的 Authorization: Bearer <CRON_SECRET>；沒設 CRON_SECRET 就一律拒絕。
import { sweepVoices } from "@/lib/mahjong/chat/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, removed: await sweepVoices() });
  } catch (err) {
    console.error("[mj-voice-sweep]", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
