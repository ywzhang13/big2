// 測試用：lib/mahjong/chat/store.ts 的記憶體版本。
// 冷卻：跑真的 mj_chat_take（PGlite，見 pg-mj.ts），時間用 clock.now 控制。
// 語音檔：存在 voices（key = <roomId>/<voiceId>.m4a，記建立時間）；房間在不在看 stub-db 的 rooms。
import { RATE, VOICE_MAX_AGE_MS, type ChatKind } from "../../lib/mahjong/chat/rules";
import { db } from "./pg-mj";
import { rooms } from "./stub-db";

export const clock = { now: Date.parse("2026-10-23T00:00:00Z") };
export const voices = new Map<string, { data: Buffer; createdAt: number }>();
export const calls = { deleteRoomChat: [] as string[], sweepVoices: 0, checkRate: [] as string[] };

export async function checkRate(roomId: string, userId: string, kind: ChatKind, commit: boolean): Promise<number> {
  calls.checkRate.push(`${kind}:${commit ? "take" : "peek"}`);
  const r = RATE[kind];
  const res = await (await db()).query<{ w: number }>("select public.mj_chat_take($1, $2, $3, $4, $5, $6, $7, $8, $9) as w", [
    roomId, userId, kind, r.cooldownMs, r.burstCount, r.burstWindowMs, r.burstCooldownMs, commit, new Date(clock.now).toISOString(),
  ]);
  return Number(res.rows[0].w);
}

export async function saveVoice(roomId: string, voiceId: string, data: Buffer): Promise<string> {
  const key = `${roomId}/${voiceId}.m4a`;
  voices.set(key, { data, createdAt: clock.now });
  return `https://stub.supabase.co/storage/v1/object/sign/mj-voice/${key}?token=stub`;
}

export async function deleteRoomChat(roomId: string): Promise<number> {
  calls.deleteRoomChat.push(roomId);
  let n = 0;
  for (const k of [...voices.keys()]) if (k.startsWith(roomId + "/")) { voices.delete(k); n++; }
  await (await db()).query("delete from mj_chat_rate where room_id = $1", [roomId]);
  return n;
}

export async function sweepVoices(nowMs = clock.now): Promise<number> {
  calls.sweepVoices++;
  let n = 0;
  for (const [k, v] of [...voices]) {
    const room = k.split("/")[0];
    if (!rooms[room] || v.createdAt < nowMs - VOICE_MAX_AGE_MS) { voices.delete(k); n++; }
  }
  return n;
}
