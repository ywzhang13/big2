import { getSupabaseServer } from "@/lib/supabase-server";

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
        })
        .select("id")
        .single();

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

    return Response.json({ code, roomId });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
