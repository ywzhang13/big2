// 把「畫進圖裡的假透明格」鍵成真 alpha（核彈的爆炸、人物素材共用）。
// AI 出圖工具不會輸出真的透明度，常常把透明格直接畫進圖裡（整張 3 channels、100% 不透明）。
import sharp from "sharp";

/**
 * 這張圖的透明度是真的嗎。
 * 只看 metadata.hasAlpha 會被騙：有些工具會輸出 4 channels 但整張 alpha=255，
 * 透明格還是畫進圖裡的（老闆 2026-11-11 的人物表就是這樣）。
 */
export async function hasRealAlpha(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 250) return true;
  return false;
}

/** 一維滑動視窗的最小／最大值（deque，每個像素 O(1)）：下面的局部兩階還原要用 */
export function slide(src, W, H, r, horizontal, cmp) {
  const out = new Float32Array(W * H);
  const idx = new Int32Array(Math.max(W, H));
  const n = horizontal ? W : H, m = horizontal ? H : W;
  const at = (i, j) => (horizontal ? j * W + i : i * W + j);
  for (let j = 0; j < m; j++) {
    let head = 0, tail = 0;
    for (let i = 0; i < n + r; i++) {
      if (i < n) {
        const v = src[at(i, j)];
        while (tail > head && cmp(src[at(idx[tail - 1], j)], v)) tail--;
        idx[tail++] = i;
      }
      const c = i - r;
      if (c >= 0) {
        while (idx[head] < c - r) head++;
        out[at(c, j)] = src[at(idx[head], j)];
      }
    }
  }
  return out;
}

/**
 * AI 出圖工具不會輸出真的透明度，常常把「透明格」直接畫進圖裡（整張 3 channels、100% 不透明）。
 * 這支把那種假格子鍵成真 alpha。
 *
 * 不用幾何推算（算出週期和相位再判斷每個像素落在哪一格）：AI 畫的棋盤只是「看起來規則」，
 * 實測週期會飄，整張推到後面會偏掉整格，白熱光暈裡就留下一格一格的方塊。
 * 改用局部性質——在一個略大於一格的視窗裡，背景只有兩階，而且同一片半透明內容上：
 *     低階 = F·α + t0·(1−α)、高階 = F·α + t1·(1−α)
 *   兩式相減就把前景 F 消掉了：α = 1 − (高階 − 低階) / (t1 − t0)
 * 不必假設前景是白是黑，棋盤規不規則也無所謂。全不透明的地方兩階相等 → α=1；
 * 純背景的地方差距正好是 t1−t0 → α=0。
 * 另外兩個保險（取三者最大）：有彩度一定是內容；亮過 t1 或暗過 t0 也一定是內容——
 * 這兩個在物件邊緣（視窗同時吃到內容和背景、兩階差被撐大）時頂住，不會把邊緣啃掉。
 */
export async function stripFakeChecker(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const N = W * H;
  const lum = new Float32Array(N), chroma = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2];
    lum[p] = (r + g + b) / 3;
    chroma[p] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  // 兩個灰階：沿整張圖最外圈一圈（幾乎一定是背景）＋四個角落取低彩度像素，取直方圖的兩個峰。
  // 不用分位數：角落有時會壓到角色（深色西裝），分位數會被拉歪（實測把 203／243 誤判成 43／204）。
  const hist = new Map();
  const note = (x, y) => {
    const p = y * W + x;
    if (chroma[p] > 6) return;
    const v = Math.round(lum[p]);
    if (v < 20 || v > 250) return;
    hist.set(v, (hist.get(v) ?? 0) + 1);
  };
  const EDGE = 16;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < EDGE || x >= W - EDGE || y < EDGE || y >= H - EDGE) note(x, y);
  }
  const S = Math.min(72, Math.floor(Math.min(W, H) / 6));
  for (const [bx, by] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) {
    for (let y = by; y < by + S; y += 2) for (let x = bx; x < bx + S; x += 2) note(x, y);
  }
  if (hist.size < 2) throw new Error("找不到灰色透明格：請給真的去背圖，或確認背景是棋盤格");
  // 把相鄰的灰階併成同一個峰（抗壓縮雜訊），再取最高的兩個
  const peaks = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const first = peaks[0][0];
  const second = (peaks.find(([v]) => Math.abs(v - first) >= 10) ?? [])[0];
  if (second === undefined) throw new Error("背景不是棋盤格（只有一種灰）");
  const t0 = Math.min(first, second), t1 = Math.max(first, second);
  // 視窗略大於一格：用最上面那一列的跳變間距估格子大小
  const edges = [];
  for (let x = 1; x < W; x++) if (Math.abs(lum[x] - lum[x - 1]) > 6) edges.push(x);
  const gaps = edges.slice(1).map((v, i) => v - edges[i]).filter((d) => d > 5).sort((a, b) => a - b);
  const cell = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 16;
  const r = Math.max(4, Math.round(cell * 0.8));
  console.log(`這張圖沒有 alpha，偵測到畫進去的透明格（格子約 ${cell}px、灰階 ${t0}／${t1}），用局部兩階還原`);

  const gt = (a, b) => a < b, lt = (a, b) => a > b;
  const lmax = slide(slide(lum, W, H, r, true, gt), W, H, r, false, gt);
  const lmin = slide(slide(lum, W, H, r, true, lt), W, H, r, false, lt);

  // 先算 α（存成一張圖再輕輕模糊：α 本身若還帶一點棋盤紋，模糊掉比硬套門檻乾淨）
  const alpha = new Float32Array(N);
  const Bof = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const v = lum[p];
    // 落在深格還是淺格：和視窗裡兩階的中點比（不靠幾何位置，棋盤不規則也對）
    const B = v < (lmin[p] + lmax[p]) / 2 ? t0 : t1;
    Bof[p] = B;
    const aLevel = 1 - (lmax[p] - lmin[p]) / (t1 - t0);
    // 亮度項一律相對「這個像素自己的底色」，兩種格子算出來才一致；
    // 用全域門檻會讓同一片光暈在深淺格上得到不同的 α，alpha 本身就帶棋盤紋。
    const aRel = v > B ? (v - B) / (255 - B) : (B - v) / B;
    // 彩度只當「一定是內容」的保險，門檻要寬：取太緊（例如 /16）會把帶一點暖色的光暈
    // 整片判成不透明，顏色就直接照搬原圖、把棋盤一起帶進去。真正飽和的火焰彩度都破百。
    alpha[p] = Math.max(aLevel, aRel, chroma[p] / 60);
  }
  // 很淡的地方（α 小）還原前景是除以小數，雜訊會被放大成灰霧：直接當全透明
  const FLOOR = 0.14;
  const sm = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        acc += alpha[yy * W + xx]; n++;
      }
      sm[y * W + x] = acc / n;
    }
  }
  const out = Buffer.alloc(N * 4);
  for (let p = 0; p < N; p++) {
    const i = p * C, o = p * 4, B = Bof[p];
    // 扣掉底線之後再過一次 smoothstep：剩下的低值（背景殘霧）被壓得更低，
    // 高值幾乎不動，所以光暈不會被切出硬邊。
    const t = sm[p] <= FLOOR ? 0 : Math.min(1, (sm[p] - FLOOR) / (1 - FLOOR));
    const a = t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) out[o + c] = a > 0.02 ? Math.max(0, Math.min(255, (data[i + c] - B * (1 - a)) / a)) : 0;
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

