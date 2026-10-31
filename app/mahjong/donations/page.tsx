// 舊的斗內榜網址：併進排行榜（小宜〈輸贏排行榜〉第 1 節），轉到排行榜的斗內頁，舊連結照樣能用
import { redirect } from "next/navigation";

export default function MahjongDonationsPage() {
  redirect("/mahjong/ranks?type=donate");
}
