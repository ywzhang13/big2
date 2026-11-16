// 十三支理牌畫面預覽（假資料，不接 API、不碰資料庫）。只在本機開發或設了 THIRTEEN_PREVIEW=1 的預覽站開得到（見 ../gate.ts）。
//   /thirteen/preview/arrange?seed=7&secs=60   seed 換一手牌、secs 是理牌秒數
//   /thirteen/preview/arrange?hand=SA1,SA2,...  直接指定 13 張（id 照 lib/thirteen：花色＋點數字母＋第幾副）
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deal } from "@/lib/thirteen";
import { parseHandParam } from "./hand";
import { previewAllowed } from "../gate";
import ThArrangePreview from "@/components/thirteen/ThArrangePreview";

export const metadata: Metadata = { title: "十三支理牌預覽", robots: { index: false } };

/** 預覽用的固定種子亂數（mulberry32）。正式發牌由後端用安全亂數，不走這裡 */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // 先讀查詢參數：讓這頁每次請求才算（動態），預覽開關在執行時才讀。
  // 若先判斷開關，next build 會把這頁當靜態頁、在 build 時就算成 404 存起來，預覽站設了開關也打不開（實測過）
  const q = await searchParams;
  if (!previewAllowed()) notFound(); // 正式環境沒開預覽開關：一律 404，不發牌、不給預覽內容
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const secs = Math.min(600, Math.max(5, Number(one("secs")) || 60));
  const cards = parseHandParam(one("hand")) ?? deal(seeded(Number(one("seed")) || 1)).hands[0];
  return <ThArrangePreview cards={cards} secs={secs} />;
}
