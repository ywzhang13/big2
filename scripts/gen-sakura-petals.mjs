// 產生櫻花紛飛的花瓣表（小宜規格第 5、8 節）：6 種形狀 × 上排清晰、下排預先模糊。手機 384×128、電腦 576×192。
// 用法：node scripts/gen-sakura-petals.mjs；之後跑 node scripts/asset-hashes.mjs --write。長期快取素材不能同檔名換內容：要換畫面就改檔名（v3…），也要改 ZimoFx.tsx 的檔名。
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/mahjong-fx/zimo/sakura");
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
for (const [name, cell] of [["sakura-petals-v2-m", 64], ["sakura-petals-v2-d", 96]]) {
  const data = await p.evaluate((cell) => {
    const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; }; };
    const c = document.createElement("canvas"); c.width = cell * 6; c.height = cell * 2;
    const x = c.getContext("2d");
    const tones = [["#fff4f6", "#ffc4d6", "#f58cb0"], ["#ffeef3", "#ffb5cc", "#ec7ea6"], ["#fff8f8", "#ffd3df", "#f7a0bc"], ["#ffe9f0", "#ffa9c5", "#e0709c"], ["#fff5f2", "#ffcbd2", "#f28fa8"], ["#fffafa", "#ffdbe6", "#f9afc6"]];
    const petal = (g, i, cx, cy, s) => {
      const r = rng(i * 77 + 3), w = s * (0.56 + r() * 0.16), h = s, notch = s * (0.1 + r() * 0.07), bend = (r() - 0.5) * s * 0.22;
      g.save(); g.translate(cx, cy);
      const q = new Path2D();
      q.moveTo(0, h * 0.5);
      q.bezierCurveTo(-w * 0.62 + bend, h * 0.22, -w * 0.62 + bend, -h * 0.36, -w * 0.12, -h * 0.5);
      q.lineTo(0, -h * 0.5 + notch);
      q.lineTo(w * 0.12, -h * 0.5);
      q.bezierCurveTo(w * 0.62 + bend, -h * 0.36, w * 0.62 + bend, h * 0.22, 0, h * 0.5);
      const gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
      gr.addColorStop(0, tones[i][0]); gr.addColorStop(0.55, tones[i][1]); gr.addColorStop(1, tones[i][2]);
      g.fillStyle = gr; g.fill(q);
      g.globalAlpha = 0.28; g.strokeStyle = tones[i][2]; g.lineWidth = Math.max(0.6, s * 0.012);
      for (const k of [-0.22, 0, 0.22]) { g.beginPath(); g.moveTo(0, h * 0.44); g.quadraticCurveTo(k * w, 0, k * w * 1.25, -h * 0.34); g.stroke(); }
      g.restore();
    };
    for (let i = 0; i < 6; i++) petal(x, i, cell * (i + 0.5), cell * 0.5, cell * 0.82);
    x.filter = `blur(${Math.max(1, Math.round(cell * 0.03))}px)`;
    for (let i = 0; i < 6; i++) petal(x, i, cell * (i + 0.5), cell * 1.5, cell * 0.72);
    x.filter = "none";
    return c.toDataURL("image/webp", 0.92);
  }, cell);
  const buf = Buffer.from(data.split(",")[1], "base64");
  writeFileSync(path.join(OUT, `${name}.webp`), buf);
  console.log(name, buf.length, "bytes");
}
await b.close();
