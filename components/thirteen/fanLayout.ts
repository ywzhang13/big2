// 十三支出牌區的幾何（純函式，畫面和測試共用；基準 844×390，牌桌整塊等比放大）：
//   小宜 v13 扇形出牌（相鄰兩張夾 4°，每墩排在圓弧上）、v14.2 四家牌背區（剩下的牌背滑到正中間）、v14 大牌大字分級。
//   座位自己的座標：原點＝頭墩中間那張牌的中心，x 往右、y 往玩家；整組再轉到那一家的方向（自己 0°、右家 −90°、對家 180°、左家 90°）
export type Pos = "bottom" | "right" | "top" | "left";

export interface SeatGeo {
  /** 頭墩中間那張牌的中心（牌桌座標） */
  o: [number, number];
  rot: number;
  /** 牌的大小、同墩相鄰兩張中心距離、每墩往玩家方向錯開 */
  w: number; h: number; step: number; off: number;
  /** 牌背區中心（牌桌座標）、牌背大小、牌背相鄰距離 */
  strip: [number, number]; bw: number; bh: number; bx: number;
}

/** v14.2 §6 參數表 */
export const SEAT_GEO: Record<Pos, SeatGeo> = {
  bottom: { o: [422, 267], rot: 0, w: 46, h: 64, step: 30, off: 36, strip: [422, 361], bw: 30, bh: 42, bx: 16 },
  right: { o: [516, 185], rot: -90, w: 40, h: 56, step: 25, off: 31, strip: [732, 185], bw: 26, bh: 36, bx: 14 },
  top: { o: [422, 107], rot: 180, w: 40, h: 56, step: 25, off: 30, strip: [422, 26], bw: 26, bh: 36, bx: 14 },
  left: { o: [328, 185], rot: 90, w: 40, h: 56, step: 25, off: 31, strip: [112, 185], bw: 26, bh: 36, bx: 14 },
};
/** 相鄰兩張夾角（v13）；牌背組和組的間隔（v14.2） */
export const FAN_DEG = 4, BACK_GAP = 6;
/** 前端動畫時間（v13 §5、v14.2 §3）：每張牌飛 0.29 秒、依序晚 0.015 秒；牌背滑 0.2 秒。條件：都 ≤ 出牌落定 0.35 秒 */
export const FAN_FLY_MS = 290, FAN_STAGGER_MS = 15, BACK_SLIDE_MS = 200;
export const ROW_SIZES = [3, 5, 5] as const;

const rad = (d: number) => (d * Math.PI) / 180;
/** 座位座標 → 牌桌座標 */
export function toStage(g: SeatGeo, x: number, y: number): [number, number] {
  const c = Math.cos(rad(g.rot)), s = Math.sin(rad(g.rot));
  return [g.o[0] + x * c - y * s, g.o[1] + x * s + y * c];
}
/** 牌桌座標 → 座位座標 */
export function toLocal(g: SeatGeo, X: number, Y: number): [number, number] {
  const c = Math.cos(rad(g.rot)), s = Math.sin(rad(g.rot)), dx = X - g.o[0], dy = Y - g.o[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}

/** 第 r 墩第 i 張（這墩 n 張）在座位座標的中心和角度：θ＝k×4°，x＝R sinθ，y＝r×off＋R(1−cosθ)，R＝step ÷ (2 sin(2°)) */
export function cardPose(g: SeatGeo, r: number, i: number, n: number): { x: number; y: number; deg: number } {
  const k = i - (n - 1) / 2, R = g.step / (2 * Math.sin(rad(FAN_DEG) / 2)), t = rad(k * FAN_DEG);
  return { x: R * Math.sin(t), y: r * g.off + R * (1 - Math.cos(t)), deg: k * FAN_DEG };
}

/** 牌背區：還沒出的墩（gone＝已經出了幾墩，照頭、中、尾順序）每組的中心，座位座標的 x（沿牌背排列方向）。
 *  總長＝各組長度＋6×(組數−1)，從 −總長÷2 排起；出掉的墩回 null */
export function backGroupX(g: SeatGeo, gone: number): (number | null)[] {
  const len = (n: number) => g.bw + (n - 1) * g.bx;
  const left = ROW_SIZES.map((n, r) => (r < gone ? 0 : len(n)));
  const total = left.reduce((a, b) => a + b, 0) + BACK_GAP * (3 - gone - 1);
  let x = -total / 2;
  return ROW_SIZES.map((_, r) => {
    if (r < gone) return null;
    const c = x + left[r] / 2;
    x += left[r] + BACK_GAP;
    return c;
  });
}
/** 牌背區中心在座位座標的 y（往玩家方向） */
export const backY = (g: SeatGeo) => toLocal(g, g.strip[0], g.strip[1])[1];

/** 大牌大字（v14 §3）：五龍寬當 100%（他家 210、自己 270）；同花順 90%、鐵支 80% 照寬；衝三照面積 70%。素材寬高比 fx-info-v2.json */
export const FX_RATIO = { chongsan: 1.3734, tiezhi: 2.6947, tonghuashun: 2.7179, wulong: 2.6987 } as const;
export type FxKind = keyof typeof FX_RATIO;
const FX_K: Record<FxKind, number> = { wulong: 1, tonghuashun: 0.9, tiezhi: 0.8, chongsan: 0.7 };
/** 中央看板（v12）與大字放大到最大的倍數 */
export const BOARD_RECT = [366, 143, 112, 84] as const, FX_PEAK = 1.08;
export function fxWidth(pos: Pos, kind: FxKind): number {
  const w0 = pos === "bottom" ? 270 : 210;
  return kind === "chongsan" ? w0 * FX_K.chongsan * Math.sqrt(FX_RATIO.chongsan / FX_RATIO.wulong) : w0 * FX_K[kind];
}
/** 大字中心（牌桌座標）：那一家中墩中間那張牌；左右家往外移，最大瞬間也離看板 4px（算出來比原本更靠內就不移） */
export function fxCenter(pos: Pos, kind: FxKind): [number, number] {
  const g = SEAT_GEO[pos], w = fxWidth(pos, kind);
  let [x] = toStage(g, 0, g.off);
  const y = toStage(g, 0, g.off)[1];
  if (pos === "right") x = Math.max(x, BOARD_RECT[0] + BOARD_RECT[2] + 4 + (w * FX_PEAK) / 2);
  if (pos === "left") x = Math.min(x, BOARD_RECT[0] - 4 - (w * FX_PEAK) / 2);
  return [x, y];
}
