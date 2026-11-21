// 十三支大字特效「只出現一半、偏到下半部」（老馬 2026-11-22）：每張特效圖在載完前就要有長寬比（ThRevealFx 的 FX_AR），
// 不然 iPhone Safari 在動畫開始那一刻把 translate(-50%,-50%) 的 -50% 高度當成 0，整張圖上緣停在中線往下長。
// 這裡逐張比對 FX_AR 和實際圖檔（手機 .m、桌機 .d）的長寬比，換素材忘了改 FX_AR 就會失敗。
import { readFileSync } from "node:fs";
import path from "node:path";
import { FX_AR, FX_NAMES, fxSrc } from "../components/thirteen/ThRevealFx";

/** 讀 webp 檔頭的寬高（VP8X／VP8L／VP8） */
function webpSize(file: string): [number, number] {
  const b = readFileSync(file), kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const pub = path.join(import.meta.dirname, "..", "public");
const ar = (FX_AR ?? {}) as Record<string, [number, number]>;
for (const n of FX_NAMES) {
  const want = ar[n];
  if (!want) { ok(false, `${n}：FX_AR 沒有長寬比`); continue; }
  const r = want[0] / want[1];
  const bad = (["m", "d"] as const).map((s) => { const [w, h] = webpSize(path.join(pub, fxSrc(n, s))); return Math.abs(w / h - r) / r > 0.01 ? `${s} 實際 ${w}×${h}` : null; }).filter(Boolean);
  ok(bad.length === 0, `${n}：長寬比 ${want[0]}:${want[1]} 和手機、桌機圖一致${bad.length ? "（" + bad.join("、") + "）" : ""}`);
}
for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
