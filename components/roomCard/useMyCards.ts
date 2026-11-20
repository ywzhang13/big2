"use client";
// 自己的房卡（右上角張數、頭像選單要不要「房卡後台」）：登入 LINE 才問；遊客、沒登入不問。
// 回到畫面（visibilitychange）、開房／加入被擋之後（refreshMyCards）再問一次，張數跟著伺服器
import { useEffect, useState } from "react";
import { getMyCards, type MyCards } from "./client";

const EVT = "room-card:refresh";
export const refreshMyCards = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT)); };

export function useMyCards(user: { id: string; isGuest?: boolean } | null | undefined): MyCards | null {
  const [me, setMe] = useState<{ id: string; v: MyCards } | null>(null);
  const id = user && !user.isGuest ? user.id : null;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const ask = () => { if (!document.hidden) void getMyCards().then((r) => { if (alive && r.ok) setMe({ id, v: r.data }); }); };
    ask();
    document.addEventListener("visibilitychange", ask);
    window.addEventListener(EVT, ask);
    return () => { alive = false; document.removeEventListener("visibilitychange", ask); window.removeEventListener(EVT, ask); };
  }, [id]);
  return id && me?.id === id ? me.v : null; // 換帳號、登出：不沿用上一個人的
}
