"use client";

// 斗內給阿瑋（小宜〈斗內給阿瑋-UIUX設計規格-2026-10-21〉；老闆 2026-10-21：拿掉「不會開啟付款或跳轉」那行、按鈕改小放右側）。
// 歷史紀錄的成就回饋，不是付款頁：按下去只跳感謝訊息，不跳轉、不開 LINE Pay、不追蹤有沒有付款。
// 只給 LINE 玩家：自摸次數由伺服器照登入帳號算（GET /api/mahjong/donate → { count, show }），show && count > 0 才顯示；
// 金額＝自摸次數 × 10（老闆 2026-10-21）。次數只有老闆在後台記一筆斗內（自動抵扣）或手動清除時才會變少。
// 收起（小宜〈斗內卡收起與後台自摸次數〉v2 第 2 節，老闆 2026-10-31：按了要消失）：關掉感謝框的所有方式（知道了、×、Esc、點背景）
// 和「下次自摸再說」都算「看過」→ 卡片 0.2 秒淡出收合 → POST /api/mahjong/donate/seen { count }（樂觀更新，失敗也不放回來）。
// 看過不改次數；伺服器記住看過幾次，之後再自摸、次數變多卡片才會再出現（換裝置登入也一樣）。

import { useCallback, useEffect, useRef, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import type { MjAuthUser } from "@/hooks/useMjAuth";

/** 斗內金額：自摸一次 NT$10 */
export const donateAmount = (count: number) => count * 10;

export default function MjDonate({ user, focusBack }: { user: MjAuthUser; focusBack: () => void }) {
  const [count, setCount] = useState<number | null>(null); // null＝還沒取到、取失敗或伺服器說不用顯示
  const [leaving, setLeaving] = useState(false); // 收起動畫中
  const [thanks, setThanks] = useState<number | null>(null); // 感謝訊息開著：記下按的時候的金額
  const doneRef = useRef<HTMLButtonElement>(null);
  const seenRef = useRef(false);

  useEffect(() => {
    if (user.isGuest) return; // 訪客不取、也不顯示
    let alive = true;
    mjFetch("/api/mahjong/donate", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: unknown; show?: unknown } | null) => {
        if (alive && d && typeof d.count === "number" && d.show === true && d.count > 0) setCount(d.count);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user.isGuest]);

  /** 看過：收起卡片，告訴伺服器看到的是幾次（只送一次） */
  const seen = useCallback(() => {
    if (seenRef.current || count == null) return;
    seenRef.current = true;
    setLeaving(true);
    void mjFetch("/api/mahjong/donate/seen", { method: "POST", body: JSON.stringify({ count }) }).catch(() => {});
  }, [count]);

  const close = useCallback(() => {
    setThanks(null);
    seen();
    focusBack(); // 焦點回到「歷史紀錄」標題
  }, [focusBack, seen]);

  useEffect(() => {
    if (thanks == null) return;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thanks, close]);

  return (
    <>
      {count != null && count > 0 && (
        <section className={`mjl-donate ${leaving ? "out" : ""}`} aria-label="斗內給阿瑋" data-donate-card
          onAnimationEnd={(e) => { if (leaving && e.animationName === "mjl-donate-out") setCount(null); }}>
          <div className="mjl-donate-trophy" aria-hidden="true">🏆</div>
          <div className="mjl-donate-copy">
            <span className="cnt">累計自摸 <b data-donate-count>{count}</b> 次</span>
            <span className="sub">你的好手氣，也能成為阿瑋的開發基金</span>
          </div>
          <button type="button" className="mjl-donate-btn" data-donate-btn disabled={leaving} onClick={() => setThanks(donateAmount(count))}>
            斗內給阿瑋．NT${donateAmount(count)}
          </button>
          <div className="mjl-donate-foot">
            <span>純屬自願，不影響任何遊戲功能</span>
            <button type="button" className="mjl-donate-later" data-donate-later disabled={leaving} onClick={() => { seen(); focusBack(); }}>下次自摸再說</button>
          </div>
        </section>
      )}
      {thanks != null && (
        <div className="mjl-donate-shade" data-donate-thanks onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <section className="mjl-donate-thanks" role="dialog" aria-modal="true" aria-labelledby="mjl-donate-ttl">
            <button type="button" className="x" aria-label="關閉感謝訊息" data-donate-x onClick={close}>×</button>
            <span className="linepay" aria-label="LINE Pay">LINE<br />Pay</span>
            <h3 id="mjl-donate-ttl">感謝乾爹乾媽的開發基金！</h3>
            <p>您的心意，阿瑋感受到了！</p>
            <div className="pay">歡迎使用 LINE Pay 贊助阿瑋<strong data-donate-amount>NT${thanks}</strong></div>
            <button type="button" className="done" ref={doneRef} data-donate-done onClick={close}>知道了</button>
          </section>
        </div>
      )}
    </>
  );
}
