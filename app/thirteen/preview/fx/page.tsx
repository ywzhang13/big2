// 十三支特效測試頁（老闆 2026-11-18：所有特效做成可以按的測試網站）：開始比牌、衝三、鐵支、同花順、五龍、打槍、全壘打，
// 可選哪一家觸發、切換四款牌桌、重播。假資料，不接 API、不碰資料庫；只在本機開發或 THIRTEEN_PREVIEW=1 的預覽站開得到（見 ../gate.ts）
//   /thirteen/preview/fx?fx=tiezhi&seat=1&felt=blue&ui=0   fx、seat（0 自己、1 右家、2 對家、3 左家）、felt 一打開就播；ui=0 收起按鈕（截圖用）
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { previewAllowed } from "../gate";
import { buildCase } from "../reveal/cases";
import ThFxLab from "@/components/thirteen/ThFxLab";

export const metadata: Metadata = { title: "十三支特效測試", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams; // 先讀查詢參數，這頁才會每次請求才算（見 ../arrange/page.tsx）
  if (!previewAllowed()) notFound();
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const rv = buildCase("normal");
  if (!rv) notFound();
  return <ThFxLab rv={rv} initial={{ fx: one("fx") ?? null, seat: Number(one("seat") ?? 0), felt: one("felt") ?? null, ui: one("ui") !== "0" }} />;
}
