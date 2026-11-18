// 大老二設定入口的預覽頁（截圖、自動驗收用）：預覽站沒有大老二的後端，開不了真的牌局，這裡只掛和牌桌同一個 GameMenu（左上 ≡ →「設定」→ 共用設定面板，只有聲音頁）。
// 和十三支預覽頁同一個開關：本機開發可開；正式 build 要設 THIRTEEN_PREVIEW=1，沒設就 404
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { previewAllowed } from "@/app/thirteen/preview/gate";
import GameMenu from "@/components/gamePrefs/GameMenu";

export const metadata: Metadata = { title: "大老二設定預覽", robots: { index: false } };
export const dynamic = "force-dynamic"; // 開關在執行時才讀（build 時沒有 THIRTEEN_PREVIEW，不能先算好）

export default function Page() {
  if (!previewAllowed()) notFound();
  return (
    <div className="flex flex-col flex-1 overflow-hidden relative" data-big2-preview>
      <GameMenu game="big2" tabs={[]} />
    </div>
  );
}
