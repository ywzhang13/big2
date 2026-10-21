// 遊戲內語音訊息：POST multipart/form-data { roomId, audio: <錄音檔> }，最長 10 秒（超過的截掉）。
// 只有同一桌、LINE 登入的玩家能送；訪客 403 guest_not_allowed（照樣聽得到別人的語音）。
// 伺服器一律轉成 m4a（iPhone、Android 都能播），存到私有 bucket mj-voice，用 1 小時有效的網址送給同桌四人。
// 冷卻：轉檔前只檢查不扣（擋洗版、不白跑轉檔），轉檔成功才真的扣；壞檔、太短不扣冷卻。
import { randomUUID } from "node:crypto";
import { fail, resolveMember } from "@/lib/mahjong/effects/members";
import { MAX_VOICE_BYTES, MIN_VOICE_MS } from "@/lib/mahjong/chat/rules";
import { sendToTable } from "@/lib/mahjong/chat/send";
import { checkRate, saveVoice } from "@/lib/mahjong/chat/store";
import { BadAudioError, transcodeToM4a } from "@/lib/mahjong/chat/voice";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[mj-voice]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

const rateLimited = (wait: number) => fail(429, "rate_limited", { retryAfterMs: wait, retryAfterSec: Math.ceil(wait / 1000) });

async function handle(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_VOICE_BYTES + 64 * 1024) return fail(413, "audio_too_large");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request");
  }
  const who = await resolveMember(request, form.get("roomId"), form.get("playerId") ?? undefined);
  if (who instanceof Response) return who;
  const { roomCode, roomId, me, members, user } = who;
  if (user.isGuest) return fail(403, "guest_not_allowed");

  const file = form.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return fail(400, "bad_audio");
  if (file.size > MAX_VOICE_BYTES) return fail(413, "audio_too_large");

  const before = await checkRate(roomId, user.id, "voice", false);
  if (before > 0) return rateLimited(before);

  let voice: { data: Buffer; durationMs: number };
  try {
    voice = await transcodeToM4a(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof BadAudioError) return fail(400, "bad_audio");
    throw e;
  }
  if (voice.durationMs < MIN_VOICE_MS) return fail(400, "too_short");

  // 轉檔成功才扣冷卻；轉檔期間同一人另一則先扣了，這裡照樣擋下（檔案不存）
  const wait = await checkRate(roomId, user.id, "voice", true);
  if (wait > 0) return rateLimited(wait);
  const id = randomUUID();
  const url = await saveVoice(roomId, id, voice.data);
  const message = await sendToTable(roomCode, members, me, { id, kind: "voice", url, durationMs: voice.durationMs });
  return Response.json({ ok: true, message });
}
