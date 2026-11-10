// 核彈自摸（nuke）的專屬音效產生器（老闆 2026-11-10）。
// 沒有錄音素材，整段用程式合成：防空警報 → 飛彈嘶聲 → 核爆（低頻下掃＋噪音爆開）→ 餘響轟隆 → 大字的金屬撞擊。
// 時間點直接對 lib/mahjong/fx/nukeFx.ts 的 NUKE_TL（檔案 0 秒＝特效開始那一格，爆炸對在 hit＝1.80 秒），
// 和其他自摸特效音效同一個規則（lib/mahjong/fx/engine.ts 的 zimoFxUrl：從頭放就對準，不用往回推）。
//   node scripts/gen-nuke-sound.mjs            # 寫出 pc／mobile 兩檔
//   node scripts/gen-nuke-sound.mjs --preview  # 另外在 .preview/ 放一份 wav 方便試聽
// 長期快取：換內容一定要改檔名或加版本號（見 CLAUDE.md 的省量紀律），改完跑 node scripts/asset-hashes.mjs --write。
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/mahjong-fx/s");
const PREVIEW = process.argv.includes("--preview");

const SR = 44100;
/** 和 NUKE_TL 對齊（秒）：登場 0.26、發射 0.90、命中 1.80、大字 2.78、整段 4.60 */
const T = { enter: 0.26, launch: 0.9, hit: 1.8, zimo: 2.78, total: 4.6 };
const N = Math.round(SR * T.total);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** 0→1 的線段（超出範圍夾住），和特效裡的 seg 同一個意思 */
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
/** 固定亂數：每次產生的檔案完全一樣（同檔名換內容會踩長期快取的坑） */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = rng(911);
const noise = () => rnd() * 2 - 1;

const buf = new Float32Array(N);
/** 一階低通：把白噪音磨成「轟隆」而不是「嘶嘶」 */
function lowpass(src, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  const out = new Float32Array(src.length);
  let y = 0;
  for (let i = 0; i < src.length; i++) { y += a * (src[i] - y); out[i] = y; }
  return out;
}
function highpass(src, cutoff) {
  const lp = lowpass(src, cutoff);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] - lp[i];
  return out;
}
const add = (dst, src, gain = 1) => { for (let i = 0; i < dst.length; i++) dst[i] += src[i] * gain; };

// ── 1. 防空警報（0 → 發射）：上下掃的鋸齒，兩聲 ───────────────────────────
{
  const sirenEnd = T.launch + 0.35;
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (t > sirenEnd) break;
    const sweep = 0.5 - 0.5 * Math.cos((t / 0.78) * Math.PI * 2);     // 0.78 秒一個來回
    const f = 320 + 430 * sweep;
    ph += (2 * Math.PI * f) / SR;
    // 鋸齒感：基頻 + 2、3 泛音
    const v = Math.sin(ph) + 0.4 * Math.sin(ph * 2) + 0.18 * Math.sin(ph * 3);
    const env = seg(t, 0, 0.25) * (1 - seg(t, T.launch, sirenEnd));
    buf[i] += v * 0.1 * env;
  }
}

// ── 2. 低頻壓迫感（全程）：命中前慢慢堆上來 ──────────────────────────────
{
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (42 + 10 * Math.sin(t * 1.7))) / SR;
    const env = 0.5 * seg(t, T.enter, T.hit) * (1 - seg(t, T.hit + 1.6, T.total));
    buf[i] += Math.sin(ph) * 0.1 * env;
  }
}

// ── 3. 發射：噪音嘶聲上行 + 音高往上的尾焰 ──────────────────────────────
{
  const n = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const p = seg(t, T.launch, T.hit);
    if (p <= 0 || p >= 1) continue;
    n[i] = noise() * (0.25 + 0.75 * p) * (1 - Math.pow(p, 3));
  }
  add(buf, highpass(lowpass(n, 2600), 300), 0.42);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const p = seg(t, T.launch, T.hit);
    if (p <= 0 || p >= 1) continue;
    ph += (2 * Math.PI * (160 + 420 * p * p)) / SR;
    buf[i] += Math.sin(ph) * 0.05 * p;
  }
}

// ── 4. 核爆（命中）：低頻下掃 + 噪音爆開，慢慢退成餘響 ─────────────────────
{
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const d = t - T.hit;
    if (d < 0) continue;
    const f = 110 * Math.exp(-d * 2.6) + 24;        // 110Hz 掉到 24Hz
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-d * 1.35) * (1 - seg(t, T.total - 0.5, T.total));
    buf[i] += Math.tanh(Math.sin(ph) * 1.6) * 0.5 * env;  // 輕微失真＝更有「炸」的質感
  }
  const n = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR, d = t - T.hit;
    if (d < -0.02) continue;
    const crack = Math.exp(-Math.max(0, d) * 9);         // 一開始的爆裂
    const rumble = Math.exp(-Math.max(0, d) * 0.9);      // 之後的轟隆
    n[i] = noise() * (crack * 0.9 + rumble * 0.5);
  }
  add(buf, lowpass(n, 900), 0.5);                        // 低頻轟隆
  add(buf, highpass(lowpass(n, 7000), 2200), 0.16);      // 一點高頻碎裂
}

// ── 5. 大字：金屬撞擊（兩個泛音的鐘聲，短） ─────────────────────────────
{
  for (const [mul, gain] of [[1, 0.26], [2.76, 0.12], [5.4, 0.05]]) {
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR, d = t - T.zimo;
      if (d < 0) continue;
      ph += (2 * Math.PI * 520 * mul) / SR;
      buf[i] += Math.sin(ph) * gain * Math.exp(-d * (5 + mul)) ;
    }
  }
}

// ── 收尾：整段淡入淡出、限幅 ─────────────────────────────────────────────
for (let i = 0; i < N; i++) {
  const t = i / SR;
  buf[i] *= seg(t, 0, 0.02) * (1 - seg(t, T.total - 0.25, T.total));
  buf[i] = Math.tanh(buf[i] * 1.1);
}

/** 16 bit 單聲道 WAV */
function wav(samples, gain) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(clamp(samples[i] * gain, -1, 1) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

mkdirSync(OUT, { recursive: true });
let peak = 1e-6; // 20 萬個取樣，不能用 Math.max(...陣列)（會爆呼叫堆疊）
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
// pc：留 3 dB 餘裕；mobile：手機喇叭沒低頻，整體再推一點（和其他特效的 pc／mobile 兩版同一個做法）
for (const [suffix, gain, hp] of [["pc", 0.7 / peak, 0], ["mobile", 0.86 / peak, 90]]) {
  const src = hp ? (() => { const h = highpass(buf, hp); const out = new Float32Array(N); for (let i = 0; i < N; i++) out[i] = buf[i] * 0.55 + h[i] * 0.75; return out; })() : buf;
  const tmp = path.join(OUT, `.nuke-${suffix}.wav`);
  const mp3 = path.join(OUT, `zimo-nuke-${suffix}.mp3`);
  writeFileSync(tmp, wav(src, gain));
  execFileSync(ffmpeg, ["-y", "-i", tmp, "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", mp3], { stdio: "pipe" });
  if (PREVIEW) { mkdirSync(path.join(ROOT, ".preview"), { recursive: true }); writeFileSync(path.join(ROOT, ".preview", `zimo-nuke-${suffix}.wav`), wav(src, gain)); }
  execFileSync("/bin/rm", ["-f", tmp]);
  console.log(`寫出 ${path.relative(ROOT, mp3)}（${T.total} 秒，爆炸在 ${T.hit} 秒）`);
}
console.log("\n記得跑：node scripts/asset-hashes.mjs --write");
