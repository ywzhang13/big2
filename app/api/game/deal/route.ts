// 大老二「開始遊戲」舊入口：POST { roomId, playerId, seatKey }（房主本人）。2026-11-20 起不再直接發牌，
// 和 /api/game/ready-check 一樣改成發起開局確認（四家都同意才發牌，見 lib/big2/startConfirm.ts），身分驗證和回傳也一樣：
// 沒帶房主本人的入座憑證一律 403（審伯複審 R4）。舊版前端不會帶憑證，所以前端要和這版後端同一次上線。
import { beginBig2Confirm } from "@/lib/big2/startConfirm";
import { isCurrentBig2Client, outdatedBig2Client } from "@/lib/big2/clientProto";

async function readBody(request: Request): Promise<{ roomId?: string; playerId?: string; proto?: unknown; seatKey?: unknown } | null> {
  try { const b = await request.json(); return b && typeof b === "object" ? b : null; } catch { return null; }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body?.roomId || !body.playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  if (!isCurrentBig2Client(body)) return outdatedBig2Client(); // 舊版前端開局會缺牌（手牌改讀狀態拿，2026-11-27）
  try {
    return await beginBig2Confirm(body.roomId, body.playerId, body.seatKey);
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
