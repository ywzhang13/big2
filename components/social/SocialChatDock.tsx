"use client";
// 三款共用的聊天鈕＋聊天室＋名牌旁泡泡（小宜〈十三支共用聊天互動 v1〉§2～3、§6：從麻將 MjChat 抽出來，位置全部由遊戲量好傳進來）。
//   ・聊天鈕：金字「聊天」膠囊（手機 32 高、點擊範圍補到 44；桌機 36 高），不顯示未讀
//   ・聊天室：共用 SocialChatBox（dock）＋輸入面板（4 個快捷短語、輸入框最多 40 字、送出）放在它下方那一格，一起開關；
//     點聊天室和聊天鈕以外的地方就關，那一下不傳到牌桌（outsideDismiss）；Esc 也關。訪客、觀戰只看得到清單
//   ・泡泡：每家最多 3 則、5 秒淡出、最新的貼名牌；pointer-events: none。位置、疊的方向、對齊由遊戲給（每家一組）
//   ・送出中、傳送失敗、冷卻「請等 N 秒再傳」：聊天鈕左邊的狀態條
//   ・手機點輸入框、鍵盤跳出來：聊天室下緣貼鍵盤上緣（visualViewport）
// 語音是第二階段，這一版面板沒有麥克風。狀態在 lib/social/chatClient.ts（文字）和 components/social/chatLog.ts（清單、開關）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PHRASES, TEXT_MAX, dismissSocialFailed, retrySocialFailed, sendSocialPhrase, sendSocialText, useSocialChat, type Bubble } from "@/lib/social/chatClient";
import { rectOf, setPos, type Box, type Pos } from "@/lib/social/anchors";
import { setChatLogOpen, useChatLog } from "./chatLog";
import SocialChatBox from "./SocialChatBox";
import "./socialDock.css";
import "./chatFab.css";

/** 聊天室寬：手機 250、桌機 360；桌機最高 420（小宜 §2-2） */
export const DOCK_W = { m: 250, d: 360 } as const;
export const DOCK_MAX_H_DESK = 420;

/** 一家泡泡的位置：pos 是貼名牌那一則的外緣；dir＝往上疊（up）或往下疊（down）；align＝靠左（start）或靠右（end） */
export type StackPlace = { pos: Pos; dir: "up" | "down"; align: "start" | "end" };
/** 遊戲交的版面（每次重排都會呼叫，直接量 DOM）。btn＝聊天鈕量到的位置 */
export type SocialDockLayout = {
  /** 舊版：聊天鈕由遊戲量位置。不給＝固定右下的共用圓鈕（chatFab.css，iPhone UI 規格 P2） */
  button?: (size: { w: number; h: number }) => { left: number; top: number } | null;
  /** 聊天室：左緣或右緣、上緣、下緣（螢幕座標）；寬由元件照手機／桌機決定 */
  dock: (btn: Box, width: number) => { left: number; top: number; bottom: number } | null;
  /** 某個座位的泡泡放哪；null＝這家不顯示 */
  stack: (seat: number, btn: Box | null) => StackPlace | null;
  /** 泡泡最高到哪（螢幕 y）：超過的舊泡泡先不顯示（十三支理牌：「送出」鈕下緣） */
  stackCeil?: (seat: number) => number | null;
};

const ChatIcon = ({ size }: { size: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

export default function SocialChatDock({ canSend, guest = false, desk, layout, bubbles = true, oneStack = false, initials, mySeat, phase }: {
  /** LINE 登入、已入座才能發；訪客只看得到清單 */
  canSend: boolean;
  guest?: boolean;
  desk: boolean;
  layout: SocialDockLayout;
  /** false＝不顯示泡泡（十三支結算畫面） */
  bubbles?: boolean;
  /** true＝四家的泡泡疊成一串（十三支理牌畫面沒有名牌），每則前面多一個頭像字 */
  oneStack?: boolean;
  /** 頭像字（座位 → 名字第一個字）；oneStack 時用 */
  initials?: Record<number, string>;
  /** 自己的座位：聊天室開著時自己的泡泡不顯示 */
  mySeat: number;
  /** 測試、驗收用：data-social-phase */
  phase?: string;
}) {
  const st = useSocialChat();
  const log = useChatLog();
  const open = log.open;
  const btnRef = useRef<HTMLButtonElement>(null);
  const stackRefs = useRef(new Map<number, HTMLDivElement>());
  const layoutRef = useRef(layout);
  useLayoutEffect(() => { layoutRef.current = layout; }); // 每次畫完換成最新的（下面量位置的 effect 排在它後面）
  const width = desk ? DOCK_W.d : DOCK_W.m;

  // 泡泡：一家一串（理牌畫面四家併一串，用 -1 當鍵）
  const shown = bubbles ? st.bubbles.filter((b) => !(open && b.seat === mySeat)) : [];
  const groups = new Map<number, Bubble[]>();
  for (const b of shown) { const k = oneStack ? -1 : b.seat; groups.set(k, [...(groups.get(k) ?? []), b]); }
  const groupKey = [...groups.keys()].sort().join(",") + `|${shown.length}`;

  /** 量 DOM、擺聊天鈕和泡泡（聊天室由 SocialChatBox 每 300ms 自己問 place） */
  const relayout = useCallback(() => {
    const L = layoutRef.current;
    const b = btnRef.current;
    if (b) { if (L.button) setPos(b, L.button({ w: b.offsetWidth, h: b.offsetHeight })); else b.style.visibility = ""; }
    const btn = b && b.style.visibility !== "hidden" ? rectOf("[data-chat-btn]") : null;
    for (const [seat, el] of stackRefs.current) {
      const p = L.stack(seat, btn);
      if (!p) { setPos(el, null); continue; }
      el.classList.toggle("up", p.dir === "up");
      el.classList.toggle("end", p.align === "end");
      // 先全部顯示再量：超過上限就從最舊的開始藏（和麻將一樣，DOM 順序舊到新）
      const items = [...el.children] as HTMLElement[]; // DOM 順序＝舊到新
      items.forEach((c) => { c.style.display = ""; });
      setPos(el, p.pos);
      const ceil = L.stackCeil?.(seat) ?? null;
      if (ceil !== null) for (const c of items.slice(0, -1)) { if (el.getBoundingClientRect().top >= ceil) break; c.style.display = "none"; }
    }
  }, []);
  useLayoutEffect(() => { relayout(); }, [relayout, groupKey, open, desk, phase]);
  useEffect(() => {
    window.addEventListener("resize", relayout);
    const t = setInterval(relayout, 400); // 名牌、按鈕會隨牌局出現、移動（換局、亮牌、結算的查看牌桌）
    return () => { window.removeEventListener("resize", relayout); clearInterval(t); };
  }, [relayout]);

  // 聊天室位置：鍵盤出來時下緣貼鍵盤上緣
  const place = useCallback(() => {
    const btn = rectOf("[data-chat-btn]");
    if (!btn) return null;
    const d = layoutRef.current.dock(btn, width);
    if (!d) return null;
    const vh = window.innerHeight, vv = window.visualViewport;
    const kb = vv && vv.height < vh * 0.8 ? vh - (vv.offsetTop + vv.height) + 8 : 0;
    let bottomY = d.bottom, top = d.top;
    if (desk) top = Math.max(top, bottomY - DOCK_MAX_H_DESK);
    if (kb) { const h = bottomY - top; bottomY = Math.min(bottomY, vh - kb); top = Math.max(6, bottomY - h); }
    return { left: Math.round(d.left), width, top: Math.round(top), bottom: Math.round(vh - bottomY) };
  }, [width, desk]);

  // 輸入面板放進聊天室下方那一格（data-chat-slot）
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !canSend) return; // 關掉後那一格跟著聊天室拆掉（isConnected 變 false），不用清
    const raf = requestAnimationFrame(() => setSlot(document.querySelector<HTMLElement>("[data-chat-slot]")));
    return () => cancelAnimationFrame(raf);
  }, [open, canSend]);

  return (
    <>
      <button ref={btnRef} type="button" className={`${layout.button ? "sc-btn" : "chat-fab"} ${desk ? "d" : "m"}${open ? " on" : ""}`} style={{ visibility: "hidden" }}
        data-chat-btn data-social-phase={phase} aria-expanded={open} aria-label="聊天" onClick={() => setChatLogOpen(!open)}>
        <ChatIcon size={layout.button ? (desk ? 16 : 14) : desk ? 22 : 20} />{layout.button ? "聊天" : null}
      </button>
      {[...groups].map(([seat, list]) => (
        <div key={seat} ref={(el) => { if (el) stackRefs.current.set(seat, el); else stackRefs.current.delete(seat); }}
          className={`sc-stack ${desk ? "d" : "m"}`} style={{ visibility: "hidden" }} data-chat-stack={seat}>
          {list.map((b) => {
            const out = b.until - st.now < 220;
            const who = oneStack ? initials?.[b.seat] ?? Array.from(b.name)[0] ?? "" : null;
            return (
              <div key={b.id} className={`mjc-b t${who !== null ? " who" : ""}${out ? " out" : ""}`} data-chat-bubble="text" data-chat-seat={b.seat}>
                {who !== null && <i aria-hidden>{who}</i>}{b.text}
              </div>
            );
          })}
        </div>
      ))}
      <ChatStatus desk={desk} />
      <SocialChatBox
        variant="dock"
        open={open}
        onClose={() => setChatLogOpen(false)}
        readOnlyText={canSend ? undefined : guest ? undefined : "觀戰中，僅能觀看"}
        emptyHint={canSend ? "說句話，和大家聊聊吧" : "玩家的聊天會顯示在這裡"}
        slot={canSend}
        place={place}
        inside="[data-chat-btn], [data-chat-status]"
        footer={guest ? "登入 LINE 後就能聊天。" : undefined}
      />
      {open && canSend && slot?.isConnected && createPortal(<ChatPanel desk={desk} />, slot)}
    </>
  );
}

/** 輸入面板：4 個快捷短語、輸入框＋送出（冷卻中、送出中一起變淡） */
function ChatPanel({ desk }: { desk: boolean }) {
  const st = useSocialChat();
  const [text, setText] = useState("");
  const locked = st.readyAt > st.now || st.sending;
  const submit = async () => {
    const t = text.trim();
    if (!t || locked) return;
    if ((await sendSocialText(t)) === null) setText("");
  };
  return (
    <div className={`sc-panel ${desk ? "d" : "m"}`} data-chat-panel>
      <div className="ph">
        {PHRASES.map((p) => (
          <button key={p.id} type="button" disabled={locked} data-chat-phrase={p.id} onClick={() => void sendSocialPhrase(p.id)}>{p.text}</button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input value={text} placeholder="輸入訊息" enterKeyHint="send" aria-label="輸入訊息" data-chat-input
          onChange={(e) => setText([...e.target.value].slice(0, TEXT_MAX).join(""))} />
        <button type="submit" className="send" disabled={!text.trim() || locked} data-chat-send>送出</button>
      </form>
    </div>
  );
}

/** 送出中／失敗重試／冷卻／小提示：聊天鈕左邊、同一列 */
function ChatStatus({ desk }: { desk: boolean }) {
  const st = useSocialChat();
  const ref = useRef<HTMLDivElement>(null);
  const cooling = st.readyAt > st.now && !st.sending && !st.failed;
  const show = st.sending || !!st.failed || !!st.note || cooling;
  const text = st.note?.text ?? (cooling ? `請等 ${Math.ceil((st.readyAt - st.now) / 1000)} 秒再傳` : "");
  useLayoutEffect(() => {
    if (!show) return;
    const btn = rectOf("[data-chat-btn]");
    setPos(ref.current, btn ? { right: window.innerWidth - btn.left + 8, top: (btn.top + btn.bottom) / 2 } : null);
  }, [show, desk, text]);
  if (!show) return null;
  return (
    <div ref={ref} className={`mjc-status chat-fab-status ${desk ? "d" : "m"}${st.failed ? " fail" : ""}`} style={{ visibility: "hidden" }} data-chat-status>
      {st.sending ? (
        <span data-chat-sending>正在傳送…<i className="dots" aria-hidden><b /><b /><b /></i></span>
      ) : st.failed ? (
        <span className="retry">
          <button type="button" onClick={retrySocialFailed} data-chat-retry>傳送失敗，點此重試</button>
          <button type="button" className="x" aria-label="關閉" onClick={dismissSocialFailed}>×</button>
        </span>
      ) : (
        <span data-chat-note={cooling ? "cooldown" : undefined}>{text}</span>
      )}
    </div>
  );
}
