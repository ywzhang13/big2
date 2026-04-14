import { getSupabaseServer } from "@/lib/supabase-server";

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hostId, totalRounds, basePoints, fanPoints } = body as {
      hostId?: string;
      totalRounds?: number;
      basePoints?: number;
      fanPoints?: number;
    };

    if (!hostId) {
      return Response.json({ error: "缺少 hostId" }, { status: 400 });
    }

    // Validate settings
    const validRounds = [1, 2, 4, 8];
    const rounds = totalRounds && validRounds.includes(totalRounds) ? totalRounds : undefined;
    const base = basePoints && basePoints > 0 ? basePoints : undefined;
    const fan = fanPoints && fanPoints > 0 ? fanPoints : undefined;

    // Build room settings if any were provided
    const roomSettings = rounds != null ? {
      totalRounds: rounds,
      basePoints: base ?? 10,
      fanPoints: fan ?? 10,
    } : undefined;

    const supabase = getSupabaseServer();

    let code = "";
    let roomId = "";

    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateCode();

      const insertData: Record<string, unknown> = {
        code,
        status: "waiting",
        host_id: hostId,
      };
      // Store settings in game_state so they persist
      if (roomSettings) {
        insertData.game_state = { roomSettings };
      }

      const { data, error } = await supabase
        .from("mj_rooms")
        .insert(insertData)
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") continue;
        return Response.json({ error: "建立房間失敗" }, { status: 500 });
      }

      roomId = data.id;
      break;
    }

    if (!roomId) {
      return Response.json({ error: "無法產生房間代碼，請重試" }, { status: 500 });
    }

    return Response.json({ code, roomId, roomSettings });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
