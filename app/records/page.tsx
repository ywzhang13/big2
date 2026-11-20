import type { Metadata } from "next";
import HistoryPageView from "@/components/roomCard/HistoryPage";
import type { RecordGame } from "@/components/roomCard/client";

const GAMES: RecordGame[] = ["all", "mahjong", "thirteen", "big2"];

// 總大廳歷史紀錄（房卡第二批，小宜〈房卡 v1.2〉第 3 節）：總大廳頭像選單、十三支大廳（?game=thirteen）都進這一頁
export const metadata: Metadata = { title: "歷史紀錄｜阿瑋娛樂城" };

export default async function RecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const g = (await searchParams).game;
  return <HistoryPageView initialTab={GAMES.find((x) => x === g) ?? "all"} />;
}
