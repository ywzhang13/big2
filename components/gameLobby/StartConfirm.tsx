"use client";
// 開局確認（老闆 2026-11-20：房主按開始後，四家都按同意才進遊戲；10 秒沒到齊就不開，房主再按一次重新倒數）。
// 三款共用的畫面元件：只負責畫，資料（誰同意了、剩幾秒）和按鈕要做什麼都由遊戲傳進來；十三支先用，之後大老二、麻將接同一個。
//   蓋在等人畫面上的視窗：標題＋倒數秒數、四家小牌子（✓ 已同意／… 等待中，樣式同十三支下一局的「確認 2/4」）、倒數條、
//   自己還沒按＝「同意」；已按＝「已同意，等其他人」；房主（開始時就算同意）多一顆「取消」
import "./startConfirm.css";

export interface StartConfirmSeat { key: string | number; name: string; ok: boolean; me: boolean }

/** 剩幾秒（進位；不會小於 0）：截止時間是伺服器時間，換算時加上伺服器和本機的時差（clockSkew＝伺服器 − 本機，毫秒） */
export const secondsLeftOf = (deadline: number, localNow: number, clockSkew: number): number => Math.max(0, Math.ceil((deadline - (localNow + clockSkew)) / 1000));

export default function StartConfirm({ seats, secondsLeft, totalSeconds, isHost, busy = false, error = null, onAgree, onCancel }: {
  seats: StartConfirmSeat[];
  /** 剩幾秒（伺服器截止時間換算，進位成整數）；0＝時間到、等伺服器回到等人 */
  secondsLeft: number;
  /** 倒數總長（秒），畫倒數條用 */
  totalSeconds: number;
  isHost: boolean;
  /** 送出中：按鈕不能再按 */
  busy?: boolean;
  error?: string | null;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const me = seats.find((s) => s.me);
  const agreed = !!me?.ok;
  const n = seats.filter((s) => s.ok).length;
  const pct = Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100));
  return (
    <div className="sc-mask" data-start-confirm>
      <div className="sc-card" role="dialog" aria-modal="true" aria-labelledby="sc-ttl">
        <div className="sc-hd">
          <b id="sc-ttl">準備開局</b>
          <span className="sc-sec" aria-live="polite" data-start-confirm-sec={secondsLeft}>{secondsLeft}</span>
        </div>
        <div className="sc-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
        <div className="sc-seats">
          <span className="cnt">同意 {n}/{seats.length}</span>
          {seats.map((s) => (
            <span key={s.key} className={`sc-chip${s.ok ? " ok" : " wait"}${s.me ? " me" : ""}`} data-start-confirm-seat={s.key} data-ok={s.ok ? "1" : "0"}>
              <i>{s.ok ? "✓" : "…"}</i><span>{s.me ? "你" : s.name}</span>
            </span>
          ))}
        </div>
        {error && <p className="sc-err" role="alert">{error}</p>}
        <div className="sc-act">
          {agreed
            ? <div className="sc-btn mute" data-start-confirm-wait>已同意，等其他人</div>
            : <button type="button" className="sc-btn" disabled={busy || secondsLeft <= 0} onClick={onAgree} data-start-confirm-agree>{busy ? "送出中…" : "同意"}</button>}
          {isHost && <button type="button" className="sc-btn line" disabled={busy} onClick={onCancel} data-start-confirm-cancel>取消開局</button>}
        </div>
      </div>
    </div>
  );
}
