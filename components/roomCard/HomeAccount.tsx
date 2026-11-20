"use client";
// 總大廳右上角（小宜〈房卡 v1.2〉2-2）：房卡張數、頭像膠囊、設定 ⚙。點頭像開選單：房卡後台（只有老闆）、歷史紀錄、分隔線、登出。
// 關閉：再點頭像、點選單外面、Esc。沒登入（或還在確認）時右上角不放東西（設計沒有畫，照現況）
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMjAuth } from "@/hooks/useMjAuth";
import { Avatar } from "@/components/mahjong/MjLobbyAuth";
import { GearIcon } from "@/components/mahjong/MjIcons";
import MjPrefsPanel from "@/components/mahjong/MjPrefsPanel";
import { openPrefs } from "@/lib/mahjong/prefs";
import RoomCardChip from "./RoomCardChip";
import { useMyCards } from "./useMyCards";
import "./roomCard.css";

/** 歷史紀錄：總大廳的跨遊戲紀錄頁還沒做（小宜 v1.2 第 3 節），先進麻將大廳的歷史紀錄 */
export const HISTORY_HREF = "/mahjong?records=1";

export default function HomeAccount() {
  const auth = useMjAuth();
  const router = useRouter();
  const me = useMyCards(auth.status === "in" ? auth.user : null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  if (auth.status !== "in" || !auth.user) return null;
  const go = (href: string) => { setOpen(false); router.push(href); };
  return (
    <div className="mjl rc-home-bar" data-rc-home-bar>
      <MjPrefsPanel />
      <RoomCardChip me={me} />
      <div className="rc-menu-anchor" ref={box}>
        <button type="button" className={`mjl-who${open ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-rc-avatar>
          <Avatar user={auth.user} self />
          <span className="nm">{auth.user.displayName}</span>
          <span className="car" aria-hidden>▾</span>
        </button>
        {open && (
          <div className="rc-menu" role="menu" data-rc-menu>
            {me?.isOwner && <button type="button" role="menuitem" className="gold" onClick={() => go("/admin/cards")} data-rc-menu-admin>房卡後台</button>}
            <button type="button" role="menuitem" onClick={() => go(HISTORY_HREF)} data-rc-menu-history>歷史紀錄</button>
            <hr />
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void auth.signOut(); }} data-rc-menu-signout>登出</button>
          </div>
        )}
      </div>
      <button type="button" className="mjl-gear" aria-label="設定" onClick={() => openPrefs()}>
        <GearIcon size={18} />
      </button>
    </div>
  );
}
