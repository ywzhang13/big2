"use client";

// 牌桌音效（出牌聲、輪到自己 6 秒沒打的提醒聲＋手牌輕抖）接到牌桌狀態上。判斷規則在 lib/mahjong/tableSound.ts，出聲在 fx/engine.ts。
// 訪客、觀戰者也聽得到出牌聲；提醒聲只有輪到的那個人自己會響（其他人的畫面上 needsDiscard 不會是 true）。
import { useEffect, useRef, useState } from "react";
import { fxAudioState, playTableSound, playVoice, preloadVoice, unlockAudio } from "@/lib/mahjong/fx/engine";
import { createVoiceQueue, createVoiceTracker, type VoiceSnapshot } from "@/lib/mahjong/tableVoice";
import { zimoVoiceGate } from "@/lib/mahjong/zimoVoiceGate";
import { createDiscardWatcher, createTurnReminder, discardKey, remindActive } from "@/lib/mahjong/tableSound";
import { shakeHandForRemind } from "@/lib/mahjong/remindShake";
import { useGameAudioSession } from "@/lib/gameAudioSession";

// 預覽站：每一聲（哪一種、什麼時候、有沒有真的出聲、當下音訊狀態）和提醒計時的開始、停止都記下來，
// 自動驗收讀 window.__mjTableSnd；也送一份到預覽站伺服器的紀錄（/preview/clientlog），真機試玩後查得到發生了什麼
type SndLog = { kind: "tile" | "remind" | "remind-on" | "remind-off"; at: number; played?: boolean; ac: string; hidden?: boolean; shake?: string };
const PREVIEW = process.env.NEXT_PUBLIC_MJ_PREVIEW === "1";
function record(e: Omit<SndLog, "at">) {
  if (!PREVIEW || typeof window === "undefined") return;
  const row = { ...e, at: Math.round(performance.now()) };
  const w = window as unknown as { __mjTableSnd?: SndLog[] };
  (w.__mjTableSnd ??= []).push(row);
  try { navigator.sendBeacon?.("/preview/clientlog", JSON.stringify({ ...row, ua: navigator.userAgent.slice(0, 80) })); } catch { /* 預覽站紀錄失敗不影響遊戲 */ }
}
const play = (kind: "tile" | "remind") => { void playTableSound(kind).then((r) => record({ kind, ...r })); };
/** 提醒：「滴滴」＋自己的手牌同步輕抖（背景中不抖） */
const remind = () => {
  const n = shakeHandForRemind();
  void playTableSound("remind").then((r) => record({ kind: "remind", ...r, hidden: document.hidden, shake: n ? "hand" : "" }));
};

export function useTableSounds({ roomId, hand, focusDiscard, needsDiscard, status }: {
  /** 目前的房間（換房、離開時清空：剛看到的那張牌只記不響） */
  roomId: string;
  /** 第幾局（換局時提醒重新算） */
  hand: string;
  /** 牌桌中間那張最近打出的牌 */
  focusDiscard: { tile: { id: number }; from: number } | null;
  /** 輪到自己、要打牌（有自己回合的按鈕也算） */
  needsDiscard: boolean;
  /** 牌局狀態（playing 才計時） */
  status: string;
}) {
  const [watcher] = useState(() => createDiscardWatcher(() => play("tile")));
  const [reminder] = useState(() => createTurnReminder(remind));

  // 出牌聲：換房時先清掉，再看這一張
  const key = discardKey(focusDiscard);
  const roomRef = useRef(roomId);
  useEffect(() => {
    if (roomRef.current !== roomId) { roomRef.current = roomId; watcher.reset(); }
    watcher.update(roomId ? key : null);
  }, [key, roomId, watcher]);

  // 提醒聲：換局時一定先歸零；切到別的分頁照樣計時、照樣響（回來不補響、不從頭算）；離開牌桌（卸載）停掉
  useEffect(() => { reminder.set(false); }, [hand, roomId, reminder]);
  const on = remindActive({ needsDiscard, status, inRoom: !!roomId });
  useEffect(() => {
    if (on !== reminder.state().active) record({ kind: on ? "remind-on" : "remind-off", ac: fxAudioState() });
    reminder.set(on);
  }, [on, hand, roomId, reminder]);
  useEffect(() => () => reminder.set(false), [reminder]);

  // iPhone：在房間裡用 ambient 模式，跟背景音樂混音（不暫停音樂）；靜音開關打開時沒聲音；錄完語音回喇叭（大廳不改；lib/gameAudioSession.ts）
  useGameAudioSession(!!roomId);

  // 手機要在使用者點擊時解鎖音效：牌桌上任何一次點擊都解鎖（只有出牌聲、提醒聲的人也聽得到）。
  // iPhone Safari 只有 touchend、click（和按鍵）算「使用者操作」，pointerdown／touchstart 叫不醒音訊，所以幾種都聽
  useEffect(() => {
    const unlock = () => unlockAudio();
    const evs = ["pointerdown", "touchend", "click", "keydown"] as const;
    evs.forEach((e) => document.addEventListener(e, unlock, true));
    return () => evs.forEach((e) => document.removeEventListener(e, unlock, true));
  }, []);
}

/**
 * 牌桌配音（老闆 2026-11-26）：打出一張牌唸牌名；吃、碰、槓、胡、自摸唸動作。玩家（app/mahjong/page.tsx）和觀戰者（app/mahjong/watch/page.tsx）都接。
 * 該唸什麼在 lib/mahjong/tableVoice.ts（voiceEvents）；一次唸一句、排著的最多 1 句，新的取代排著的（createVoiceQueue）。
 * 換房、換局：先清掉，第一眼看到的狀態只記不唸（剛進房、重新整理不會把桌上的牌唸一遍）。
 * 音量、靜音跟互動音效同一個設定（fx/engine.ts 的 setFxVolume；0＝不唸）。
 */
export function useTableVoice({ roomId, hand, snap }: { roomId: string; hand: string; snap: VoiceSnapshot | null }) {
  const [queue] = useState(() => createVoiceQueue(playVoice));
  const track = useRef<{ scope: string; tracker: ReturnType<typeof createVoiceTracker> }>({ scope: "", tracker: createVoiceTracker() });
  useEffect(() => { if (roomId) void preloadVoice(); }, [roomId]);
  const scope = roomId ? `${roomId}|${hand}` : "";
  useEffect(() => {
    // 換房、換局、離開（scope 變空）：停掉舊的那句、丟掉排著的，從新的一局重新記（審伯 R4）
    if (track.current.scope !== scope) { queue.reset(); zimoVoiceGate.drop(); track.current = { scope, tracker: createVoiceTracker() }; }
    if (!scope || !snap) return;
    const keys = track.current.tracker.next(snap);
    // 自摸：這一手有演出「自摸」字（lib/mahjong/zimoVoiceGate.ts）就先扣住，字出現那一刻才唸（老闆 2026-11-28）
    const zimo = keys.includes("zimo") && zimoVoiceGate.hold(hand, () => queue.push(["zimo"]));
    queue.push(zimo ? keys.filter((k) => k !== "zimo") : keys);
  }, [scope, snap, queue, hand]);
  // 離開牌桌（玩家頁、觀戰頁卸載）：停掉正在播的、丟掉排著的，不會跨頁跟新的牌桌疊音（審伯 R4）
  useEffect(() => () => queue.reset(), [queue]);
  useEffect(() => () => zimoVoiceGate.drop(), []); // 扣著的自摸配音也丟掉
}
