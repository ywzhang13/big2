// 語音轉檔：iPhone 錄的是 audio/mp4（AAC）、Android 錄的是 audio/webm（Opus），iPhone 放不出 webm。
// 伺服器一律用 ffmpeg 轉成 m4a（AAC 單聲道 48kbps），兩邊都能播；同時截在 10 秒、確認真的是聲音檔。
// ffmpeg 來源：ffmpeg-static 套件附的執行檔（Vercel 上沒有系統 ffmpeg）；FFMPEG_PATH 可以覆蓋。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { MAX_VOICE_SECONDS } from "./rules";

export class BadAudioError extends Error {}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg";
}
// child_process 用 getBuiltinModule 取：直接 import 的話，打包工具會把 execFile 的參數當成可能執行的檔案，
// 把整個專案追蹤進語音路由（500 個檔案）。ffmpeg 執行檔由 next.config 的 outputFileTracingIncludes 帶進去。
const spawnFile = (process.getBuiltinModule("node:child_process") as typeof import("node:child_process")).execFile;

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    spawnFile(ffmpegPath(), args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve(String(stderr));
    });
  });
}

/** 把上傳的錄音轉成 m4a。不是聲音檔、沒有音軌、長度 0 → BadAudioError */
export async function transcodeToM4a(input: Uint8Array): Promise<{ data: Buffer; durationMs: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mj-voice-"));
  try {
    const src = path.join(dir, "in");
    const out = path.join(dir, "out.m4a");
    await writeFile(src, input);
    let log: string;
    try {
      log = await run([
        "-hide_banner", "-nostdin", "-y", "-i", src,
        "-vn", "-map", "0:a:0", "-t", String(MAX_VOICE_SECONDS),
        "-ac", "1", "-ar", "24000", "-c:a", "aac", "-b:a", "48k",
        "-map_metadata", "-1", "-movflags", "+faststart", "-f", "ipod", out,
      ]);
    } catch (e) {
      throw new BadAudioError(`轉檔失敗：${String((e as { stderr?: string }).stderr ?? e).split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
    }
    // 長度用輸出進度的最後一個 time=（webm 的 Duration 常常是 N/A）
    const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = times[times.length - 1];
    const durationMs = last ? Math.round(((+last[1] * 60 + +last[2]) * 60 + +last[3]) * 1000) : 0;
    const data = await readFile(out);
    if (durationMs <= 0 || data.length === 0) throw new BadAudioError("沒有聲音內容");
    return { data, durationMs: Math.min(durationMs, MAX_VOICE_SECONDS * 1000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
