// 十三支大牌大字換老闆 2026-11-20 新圖（v3，去背、四邊羽化）：7 種大字各有自己的圖；寬高比＝圖的像素寬高比（不變形）；跟動畫長度無關
import { existsSync, readFileSync } from "node:fs";
const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const L = await import("../components/thirteen/fanLayout");
const T = await import("../components/thirteen/revealTimeline");
const S = await import("../components/thirteen/sfx");
const KINDS = Object.keys(L.FX_RATIO) as (keyof typeof L.FX_RATIO)[];
const tsx = readFileSync("components/thirteen/ThRevealFx.tsx", "utf8");
ok(KINDS.length === 7 && KINDS.every((k) => new RegExp(`${k}: "v3"`).test(tsx) && ["m", "d"].every((z) => existsSync(`public/tiles/thirteen/fx/th-fx-${k}.v3.${z}.webp`))),
  "X1 7 種大字（衝三、鐵支、同花順、五龍、彩金衝三、彩金葫蘆、彩金鐵支）都用 v3 新圖，手機 .m、桌機 .d 都在；彩金三種不借用一般版");
const px: Record<string, [number, number]> = { chongsan: [990, 622], tiezhi: [1070, 590], tonghuashun: [1600, 596], wulong: [1398, 722], jpchongsan: [1320, 698], jphulu: [1375, 731], jptiezhi: [1378, 675] };
ok(KINDS.every((k) => Math.abs(L.FX_RATIO[k] - px[k][0] / px[k][1]) < 1e-9), "X2 FX_RATIO＝小宜清單的像素寬÷高（不變形）");
const w = (k: (typeof KINDS)[number]) => L.fxWidth("top", k);
ok(w("wulong") >= w("tonghuashun") && w("tonghuashun") > w("tiezhi") && w("tiezhi") > w("chongsan") && w("jpchongsan") > w("chongsan") && w("jptiezhi") > w("tiezhi") && w("jphulu") > w("tiezhi"),
  "X3 大小階層：五龍≥同花順＞鐵支＞衝三；彩金三種比對應的一般牌型大");
const hv = (cat: number) => ({ cat: cat as 0, keys: [] as number[] });
ok(T.patternFx("front", hv(13)) === "jpchongsan" && T.patternFx("middle", hv(14)) === "jphulu" && T.patternFx("back", hv(15)) === "jptiezhi" && T.patternFx("middle", hv(12)) === "tonghuashun" && T.patternFx("middle", hv(10)) === "tonghuashun",
  "X4 牌型→大字：彩金衝三／彩金葫蘆／彩金鐵支各自一張，黑桃和非黑桃同花順共用同花順");
const evs = S.sfxEvents([{ kind: "fx", t0: 0, dur: 1500, row: "middle", seat: 0, fx: "jphulu" }, { kind: "fx", t0: 2000, dur: 1500, row: "back", seat: 0, fx: "jptiezhi" }, { kind: "fx", t0: 4000, dur: 1500, row: "front", seat: 0, fx: "jpchongsan" }], 0, S.BIG_SFX[0].id);
const big = evs.filter((e) => e.k !== "voice" && e.k !== "score");
ok(big.length === 3 && big.every((e) => e.src === S.BIG_SFX[0].src), `X5 彩金大字出現時播選好的大牌音效（跟衝三、鐵支一樣，${big.length} 次）`);
console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
