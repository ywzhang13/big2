import { getSupabaseServer } from "@/lib/supabase-server";
import { after } from "next/server";
import { sweepIdleRooms } from "@/lib/records/close";

/** PostgREST 找不到欄位（migration 還沒跑）時的錯誤 */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST204" || error.code === "42703" || /records_enabled/.test(error.message ?? "");
}

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hostId } = body as { hostId?: string };

    if (!hostId) {
      return Response.json({ error: "缺少 hostId" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Try up to 10 times to generate a unique code
    let code: string = "";
    let roomId: string = "";

    // 新版建的房才記對局紀錄（records_enabled）；migration 還沒跑、沒有這個欄位時，改用舊寫法建房（不記紀錄）
    let withRecordFlag = true;
    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateCode();

      const { data, error } = await supabase
        .from("big2_rooms")
        .insert({
          code,
          status: "waiting",
          host_id: hostId,
          scores: {},
          ready_players: [],
          ...(withRecordFlag ? { records_enabled: true } : {}),
        })
        .select("id")
        .single();

      if (error && withRecordFlag && isMissingColumn(error)) {
        withRecordFlag = false;
        attempt--;
        continue;
      }
      if (error) {
        // Unique constraint violation — retry
        if (error.code === "23505") continue;
        return Response.json({ error: "建立房間失敗" }, { status: 500 });
      }

      roomId = data.id;
      break;
    }

    if (!roomId) {
      return Response.json({ error: "無法產生房間代碼，請重試" }, { status: 500 });
    }

    // 建房時順便清閒置太久的房間（打過牌的先記成中途解散）；回應送出後才跑，不拖慢建房
    after(() => sweepIdleRooms().then(() => undefined));

    return Response.json({ code, roomId });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
