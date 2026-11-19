// 十三支亮牌與結算預覽（假資料，不接 API、不碰資料庫）：強制觸發開始比牌、衝三、鐵支、同花順、五龍、打槍、全壘打，看完接本局結算。
// 只在本機開發或設了 THIRTEEN_PREVIEW=1 的預覽站開得到（見 ../gate.ts）
//   /thirteen/preview/reveal?case=chongsan   case：normal／chongsan／tiezhi／tonghuashun／wulong／gun／homerun／flushpair
//   &final=1  當成整場最後一局（結算按鈕是「看總結算」，再進總結算）
//   &unused=1 每家多帶 3 張沒用到的牌（照老柯 v4 的 unusedCards：本局結算最右邊那組）
//   &lucky=9S 這一局的彩金牌（只看畫面：中央看板、金卡、本局結算；牌型照預覽牌局原本算的）
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { previewAllowed } from "../gate";
import { buildCase } from "./cases";
import { buildDeck, parseCards, type Card } from "@/lib/thirteen";
import ThRevealPreview from "@/components/thirteen/ThRevealPreview";

export const metadata: Metadata = { title: "十三支亮牌預覽", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams; // 先讀查詢參數，這頁才會每次請求才算（見 ../arrange/page.tsx）
  if (!previewAllowed()) notFound();
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const rv = buildCase(one("case") ?? "normal");
  if (!rv) notFound();
  const used = new Set(rv.arrangements.flatMap((a) => [...a.front, ...a.middle, ...a.back].map((c) => c.id)));
  const left = buildDeck().filter((c) => !used.has(c.id)); // 52 張發完剩 13 張：每家拿 3 張當沒用到的牌
  const unusedCards = one("unused") === "1" ? [0, 1, 2, 3].map((s) => left.slice(s * 3, s * 3 + 3)) : undefined;
  let luckyCard: Card | null = null;
  try { if (one("lucky")) luckyCard = parseCards(one("lucky")!)[0]; } catch { /* 看不懂就不放 */ }
  return <ThRevealPreview rv={{ ...rv, over: one("final") === "1", unusedCards, luckyCard }} />;
}
