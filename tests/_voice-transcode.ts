// 語音轉檔（lib/mahjong/chat/voice.ts）：Android webm／Opus、iPhone mp4／AAC、ogg 都轉成 m4a（AAC），
// 超過 10 秒截掉，不是聲音的檔案擋下。轉出來的檔用 ffmpeg 讀回來確認格式。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { BadAudioError, transcodeToM4a } from "../lib/mahjong/chat/voice";

const ff = (ffmpegStatic as unknown as string) || "ffmpeg";
const dir = mkdtempSync(path.join(tmpdir(), "voice-test-"));
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
function gen(name: string, secs: number, codec: string[]) {
  const f = path.join(dir, name);
  execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`, ...codec, f]);
  return readFileSync(f);
}
/** 用 ffmpeg 讀回轉好的檔：容器、編碼、聲道 */
function probe(data: Buffer) {
  const f = path.join(dir, "probe.m4a");
  writeFileSync(f, data);
  const err = spawnSync(ff, ["-hide_banner", "-i", f], { encoding: "utf8" }).stderr;
  return { ipod: /Input #0, mov,mp4,m4a/.test(err), aac: /Audio: aac/.test(err), mono: /mono/.test(err), brand: data.subarray(4, 11).toString("latin1") };
}
const OK = { ipod: true, aac: true, mono: true, brand: "ftypM4A" };

for (const [label, name, secs, codec] of [
  ["Android Chrome（webm／Opus）", "a.webm", 3, ["-c:a", "libopus", "-b:a", "32k"]],
  ["iPhone Safari（mp4／AAC 雙聲道 44.1k）", "b.mp4", 4, ["-ac", "2", "-ar", "44100", "-c:a", "aac"]],
  ["Firefox（ogg／Opus）", "c.ogg", 2, ["-c:a", "libopus"]],
] as const) {
  const out = await transcodeToM4a(gen(name, secs, [...codec]));
  eq([probe(out.data), Math.abs(out.durationMs - secs * 1000) < 150], [OK, true], `W ${label} → m4a、AAC、單聲道，長度約 ${secs} 秒`);
}
{
  const out = await transcodeToM4a(gen("long.webm", 12, ["-c:a", "libopus"]));
  eq([out.durationMs <= 10000, out.durationMs > 9800, probe(out.data).aac], [true, true, true], "W 12 秒的錄音截在 10 秒");
}
for (const [label, data] of [
  ["文字檔", Buffer.from("hello, not audio")],
  ["空的", Buffer.alloc(0)],
  ["只有影像沒有聲音", (() => { const f = path.join(dir, "v.mp4"); execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=16x16:d=1", "-c:v", "mpeg4", f]); return readFileSync(f); })()],
] as const) {
  let got = "沒有擋";
  try { await transcodeToM4a(data); } catch (e) { got = e instanceof BadAudioError ? "BadAudioError" : String(e); }
  eq(got, "BadAudioError", `W ${label} → 擋下（BadAudioError）`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
