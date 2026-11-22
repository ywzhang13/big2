// 十三支亮牌不能擋到中央看板（老馬 2026-11-22，老闆 iPhone 截圖：左右家亮開的牌壓在看板上）。
// 原因：第十批 iPhone UI A2 為了避開瀏海，把左右家整組（.th-seatbox：名牌＋牌背＋亮牌扇形）往內縮 Δ；
// 亮牌扇形的中心本來就緊貼看板左右緣（SEAT_GEO left.o＝328、right.o＝516，看板 366～478），一起內縮就壓進看板。
// 這裡用 fanLayout 的真實幾何算每張亮牌的範圍，照 thRoom.css 實際的規則決定扇形有沒有跟著內縮，用 iPhone 852×393 的 Δ 算重疊。
import { readFileSync } from "node:fs";
import { SEAT_GEO, ROW_SIZES, BOARD_RECT, cardPose, toStage, type Pos } from "../components/thirteen/fanLayout";
const css = readFileSync("components/thirteen/thRoom.css", "utf8");
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
// iPhone 852×393：左右安全區 59、牌桌倍率約 1.0077 → Δ＝(59＋8)/1.0077−4 ≈ 62.5（牌桌座標）
const DELTA = (59 + 8) / (852 / 844) - 4;
const rule = (sel: string) => new RegExp(sel.replace(/[.]/g, "\\.") + " \\{ margin-(left|top): [^}]*--th-d[lr]").test(css);
// 扇形（.th-blk）在座位容器 .th-seatbox 裡：只有整個座位容器被內縮時，扇形才會跟著移
const fanShifted = { left: rule(".th-bg > .th-table .th-seatbox.th-at-left"), right: rule(".th-bg > .th-table .th-seatbox.th-at-right") };
const [bx, by, bw, bh] = BOARD_RECT;
function fanOverlap(pos: Pos, shift: number): number {
  const g = SEAT_GEO[pos]; let area = 0;
  ROW_SIZES.forEach((n, r) => { for (let i = 0; i < n; i++) {
    const p = cardPose(g, r, i, n); const [cx, cy] = toStage(g, p.x, p.y); const a = ((p.deg + g.rot) * Math.PI) / 180;
    const w = Math.abs(g.w * Math.cos(a)) + Math.abs(g.h * Math.sin(a)), h = Math.abs(g.w * Math.sin(a)) + Math.abs(g.h * Math.cos(a));
    const L = cx + shift - w / 2, R = cx + shift + w / 2, T = cy - h / 2, B = cy + h / 2;
    area += Math.max(0, Math.min(R, bx + bw) - Math.max(L, bx)) * Math.max(0, Math.min(B, by + bh) - Math.max(T, by));
  } });
  return Math.round(area);
}
const ovL = fanOverlap("left", fanShifted.left ? DELTA : 0), ovR = fanOverlap("right", fanShifted.right ? -DELTA : 0);
ok(ovL === 0 && ovR === 0, `B1 iPhone 852×393（Δ≈${DELTA.toFixed(1)}）亮牌時左右家扇形和中央看板重疊＝0（左 ${ovL}、右 ${ovR}）`);
ok(fanOverlap("left", 0) === 0 && fanOverlap("right", 0) === 0 && fanOverlap("top", 0) === 0 && fanOverlap("bottom", 0) === 0, "B2 扇形在原位（沒有安全區的手機、桌機）時四家都不碰看板");
ok(/\.th-seatbox\.th-at-left \.th-gp-left \{ margin-left: var\(--th-dl\); \}/.test(css) && /\.th-seatbox\.th-at-right \.th-gp-right \{ margin-left: calc\(-1 \* var\(--th-dr\)\); \}/.test(css), "B3 左右家名牌仍往內縮（避開瀏海，第十批 A2）");
ok(/\.th-seatbox\.th-at-left \.th-hand-strip \{ margin-top: calc\(-1 \* var\(--th-dl\)\); \}/.test(css) && /\.th-seatbox\.th-at-right \.th-hand-strip \{ margin-top: calc\(-1 \* var\(--th-dr\)\); \}/.test(css), "B4 左右家手上的牌背仍往內縮（座位容器轉 ±90°，往內＝容器的 −y）");
// B5 出牌飛行的起點（th-fan-fly 的 --dy）要跟著牌背一起內縮，起點才會是看得到的牌背中心（審伯建議）
//    ThTable 行內 style 若直接給 --dy，會蓋過 thRoom.css 的內縮 → 起點停在沒內縮的位置
const tsx = readFileSync("components/thirteen/ThTable.tsx", "utf8");
const inlineDy = /"--dy":/.test(tsx);
const shiftOf = (v: string | undefined) => (v && /--th-d[lr]/.test(v) ? -DELTA : 0);
const stripY = (side: string) => shiftOf(css.match(new RegExp(`\\.th-seatbox\\.th-at-${side} \\.th-hand-strip \\{ margin-top: ([^;]*);`))?.[1]);
const flyY = (side: string) => inlineDy || !/"--dy0":/.test(tsx) ? 0 : shiftOf(css.match(new RegExp(`\\.th-seatbox\\.th-at-${side} \\.th-fan-card \\{ --dy: calc\\(var\\(--dy0, 0px\\) - ([^)]*\\))\\); \\}`))?.[1]);
const flyGap = { left: Math.abs(flyY("left") - stripY("left")), right: Math.abs(flyY("right") - stripY("right")) };
ok(flyGap.left <= 1 && flyGap.right <= 1, `B5 iPhone 852×393 左右家出牌飛行起點和看得到的牌背中心差 ≤1（左 ${flyGap.left.toFixed(1)}、右 ${flyGap.right.toFixed(1)}）`);
for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
