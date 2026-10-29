"use client";
// 牌桌上被申請／被觀戰的玩家這一側（小宜〈麻將觀戰模式-UIUX完整規格-2026-10-30〉5.5、5.8；老柯〈觀戰模式-前後端對接格式〉第 4 節）：
//   ・申請卡：非阻斷（沒有遮罩，只有卡片吃點擊），手機在左上、桌機在右上；一次只顯示最早一筆，其他寫「另有 n 筆」；30 秒倒數用伺服器時間
//   ・觀戰管理：牌桌選單「觀戰管理・n 人」打開，可單筆或全部收回，收回前先確認
// 清單用 useSpectateManage 抓（進牌桌時、收到 mj_spectate_request／mj_spectators 時、每 5 秒保險一次）
import { useCallback, useEffect, useRef, useState } from "react";
import { clockSkew, fetchManage, respondSpectate, revokeSpectate, secondsLeft, type SpectateManageInfo } from "@/lib/mahjong/spectateClient";
import "./spectate.css";

export function SpxAvatar({ url, name, large }: { url: string | null; name: string; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`spx-av${large ? " l" : ""}`} aria-hidden>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- LINE 頭像外部網址，不經過 next/image
        <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}

/** 每秒重畫一次（倒數用）；active＝false 時不跑 */
export function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function SpxToast({ text, assertive }: { text: string | null; assertive?: boolean }) {
  return (
    <div aria-live={assertive ? "assertive" : "polite"} style={{ position: "fixed", width: 0, height: 0, overflow: "visible" }}>
      {text && <div className="spx-toast" data-spectate-toast>{text}</div>}
    </div>
  );
}

/** 被觀戰的玩家本人的觀戰清單（申請中、已同意）。active＝牌局進行中、本人有座位；tick 變了（收到觀戰事件）就重抓 */
export function useSpectateManage(roomId: string, playerId: string, tick: number | undefined, active: boolean) {
  const [info, setInfo] = useState<SpectateManageInfo | null>(null);
  const reload = useCallback(async () => {
    if (!active || !roomId || !playerId) return;
    const r = await fetchManage(roomId, playerId);
    if (r.ok) setInfo(r.data);
  }, [roomId, playerId, active]);
  useEffect(() => {
    if (!active || !roomId || !playerId) return;
    let alive = true;
    const load = () => fetchManage(roomId, playerId).then((r) => { if (alive && r.ok) setInfo(r.data); });
    const first = setTimeout(load, 0);
    const t = setInterval(load, 5000);
    return () => { alive = false; clearTimeout(first); clearInterval(t); };
  }, [active, roomId, playerId, tick]);
  return { info: active ? info : null, reload };
}

/** 申請卡（牌桌上，非阻斷） */
export function SpectateRequestCard({ info, roomId, playerId, desk, onChanged }: {
  info: SpectateManageInfo | null; roomId: string; playerId: string; desk: boolean; onChanged: () => void;
}) {
  const skew = clockSkew(info?.serverNow);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]); // 剛回應過的（等伺服器下一份清單前先藏起來）
  const [toast, setToast] = useState<string | null>(null);
  const shown = (info?.pending ?? []).filter((r) => !done.includes(r.requestId) && secondsLeft(r.expiresAt, skew) > 0);
  const req = shown[0];
  useTick(!!req);
  const left = req ? secondsLeft(req.expiresAt, skew) : 0;
  const flash = (text: string) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2500); };
  // 逾時：卡片消失、提示「○○的申請已失效」（自己按了同意／拒絕的不算）
  const lastReq = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (req) { lastReq.current = { id: req.requestId, name: req.name }; return; }
    const prev = lastReq.current;
    lastReq.current = null;
    if (prev && !done.includes(prev.id)) flash(`${prev.name}的申請已失效`);
  }, [req, done]);
  if (!req) return <SpxToast text={toast} />;
  const answer = async (approve: boolean) => {
    setBusy(true);
    const r = await respondSpectate(roomId, playerId, req.requestId, approve);
    setBusy(false);
    if (r.ok) { setDone((d) => [...d, req.requestId]); onChanged(); }
    else if (r.error === "not_pending") { setDone((d) => [...d, req.requestId]); flash(`${req.name}的申請已失效`); onChanged(); }
    else flash("送出失敗，請再試一次");
  };
  // 讀屏只在 10 秒、5 秒時更新說明，不每秒播報
  const ariaLeft = left <= 5 ? 5 : left <= 10 ? 10 : null;
  return (
    <>
      <section className={`spx spx-req${desk ? " d" : ""}`} role="region" aria-label="觀戰申請" data-spectate-request={req.requestId}>
        <div className="hd">
          <SpxAvatar url={req.avatarUrl} name={req.name} large={desk} />
          <div className="who">
            <div className="t">
              {req.name}想觀戰你的視角
              {shown.length > 1 && <span className="more">另有 {shown.length - 1} 筆</span>}
            </div>
            <div className="s" aria-hidden>LINE 本名・剩 {left} 秒</div>
            {ariaLeft && <span className="sr-only">申請剩 {ariaLeft} 秒</span>}
          </div>
        </div>
        <div className="warn">同意後，對方會即時看到你的手牌。</div>
        <div className="sub">你可以隨時收回，效力到房間結束。</div>
        <div className="acts">
          <button type="button" className="spx-btn danger" disabled={busy} onClick={() => answer(false)} data-spectate-reject>拒絕</button>
          <button type="button" className="spx-btn primary" disabled={busy} onClick={() => answer(true)} data-spectate-approve>同意觀戰</button>
        </div>
      </section>
      <SpxToast text={toast} />
    </>
  );
}

/** 觀戰管理（從牌桌選單打開）：看誰在觀戰、單筆或全部收回 */
export function SpectateManage({ info, roomId, playerId, onClose, onChanged }: {
  info: SpectateManageInfo | null; roomId: string; playerId: string; onClose: () => void; onChanged: () => void;
}) {
  const viewers = info?.approved ?? [];
  const [confirm, setConfirm] = useState<{ requestId?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const revoke = async () => {
    if (!confirm) return;
    setBusy(true);
    const r = await revokeSpectate(roomId, playerId, confirm.requestId);
    setBusy(false);
    const text = r.ok ? (confirm.requestId ? `已收回${confirm.name}的觀戰權限` : "已收回全部觀戰權限") : "收回失敗，請再試一次";
    setConfirm(null);
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2500);
    if (r.ok) onChanged();
  };
  return (
    <>
      <div className="spx-manage-mask" onClick={onClose} />
      <div className="spx spx-manage" role="dialog" aria-label="觀戰管理" data-spectate-manage>
        <h3>觀戰管理・{viewers.length} 人</h3>
        <div className="note">收回後，對方會立即離開你的視角。</div>
        {viewers.length === 0 && <div className="note">目前沒有人在觀戰你的視角。</div>}
        {viewers.map((v) => (
          <div className="row" key={v.requestId}>
            <SpxAvatar url={v.avatarUrl} name={v.name} />
            <span className="nm">{v.name}</span>
            <button type="button" className="spx-btn danger" onClick={() => setConfirm({ requestId: v.requestId, name: v.name })} data-spectate-revoke={v.requestId}>收回觀戰同意</button>
          </div>
        ))}
        {confirm && (
          <div className="confirm" role="alert">
            {confirm.requestId ? `收回${confirm.name}？` : "收回全部觀戰者？"}收回後，對方會立即離開你的視角。
            <div className="foot">
              <button type="button" className="spx-btn" onClick={() => setConfirm(null)}>取消</button>
              <button type="button" className="spx-btn danger" disabled={busy} onClick={revoke} data-spectate-revoke-confirm>確定收回</button>
            </div>
          </div>
        )}
        {/* 確認收回時換掉底下這列（不疊兩排按鈕，手機橫向高度不夠） */}
        {!confirm && (
          <div className="foot">
            {viewers.length > 1 && <button type="button" className="spx-btn danger" onClick={() => setConfirm({ name: "" })} data-spectate-revoke="all">收回全部</button>}
            <button type="button" className="spx-btn" onClick={onClose}>關閉</button>
          </div>
        )}
      </div>
      <SpxToast text={toast} />
    </>
  );
}
