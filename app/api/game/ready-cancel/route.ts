// 大老二開局確認：房主取消。POST { roomId, playerId, confirmId, seatKey }（seatKey＝房主入座時拿到的入座憑證；沒有或不對 403 not_host，編號是舊一輪的 409 stale_confirm）。回到等人、廣播 ready_check_cancelled（reason "host"）。
//   200 { ok, cancelled: true }；沒有在倒數的確認 200 { ok, cancelled: false }；不是房主 403 not_host
import { cancelBig2Confirm } from "@/lib/big2/startConfirm";

async function readBody(request: Request): Promise<{ roomId?: string; playerId?: string; confirmId?: unknown; seatKey?: unknown } | null> {
  try { const b = await request.json(); return b && typeof b === "object" ? b : null; } catch { return null; }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body?.roomId || !body.playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  try {
    return await cancelBig2Confirm(body.roomId, body.playerId, body.confirmId, body.seatKey);
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
