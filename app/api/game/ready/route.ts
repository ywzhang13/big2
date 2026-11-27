// 大老二開局確認：按同意。POST { roomId, playerId, confirmId }（confirmId＝這一輪確認的編號；舊一輪的 409 stale_confirm、沒帶 400 confirm_id_required）。四家都同意才發牌（lib/deal-and-start.ts）；規則見 lib/big2/startConfirm.ts。
//   200 { allReady: false, confirm } 還在等別人；200 { allReady: true } 已發牌開局
//   409 expired（倒數已到、這次沒開成）／no_confirm（房主沒按開始或已取消）／room_changed（發牌途中有人退出）；不在房裡 403 not_in_room
// 名單寫入帶 row_version 條件（輸的重讀再加），四人同時按不會漏人。
import { agreeBig2 } from "@/lib/big2/startConfirm";
import { isCurrentBig2Client, outdatedBig2Client } from "@/lib/big2/clientProto";

async function readBody(request: Request): Promise<{ roomId?: string; playerId?: string; proto?: unknown; confirmId?: unknown } | null> {
  try { const b = await request.json(); return b && typeof b === "object" ? b : null; } catch { return null; }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body?.roomId || !body.playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  if (!isCurrentBig2Client(body)) return outdatedBig2Client(); // 舊版前端開局會缺牌（手牌改讀狀態拿，2026-11-27）
  try {
    return await agreeBig2(body.roomId, body.playerId, body.confirmId);
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
