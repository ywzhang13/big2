"use client";
// 共用設定跟著登入的人（審伯 2026-11-19 必修 2）：三款都用麻將那一份設定（lib/mahjong/prefs），登入 LINE 的讀寫帳號、訪客和沒登入用這台。
// 規則和麻將頁面一樣（app/mahjong/page.tsx）：還在確認登入時先用這台的；登入狀態一變就換主人；換帳號、登出不沿用上一個人的（prefs 自己保證）
import { useEffect, useState } from "react";
import { bindPrefsAccount } from "@/lib/mahjong/prefs";
import { getSupabase } from "@/lib/supabase";
import { getGuestClient, isGuestTab } from "@/lib/mahjong/clientAuth";

type Auth = { status: string; user: { id: string; isGuest?: boolean } | null };

/** 登入狀態 → 設定的主人：undefined＝還在確認（先不綁）；null＝這台；訪客照樣傳 isGuest（bindPrefsAccount 對訪客只用這台） */
export function prefsOwnerOf(auth: Auth): { id: string; isGuest: boolean } | null | undefined {
  if (auth.status === "checking") return undefined;
  return auth.status === "in" && auth.user ? { id: auth.user.id, isGuest: !!auth.user.isGuest } : null;
}

export function useGamePrefsAccount(auth: Auth): void {
  const owner = prefsOwnerOf(auth);
  const id = owner === undefined ? undefined : owner?.id ?? null, guest = !!owner?.isGuest;
  useEffect(() => {
    if (id === undefined) return;
    bindPrefsAccount(id ? { id, isGuest: guest } : null);
  }, [id, guest]);
}

/** 只讀「現在是誰登入」給沒有登入入口的頁面（大老二）用：不走 useMjAuth（那是登入流程，含配對交接、錯誤條；
 *  大老二不能有 LINE 登入入口，tests/_login-return-url.ts L4）。和 useMjAuth 同一個判斷：遊客分頁用遊客那一個 client、
 *  一般分頁跟 LINE 的登入狀態走（登入、登出、換帳號都會通知） */
export function useSessionAuth(): Auth {
  const [auth, setAuth] = useState<Auth>({ status: "checking", user: null });
  useEffect(() => {
    let alive = true;
    const guestTab = isGuestTab();
    (guestTab ? getGuestClient() : getSupabase()).auth.getSession().then(({ data }) => {
      if (!alive) return;
      const s = data.session;
      setAuth(s ? { status: "in", user: { id: s.user.id, ...(guestTab ? { isGuest: true } : {}) } } : { status: "out", user: null });
    }).catch(() => { if (alive) setAuth({ status: "out", user: null }); });
    const { data: sub } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (!alive || isGuestTab()) return; // 遊客分頁不跟 LINE 的登入狀態走
      if (event === "SIGNED_OUT") setAuth({ status: "out", user: null });
      else if (session && (event === "SIGNED_IN" || event === "USER_UPDATED")) setAuth({ status: "in", user: { id: session.user.id } });
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return auth;
}
