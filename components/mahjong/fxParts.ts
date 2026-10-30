// 特效「零件」的共用寫法（老馬 2026-10-31；ZimoFx 的風暴、黑洞、櫻花 v4 和雷霆、冰封、隕石的補細節層都用這套）：
// 每個零件依視角固定轉一次方向（rot／flip），之後只做位移、縮放、透明度（碎石、碎片另外小幅自轉）；序列幀用 background-position 一格一格跳。
// 姿勢的時間都是毫秒（從特效開始算），由 runParts 換成 Web Animations 的整條時間軸（和特效的 CSS 動畫同時開始，預熱、定格截圖都能一起走）。

/** 一個姿勢：相對落點的位移（px）、縮放（s＝橫、sy＝直，沒給＝s）、透明度、自轉（度）、到下一個姿勢的 easing；bp＝序列幀的 background-position */
export type Pose = { x: number; y: number; s: number; sy?: number; o: number; r?: number; e?: string; bp?: string };
/** 一個零件：元素、尺寸、固定的方向（rot、左右翻面）、時間軸上的姿勢（ms）；rm＝減少動態時定格的姿勢（只有標 data-rmk 的那一個會顯示） */
export type Part = { el: HTMLElement; w: number; h: number; rot?: number; flip?: boolean; keys: [number, Pose][]; rm?: Pose };

export const poseCss = (p: Part, q: Pose) =>
  `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) rotate(${((p.rot ?? 0) + (q.r ?? 0)).toFixed(1)}deg) scale(${(q.s * (p.flip ? -1 : 1)).toFixed(3)}, ${(q.sy ?? q.s).toFixed(3)})`;

/** 精靈表第 k 格的 background-position（cols × rows 格） */
export const cellPos = (k: number, cols: number, rows: number) =>
  `${cols > 1 ? ((k % cols) / (cols - 1)) * 100 : 0}% ${rows > 1 ? (Math.floor(k / cols) / (rows - 1)) * 100 : 0}%`;

/** 給每個零件尺寸（元素中心放在落點）；減少動態只把定格的那一個擺好姿勢、不排動畫；否則排好整條時間軸，回傳動畫（清除時 cancel） */
export function runParts(parts: Part[], total: number, rm: boolean): Animation[] {
  const anims: Animation[] = [];
  for (const p of parts) {
    Object.assign(p.el.style, { width: `${Math.round(p.w)}px`, height: `${Math.round(p.h)}px`, margin: `${Math.round(-p.h / 2)}px 0 0 ${Math.round(-p.w / 2)}px` });
    if (rm) {
      if (p.rm) Object.assign(p.el.style, { transform: poseCss(p, p.rm), ...(p.rm.bp ? { backgroundPosition: p.rm.bp } : {}) });
      continue;
    }
    const kf: Keyframe[] = p.keys.map(([ms, q]) => ({ offset: Math.min(1, Math.max(0, ms / total)), opacity: q.o, transform: poseCss(p, q), ...(q.bp ? { backgroundPosition: q.bp } : {}), ...(q.e ? { easing: q.e } : {}) }));
    // 時間軸頭尾補齊（同一個零件的每個姿勢都有 opacity、transform）
    if (kf[0].offset !== 0) kf.unshift({ ...kf[0], offset: 0 });
    if (kf[kf.length - 1].offset !== 1) kf.push({ ...kf[kf.length - 1], offset: 1, easing: "linear" });
    anims.push(p.el.animate(kf, { duration: total, fill: "both" }));
  }
  return anims;
}
