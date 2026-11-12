// 牌局回放：取得某一局的完整紀錄。說明見 lib/mahjong/replay/API.md。
// GET /api/mahjong/replay/hand?matchId=<對戰紀錄 id>&hand=<第幾局>
//   權限、過期同 /api/mahjong/replay；這一局沒有紀錄（上線前打的、記錄失敗）404 not_found。
//   回傳四家完整資料（可以切換任何一家視角），另附 tiles：這局用到的牌 id → 牌面。
import { replayAccess } from "@/lib/mahjong/replay/access";
import { decodeRecord, tileFace } from "@/lib/mahjong/replay/log";
import { loadReplayHand } from "@/lib/mahjong/replay/store";
import type { Tile } from "@/lib/mahjong/tiles";

export async function GET(request: Request) {
  const a = await replayAccess(request);
  if (a instanceof Response) return a;
  const { match, matchId, params } = a;
  const hand = Number(params.get("hand"));
  if (!Number.isInteger(hand) || hand < 1 || hand > 999) return Response.json({ error: "bad_hand" }, { status: 400 });
  try {
    const rec = await loadReplayHand(match.roomId, hand);
    if (!rec) return Response.json({ error: "not_found" }, { status: 404 });
    const tiles: Record<number, Pick<Tile, "suit" | "rank" | "display">> = {};
    const add = (id: number) => { const t = tileFace(id); if (t) tiles[id] = { suit: t.suit, rank: t.rank, display: t.display }; };
    for (const s of rec.init.seats) { [...s.h, ...s.f, ...s.d].forEach(add); s.m.forEach((m) => (m.slice(2) as number[]).forEach(add)); }
    rec.init.wall.forEach(add);
    return Response.json({ matchId, roomCode: match.roomCode, expiresAt: match.expiresAt, mySeat: match.mySeat, replay: decodeRecord(rec), tiles });
  } catch (e) {
    console.error("[mj-replay] 讀取回放失敗：", e instanceof Error ? e.message : e);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
