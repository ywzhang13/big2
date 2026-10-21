"use client";

// 斗內給阿瑋（小宜〈斗內給阿瑋-UIUX設計規格-2026-10-21〉；老闆 2026-10-21：拿掉「不會開啟付款或跳轉」那行、按鈕改小放右側）。
// 歷史紀錄的成就回饋，不是付款頁：按下去只跳感謝訊息，不跳轉、不開 LINE Pay、不追蹤有沒有付款。
// 只給 LINE 玩家：自摸次數由伺服器照登入帳號算（GET /api/mahjong/donate → { count }），> 0 才顯示；
// 金額＝自摸次數 × 10（老闆 2026-10-21，原本固定 NT$50）。
// 按斗內 → POST /api/mahjong/donate/ack，成功才把次數設成 0（卡片收起）；失敗照樣跳感謝訊息，但卡片留著，下次打開再取一次。

import { useCallback, useEffect, useRef, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import type { MjAuthUser } from "@/hooks/useMjAuth";

/** 斗內金額：自摸一次 NT$10 */
export const donateAmount = (count: number) => count * 10;

export default function MjDonate({ user, focusBack }: { user: MjAuthUser; focusBack: () => void }) {
  const [count, setCount] = useState<number | null>(null); // null＝還沒取到或取失敗：不顯示
  const [later, setLater] = useState(false); // 「下次自摸再說」：只在這次瀏覽收起，不歸零
  const [thanks, setThanks] = useState<number | null>(null); // 感謝訊息開著：記下按的時候的金額（按完次數會歸零）
  const [busy, setBusy] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (user.isGuest) return; // 訪客不取、也不顯示
    let alive = true;
    mjFetch("/api/mahjong/donate", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: unknown } | null) => { if (alive && d && typeof d.count === "number") setCount(d.count); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user.isGuest]);

  const donate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await mjFetch("/api/mahjong/donate/ack", { method: "POST", body: "{}" });
      if (r.ok) setCount(0); // 伺服器已歸零：卡片收起，等下次自摸再出現
    } catch { /* 失敗：卡片留著，下次打開歷史紀錄再取一次正確的次數 */ }
    setBusy(false);
    setThanks(donateAmount(count ?? 0));
  };

  const close = useCallback(() => {
    setThanks(null);
    focusBack(); // 卡片可能已經收起：焦點回到「歷史紀錄」標題
  }, [focusBack]);

  useEffect(() => {
    if (thanks == null) return;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thanks, close]);

  const show = !user.isGuest && count != null && count > 0;
  return (
    <>
      {show && !later && (
        <section className="mjl-donate" aria-label="斗內給阿瑋" data-donate-card>
          <div className="mjl-donate-trophy" aria-hidden="true">🏆</div>
          <div className="mjl-donate-copy">
            <span className="cnt">累計自摸 <b data-donate-count>{count}</b> 次</span>
            <span className="sub">你的好手氣，也能成為阿瑋的開發基金</span>
          </div>
          <button type="button" className="mjl-donate-btn" data-donate-btn disabled={busy} onClick={donate}>
            斗內給阿瑋．NT${donateAmount(count ?? 0)}
          </button>
          <div className="mjl-donate-foot">
            <span>純屬自願，不影響任何遊戲功能</span>
            <button type="button" className="mjl-donate-later" data-donate-later onClick={() => setLater(true)}>下次自摸再說</button>
          </div>
        </section>
      )}
      {show && later && (
        <p className="mjl-donate-hidden" data-donate-hidden>
          本次已先收起斗內提醒。
          <button type="button" onClick={() => setLater(false)}>顯示卡片</button>
        </p>
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
