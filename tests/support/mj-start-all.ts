// 測試用（老柯 2026-11-20）：麻將開始改成「房主發起 → 四家同意才發牌」之後，舊的流程測試（測的是開局之後的牌局）
// 改 import 這支：房主按開始成功，就幫其餘三家照各自的登入身分按同意（帶這一輪的編號），回最後一個回應。
// 開始被擋（不是房主、不滿 4 人、沒登入、有人被暫停…）照樣回原本的錯誤，舊測試的錯誤斷言不用改。
// 開局確認本身的規則（倒數、取消、時間到不開、同時按、舊一輪、暫停）另外在 flow-mj-start-confirm 測。
import { POST as realStart } from "../../app/api/mahjong/start/route";
import { POST as confirmRoute } from "../../app/api/mahjong/start-confirm/route";
import { loadPlayers } from "./stub-db";
import { tokens } from "./stub-auth";

function authFor(userId: string | null, playerId: string): Record<string, string> {
  const key = Object.entries(tokens).find(([, u]) => u.id === userId)?.[0];
  if (key) return { authorization: `Bearer ${key}` };
  return { authorization: `Bearer as:${playerId}` }; // stub-auth 的「以座位本人登入」（帳號 u:<玩家 id>）
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const res = await realStart(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
  if (res.status !== 200) return res;
  const body = JSON.parse(raw) as { roomId: string };
  const started = (await res.clone().json()) as { confirm?: { id: string; readyIds: string[]; seatIds: string[] } };
  if (!started.confirm) return res;
  let last = res;
  const seats = await loadPlayers(body.roomId);
  for (const pid of started.confirm.seatIds.filter((id) => !started.confirm!.readyIds.includes(id))) {
    const seat = seats.find((p) => p.player_id === pid);
    last = await confirmRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...authFor(seat?.user_id ?? null, pid) },
      body: JSON.stringify({ roomId: body.roomId, playerId: pid, confirmId: started.confirm.id }) }));
    if (last.status !== 200) return last;
  }
  return last;
}
