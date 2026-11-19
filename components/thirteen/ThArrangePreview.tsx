"use client";
// 理牌畫面的假資料預覽（還沒接 API）：送出只在畫面上鎖住，並把排法印在下方給測試看。
import { useState } from "react";
import type { Arrangement, Card } from "@/lib/thirteen";
import ThArrange from "./ThArrange";

export default function ThArrangePreview({ cards, secs, lucky = null }: { cards: Card[]; secs: number; lucky?: Card | null }) {
  const [deadline] = useState(() => Date.now() + secs * 1000);
  const [sent, setSent] = useState<Arrangement | null>(null);
  return (
    <>
      <ThArrange cards={cards} deadline={deadline} onSubmit={setSent} lucky={lucky} rule={{ lucky: lucky?.rank ?? null }} />
      {sent && (
        <output className="th-preview-sent" data-testid="th-sent">
          {(["front", "middle", "back"] as const).map((r) => `${r}:${sent[r].map((c) => c.id).join(",")}`).join(" | ")}
        </output>
      )}
    </>
  );
}
