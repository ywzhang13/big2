// 核彈自摸（nuke）的專屬音效：把四段素材照時間軸混成一檔（老闆 2026-11-11 用 Comfy Cloud 的
// Stable Audio 3 Medium 生出警報／發射／核爆／金屬撞擊四段；前一版是程式合成的，見 git 歷史）。
//   node scripts/gen-nuke-sound.mjs <警報> <發射> <核爆> <撞擊> [--preview]
// 時間點直接對 lib/mahjong/fx/nukeFx.ts 的 NUKE_TL（檔案 0 秒＝特效開始），和其他自摸特效
// 同一個規則（engine.ts 的 zimoFxUrl：從頭放就對準，不用往回推）。
//
// 為什麼要偵測起音點：生出來的素材前面常有一段空白或淡入，直接首尾相接的話「爆炸聲」不會
// 落在 1.80 秒。這支會先找出每一段真正開始響的位置，再反推要延後多久播，讓那個瞬間剛好對上。
// 長期快取：換內容一定要改檔名（這一版輸出 -v2），改完跑 node scripts/asset-hashes.mjs --write。
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/s");
const argv = process.argv.slice(2);
const SRC = argv.filter((a) => !a.startsWith("--"));
const PREVIEW = argv.includes("--preview");
if (SRC.length !== 4) {
  console.error("用法：node scripts/gen-nuke-sound.mjs <警報> <發射> <核爆> <撞擊> [--preview]");
  process.exit(2);
}

const SR = 44100;
/** 和 NUKE_TL 對齊（秒）：整段 4.60，發射 0.90，命中 1.80，大字 2.78 */
const T = { total: 4.6 };
/** 每一段：起音點要落在哪一秒、音量倍率、最多用幾秒 */
const PARTS = [
  // gain 是各段混進去的相對音量：素材本身的響度差很多（警報 -22dB、核爆 -0.5dB），
  // 不調的話前一秒幾乎聽不到、爆炸之後又只剩餘響。
  // 核爆一定要是全段最大聲：飛彈的呼嘯峰值其實比爆炸還響，不壓下去會蓋過主擊。
  { name: "警報", at: 0.05, gain: 2.2, max: 1.6 },
  { name: "發射", at: 0.9, gain: 0.42, max: 0.85 },
  { name: "核爆", at: 1.8, gain: 2.6, max: 2.8 },
  { name: "大字撞擊", at: 2.78, gain: 2.2, max: 1.5 },
];
const N = Math.round(SR * T.total);

/** 用 ffmpeg 解成單聲道 32-bit float PCM，直接在記憶體處理 */
function decode(file) {
  const buf = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/** 起音點：10ms 視窗的 RMS 第一次超過「整段最大 RMS 的 18%」的位置 */
function onsetOf(x) {
  const win = Math.round(SR * 0.01);
  const rms = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += x[i + j] * x[i + j];
    rms.push(Math.sqrt(s / win));
  }
  const peak = Math.max(...rms);
  if (peak <= 1e-6) return 0;
  const k = rms.findIndex((v) => v > peak * 0.18);
  return Math.max(0, k) * win;
}

const buf = new Float32Array(N);
for (const [i, p] of PARTS.entries()) {
  const x = decode(SRC[i]);
  const on = onsetOf(x);
  const start = Math.round(p.at * SR) - on;              // 讓起音點正好落在 p.at
  const len = Math.min(x.length, Math.round(p.max * SR) + on);
  console.log(`${p.name}：${path.basename(SRC[i])}  長度 ${(x.length / SR).toFixed(2)}s、起音 ${(on / SR).toFixed(2)}s → 擺在 ${p.at}s`);
  for (let j = 0; j < len; j++) {
    const d = start + j;
    if (d < 0 || d >= N) continue;
    // 每一段自己的尾巴淡出，接起來才不會有切斷感
    const tail = Math.min(1, (len - j) / (SR * 0.25));
    buf[d] += x[j] * p.gain * tail;
  }
}

// 整段淡入淡出 + 限幅
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fin = Math.min(1, t / 0.02), fout = Math.min(1, (T.total - t) / 0.25);
  buf[i] = Math.tanh(buf[i] * Math.max(0, Math.min(fin, fout)) * 1.1);
}
let peak = 1e-6;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));

/** 16 bit 單聲道 WAV */
function wav(samples, gain) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
/** 一階高通：手機喇叭沒低頻，把中高頻推上來才聽得到 */
function highpass(x, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  const out = new Float32Array(x.length);
  let yPrev = 0, xPrev = 0;
  for (let i = 0; i < x.length; i++) {
    out[i] = a * (yPrev + x[i] - xPrev);
    yPrev = out[i]; xPrev = x[i];
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
for (const [suffix, gain, hp] of [["pc", 0.72 / peak, 0], ["mobile", 0.88 / peak, 110]]) {
  const src = hp ? (() => { const h = highpass(buf, hp); const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = buf[i] * 0.5 + h[i] * 0.8; return o; })() : buf;
  const tmp = path.join(OUT, `.nuke-${suffix}.wav`);
  const mp3 = path.join(OUT, `zimo-nuke-v2-${suffix}.mp3`);
  writeFileSync(tmp, wav(src, gain));
  execFileSync(ffmpeg, ["-y", "-v", "error", "-i", tmp, "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", mp3]);
  if (PREVIEW) { mkdirSync(path.join(ROOT, ".preview"), { recursive: true }); writeFileSync(path.join(ROOT, ".preview", `zimo-nuke-v2-${suffix}.wav`), wav(src, gain)); }
  unlinkSync(tmp);
  console.log(`寫出 ${path.relative(ROOT, mp3)}（${T.total} 秒，爆炸在 1.80 秒）`);
}
console.log("\n記得跑：node scripts/asset-hashes.mjs --write");
