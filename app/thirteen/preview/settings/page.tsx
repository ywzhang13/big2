// 十三支設定面板預覽頁（小測驗收用，不用開房）：掛十三支牌桌、理牌畫面同一個 ≡ 選單和共用設定面板（外觀頁＋聲音頁）。
//   /thirteen/preview/settings　沒有牌局、不接 API；只在本機開發或 THIRTEEN_PREVIEW=1 的預覽站開得到（見 ../gate.ts），正式站一律 404
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { previewAllowed } from "../gate";
import ThFeltMenu from "@/components/thirteen/ThFeltMenu";

export const metadata: Metadata = { title: "十三支設定預覽", robots: { index: false } };
export const dynamic = "force-dynamic"; // 開關在執行時才讀（build 時沒有 THIRTEEN_PREVIEW，不能先算好）

export default function Page() {
  if (!previewAllowed()) notFound();
  return (
    <div className="th-bg" data-th-settings-preview>
      <ThFeltMenu />
    </div>
  );
}
