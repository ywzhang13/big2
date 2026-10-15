"use client";

// 麻將的 LINE 登入狀態（Supabase Auth 自訂 OIDC）。
// checking：還在確認 ／ out：沒登入 ／ redirecting：正在導去 LINE ／ error：登入沒有完成 ／ in：已登入

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { LINE_PROVIDER, loginReturnUrl } from "@/lib/mahjong/clientAuth";
import type { Session } from "@supabase/supabase-js";

export type MjAuthStatus = "checking" | "out" | "redirecting" | "error" | "in";

export interface MjAuthUser {
  displayName: string;
  pictureUrl: string | null;
}

const ERROR_MS = 8000;

function userOf(session: Session | null): MjAuthUser | null {
  if (!session) return null;
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    displayName: str(meta.name) ?? str(meta.full_name) ?? str(meta.nickname) ?? "",
    pictureUrl: str(meta.picture) ?? str(meta.avatar_url),
  };
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

  useEffect(() => {
    const supabase = getSupabase();
    const failed = takeLoginError();
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const u = userOf(data.session);
      setUser(u);
      setStatus(u ? "in" : failed ? "error" : "out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
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

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut({ scope: "local" });
    setUser(null);
    setStatus("out");
  }, []);

  /** 任何麻將 API 回 401：token 已失效，清掉本機登入，整頁退回登入閘門 */
  const expire = useCallback(() => {
    getSupabase().auth.signOut({ scope: "local" }).catch(() => {});
    setUser(null);
    setStatus("out");
  }, []);

  return { status, user, signIn, signOut, expire };
}
