// 十三支亮牌與結算預覽（假資料，不接 API、不碰資料庫）：強制觸發開始比牌、衝三、鐵支、同花順、五龍、打槍、全壘打，看完接本局結算。
// 只在本機開發或設了 THIRTEEN_PREVIEW=1 的預覽站開得到（見 ../gate.ts）
//   /thirteen/preview/reveal?case=chongsan   case：normal／chongsan／tiezhi／tonghuashun／wulong／gun／homerun／flushpair
//   &final=1  當成整場最後一局（結算按鈕是「看總結算」，再進總結算）
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { previewAllowed } from "../gate";
import { buildCase } from "./cases";
import ThRevealPreview from "@/components/thirteen/ThRevealPreview";

export const metadata: Metadata = { title: "十三支亮牌預覽", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams; // 先讀查詢參數，這頁才會每次請求才算（見 ../arrange/page.tsx）
  if (!previewAllowed()) notFound();
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const rv = buildCase(one("case") ?? "normal");
  if (!rv) notFound();
  return <ThRevealPreview rv={{ ...rv, over: one("final") === "1" }} />;
}
