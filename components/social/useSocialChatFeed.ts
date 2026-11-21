"use client";
// 把這一場的聊天、互動餵進共用聊天室清單（chatLog），進房、回前景、網路恢復時讀歷史（照麻將 MjChatLog 的 useMjChatFeed，歷史網址由遊戲傳進來）。
//   ・聊天：lib/social/chatClient 收到（通過這一場的檢查、去重）的每一則 → addChatMessage
//   ・互動：lib/social/fx/transport 收到的每一次 → addChatEffect（互動不存伺服器，只有在場時收到的）
//   ・送出時房間剛好關掉（410）→ 聊天室顯示「房間已關閉」
// 回傳 retry（讀不到歷史時「重試」）。觀戰（第二階段、十三支目前沒有觀戰頁）不在這裡
import { useEffect, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import { subscribeSocialChat, subscribeSocialChatClosed } from "@/lib/social/chatClient";
import { FX_LABEL } from "@/lib/social/fx";
import { subscribeSocialFx } from "@/lib/social/fx/transport";
import type { ChatMessage } from "@/lib/social/events";
import { addChatEffect, addChatMessage, bindChatLog, loadChatHistory, markChatLogClosed, type HistoryResult } from "./chatLog";

export async function fetchChatHistory(url: string): Promise<HistoryResult> {
  const r = await mjFetch(url);
  if (r.status === 404) return { ok: false, reason: "closed" };
  if (!r.ok) return { ok: false, reason: "failed" };
  const b = (await r.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
  if (!b || !Array.isArray(b.messages)) return { ok: false, reason: "failed" };
  return { ok: true, messages: b.messages };
}

export function useSocialChatFeed({ account, roomId, me, historyUrl }: {
  account: string; roomId: string; me: string; /** 例：/api/thirteen/chat/history?roomId=… */ historyUrl: string;
}): () => void {
  const key = account && roomId && me ? `${account}|${roomId}|${me}` : null;
  const [tick, setTick] = useState(0);
  useEffect(() => { bindChatLog(key, me); }, [key, me]);
  useEffect(() => subscribeSocialChat(addChatMessage), []);
  useEffect(() => subscribeSocialChatClosed(markChatLogClosed), []);
  useEffect(() => subscribeSocialFx((m) => addChatEffect({ id: m.id, ts: Date.now(), fromName: m.fromName, toName: m.toName, label: FX_LABEL[m.kind] })), []);
  useEffect(() => {
    if (!key) return;
    const load = () => void loadChatHistory(() => fetchChatHistory(historyUrl));
    load();
    const onBack = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("online", onBack); };
  }, [key, historyUrl, tick]);
  return () => setTick((t) => t + 1);
}
