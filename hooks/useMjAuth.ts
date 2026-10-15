"use client";

// 麻將的登入狀態：LINE 登入（Supabase Auth 自訂 OIDC），或測試用的遊客登入（這個分頁有遊客 session 就以遊客為準）。
// checking：還在確認 ／ out：沒登入 ／ redirecting：正在導去 LINE ／ error：登入沒有完成 ／ in：已登入

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { LINE_PROVIDER, authHeaders, getGuestClient, isGuestTab, loginReturnUrl } from "@/lib/mahjong/clientAuth";
import type { Session } from "@supabase/supabase-js";

export type MjAuthStatus = "checking" | "out" | "redirecting" | "error" | "in";

export interface MjAuthUser {
  displayName: string;
  pictureUrl: string | null;
  isGuest?: boolean;
}

/** 遊客登入的結果：ok，或給畫面顯示的錯誤 */
export type GuestLoginError = "wrong_password" | "too_many_attempts" | "disabled" | "network";

const ERROR_MS = 8000;

function userOf(session: Session | null, isGuest = false): MjAuthUser | null {
  if (!session) return null;
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    displayName: str(meta.name) ?? str(meta.full_name) ?? str(meta.nickname) ?? "",
    pictureUrl: isGuest ? null : str(meta.picture) ?? str(meta.avatar_url),
    ...(isGuest ? { isGuest: true } : {}),
  };
}

/** 遊客入口：網址帶 ?guest=1（一般大廳沒有任何入口） */
function guestEntry(): boolean {
  return new URLSearchParams(window.location.search).get("guest") === "1";
}

/** LINE／Supabase 登入失敗時會把 error、error_description 帶回 redirectTo（query 或 hash）。讀到就從網址拿掉 */
function takeLoginError(): boolean {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const inQuery = url.searchParams.has("error") || url.searchParams.has("error_description");
  const inHash = hash.has("error") || hash.has("error_description");
  if (!inQuery && !inHash) return false;
  for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
  if (inHash) url.hash = "";
  window.history.replaceState(window.history.state, "", url.toString());
  return true;
}

export function useMjAuth() {
  const [status, setStatus] = useState<MjAuthStatus>("checking");
  const [user, setUser] = useState<MjAuthUser | null>(null);
  // 這個分頁走遊客入口（?guest=1 進來，或已經是遊客）：沒登入時顯示測試密碼，不顯示 LINE 登入
  const [guestMode, setGuestMode] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    const failed = takeLoginError();
    let alive = true;
    const guestTab = isGuestTab();
    const entry = guestEntry();
    (guestTab ? getGuestClient() : supabase).auth.getSession().then(({ data }) => {
      if (!alive) return;
      setGuestMode(guestTab || entry);
      const u = userOf(data.session, guestTab);
      setUser(u);
      setStatus(u ? "in" : failed ? "error" : "out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (isGuestTab()) return; // 遊客分頁不跟 LINE 的登入狀態走
      if (event === "SIGNED_OUT") {
        setUser(null);
        setStatus((s) => (s === "error" ? s : "out"));
      } else if (session && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
        setUser(userOf(session));
        setStatus("in");
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 錯誤條 8 秒後消失，回到未登入
  useEffect(() => {
    if (status !== "error") return;
    const t = setTimeout(() => setStatus((s) => (s === "error" ? "out" : s)), ERROR_MS);
    return () => clearTimeout(t);
  }, [status]);

  /** 導去 LINE 登入；登入完回到 /mahjong（有房號就回那間房） */
  const signIn = useCallback(async (roomCode: string | null) => {
    setStatus("redirecting");
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: LINE_PROVIDER,
      options: { redirectTo: loginReturnUrl(roomCode), scopes: "openid profile" },
    });
    if (error) setStatus("error");
  }, []);

  /** 遊客登入：伺服器驗證測試密碼後建一個新的遊客，session 只存在這個分頁 */
  const signInGuest = useCallback(async (password: string): Promise<{ error: GuestLoginError; retryAfter?: number } | null> => {
    let res: Response;
    try {
      res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      return { error: "network" };
    }
    const body = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; retryAfter?: number };
    if (res.status === 401) return { error: "wrong_password" };
    if (res.status === 429) return { error: "too_many_attempts", retryAfter: body.retryAfter ?? Number(res.headers.get("Retry-After")) };
    if (res.status === 404) return { error: "disabled" };
    if (!res.ok || !body.accessToken || !body.refreshToken) return { error: "network" };
    const { data, error } = await getGuestClient().auth.setSession({ access_token: body.accessToken, refresh_token: body.refreshToken });
    if (error || !data.session) return { error: "network" };
    setGuestMode(true);
    setUser(userOf(data.session, true));
    setStatus("in");
    return null;
  }, []);

  /** 清掉這個分頁的遊客 session（不呼叫伺服器） */
  const dropGuest = useCallback(() => {
    if (!isGuestTab()) return false;
    getGuestClient().auth.signOut({ scope: "local" }).catch(() => {});
    window.sessionStorage.removeItem("mj-guest");
    return true;
  }, []);

  const signOut = useCallback(async () => {
    if (isGuestTab()) {
      // 遊客登出＝刪掉這個遊客（伺服器）＋清掉這個分頁的 session
      const headers = await authHeaders();
      await fetch("/api/auth/guest", { method: "DELETE", headers }).catch(() => {});
      dropGuest();
    } else {
      await getSupabase().auth.signOut({ scope: "local" });
    }
    setUser(null);
    setStatus("out");
  }, [dropGuest]);

  /** 任何麻將 API 回 401：token 已失效，清掉本機登入，整頁退回登入閘門 */
  const expire = useCallback(() => {
    if (!dropGuest()) getSupabase().auth.signOut({ scope: "local" }).catch(() => {});
    setUser(null);
    setStatus("out");
  }, [dropGuest]);

  return { status, user, guestMode, signIn, signInGuest, signOut, expire };
}
