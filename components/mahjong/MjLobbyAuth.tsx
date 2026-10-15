"use client";

// 麻將大廳的登入元件（小宜規格 v2）：LINE 登入按鈕、登入閘門、遊客登入（測試用）、右上登入列、直向轉向提示

import { useState } from "react";
import type { GuestLoginError, MjAuthStatus, MjAuthUser } from "@/hooks/useMjAuth";

/** LINE 登入按鈕：icon 用官方素材 public/line/btn_base.png，文字用「使用 LINE 登入」 */
export function LineLoginButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="mjl-line" onClick={onClick}>
      <span className="ic">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/line/btn_base.png" alt="" />
      </span>
      <span className="lb">使用 LINE 登入</span>
    </button>
  );
}

function LoggingInPill() {
  return (
    <div className="mjl-pill" role="status">
      <span className="mjl-spin" />
      登入中…
    </div>
  );
}

/**
 * 沒登入時的主欄：只有 LINE 登入。roomCode 有值＝用房號或連結進來（「加入房間 XXXX」、返回大廳）
 */
export function LoginGate({
  status,
  roomCode,
  onLogin,
  onBack,
}: {
  status: Exclude<MjAuthStatus, "in">;
  roomCode: string | null;
  onLogin: () => void;
  onBack: () => void;
}) {
  const back = (
    <button type="button" className="mjl-foot" onClick={onBack}>
      {roomCode ? "返回大廳" : "返回首頁"}
    </button>
  );
  return (
    <div className="mjl-col mjl-gate fade-in">
      {roomCode && (
        <h2 className="mjl-join-ttl">
          加入房間 <b>{roomCode}</b>
        </h2>
      )}
      {status === "checking" ? (
        <LoggingInPill />
      ) : status === "redirecting" ? (
        <>
          <LoggingInPill />
          {back}
        </>
      ) : (
        <>
          {status === "error" && (
            <div className="mjl-err" role="alert">
              登入沒有完成
              <button type="button" onClick={onLogin}>再試一次</button>
            </div>
          )}
          <LineLoginButton onClick={onLogin} />
          {back}
        </>
      )}
    </div>
  );
}

const GUEST_ERRORS: Record<GuestLoginError, string> = {
  wrong_password: "測試密碼不正確",
  too_many_attempts: "嘗試太多次",
  disabled: "遊客登入目前沒有開放",
  network: "連線失敗，請再試一次",
};

/**
 * 遊客登入（只給測試用，從 /mahjong?guest=1 進來才會看到）：輸入測試密碼，每個分頁成為一個新的遊客
 */
export function GuestGate({
  checking,
  roomCode,
  onSubmit,
  onBack,
}: {
  checking: boolean;
  roomCode: string | null;
  onSubmit: (password: string) => Promise<{ error: GuestLoginError; retryAfter?: number } | null>;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    const r = await onSubmit(password);
    setBusy(false);
    if (!r) return;
    const wait = r.error === "too_many_attempts" && r.retryAfter ? `，請 ${Math.max(1, Math.ceil(r.retryAfter / 60))} 分鐘後再試` : "";
    setError(GUEST_ERRORS[r.error] + wait);
    if (r.error === "wrong_password" || r.error === "too_many_attempts") setPassword("");
  }

  return (
    <div className="mjl-col mjl-gate fade-in">
      <h2 className="mjl-join-ttl">
        {roomCode ? <>加入房間 <b>{roomCode}</b></> : "遊客登入"}
      </h2>
      {checking ? (
        <LoggingInPill />
      ) : (
        <form className="mjl-guest" onSubmit={submit}>
          {error && <div className="mjl-err" role="alert">{error}</div>}
          <input
            type="password"
            autoComplete="off"
            placeholder="測試密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center" })}
          />
          <button type="submit" className="mjl-btn primary" disabled={busy || !password}>
            {busy ? "登入中…" : "以遊客進入"}
          </button>
          <button type="button" className="mjl-foot" onClick={onBack}>
            {roomCode ? "返回大廳" : "返回首頁"}
          </button>
        </form>
      )}
    </div>
  );
}

export function Avatar({ user }: { user: MjAuthUser }) {
  const [broken, setBroken] = useState(false);
  if (user.pictureUrl && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="mjl-ava" src={user.pictureUrl} alt="" onError={() => setBroken(true)} />;
  }
  return <span className="mjl-ava">{Array.from(user.displayName)[0] ?? ""}</span>;
}

/** 已登入時右上角：頭像＋LINE 名稱＋登出 */
export function AuthBar({ user, onSignOut }: { user: MjAuthUser; onSignOut: () => void }) {
  return (
    <div className="mjl-authbar">
      <div className="mjl-who">
        <Avatar user={user} />
        <span className="nm">{user.displayName}</span>
        {user.isGuest && <span className="mjl-guest-tag">遊客</span>}
      </div>
      <button type="button" className="mjl-txtbtn" onClick={onSignOut}>
        登出
      </button>
    </div>
  );
}

/** 手機直向轉向提示（樣式沿用 globals.css 的 .mjm-portrait；只在手機直向顯示） */
export function PortraitHint({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mjm-portrait">
      <div className="pair">
        <div className="ph up" />
        <span className="arrow">↻</span>
        <div className="ph land" />
      </div>
      <p className="ttl">請把手機轉成橫向</p>
      <p className="hint">轉了沒反應？請關閉「螢幕方向鎖定」</p>
      <div className="foot">
        <button type="button" className="leave" onClick={onClick}>{label}</button>
      </div>
    </div>
  );
}
