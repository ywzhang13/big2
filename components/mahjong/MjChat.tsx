"use client";

// 打字聊天與語音訊息的畫面（小宜〈麻將聊天與語音訊息-UIUX設計規格-2026-10-21〉＋兩張設計稿；老闆 2026-10-22 確認）。
//   ・訊息泡泡貼在說話的人名牌旁邊（左家往右、右家往左、對家往下、自己往上），每家最多三則，文字 5 秒淡出
//   ・自己資訊列右側的「聊天」鈕打開底板：四個快捷短語、輸入框、按住說話（手機在左下、左家名牌右邊，聊天室接在它上方；桌機在自己名牌上方）
//   ・輪到自己出牌、吃碰槓胡時底板照樣能開、錄音不中斷（老闆 2026-10-21）；吃碰槓胡按鈕列（z-index 70）疊在底板上面
//   ・底板開著時，自己的泡泡改貼在底板右側（不被底板、鍵盤蓋住），不低於手機動作列（打出鈕）和吃碰槓胡按鈕列的上緣
//   ・訪客、觀戰：看得到、聽得到，按「聊天」只打開聊天框（只能看）
//   ・按「聊天」同時打開本場聊天框（components/social/SocialChatBox，見 MjChatLog.tsx）；收起時鈕上顯示未讀數（2026-11-13）
// 狀態都在 lib/mahjong/chatClient.ts（綁「帳號＋房間＋座位」，換場全部清空）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  PHRASES, TEXT_MAX, VOICE_MAX_MS, bindChatSession, dismissFailed, noteText, retryFailed, sendPhrase, sendText, sendVoice,
  setChatOpen, startRecording, toggleVoice, useChatState, type Bubble, type MicError,
} from "@/lib/mahjong/chatClient";
import { createChatMic } from "@/lib/mahjong/chatMic";
import { SpeakerIcon } from "./MjIcons";
import { mjDockLeft, toggleMjChatBox } from "./MjChatLog";
import { useChatLog } from "@/components/social/chatLog";
import { UnreadBadge } from "@/components/social/SocialChatBox";

const mmss = (ms: number) => `00:${String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, "0")}`;

/** 自己資訊列右側的「聊天」鈕（放在牌桌元件的 chatButton 位置） */
export function MjChatButton({ canSend, desk }: { canSend: boolean; desk: boolean }) {
  const st = useChatState();
  const log = useChatLog();
  const open = canSend ? st.open || log.open : log.open;
  return (
    <button
      type="button"
      className={`mjc-btn ${desk ? "d" : "m"} ${open ? "on" : ""}`}
      data-chat-btn
      aria-expanded={open}
      onClick={() => toggleMjChatBox(canSend, !open)}
    >
      <svg viewBox="0 0 24 24" width={desk ? 16 : 13} height={desk ? 16 : 13} aria-hidden>
        <path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      聊天
      <UnreadBadge />
    </button>
  );
}

type Box = { left: number; top: number; right: number; bottom: number };
const rectOf = (sel: string): Box | null => {
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return r && r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};
type Pos = { left?: number; right?: number; top?: number; bottom?: number };
/** 位置直接寫到元素上（量完 DOM 才知道，不經過 React state，不多重畫一次） */
function setPos(el: HTMLElement | null, p: Pos | null) {
  if (!el) return;
  el.style.visibility = p ? "" : "hidden";
  if (!p) return;
  for (const k of ["left", "right", "top", "bottom"] as const) el.style[k] = p[k] == null ? "" : `${p[k]}px`;
}

export default function MjChat({
  mySeat, myId, roomId, roomCode, account, canSend, claiming, desk,
}: {
  mySeat: number;
  myId: string;
  /** 目前的房間 id；房間關了、還沒進房給空字串 */
  roomId: string;
  /** 房號（mj_chat 用它核對是不是這一房的事件） */
  roomCode: string;
  /** 登入帳號 id（換帳號就換一場） */
  account: string;
  /** LINE 登入、已入座才能發；訪客、觀戰只能看、聽 */
  canSend: boolean;
  /** 吃碰槓胡按鈕列出現中（自己的泡泡不能被它蓋住） */
  claiming: boolean;
  desk: boolean;
}) {
  const st = useChatState();
  const gap = desk ? 8 : 7;

  // 綁「這一場」：帳號、房間、座位一變就清空；離開（卸載）也清空
  useEffect(() => {
    bindChatSession(account && roomId && myId ? { account, roomId, roomCode, myId, mySeat } : null);
  }, [account, roomId, roomCode, myId, mySeat]);
  useEffect(() => () => bindChatSession(null), []);

  // ---- 泡泡位置：量名牌（data-fx-seat），貼在名牌外側 ----
  const panelRef = useRef<HTMLDivElement>(null);
  /** 底板目前的位置（placePanel 算的）；開著時自己的泡泡貼在它右側 */
  const panelPosRef = useRef<{ left: number; bottom: number } | null>(null);
  const stackRefs = useRef(new Map<number, HTMLDivElement>());
  const seats = [...new Set(st.bubbles.map((b) => b.seat).concat(st.autoOffNotice ? [st.autoOffNotice.seat] : []))].sort();
  const seatKey = seats.join(",");
  const relOf = (seat: number) => (((seat - mySeat) % 4) + 4) % 4;
  const place = useCallback(() => {
    for (const [seat, el] of stackRefs.current) {
      const p = rectOf(`[data-fx-seat="${seat}"]`);
      const rel = (((seat - mySeat) % 4) + 4) % 4;
      const vw = window.innerWidth, vh = window.innerHeight;
      const pp = rel === 0 ? panelPosRef.current : null;
      const pw = pp ? panelRef.current?.offsetWidth ?? 0 : 0;
      const floor = pp && pw ? Math.min(...[rectOf("[data-claim-banner]"), rectOf(".mjm-action")].map((r) => r?.top ?? vh)) : vh;
      setPos(el, pp && pw ? { left: pp.left + pw + gap, bottom: Math.max(pp.bottom, vh - floor + gap) } // 自己、底板開著：貼底板右側
        : !p ? null
        : rel === 3 ? { left: p.right + gap, top: p.top } // 左家：往右
        : rel === 1 ? { right: vw - p.left + gap, top: p.top } // 右家：往左
        : rel === 2 ? { left: p.left, top: p.bottom + gap } // 對家：往下
        : { left: p.left, bottom: vh - p.top + gap }); // 自己：往上
    }
  }, [mySeat, gap]);
  useLayoutEffect(() => { place(); }, [place, seatKey, desk, claiming]);
  useEffect(() => {
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  // ---- 底板 ----
  const open = st.open && canSend;
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [mic, setMic] = useState<MicError | null>(null);
  const [rec, setRec] = useState<{ t0: number; cancelArm: boolean } | null>(null);
  const [recNow, setRecNow] = useState(0);
  const [micCtl] = useState(() => createChatMic(startRecording, (blob, ms) => void sendVoice(blob, ms)));
  const startYRef = useRef(0);

  // 換場（帳號、房間、玩家、座位）或不能再發送：輸入、錄音畫面、錯誤、焦點全部清掉（審伯 2026-10-21 退回①）
  const sessKey = `${account}|${roomId}|${roomCode}|${myId}|${mySeat}|${canSend}`;
  const sessRef = useRef(sessKey);
  const [prevKey, setPrevKey] = useState(sessKey);
  if (prevKey !== sessKey) {
    setPrevKey(sessKey);
    setText("");
    setFocus(false);
    setMic(null);
    setRec(null);
  }
  // 錄音中就取消、等權限的作廢，舊的 callback 不會送到新的一場；卸載也一樣
  useEffect(() => {
    sessRef.current = sessKey;
    micCtl.reset();
    return () => micCtl.reset();
  }, [sessKey, micCtl]);
  const cooling = st.readyAt > st.now;
  const coolLeft = Math.ceil((st.readyAt - st.now) / 1000);
  const locked = cooling || st.sending;

  // 桌機：底板放進聊天室側欄底部的那一格（SocialChatBox 的 data-chat-slot），接在訊息下面（小宜 2026-11-13 必修）
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !desk) { setSlot(null); return; }
    const find = () => setSlot(document.querySelector<HTMLElement>("[data-chat-slot]"));
    find();
    const raf = requestAnimationFrame(find); // 側欄和底板同一批畫出來；萬一還沒掛上，下一格再找一次
    return () => cancelAnimationFrame(raf);
  }, [open, desk]);
  const inSlot = !!slot && slot.isConnected;

  // 底板位置：手機在左下（自己資訊列上方，不蓋手牌）；桌機在聊天室側欄底部（inSlot，正常版面，不用量）。鍵盤出現時貼著鍵盤上緣
  const placePanel = useCallback(() => {
    if (inSlot) { panelPosRef.current = null; place(); return; }
    const me = rectOf(desk ? '[data-fx-seat].mjm-me-who' : ".mjm-me");
    if (!me) return;
    const vv = window.visualViewport;
    const vh = window.innerHeight;
    const kb = vv && vv.height < vh * 0.8 ? vh - (vv.offsetTop + vv.height) + 8 : 0;
    // 吃碰槓胡按鈕列（底邊貼著自己資訊列上緣，z-index 70）出現時底板移到它上面，輸入框、麥克風才點得到
    const bar = claiming ? rectOf("[data-claim-banner] .bar") : null;
    const info = bar ? rectOf(desk ? "[data-my-info]" : ".mjm-me-info") : null;
    const above = bar && info ? vh - info.top + (bar.bottom - bar.top) + 4 : 0;
    // 手機：左緣在左家名牌右邊，聊天室（MjChatLog）接在面板正上方、同一個左緣，不擋左家名牌（老闆 2026-11-13）
    const left = desk ? 12 : mjDockLeft(mySeat);
    // 手機動作列裡的按鈕（眼牌、打出）落在面板範圍內：面板移到它上面，不擋按鈕（狀態文字可以蓋）
    const pw = panelRef.current?.offsetWidth ?? 0;
    const btnTop = desk || !pw ? Infinity : Math.min(Infinity, ...[...document.querySelectorAll(".mjm-action button")]
      .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && r.left < left + pw && r.right > left).map((r) => r.top));
    const overBtn = Number.isFinite(btnTop) ? vh - btnTop + 4 : 0;
    const bottom = kb || Math.max(vh - me.top + (desk ? 8 : 4), above, overBtn);
    panelPosRef.current = { left, bottom };
    setPos(panelRef.current, panelPosRef.current);
    place();
  }, [desk, place, claiming, mySeat, inSlot]);
  useLayoutEffect(() => {
    if (open) { placePanel(); return; }
    panelPosRef.current = null;
    place();
  }, [open, placePanel, place, focus]);
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    window.addEventListener("resize", placePanel);
    vv?.addEventListener("resize", placePanel);
    const t = setInterval(placePanel, 400); // 動作列的按鈕（眼牌、打出）會隨牌局出現、消失
    return () => { window.removeEventListener("resize", placePanel); vv?.removeEventListener("resize", placePanel); clearInterval(t); };
  }, [open, placePanel]);

  // 點底板和聊天鈕以外的地方：收起（錄音中不收）
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (rec || t?.closest?.("[data-chat-panel], [data-chat-btn], [data-chat-status], [data-chat-log]")) return;
      setChatOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open, rec]);

  // 錄音計時
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRecNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [rec]);
  const micDown = async (e: React.PointerEvent) => {
    if (locked || micCtl.busy()) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startYRef.current = e.clientY;
    setRec({ t0: Date.now(), cancelArm: false });
    setRecNow(Date.now());
    const r = await micCtl.down(() => setRec(null));
    if (r === "stale") return; // 等權限的時候換場了：畫面已經清過
    if (r === "ok") { setMic(null); return; }
    setRec(null);
    setMic(r);
  };
  const micMove = (e: React.PointerEvent) => {
    if (!rec) return;
    const arm = startYRef.current - e.clientY > 50; // 上滑取消
    if (arm !== rec.cancelArm) setRec({ ...rec, cancelArm: arm });
  };
  const micUp = () => {
    if (!rec) return;
    const cancel = rec.cancelArm;
    if (cancel) noteText("已取消", 1500);
    micCtl.up(cancel);
  };
  const recheckMic = async () => {
    const k = sessRef.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      if (sessRef.current === k) setMic(null);
    } catch { if (sessRef.current === k) setMic("denied"); }
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || locked) return;
    const r = await sendText(t);
    if (r === null) setText("");
  };

  const voiceLabel = (b: Bubble) => {
    const playing = st.playing?.id === b.id;
    const left = playing ? (b.durationMs ?? 0) - (st.now - st.playing!.startedAt) : b.durationMs ?? 0;
    return { playing, left };
  };
  const recMs = rec ? Math.min(VOICE_MAX_MS, recNow - rec.t0) : 0;

  return (
    <>
      {/* 名牌旁的訊息泡泡（只有語音泡泡點得到；文字泡泡不擋點擊） */}
      {seats.map((seat) => {
        const list = st.bubbles.filter((b) => b.seat === seat);
        const notice = st.autoOffNotice?.seat === seat;
        const rel = relOf(seat);
        return (
          <div
            key={seat}
            ref={(el) => { if (el) stackRefs.current.set(seat, el); else stackRefs.current.delete(seat); }}
            className={`mjc-stack ${desk ? "d" : "m"} r${rel}`}
            style={{ visibility: "hidden" }}
            data-chat-stack={seat}
          >
            {notice && <div className="mjc-note off" data-chat-autooff><SpeakerIcon size={12} muted />自動播放已關閉</div>}
            {list.map((b) => {
              const out = b.until - st.now < 220 && st.playing?.id !== b.id;
              if (b.kind === "text") {
                return <div key={b.id} className={`mjc-b t ${out ? "out" : ""}`} data-chat-bubble="text" data-chat-seat={seat}>{b.text}</div>;
              }
              const { playing, left } = voiceLabel(b);
              return (
                <button key={b.id} type="button" className={`mjc-b v ${playing ? "on" : ""} ${out ? "out" : ""}`} data-chat-bubble="voice" data-chat-seat={seat}
                  data-chat-playing={playing ? "1" : undefined} aria-label={playing ? "暫停語音" : "播放語音"} onClick={() => toggleVoice(b.id)}>
                  <span className="pp" aria-hidden>{playing ? "Ⅱ" : "▶"}</span>
                  <span className="wave" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
                  <span className="sec">{b.blocked ? "點一下播放" : mmss(left)}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      {/* 送出中／失敗重試／小提示：放在聊天鈕左邊 */}
      <ChatStatus desk={desk} />

      {/* 底板 */}
      {open && portalTo(inSlot ? slot : null,
        <div ref={panelRef} className={`mjc-panel ${desk ? "d" : "m"} ${focus ? "typing" : ""}`} style={inSlot ? undefined : { visibility: "hidden" }} data-chat-panel>
          <div className="main">
            <div className="phrases">
              {PHRASES.map((p) => (
                <button key={p.id} type="button" disabled={locked} data-chat-phrase={p.id} onClick={() => void sendPhrase(p.id)}>{p.text}</button>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <input
                value={text}
                placeholder="輸入訊息"
                enterKeyHint="send"
                aria-label="輸入訊息"
                data-chat-input
                onChange={(e) => setText([...e.target.value].slice(0, TEXT_MAX).join(""))}
                onFocus={() => setFocus(true)}
                onBlur={() => setFocus(false)}
              />
              <button type="submit" className="send" disabled={!text.trim() || locked} data-chat-send>送出</button>
            </form>
            {(mic === "denied" || mic === "unsupported") && (
              <div className="hint" data-chat-hint>
                {mic === "denied" ? (
                  <span className="warn" data-chat-mic-denied><b>需要麥克風權限</b>請在瀏覽器設定中開啟後再試</span>
                ) : (
                  <span className="warn">這個瀏覽器不能錄音</span>
                )}
              </div>
            )}
          </div>
          <div className="micbox">
            {mic === "denied" ? (
              <button type="button" className="mic" onClick={() => void recheckMic()} data-chat-mic>
                <MicIcon />
                <span className="lb">重新檢查</span>
              </button>
            ) : (
              <button
                type="button"
                className={`mic ${rec ? "rec" : ""} ${rec?.cancelArm ? "cancel" : ""}`}
                disabled={locked && !rec}
                data-chat-mic
                aria-label="按住說話"
                onPointerDown={(e) => void micDown(e)}
                onPointerMove={micMove}
                onPointerUp={micUp}
                onPointerCancel={() => micCtl.abort()}
                onContextMenu={(e) => e.preventDefault()}
                style={rec ? ({ "--p": `${(recMs / VOICE_MAX_MS) * 100}%` } as CSSProperties) : undefined}
              >
                {rec ? <><b className="t">{mmss(recMs)}</b><small>{rec.cancelArm ? "取消" : "上滑取消"}</small></> : <MicIcon />}
              </button>
            )}
            <span className={`lb ${rec ? "rec" : ""}`} data-chat-rec={rec ? "1" : undefined}>
              {rec ? (rec.cancelArm ? "放開取消" : "放開送出") : mic === "denied" ? "" : cooling ? <span data-chat-cooldown>請等 {coolLeft} 秒再傳</span> : "按住說話"}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function ChatStatus({ desk }: { desk: boolean }) {
  const st = useChatState();
  const ref = useRef<HTMLDivElement>(null);
  const show = st.sending || !!st.failed || !!st.note;
  useLayoutEffect(() => {
    if (!show) return;
    const btn = rectOf("[data-chat-btn]") ?? rectOf('[data-fx-seat].mjm-me-who');
    // 聊天鈕左邊、同一列
    setPos(ref.current, btn ? { right: window.innerWidth - btn.left + 8, top: (btn.top + btn.bottom) / 2 } : null);
  }, [show, desk, st.note?.text]);
  if (!show) return null;
  return (
    <div ref={ref} className={`mjc-status ${desk ? "d" : "m"} ${st.failed ? "fail" : ""}`} style={{ visibility: "hidden" }} data-chat-status>
      {st.sending ? (
        <span data-chat-sending>正在傳送…<i className="dots" aria-hidden><b /><b /><b /></i></span>
      ) : st.failed ? (
        <span className="retry">
          <button type="button" onClick={retryFailed} data-chat-retry>傳送失敗，點此重試</button>
          <button type="button" className="x" aria-label="關閉" onClick={dismissFailed}>×</button>
        </span>
      ) : (
        <span data-chat-note>{st.note?.text}</span>
      )}
    </div>
  );
}

/** 有目標就用 portal 放進去（桌機聊天室側欄的那一格），沒有就照原本的位置畫 */
const portalTo = (target: HTMLElement | null, node: React.ReactNode) => (target ? createPortal(node, target) : node);

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

