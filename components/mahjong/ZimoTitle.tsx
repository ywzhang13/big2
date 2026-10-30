"use client";

// 自摸特效庫的專屬「自摸」大字＋名字（老闆 2026-10-31：大字改用老闆生成的 6 款圖，zimo-titles-6.png 切成每款一張，
// 放在 /mahjong-fx/zimo/<代號>/<代號>-title.webp，只在用到這一種特效時跟著特效素材一起下載；隕石的在 MeteorFx）。
// 每款有自己的登場（只有位移、縮放、透明度，不旋轉，最後一定停在正的位置），定格後加一層持續的小動態：
//   雷霆＝電弧閃爍＋白光掃過、風暴＝風帶流過＋葉片被吹走、冰封＝冰面反光掃過、黑洞＝星塵繞行＋金邊微光、櫻花＝花瓣飄落＋金邊閃光
// 名字是實際的自摸者名字（任何字），用系統字型，放在大字下面。位置（--zx 中線、--zy 上緣）由外面算好；t／n＝大字、名字出現的毫秒數（從特效開始算）。
// 大字高度＝1.2em（em＝字級 clamp(92px, 14vw, 202px)，和原本字型版同一個字級），寬度照每張圖的長寬比。
// 減少動態：大字直接定格顯示，名字淡入；沒有登場動作、閃爍、掃光、粒子
import type { CSSProperties } from "react";
import type { ZimoFxNew } from "@/lib/mahjong/winShow";
import "./zimoTitle.css";

/** 每款大字圖的長寬比（寬÷高，切圖時量的原尺寸：雷霆 656×346、風暴 725×363、冰封 647×352、黑洞 696×343、櫻花 646×345） */
export const ZIMO_TITLE_AR: Record<ZimoFxNew, number> = { thunder: 1.896, storm: 1.997, frost: 1.838, blackhole: 2.029, sakura: 1.872 };
/** 大字高度相對字級（em） */
export const ZIMO_TITLE_EM = 1.2;
export const zimoTitleArt = (fx: ZimoFxNew) => `/mahjong-fx/zimo/${fx}/${fx}-title.webp`;

const loads = new Map<ZimoFxNew, Promise<boolean>>();
/** 先載好、解碼好這一款大字圖（特效本身的預載已經包含；這支給只看大字的地方用） */
export function loadZimoTitle(fx: ZimoFxNew): Promise<boolean> {
  let p = loads.get(fx);
  if (!p) {
    const i = new Image();
    i.src = zimoTitleArt(fx);
    p = i.decode().then(() => true, () => false);
    loads.set(fx, p);
  }
  return p;
}

/** 固定的小粒子（不用亂數，每次播都一樣）：櫻花花瓣、風暴葉片、黑洞星塵 */
const PETALS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 + 0.4;
  return { x: Math.cos(a) * (1.25 + (i % 3) * 0.2), y: Math.sin(a) * (0.55 + (i % 2) * 0.15), dx: (i % 2 ? 1 : -1) * (0.3 + (i % 4) * 0.12), r: (i * 47) % 360, d: (i % 5) * 160 };
});
const LEAVES = Array.from({ length: 7 }, (_, i) => ({ y: -0.42 + (i % 4) * 0.27, x: -0.8 + ((i * 37) % 9) * 0.18, d: i * 210, s: 0.8 + (i % 3) * 0.2 }));
const DUST = Array.from({ length: 10 }, (_, i) => ({ d: -i * 360, s: 0.6 + (i % 3) * 0.3, k: i % 2 }));

/**
 * fx：哪一種；name：名字（最多 10 個字）；t／n：大字、名字出現的毫秒數；wind：風暴的風往哪邊吹（1 往右、-1 往左）；
 * rm：減少動態；mobile：手機版名字字級較小；src：大字圖（預熱時傳占位圖，平常不用給）
 */
export default function ZimoTitle({ fx, name, t, n, wind = 1, rm, mobile, src }: {
  fx: ZimoFxNew; name: string; t: number; n: number; wind?: number; rm?: boolean; mobile: boolean; src?: string;
}) {
  const shown = Array.from(name).length > 10 ? `${Array.from(name).slice(0, 10).join("")}…` : name;
  const url = `url("${src ?? zimoTitleArt(fx)}")`;
  const style = { "--zt": `${t}ms`, "--zn": `${n}ms`, "--wd": wind, "--ar": ZIMO_TITLE_AR[fx], "--src": url } as CSSProperties;
  return (
    <div className={`zz zz-${fx} ${mobile ? "m" : "d"} ${rm ? "rm" : ""}`} style={style} data-zf-zimo={fx}>
      <span className="zz-back" />
      <b className="zz-art" role="img" aria-label="自摸">
        {/* 雷霆：同一張圖提亮後疊上去一直閃（電弧閃爍） */}
        {fx === "thunder" && <span className="zz-glow" />}
        {/* 掃光（雷霆白光、冰封冰面反光、黑洞金邊、櫻花金邊）：只照在字的形狀上 */}
        {fx !== "storm" && <span className="zz-hl"><span className="zz-band" /></span>}
      </b>
      {fx === "storm" && <>
        <span className="zz-wind w1" /><span className="zz-wind w2" />
        {LEAVES.map((l, i) => <span key={i} className="zz-leaf" style={{ "--ly": `${l.y}em`, "--lx": `${l.x}em`, "--ld": `${l.d}ms`, "--ls": l.s } as CSSProperties} />)}
      </>}
      {fx === "blackhole" && DUST.map((p, i) => <span key={i} className={`zz-dust k${p.k}`} style={{ "--dd": `${p.d}ms`, "--ds": p.s } as CSSProperties} />)}
      {fx === "sakura" && PETALS.map((p, i) => (
        <span key={i} className="zz-petal" style={{ "--x0": `${p.x}em`, "--y0": `${p.y}em`, "--dx": `${p.dx}em`, "--r0": `${p.r}deg`, "--pd": `${p.d}ms` } as CSSProperties} />
      ))}
      <p className="zz-name">{shown}</p>
    </div>
  );
}
