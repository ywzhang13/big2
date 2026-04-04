import { getServerSupabase } from "@/lib/supabase-server";
import { generateCode } from "@/lib/room";

export async function POST() {
  try {
    const supabase = getServerSupabase();
    const code = generateCode();

    const { data, error } = await supabase
      .from("big2_rooms")
      .insert({
        code,
        status: "waiting",
        pass_count: 0,
      })
      .select("id, code")
      .single();

    if (error) {
      // Code collision — retry once
      if (error.code === "23505") {
        const retryCode = generateCode();
        const { data: retryData, error: retryError } = await supabase
          .from("big2_rooms")
          .insert({
            code: retryCode,
            status: "waiting",
            pass_count: 0,
          })
          .select("id, code")
          .single();

        if (retryError) {
          return Response.json(
            { error: "Failed to create room" },
            { status: 500 }
          );
        }

        return Response.json({ code: retryData.code, roomId: retryData.id });
      }

      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ code: data.code, roomId: data.id });
  } catch (err) {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
