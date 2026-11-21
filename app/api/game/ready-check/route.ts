// 大老二開始（房主本人）：POST { roomId, playerId, seatKey }（seatKey＝房主入座時拿到的入座憑證，只知道房主 id 不能發起）。2026-11-20 起（老闆定案，同十三支）不直接發牌，而是發起開局確認：
//   房主自己算同意，倒數 10 秒；另外三家按 /api/game/ready 同意，四家都同意才發牌。倒數到了還有人沒按 → 不開局、回到等人，
//   房主要再按一次（重新倒數 10 秒）。已經有一個還在倒數的就回那一個，不重新計時。規則見 lib/big2/startConfirm.ts。
//   成功 200 { ok, confirm: { id, startedBy, readyIds, seatIds, deadline, serverNow } }；不是房主本人（沒有、錯的、別人的入座憑證）403 not_host；不滿 4 人 400 not_full；已開打 400 started
import { beginBig2Confirm } from "@/lib/big2/startConfirm";

async function readBody(request: Request): Promise<{ roomId?: string; playerId?: string; seatKey?: unknown } | null> {
  try { const b = await request.json(); return b && typeof b === "object" ? b : null; } catch { return null; }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body?.roomId || !body.playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  try {
    return await beginBig2Confirm(body.roomId, body.playerId, body.seatKey);
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
