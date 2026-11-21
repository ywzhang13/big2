"use client";
// 十三支的聊天與互動（小宜〈十三支共用聊天互動 v1〉§2～5）：用三款共用的 SocialChatDock、SocialFxMenu，這裡只交十三支的錨點和規則。
//   phase：
//   聊天鈕：三款共用的右下圓鈕（components/social/chatFab.css；小宜〈三款遊戲 iPhone UI 修正規格 v1〉P2、A3），三個階段同一個位置，這裡不再量
//   ・table（等其他人、亮牌）：聊天室右緣貼右家牌列左緣 −8、下緣在聊天鈕上面 8、往上到 ≡ 鈕下方（規格 P3，不再蓋左家）；泡泡貼四家名牌（§3）；點名牌丟道具，還在理牌的人只出「理牌中」
//   ・arrange（理牌）：聊天室右緣貼右欄；泡泡疊在聊天鈕上方、帶頭像字；不能丟、不播收到的特效
//   ・result（本局結算）：聊天室右緣對齊聊天鈕右緣；按「查看牌桌」時照牌桌的位置；不顯示泡泡、不能丟、特效層清空
//   hold：牌型大字、打槍、全壘打播放中，收到的互動先排著，播完再播
// 即時事件：伺服器把 mj_chat、mj_effect 送到自己的座位頻道（join.channel，useThirteenRoom 已經訂閱那個頻道收 th_ 事件）。
//   這裡不改 useThirteenRoom：同一個頻道物件上另外掛 mj_chat、mj_effect 兩個監聽（Supabase 同名頻道回傳同一個物件）；
//   useThirteenRoom 重建頻道（斷線、換房）時，下一輪檢查會在新的物件上再掛一次（每個物件只掛一次）
// 換階段（理牌 → 牌桌 → 結算）時這個元件會換位置重掛：聊天狀態不清，離開房間（卸載後沒有再掛回來）才清空
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { bindSocialChat, receiveSocialChat, socialChatSession, type SocialChatSession } from "@/lib/social/chatClient";
import { receiveSocialFx } from "@/lib/social/fx/transport";
import type { ChatMessage, EffectEvent } from "@/lib/social/events";
import { isDesk, rectOf, type Box } from "@/lib/social/anchors";
import type { MenuPlacement } from "@/lib/social/fx/place";
import SocialChatDock, { type SocialDockLayout, type StackPlace } from "@/components/social/SocialChatDock";
import SocialFxMenu from "@/components/social/SocialFxMenu";
import { bindChatLog, setChatLogOpen } from "@/components/social/chatLog";
import { useSocialChatFeed } from "@/components/social/useSocialChatFeed";
import type { ThJoin } from "./useThirteenRoom";

export type ThSocialPhase = "table" | "arrange" | "result";
export const CHAT_URL = "/api/thirteen/chat";
export const EFFECT_URL = "/api/thirteen/effect";
const historyUrl = (roomId: string) => `/api/thirteen/chat/history?roomId=${encodeURIComponent(roomId)}`;

/** 座位 → 共用名牌的 data-fx-seat（相對自己）：自己 b、右家 r、對家 t、左家 l */
export const plateKey = (seat: number, mySeat: number) => (["b", "r", "t", "l"] as const)[(((seat - mySeat) % 4) + 4) % 4];
/** 選單位置（§4-1）：左家放名牌右邊、右家放左邊，垂直置中；對家放左邊、上緣對齊 */
export const menuPlacement = (key: string): MenuPlacement =>
  key === "l" ? { side: "right", align: "center" } : key === "r" ? { side: "left", align: "center" } : { side: "left", align: "top" };

const GAP = 7;
/** 泡泡（§3）：左家、右家、自己在名牌上方往上疊；對家在名牌左側往下疊 */
export function tableStack(key: string, p: Box, vw: number, vh: number): StackPlace {
  if (key === "t") return { pos: { right: vw - p.left + GAP, top: p.top }, dir: "down", align: "end" };
  if (key === "r") return { pos: { right: vw - p.right, bottom: vh - p.top + GAP }, dir: "up", align: "end" };
  return { pos: { left: p.left, bottom: vh - p.top + GAP }, dir: "up", align: "start" };
}

/** 三個階段的版面（量好的框進來、算出位置；ThSocial 每次重排呼叫，測試直接餵數字） */
export type Measured = {
  vw: number; vh: number;
  /** ≡ 鈕 */ menu: Box | null;
  /** 自己的名牌（牌桌） */ me: Box | null;
  /** 理牌：右欄、844×390 舞台、送出鈕、手牌（16 張時會伸到右欄下方） */ side: Box | null; stage: Box | null; submit: Box | null; hand: Box | null;
  /** 結算：外框、確認鈕、倍率 --th-s2 */ frame: Box | null; ok: Box | null; s2: number;
  /** 牌桌：右家的牌列加名牌（聊天室右緣貼它的左緣） */ right?: Box | null;
};
export function phaseDock(phase: ThSocialPhase, m: Measured, btn: Box, width: number): { left: number; top: number; bottom: number } | null {
  const top0 = m.menu ? m.menu.bottom + 8 : 8;
  // 牌桌；結算按「查看牌桌」（外框收起，看得到牌桌）時也用這個位置（審伯 iPhone UI 初審 R1：原本回 null，聊天鈕按了沒有聊天室）
  if (phase === "table" || (phase === "result" && !m.frame)) return { left: (m.right ? m.right.left : btn.right) - 8 - width, top: top0, bottom: btn.top - 8 };
  if (phase === "arrange") {
    if (!m.side) return null;
    const left = m.side.right - width;
    // 不蓋手牌：手牌伸進聊天室的範圍（16 張）就停在手牌上緣上面（小宜稿是 13 張，手牌到不了右欄）
    const handTop = m.hand && m.hand.right > left ? m.hand.top : Infinity;
    return { left, top: top0, bottom: Math.min(btn.top, handTop) - 6 };
  }
  return m.frame ? { left: btn.right - width, top: m.frame.top + 56, bottom: btn.top - 8 } : null;
}

/** 好幾個元素合起來的範圍 */
function unionOf(sel: string): Box | null {
  const rs = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  return rs.length ? { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null;
}
function measure(): Measured {
  const s2 = typeof document === "undefined" ? 1 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--th-s2")) || 1;
  return {
    vw: window.innerWidth, vh: window.innerHeight, menu: rectOf(".th-menu .mjm-menu"), me: rectOf('[data-fx-seat="b"]'),
    side: rectOf(".th-side"), stage: rectOf(".th-arr-stage"), submit: rectOf(".th-btn-submit"), hand: unionOf(".th-hand .th-card"),
    frame: rectOf(".gr:not(.peek) .gr-in"), ok: rectOf(".gr:not(.peek) .gr-btn"), s2,
    right: unionOf('.th-table [data-th-pos="right"] .th-seat2 img, .th-table [data-th-pos="right"] [data-fx-seat]'),
  };
}

// ---- 這一場的聊天狀態：重掛時不清，卸載後 1.5 秒沒有再掛回來才清（離開房間） ----
let mounted = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
function useSession(s: SocialChatSession | null) {
  const key = s ? `${s.account}|${s.roomId}|${s.roomCode}|${s.myId}|${s.mySeat}` : "";
  useEffect(() => {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    mounted++;
    return () => {
      mounted--;
      if (mounted > 0) return;
      releaseTimer = setTimeout(() => { releaseTimer = null; if (mounted === 0) { bindSocialChat(null); bindChatLog(null); setChatLogOpen(false); } }, 1500);
    };
  }, []);
  useEffect(() => { if (s) bindSocialChat(s); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key 已涵蓋 s 的每個欄位
}

// ---- 座位頻道上的 mj_chat、mj_effect ----
type Ch = ReturnType<ReturnType<typeof getSupabase>["channel"]>;
const hooked = new WeakSet<Ch>();
function useSeatChannel(join: ThJoin) {
  useEffect(() => {
    if (!join.channel) return;
    const sb = getSupabase();
    const topic = `realtime:${join.channel}`;
    const hook = () => {
      // 頻道由 useThirteenRoom 建立和訂閱；還沒建立（子元件的 effect 比頁面的早跑）就等下一輪
      const ch = sb.getChannels().find((c) => c.topic === topic);
      if (!ch || hooked.has(ch)) return;
      hooked.add(ch);
      ch.on("broadcast", { event: "mj_chat" }, ({ payload }) => {
        const p = payload as { playerId?: string; message?: ChatMessage } | null;
        const s = socialChatSession();
        if (p?.message && s) receiveSocialChat(p.message, p.playerId, s.roomCode);
      });
      ch.on("broadcast", { event: "mj_effect" }, ({ payload }) => {
        const p = payload as { playerId?: string; effect?: EffectEvent } | null;
        const s = socialChatSession();
        if (p?.effect && s && p.playerId === s.myId) receiveSocialFx(p.effect);
      });
    };
    hook();
    const t = setInterval(hook, 1000);
    return () => clearInterval(t);
  }, [join.channel]);
}

function useDesk(): boolean {
  const [desk, setDesk] = useState(() => typeof window !== "undefined" && isDesk(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const f = () => setDesk(isDesk(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return desk;
}

export default function ThSocial({ phase, join, account, guest, players, hand, revealed = false, hold = false }: {
  phase: ThSocialPhase;
  join: ThJoin;
  /** 登入帳號 id */
  account: string;
  /** 訪客：只看得到聊天室、不能發、不能丟 */
  guest: boolean;
  /** 四家（submitted＝已送出三墩；還在理牌的人不能丟） */
  players: { id: string; name: string; seat: number; submitted: boolean }[];
  /** 換局就收起選單（第幾局） */
  hand: number;
  /** 已經在亮牌：沒有人在理牌了 */
  revealed?: boolean;
  /** 牌型大字播放中 */
  hold?: boolean;
}) {
  const desk = useDesk();
  const mySeat = join.seat;
  useSession(account ? { account, roomId: join.roomId, roomCode: join.code, myId: join.playerId, mySeat, chatUrl: CHAT_URL } : null);
  useSeatChannel(join);
  useSocialChatFeed({ account, roomId: join.roomId, me: join.playerId, historyUrl: historyUrl(join.roomId) });

  const layout: SocialDockLayout = {
    dock: (btn, width) => phaseDock(phase, measure(), btn, width),
    stack: (seat, btn) => {
      if (phase === "result") return null;
      const vw = window.innerWidth, vh = window.innerHeight;
      // 理牌：聊天鈕上方往上疊；右緣對齊右欄右緣（貼聊天鈕右緣的話，長一點的訊息會蓋到 16 張手牌的最後幾張）
      if (phase === "arrange") { const side = rectOf(".th-side"); return btn && side ? { pos: { right: vw - side.right, bottom: vh - btn.top + 6 }, dir: "up", align: "end" } : null; }
      const key = plateKey(seat, mySeat), p = rectOf(`[data-fx-seat="${key}"]`);
      return p ? tableStack(key, p, vw, vh) : null;
    },
    stackCeil: () => (phase === "arrange" ? rectOf(".th-btn-submit")?.bottom ?? null : null),
  };
  const initials = Object.fromEntries(players.map((p) => [p.seat, Array.from(p.name)[0] ?? ""]));

  const keyOf = useCallback((seat: number) => plateKey(seat, mySeat), [mySeat]);
  const placement = useCallback((seat: number) => menuPlacement(plateKey(seat, mySeat)), [mySeat]);
  const arranging = useCallback((seat: number) => (!revealed && players.find((p) => p.seat === seat)?.submitted === false ? "理牌中" : null), [revealed, players]);
  const thinkBelow = useCallback((seat: number) => {
    const plate = rectOf(`[data-fx-seat="${plateKey(seat, mySeat)}"]`), think = rectOf(`[data-gp-thinking="${seat}"]`);
    return plate && think && think.top >= plate.bottom - 1 ? think : null; // 只有對家的思考中泡泡在名牌下面
  }, [mySeat]);

  return (
    <>
      <SocialChatDock canSend={!guest} guest={guest} desk={desk} layout={layout} bubbles={phase !== "result"} oneStack={phase === "arrange"}
        initials={initials} mySeat={mySeat} phase={phase} />
      {phase === "table" && (
        <SocialFxMenu players={players} mySeat={mySeat} enabled={!guest} desk={desk} hand={String(hand)} roomId={join.roomId} effectUrl={EFFECT_URL}
          keyOf={keyOf} placement={placement} blockedReason={arranging} noteBelow={thinkBelow} hold={hold} />
      )}
    </>
  );
}
