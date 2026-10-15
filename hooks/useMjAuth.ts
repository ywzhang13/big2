"use client";

// 麻將的登入狀態：LINE 登入（Supabase Auth 自訂 OIDC），或測試用的遊客登入（這個分頁有遊客 session 就以遊客為準）。
// checking：還在確認 ／ out：沒登入 ／ redirecting：正在導去 LINE ／ error：登入沒有完成 ／ in：已登入
// iPhone 主畫面 App 的 LINE 登入交接（老柯《主畫面App登入-後端API規格》）：
// pairing：主畫面 App 等 Safari 登入完、輪詢領回 ／ handoff：Safari 登入完，把登入交給主畫面 App

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { LINE_PROVIDER, authHeaders, getGuestClient, isGuestTab, loginReturnUrl } from "@/lib/mahjong/clientAuth";
import type { Session } from "@supabase/supabase-js";

export type MjAuthStatus = "checking" | "out" | "redirecting" | "error" | "in" | "pairing" | "handoff";

/** Safari 交接的結果：null＝還在認領 */
export type MjHandoff = { ok: true; name: string } | { ok: false } | null;

export interface MjAuthUser {
  displayName: string;
  pictureUrl: string | null;
  isGuest?: boolean;
}

/** 遊客登入的結果：ok，或給畫面顯示的錯誤 */
export type GuestLoginError = "wrong_password" | "too_many_attempts" | "disabled" | "network";

const ERROR_MS = 8000;

// ---- iPhone 主畫面 App 的登入交接 ----
const PAIRING_KEY = "mj-pairing";
const POLL_MS = 2000;
type Pairing = { code: string; secret: string; expiresAt: string };

/**
 * iPhone／iPad 從主畫面打開（獨立模式）：只有這時候 LINE 登入才走交接。
 * navigator.standalone 只有 iOS 的 Safari 有；電腦（Chrome 安裝成 App、Mac 的網頁 App，display-mode 也是 standalone）
 * 登入不會被丟到另一個瀏覽器，照一般 LINE 登入。iPadOS 的 UA 是 Mac，用觸控點數分辨
 */
function isStandalone(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** 配對資料（代碼＋領取密鑰）只存在主畫面 App 的 sessionStorage，密鑰不能進網址 */
function readPairing(): Pairing | null {
  try {
    const p = JSON.parse(window.sessionStorage.getItem(PAIRING_KEY) ?? "null") as Partial<Pairing> | null;
    return p?.code && p.secret && p.expiresAt ? (p as Pairing) : null;
  } catch {
    return null;
  }
}

function dropPairing() {
  window.sessionStorage.removeItem(PAIRING_KEY);
}

/** 網址上的配對代碼：讀到就從網址拿掉（不論之後成功或失敗，都不能留在網址列和瀏覽紀錄） */
function takePairingCode(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("pairing");
  if (code === null) return null;
  url.searchParams.delete("pairing");
  window.history.replaceState(window.history.state, "", url.toString());
  return code || null;
}

/**
 * Safari 交接成功後丟掉自己的登入：只清本機儲存、停掉自動更新 token。
 * 不能呼叫 signOut()——伺服器已經用這組 refresh token 換新的給主畫面 App，signOut 或之後再用舊的 refresh token，
 * 都會把整個帳號連同主畫面 App 一起登出
 */
function dropLocalSession() {
  const supabase = getSupabase();
  supabase.auth.stopAutoRefresh().catch(() => {});
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  window.localStorage.removeItem(`sb-${ref}-auth-token`);
}

/** Safari 認領代碼：成功就丟掉 Safari 自己的登入；API 拒絕或例外都算失敗（Safari 仍是登入狀態） */
async function claimPairing(code: string, session: Session): Promise<MjHandoff> {
  try {
    const res = await fetch("/api/auth/pairing/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ code, refreshToken: session.refresh_token }),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json().catch(() => ({}))) as { displayName?: string };
    dropLocalSession();
    return { ok: true, name: body.displayName ?? "" };
  } catch {
    return { ok: false };
  }
}

/** 最多等 ms 毫秒，逾時就用 fallback（不中斷原本的請求） */
function withTimeout<T>(p: Promise<T>, fallback: T, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** 429 的 retryAfter（秒）→ 給人看的分鐘數 */
function tooManyText(retryAfter: unknown): string {
  const sec = typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : 600;
  return `嘗試太多次，請 ${Math.max(1, Math.ceil(sec / 60))} 分鐘後再試`;
}

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
  // 交接用：錯誤訊息（null＝預設的「登入沒有完成」）、Safari 交接結果、主畫面 App 領回後要讓使用者確認的帳號名稱
  const [errorText, setErrorText] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<MjHandoff>(null);
  const [pairedAs, setPairedAs] = useState<string | null>(null);
  // Safari 交接中：登入事件不能把畫面切成已登入
  const handoffRef = useRef(false);
  // 網址上的配對代碼只讀一次（開發模式的 StrictMode 會把 effect 跑兩次，第二次網址上已經沒有了）；認領結束就清成 null
  const pairCodeRef = useRef<string | null | undefined>(undefined);
  // 認領只送一次：effect 重跑時共用同一個 Promise
  const claimRef = useRef<Promise<MjHandoff> | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const failed = takeLoginError();
    let alive = true;
    const guestTab = isGuestTab();
    const entry = guestEntry();
    // 網址上的配對代碼一開始就讀走：supabase-js 從儲存還原登入時會先發 SIGNED_IN，
    // 頁面接著把 ?room= 換成 #room=，會連 ?pairing= 一起蓋掉；交接中的登入事件也不能把畫面切成已登入
    if (pairCodeRef.current === undefined) pairCodeRef.current = guestTab ? null : takePairingCode();
    const pairCode = pairCodeRef.current;
    const standalone = isStandalone();
    const claiming = !!pairCode && !standalone;
    // iOS 沒有把登入丟到 Safari、直接回到主畫面 App：已經登入在 App 裡，不用認領
    if (pairCode && !claiming) dropPairing();
    handoffRef.current = claiming;
    (guestTab ? getGuestClient() : supabase).auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setGuestMode(guestTab || entry);
      if (claiming && pairCode && data.session) {
        // Safari：LINE 登入完，把登入交給主畫面 App（失敗時 Safari 自己還是登入狀態，可以在這裡繼續用）
        setStatus("handoff");
        claimRef.current ??= claimPairing(pairCode, data.session).finally(() => {
          pairCodeRef.current = null; // 成功、拒絕、例外都清掉記憶體裡的代碼
        });
        const result = await claimRef.current;
        if (alive) setHandoff(result);
        return;
      }
      handoffRef.current = false;
      const waiting = readPairing();
      if (waiting && !data.session && standalone && Date.now() < Date.parse(waiting.expiresAt)) {
        // 主畫面 App 重新打開時還在等 Safari 登入：繼續等
        setStatus("pairing");
        return;
      }
      if (waiting) dropPairing(); // 殘留的配對資料（過期、已經登入、不是 iPhone 主畫面）直接清掉，不會卡在等待
      const u = userOf(data.session, guestTab);
      setUser(u);
      setStatus(u ? "in" : failed ? "error" : "out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (isGuestTab()) return; // 遊客分頁不跟 LINE 的登入狀態走
      if (handoffRef.current) return; // Safari 交接中，畫面停在交接結果
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

  // 主畫面 App 等 Safari 登入完：每 2 秒、切回 App 時輪詢；領回就 setSession，過期、失敗就停
  useEffect(() => {
    if (status !== "pairing") return;
    let stop = false;
    let busy = false;
    const fail = (text: string | null) => {
      stop = true;
      dropPairing();
      setErrorText(text);
      setStatus("error");
    };
    const poll = async () => {
      if (stop || busy) return;
      const p = readPairing();
      if (!p) {
        stop = true;
        setStatus("out");
        return;
      }
      if (Date.now() >= Date.parse(p.expiresAt)) return fail("登入逾時，請再試一次");
      busy = true;
      const res = await fetch("/api/auth/pairing/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: p.code, secret: p.secret }),
      }).catch(() => null);
      busy = false;
      if (stop || !res) return; // 網路斷了：下一輪再問
      const body = (await res.json().catch(() => ({}))) as { status?: string; accessToken?: string; refreshToken?: string; retryAfter?: number };
      if (res.ok && body.status === "pending") return;
      if (res.ok && body.status === "ready" && body.accessToken && body.refreshToken) {
        stop = true;
        dropPairing();
        const { data, error } = await getSupabase().auth.setSession({ access_token: body.accessToken, refresh_token: body.refreshToken });
        if (error || !data.session) return fail(null);
        const u = userOf(data.session);
        setUser(u);
        setPairedAs(u?.displayName ?? "");
        setStatus("in");
        return;
      }
      fail(res.status === 429 ? tooManyText(body.retryAfter) : "登入逾時，請再試一次");
    };
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    poll();
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status]);

  /** 導去 LINE 登入；登入完回到 /mahjong（有房號就回那間房）。主畫面 App 先發起交接，代碼跟著登入流程走 */
  const signIn = useCallback(async (roomCode: string | null) => {
    setStatus("redirecting");
    setErrorText(null);
    const standalone = isStandalone();
    let redirectTo = loginReturnUrl(roomCode);
    if (standalone) {
      const res = await fetch("/api/auth/pairing/start", { method: "POST" }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as Partial<Pairing> & { retryAfter?: number } | undefined;
      if (!res?.ok || !body?.code || !body.secret || !body.expiresAt) {
        setErrorText(res?.status === 429 ? tooManyText(body?.retryAfter) : null);
        setStatus("error");
        return;
      }
      window.sessionStorage.setItem(PAIRING_KEY, JSON.stringify({ code: body.code, secret: body.secret, expiresAt: body.expiresAt }));
      const url = new URL(redirectTo);
      url.searchParams.set("pairing", body.code); // 只放代碼，密鑰留在這個 App
      redirectTo = url.toString();
    }
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: LINE_PROVIDER,
      options: { redirectTo, scopes: "openid profile" },
    });
    if (error) {
      dropPairing();
      setStatus("error");
    } else if (standalone) {
      setStatus("pairing");
    }
  }, []);

  /** 主畫面 App 取消等待（伺服器那筆 3 分鐘後自己過期） */
  const cancelPairing = useCallback(() => {
    dropPairing();
    setStatus("out");
  }, []);

  /** Safari 交接失敗：改在這個瀏覽器繼續用（Safari 本身是登入狀態） */
  const continueHere = useCallback(async () => {
    handoffRef.current = false;
    setHandoff(null);
    const { data } = await getSupabase().auth.getSession();
    const u = userOf(data.session);
    setUser(u);
    setStatus(u ? "in" : "out");
  }, []);

  const dismissPairedAs = useCallback(() => setPairedAs(null), []);

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

  /**
   * 登出：畫面先回到登入閘門，本機的登入一定清掉；通知伺服器作廢這次登入放在背景、最多等 3 秒。
   * 原本要等伺服器回應才換畫面：請求卡住、或拿不到 supabase-js 的登入鎖（例如另一個分頁或主畫面 App 正在用）時，
   * 按了沒反應；伺服器回錯時 supabase-js 也不會清本機登入，重新整理又是登入狀態。只清這台裝置，其他裝置不受影響
   */
  const signOut = useCallback(async () => {
    setUser(null);
    setPairedAs(null);
    setStatus("out");
    if (isGuestTab()) {
      // 遊客登出＝刪掉這個遊客（伺服器）＋清掉這個分頁的 session
      const headers = await withTimeout(authHeaders(), {});
      fetch("/api/auth/guest", { method: "DELETE", headers, keepalive: true }).catch(() => {});
      dropGuest();
      return;
    }
    const ok = await withTimeout(getSupabase().auth.signOut({ scope: "local" }).then((r) => !r.error, () => false), false);
    if (!ok) dropLocalSession(); // 伺服器沒確認（失敗、逾時、拿不到鎖）：自己清掉這台裝置的登入
  }, [dropGuest]);

  /** 任何麻將 API 回 401：token 已失效，清掉本機登入，整頁退回登入閘門 */
  const expire = useCallback(() => {
    if (!dropGuest()) getSupabase().auth.signOut({ scope: "local" }).catch(() => {});
    setUser(null);
    setStatus("out");
  }, [dropGuest]);

  return {
    status, user, guestMode, signIn, signInGuest, signOut, expire,
    errorText, handoff, pairedAs, cancelPairing, continueHere, dismissPairedAs,
  };
}
