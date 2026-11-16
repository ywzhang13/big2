"use client";

// 三個遊戲共用的「聊天室」（老闆 2026-11-13：按聊天要有聊天框的感覺、看得到這一場之前的訊息；觀戰可以看不能說）。
// 老闆看過第一版後（2026-11-13）：
//   ・手機：訊息清單接在遊戲自己的輸入面板（快捷句、輸入框、按住說話）正上方，合成一個聊天室，一起開關（dock）
//   ・標題「聊天室」，不寫「關房後清除」；訊息字大、名字時間標題字小，盡量多顯示幾則
//   ・沒有「收起」鈕：點聊天室以外的地方就關（像 LINE），關的那一下不會傳到牌桌（outsideDismiss.ts）
//   ・輪到自己出牌、可以吃碰槓胡：只顯示一條細提示，沒有按鈕
// 桌機（side）放在牌桌旁邊的正常版面裡。輸入、錄音、快捷短語沿用各遊戲自己的元件，這裡只顯示。
// 不依賴任何遊戲：位置（dock 的 place）、算在聊天室裡的其他區塊、提示文字、語音音量都由遊戲傳進來。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatLog, type LogEntry } from "./chatLog";
import { attachOutsideDismiss, insideAny } from "./outsideDismiss";
import "./social.css";

const clock = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** 伺服器每房保留的則數（老柯 CHAT_HISTORY_LIMIT）；到了這個數就不說「從這裡開始」 */
const HISTORY_CAP = 200;
const secs = (ms?: number) => `${Math.max(1, Math.round((ms ?? 0) / 1000))} 秒`;

export default function SocialChatBox({
  variant, open, onClose, readOnlyText, emptyHint, alert, voice, onRetry, place, inside = "", ignoreDismiss, slot = false, footer,
}: {
  /** dock＝手機：position: fixed，位置由 place 算（接在輸入面板上方）；side＝桌機牌桌旁（正常版面） */
  variant: "dock" | "side";
  open: boolean;
  onClose: () => void;
  /** 只能看不能說（觀戰）：顯示這段文字 */
  readOnlyText?: string;
  /** 還沒有訊息時的第二行（玩家：說句話…；觀戰：玩家的聊天會顯示在這裡） */
  emptyHint: string;
  /** 輪到自己要操作時的細提示（例如「輪到你出牌」）；沒有按鈕，點外面一樣收起 */
  alert?: string | null;
  /** 語音播放交給遊戲（和名牌旁泡泡、自動播放共用同一個播放器，一次只播一段；音量、靜音也由遊戲管）。
   *  沒給：語音列只顯示長度、不能播 */
  voice?: { playingId: string | null; failedId: string | null; toggle: (id: string, url: string, durationMs?: number) => void };
  /** 歷史讀取失敗時「重試」 */
  onRetry?: () => void;
  /** dock 的位置（量 DOM；null＝量不到，先藏起來）；畫面會變（吃碰列出現、面板移動），每 300ms 重算 */
  place?: () => { left: number; top: number; width: number; bottom: number } | null;
  /** 也算在聊天室裡的區塊（CSS 選擇器，例如輸入面板、聊天鈕）：點這些不會關 */
  inside?: string;
  /** true 時點外面不關（例如正在按住錄音） */
  ignoreDismiss?: () => boolean;
  /** 清單下方留一格（data-chat-slot）給遊戲放自己的輸入面板（桌機：快捷句、輸入框、按住說話接在訊息下面，小宜 2026-11-13） */
  slot?: boolean;
  /** 清單下方的附註（例如訪客「登入 LINE 後就能聊天」） */
  footer?: React.ReactNode;
}) {
  const log = useChatLog();
  const boxRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [newBelow, setNewBelow] = useState(false);

  // dock 的位置：由遊戲量（直接寫到元素上，不經過 React state）
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => {
    if (!open || variant !== "dock") return;
    const fit = () => {
      const el = boxRef.current;
      if (!el) return;
      const p = placeRef.current?.();
      el.style.visibility = p ? "" : "hidden";
      if (!p) return;
      const wasBottom = atBottomRef.current;
      el.style.left = `${p.left}px`;
      el.style.width = `${p.width}px`;
      el.style.top = `${p.top}px`;
      el.style.bottom = `${p.bottom}px`;
      if (wasBottom) { const l = listRef.current; if (l) l.scrollTop = l.scrollHeight; }
    };
    fit();
    window.addEventListener("resize", fit);
    const t = setInterval(fit, 300); // 吃碰槓胡按鈕列出現、輸入面板跟著往上移
    return () => { window.removeEventListener("resize", fit); clearInterval(t); };
  }, [open, variant, alert]);

  // 點聊天室以外的地方：關閉，那一下不傳到牌桌
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ignoreRef = useRef(ignoreDismiss);
  ignoreRef.current = ignoreDismiss;
  useEffect(() => {
    if (!open) return;
    const sel = ["[data-chat-log]", inside].filter(Boolean).join(", ");
    return attachOutsideDismiss(window, { isInside: (t) => insideAny(t, sel), onClose: () => closeRef.current(), ignore: () => !!ignoreRef.current?.() });
  }, [open, inside]);

  // 捲動：停在底部時新訊息自動捲到底；在看舊訊息時不搶捲，顯示「有新訊息」
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottomRef.current) setNewBelow(false);
  };
  const toBottom = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; atBottomRef.current = true; setNewBelow(false); };
  const count = log.entries.length;
  useLayoutEffect(() => {
    if (!open) return;
    if (atBottomRef.current) toBottom(); else setNewBelow(true);
  }, [count, open]);
  // 提示條出現、消失、換版型（桌機側欄↔手機抽屜）會改變清單高度：原本停在底部就維持在底部
  useLayoutEffect(() => { if (open && atBottomRef.current) toBottom(); }, [alert, open, variant]);
  useLayoutEffect(() => { if (open) toBottom(); }, [open]);

  // 語音：播放器在遊戲那邊（voice），一次只播一段，點同一則就停
  const playing = voice?.playingId ?? null;
  const failedVoice = voice?.failedId ?? null;

  if (!open) return null;

  const row = (e: LogEntry) => {
    if (e.type === "fx") {
      return (
        <li key={e.id} className="scb-fx" data-chat-log-fx>
          <span className="who">{e.fromName}</span>{e.toName ? <> 對 <span className="who">{e.toName}</span></> : null} 使用了 {e.label}
          <time>{clock.format(e.ts)}</time>
        </li>
      );
    }
    const m = e.msg;
    const mine = !!log.me && m.from === log.me;
    return (
      <li key={e.id} className={`scb-msg${mine ? " mine" : ""}`} data-chat-log-msg={m.kind}>
        <div className="hd"><span className="who">{m.fromName}</span><time>{clock.format(m.ts)}</time></div>
        {m.kind === "text" ? (
          <p className="tx">{m.text}</p>
        ) : !m.url ? (
          <p className="vx dead">語音已過期</p>
        ) : (
          <button type="button" className={`vx${playing === e.id ? " on" : ""}`} aria-label={playing === e.id ? "暫停語音" : "播放語音"} disabled={!voice} onClick={() => voice?.toggle(e.id, m.url!, m.durationMs)} data-chat-log-voice>
            <span className="pp" aria-hidden>{playing === e.id ? "Ⅱ" : "▶"}</span>
            {failedVoice === e.id ? "語音無法播放，點擊重試" : `語音 ${secs(m.durationMs)}`}
          </button>
        )}
      </li>
    );
  };

  return (
    <aside ref={boxRef} className={`scb ${variant}`} aria-label="聊天室" data-chat-log={variant} style={variant === "dock" ? { visibility: "hidden" } : undefined}>
      <header className="scb-top">
        <b>聊天室</b>
        {readOnlyText && <span className="ro" data-chat-log-readonly>{readOnlyText}</span>}
        {/* 提示併進標題列（小宜 2026-11-13：省下一列，訊息多一點） */}
        {alert && <span className="scb-alert" role="status" data-chat-log-alert>{alert}</span>}
      </header>
      <div className="scb-body">
      <div className="scb-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {log.status === "loading" && count === 0 ? (
          <p className="scb-state" role="status">載入聊天中…</p>
        ) : log.status === "error" ? (
          <div className="scb-state" role="alert">聊天暫時無法載入{onRetry && <button type="button" onClick={onRetry}>重試</button>}</div>
        ) : log.status === "closed" ? (
          <p className="scb-state" role="status">房間已關閉，本場聊天已清除</p>
        ) : count === 0 ? (
          <div className="scb-state" data-chat-log-empty><b>還沒有訊息</b><span>{emptyHint}</span></div>
        ) : (
          <ul>
            <li className="scb-begin">{log.entries.filter((e) => e.type === "msg").length >= HISTORY_CAP ? `只保留本場最近 ${HISTORY_CAP} 則聊天` : "本場聊天從這裡開始"}</li>
            {log.entries.map(row)}
          </ul>
        )}
      </div>
        {newBelow && <button type="button" className="scb-new" onClick={toBottom} data-chat-log-new>有新訊息</button>}
      </div>
      {slot && <div className="scb-slot" data-chat-slot />}
      {footer && <div className="scb-foot">{footer}</div>}
    </aside>
  );
}
