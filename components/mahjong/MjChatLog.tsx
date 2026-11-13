"use client";

// 麻將接上共用聊天框（components/social/）：把這一場的聊天、互動餵進共用的訊息清單，進房／重新整理／重連時讀歷史。
//   ・聊天：chatClient 收到（通過這一場的檢查、去重）的每一則 → addChatMessage
//   ・互動：fx/transport 收到的每一次 → addChatEffect（互動不存伺服器，只有在場時收到的）
//   ・歷史：GET /api/mahjong/chat/history（老柯 lib/social/README.md）；觀戰者另外訂閱回傳的 spectatorChannel，
//     收到的 mj_chat、mj_effect 交給 chatClient／fx 模組（泡泡、動畫照常），清單由上面兩條自動補上
// 牌局核心（hooks/useMahjong.ts）不用改。
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import { receiveChat, setChatOpen, subscribeChat, subscribeChatRoomClosed, toggleLogVoice, useChatState, type ChatMessage as LiveChat } from "@/lib/mahjong/chatClient";
import { FX_LABEL } from "@/lib/mahjong/fx/engine";
import { receiveFx, subscribeFx, type FxEvent } from "@/lib/mahjong/fx/transport";
import type { ChatMessage } from "@/lib/social/events";
import { addChatEffect, addChatMessage, bindChatLog, loadChatHistory, markChatLogClosed, setChatLogOpen, useChatLog, type HistoryResult } from "@/components/social/chatLog";
import SocialChatBox from "@/components/social/SocialChatBox";
import "./mjChatLog.css";

type Hist = HistoryResult & { spectatorChannel?: string };

async function fetchHistory(roomId: string): Promise<Hist> {
  const r = await mjFetch(`/api/mahjong/chat/history?roomId=${encodeURIComponent(roomId)}`);
  if (r.status === 404) return { ok: false, reason: "closed" };
  if (!r.ok) return { ok: false, reason: "failed" };
  const b = (await r.json().catch(() => null)) as { messages?: ChatMessage[]; spectatorChannel?: string } | null;
  if (!b || !Array.isArray(b.messages)) return { ok: false, reason: "failed" };
  return { ok: true, messages: b.messages, spectatorChannel: b.spectatorChannel };
}

/** 這一場的聊天清單：key＝帳號｜房間｜玩家（換了就清空），me＝自己的 playerId（觀戰 null）。
 *  回傳 retry（讀不到歷史時「重試」） */
export function useMjChatFeed({ account, roomId, roomCode, me, spectator }: {
  account: string; roomId: string; roomCode: string; me: string | null; spectator?: boolean;
}): () => void {
  const key = account && roomId ? `${account}|${roomId}|${me ?? "*spectator"}` : null;
  const [tick, setTick] = useState(0);
  const [spxChannel, setSpxChannel] = useState<string | null>(null);

  useEffect(() => { bindChatLog(key, me); }, [key, me]);
  useEffect(() => () => bindChatLog(null), []);
  useEffect(() => subscribeChat(addChatMessage), []);
  // 送出時房間剛好關掉（410 room_closed）：聊天室顯示「房間已關閉，本場聊天已清除」
  useEffect(() => subscribeChatRoomClosed(markChatLogClosed), []);
  useEffect(() => subscribeFx((m) => addChatEffect({ id: m.id, ts: Date.now(), fromName: m.fromName, toName: m.toName, label: FX_LABEL[m.kind] })), []);

  // 歷史：進房、重新整理、回到前景、網路恢復時各讀一次（同一則用 id 去重）
  useEffect(() => {
    if (!key) { setSpxChannel(null); return; }
    let alive = true;
    const load = () => void loadChatHistory(async () => {
      const r = await fetchHistory(roomId);
      if (alive && r.ok && spectator) setSpxChannel(r.spectatorChannel ?? null);
      return r;
    });
    load();
    const onBack = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => { alive = false; document.removeEventListener("visibilitychange", onBack); window.removeEventListener("online", onBack); };
  }, [key, roomId, spectator, tick]);

  // 觀戰頻道：即時的聊天、互動（payload.playerId 是 "*spectators"，不用看）
  useEffect(() => {
    if (!spectator || !spxChannel || !roomCode) return;
    const supabase = getSupabase();
    const ch = supabase.channel(spxChannel);
    ch.on("broadcast", { event: "mj_chat" }, ({ payload }) => onSpectatorEvent("mj_chat", payload, roomCode));
    ch.on("broadcast", { event: "mj_effect" }, ({ payload }) => onSpectatorEvent("mj_effect", payload, roomCode));
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [spectator, spxChannel, roomCode]);

  return () => setTick((t) => t + 1);
}

/** 觀戰頻道收到的事件（每位觀戰者各自一個頻道，老柯 701d501；payload.playerId 是 "*spectators"，不用看）：
 *  聊天交給 chatClient（泡泡、自動播放、聊天室清單），互動交給特效模組（動畫、聊天室互動紀錄） */
export function onSpectatorEvent(event: "mj_chat" | "mj_effect", payload: unknown, roomCode: string) {
  if (event === "mj_chat") {
    const m = (payload as { message?: LiveChat } | null)?.message;
    if (m) receiveChat(m, undefined, roomCode);
  } else {
    const e = (payload as { effect?: FxEvent } | null)?.effect;
    if (e) receiveFx(e);
  }
}

/** 聊天框開關：玩家（能發）時和輸入底板一起開關；訪客、觀戰只開清單 */
export function toggleMjChatBox(canSend: boolean, open: boolean) {
  setChatLogOpen(open);
  if (canSend) setChatOpen(open);
}

const ALERT_DISCARD = "輪到你出牌";
const ALERT_CLAIM = "可以吃碰槓胡";
/** 算在聊天室裡的其他區塊：輸入面板、聊天鈕、送出狀態（點這些不會關聊天室） */
const INSIDE = "[data-chat-panel], [data-chat-btn], [data-chat-status]";
/** 手機輸入面板的寬（globals.css .mjc-panel.m）；觀戰沒有輸入面板時聊天室用這個寬 */
const DOCK_W = 320;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const boxOf = (el: Element | null): Box | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? r : null;
};

/** 手機聊天室的左緣：在左家名牌右邊（不擋左家名牌）；輸入面板（MjChat）也用同一個左緣，兩塊才對齊 */
export function mjDockLeft(mySeat: number): number {
  const plate = boxOf(document.querySelector(`[data-fx-seat="${(mySeat + 3) % 4}"]`));
  return Math.round(Math.max(8, plate ? plate.right + 6 : 8));
}

/** 手機聊天室的位置：
 *  ・左右：和輸入面板同一個左緣、同寬（觀戰沒有面板：同樣的左緣、寬 320）
 *  ・下緣：接在輸入面板正上方；觀戰（沒有面板）在被看那家的資訊列上緣之上（觀戰的動作列只有狀態文字、沒有按鈕，可以蓋）
 *  ・上緣：在橫向重疊到的別家名牌（對家）下面，不擋名牌 */
export function mjDockPlace(mySeat: number, spectator = false) {
  const vh = window.innerHeight;
  const panel = boxOf(document.querySelector("[data-chat-panel]"));
  const left = panel ? Math.round(panel.left) : mjDockLeft(mySeat);
  const width = Math.round(panel ? panel.width : Math.min(DOCK_W, window.innerWidth - left - 8));
  const floor = panel ? panel.top - 3
    : Math.min(vh, ...(spectator ? [".mjm-me"] : [".mjm-me", ".mjm-action", "[data-claim-banner] .bar"]).map((s) => boxOf(document.querySelector(s))?.top ?? vh)) - 4;
  const plates = [...document.querySelectorAll("[data-fx-seat]")]
    .filter((el) => el.getAttribute("data-fx-seat") !== String(mySeat))
    .map(boxOf).filter((r): r is Box => !!r && r.left < left + width && r.right > left && r.top < floor);
  const top = Math.round(Math.max(6, ...plates.map((r) => r.bottom + 4)));
  return { left, width, top, bottom: Math.round(vh - floor) };
}

/** 麻將用的聊天室。dock：手機，接在輸入面板正上方（觀戰沒有面板就在同一個位置）；side：桌機牌桌旁 */
export default function MjChatLogBox({ variant, mySeat, canSend, guest, spectator, myTurn, claiming, onRetry }: {
  variant: "dock" | "side";
  /** 自己（觀戰：正在看的那家）的座位：手機聊天室要避開左家、對家名牌 */
  mySeat: number;
  canSend: boolean;
  guest?: boolean;
  spectator?: boolean;
  /** 輪到自己出牌 */
  myTurn?: boolean;
  /** 有吃碰槓胡可以選 */
  claiming?: boolean;
  onRetry?: () => void;
}) {
  const log = useChatLog();
  const chat = useChatState();
  // 能發的玩家：輸入面板因為換場等原因關掉時，聊天室跟著關
  useEffect(() => {
    if (canSend && !chat.open && log.open) setChatLogOpen(false);
  }, [canSend, chat.open, log.open]);
  const alert = claiming ? ALERT_CLAIM : myTurn ? ALERT_DISCARD : null;
  return (
    <SocialChatBox
      variant={variant}
      open={log.open}
      onClose={() => toggleMjChatBox(canSend, false)}
      readOnlyText={spectator ? "觀戰中，僅能觀看" : undefined}
      emptyHint={canSend ? "說句話，和大家聊聊吧" : "玩家的聊天會顯示在這裡"}
      // 桌機側欄不蓋牌桌，牌桌上本來就有「輪到你打牌」：只有手機顯示提示（小宜 2026-11-13）
      alert={variant === "dock" ? alert : null}
      slot={variant === "side" && canSend}
      // 語音交給 chatClient：和名牌旁泡泡、自動播放共用同一個播放器（一次只播一段），音量、靜音即時跟著設定
      voice={{ playingId: chat.playing?.id ?? null, failedId: chat.voiceFailed, toggle: toggleLogVoice }}
      onRetry={onRetry}
      place={variant === "dock" ? () => mjDockPlace(mySeat, spectator) : undefined}
      inside={INSIDE}
      // 正在按住錄音：點到別的地方不關（錄音照常）
      ignoreDismiss={() => !!document.querySelector('[data-chat-rec="1"]')}
      footer={guest && !spectator ? "登入 LINE 後就能聊天與傳語音。" : undefined}
    />
  );
}
