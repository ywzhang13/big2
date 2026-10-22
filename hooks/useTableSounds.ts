"use client";

// 牌桌音效（出牌聲、輪到自己 8 秒沒打的提醒聲）接到牌桌狀態上。判斷規則在 lib/mahjong/tableSound.ts，出聲在 fx/engine.ts。
// 訪客、觀戰者也聽得到出牌聲；提醒聲只有輪到的那個人自己會響（其他人的畫面上 needsDiscard 不會是 true）。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fxAudioState, playTableSound, unlockAudio } from "@/lib/mahjong/fx/engine";
import { createDiscardWatcher, createTurnReminder, discardKey, remindActive } from "@/lib/mahjong/tableSound";

// 預覽站：每一聲（哪一種、什麼時候、有沒有真的出聲、當下音訊狀態）和提醒計時的開始、停止都記下來，
// 自動驗收讀 window.__mjTableSnd；也送一份到預覽站伺服器的紀錄（/preview/clientlog），真機試玩後查得到發生了什麼
type SndLog = { kind: "tile" | "remind" | "remind-on" | "remind-off"; at: number; played?: boolean; ac: string };
const PREVIEW = process.env.NEXT_PUBLIC_MJ_PREVIEW === "1";
function record(e: Omit<SndLog, "at">) {
  if (!PREVIEW || typeof window === "undefined") return;
  const row = { ...e, at: Math.round(performance.now()) };
  const w = window as unknown as { __mjTableSnd?: SndLog[] };
  (w.__mjTableSnd ??= []).push(row);
  try { navigator.sendBeacon?.("/preview/clientlog", JSON.stringify({ ...row, ua: navigator.userAgent.slice(0, 80) })); } catch { /* 預覽站紀錄失敗不影響遊戲 */ }
}
const play = (kind: "tile" | "remind") => { void playTableSound(kind).then((r) => record({ kind, ...r })); };

const subscribeVisible = (cb: () => void) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); };

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
  const [reminder] = useState(() => createTurnReminder(() => play("remind")));
  const visible = useSyncExternalStore(subscribeVisible, () => !document.hidden, () => true);

  // 出牌聲：換房時先清掉，再看這一張
  const key = discardKey(focusDiscard);
  const roomRef = useRef(roomId);
  useEffect(() => {
    if (roomRef.current !== roomId) { roomRef.current = roomId; watcher.reset(); }
    watcher.update(roomId ? key : null);
  }, [key, roomId, watcher]);

  // 提醒聲：換局時一定先歸零；切到背景停掉，回來還輪到自己就重新算 8 秒；離開牌桌（卸載）停掉
  useEffect(() => { reminder.set(false); }, [hand, roomId, reminder]);
  const on = remindActive({ needsDiscard, status, visible, inRoom: !!roomId });
  useEffect(() => {
    if (on !== reminder.state().active) record({ kind: on ? "remind-on" : "remind-off", ac: fxAudioState() });
    reminder.set(on);
  }, [on, hand, roomId, reminder]);
  useEffect(() => () => reminder.set(false), [reminder]);

  // 手機要在使用者點擊時解鎖音效：牌桌上任何一次點擊都解鎖（只有出牌聲、提醒聲的人也聽得到）。
  // iPhone Safari 只有 touchend、click（和按鍵）算「使用者操作」，pointerdown／touchstart 叫不醒音訊，所以幾種都聽
  useEffect(() => {
    const unlock = () => unlockAudio();
    const evs = ["pointerdown", "touchend", "click", "keydown"] as const;
    evs.forEach((e) => document.addEventListener(e, unlock, true));
    return () => evs.forEach((e) => document.removeEventListener(e, unlock, true));
  }, []);
}
