// 把「低解析但去背乾淨」的 alpha 和「高解析但去背會殘留」的顏色合起來。
// 為什麼要這招：AI 放大器會把背景的棋盤弄得不均勻（每一格的灰階略有差異），
// 局部兩階還原在半透明的光暈那裡就會留下一格一格的殘影。但同一張圖在 1024 時
// 棋盤是規則的，去背乾淨——alpha 又是平滑的東西，直接等比放大不會失真。
// 所以：alpha 取 1024 那版放大，顏色取 2048 那版（不透明處的像素沒有背景成分，直接用就對），
// 半透明的邊緣仍用 1024 版已經解混合好的顏色，依 alpha 混合。
import sharp from "sharp";

export async function mergeUpscaled(lowRgba, highRgba, size) {
  const lo = await sharp(lowRgba).resize({ width: size, height: size }).ensureAlpha().raw().toBuffer();
  const hi = await sharp(highRgba).resize({ width: size, height: size }).ensureAlpha().raw().toBuffer();
  const out = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const a = lo[i + 3];                      // alpha 一律用低解析那版（乾淨）
    const t = Math.min(1, Math.max(0, (a / 255 - 0.85) / 0.15));  // 越不透明越信任高解析的顏色
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(lo[i + c] * (1 - t) + hi[i + c] * t);
    out[i + 3] = a;
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
