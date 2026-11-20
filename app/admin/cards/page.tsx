"use client";
// 房卡後台（小宜〈房卡系統 v1.2〉第 4 節；API：老柯〈給老馬-房卡與斗內下架-API說明〉第 3 節）：只有老闆帳號。
// 權限在伺服器：先打一次玩家名單，401／403 就只顯示「沒有權限」，不顯示任何資料（直接打網址也一樣，照斗內後台）。
// 兩個頁籤：玩家（統計格、搜尋、名單）、欠卡名單。點一列開玩家明細（狀態條、流水帳）；充值、回收（只填張數，可以收到負數）、暫停、恢復（按一下就生效）。
// 寫入按一次只生效一次：視窗打開時產生操作編號 opId，送出中按鈕變「處理中…」，失敗時視窗留著、重試用同一個 opId。
// 「全部流水帳」頁籤（4-4 後半）後端還沒做，這一版沒有放。
// 名單、統計、明細、視窗、提示都綁「讀它的那個帳號」（adminState）：登出、換帳號那一次畫面就不顯示前一個人的，舊回應晚到也不寫回。
// 張數欄位照原樣留住打的字，不是 1～100000 的整數就不能送，欄位下面寫原因（不會偷偷改成別的數字）。
import { useEffect, useMemo, useState } from "react";
import { useMjAuth } from "@/hooks/useMjAuth";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import {
  cardWrite, fmtAt, fmtCards, getCardLedger, getCardPlayers,
  type CardEntry, type CardOp, type CardPlayer,
} from "@/components/roomCard/client";
import { adminAccess, cardInputHint, loadAdmin, mine, parseCardInput, type AdminView, type Owned } from "@/components/roomCard/adminState";
import "@/components/mahjong/fxshop/fxshop.css";
import "@/components/roomCard/roomCard.css";

type Tab = "players" | "debt";
const GAME: Record<string, string> = { mahjong: "麻將", thirteen: "十三支" };
const balCls = (b: number) => (b < 0 ? " neg" : b === 0 ? " zero" : "");

export default function RoomCardAdminPage() {
  const auth = useMjAuth();
  const authBusy = auth.status === "checking" || auth.status === "pairing" || auth.status === "handoff";
  const authId = auth.status === "in" ? auth.user?.id ?? null : null;
  const [view, setView] = useState<Owned<AdminView> | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [q, setQ] = useState("");
  const [detailO, setDetailO] = useState<Owned<string> | null>(null);
  const [formO, setFormO] = useState<Owned<{ op: CardOp; p: CardPlayer }> | null>(null);
  const [toastO, setToastO] = useState<Owned<string> | null>(null);
  const [ledgerKey, setLedgerKey] = useState(0);
  const access = adminAccess(authBusy, authId, view);
  const v = mine(view, authId);
  const players = useMemo(() => (v?.api === "ok" ? v.players : []), [v]);
  const stats = v?.api === "ok" ? v.stats : null;
  const detail = mine(detailO, authId), form = mine(formO, authId), toast = mine(toastO, authId);
  const own = <T,>(value: T): Owned<T> | null => (authId ? { owner: authId, value } : null);

  // 名單：每個帳號 id 問一次（換帳號就重問權限）；充值、回收、暫停、恢復成功後 reload＋1 再問一次
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!authId) return;
    return loadAdmin(authId, getCardPlayers, setView);
  }, [authId, reload]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToastO(null), 2600); return () => clearTimeout(t); }, [toast]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    const base = tab === "debt" ? players.filter((p) => p.balance < 0) : players; // 伺服器已照餘額由少到多排好
    return k ? base.filter((p) => p.name.toLowerCase().includes(k) || p.shortId.toLowerCase().includes(k)) : base;
  }, [players, tab, q]);
  const debtors = players.filter((p) => p.balance < 0);

  const back = <button type="button" className="fxs-btn" onClick={() => { window.location.href = "/"; }} data-fxs-back>返回</button>;
  if (access !== "ok") {
    return (
      <main className="fxs" data-admin-page={access} data-rc-admin={access}>
        <div className="fxs-deny">
          {access === "checking" ? <span className="fxs-muted">讀取中…</span>
            : access === "error" ? <><b data-rc-admin-error>讀不到資料</b><button type="button" className="fxs-btn" onClick={() => setReload((k) => k + 1)}>重試</button>{back}</>
              : <><b data-admin-denied>沒有權限</b>{back}</>}
        </div>
      </main>
    );
  }
  const current = detail ? players.find((p) => p.userId === detail) ?? null : null;
  return (
    <main className="fxs" data-admin-page="ok" data-rc-admin="ok">
      <div className="fxs-wrap">
        <div className="fxs-top">
          {back}
          <h1>房卡後台</h1>
          <div className="fxs-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "players"} className={tab === "players" ? "on" : ""} onClick={() => setTab("players")} data-rc-tab="players">玩家</button>
            <button type="button" role="tab" aria-selected={tab === "debt"} className={tab === "debt" ? "on" : ""} onClick={() => setTab("debt")} data-rc-tab="debt">欠卡名單 {debtors.length}</button>
          </div>
        </div>
        {tab === "players" && stats && (
          <div className="rc-sum" data-rc-sum>
            <div className="cell"><span>玩家</span><b>{stats.players}</b></div>
            <div className="cell neg"><span>欠卡</span><b>{stats.debtors} 人・{stats.debtCards} 張</b></div>
            <div className="cell"><span>暫停中</span><b>{stats.suspended}</b></div>
            <div className="cell gold"><span>今天扣卡</span><b>{stats.chargedToday}</b></div>
          </div>
        )}
        {tab === "debt" && (
          <div className="fxs-bar"><b className="rc-red" data-rc-debt-sum>欠卡　{debtors.length} 人・{debtors.reduce((a, p) => a - p.balance, 0)} 張</b></div>
        )}
        <div className="fxs-bar">
          <input className="fxs-in" placeholder="名字或編號" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋玩家" data-rc-search />
        </div>
        <div className="fxs-list" data-rc-list>
          {shown.length === 0 ? (
            <div className="fxs-empty">{tab === "debt" && !q.trim() ? "沒有人欠卡" : "沒有玩家"}</div>
          ) : shown.map((p) => (
            <div key={p.userId} role="button" tabIndex={0} className={`rc-p${p.suspended ? " sus" : ""}`} data-rc-player={p.shortId}
              onClick={() => setDetailO(own(p.userId))} onKeyDown={(e) => { if (e.key === "Enter") setDetailO(own(p.userId)); }}>
              <FxsAvatar url={p.avatarUrl} name={p.name} />
              <div className="who">
                <b>{p.name}<i>{p.shortId}</i>{p.suspended && <span className="fxs-tag void sm">暫停中</span>}{p.playing && <span className="fxs-tag ok sm">對局中</span>}</b>
                <span>上次充值 {p.lastTopupAt ? fmtAt(p.lastTopupAt) : "—"}・上次扣卡 {p.lastChargeAt ? fmtAt(p.lastChargeAt) : "—"}</span>
              </div>
              <div className={`rc-bal${balCls(p.balance)}`} data-rc-bal={p.balance}>{fmtCards(p.balance)}<small>張</small></div>
              <div className="rc-acts">
                <button type="button" className="fxs-btn gold sm" onClick={(e) => { e.stopPropagation(); setFormO(own<{ op: CardOp; p: CardPlayer }>({ op: "topup", p })); }} data-rc-topup={p.shortId}>充值</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {current && <PlayerSheet p={current} reloadKey={ledgerKey} onClose={() => setDetailO(null)} onOp={(op) => setFormO(own({ op, p: current }))} />}
      {form && formO && (
        <OpForm op={form.op} p={form.p} onClose={() => setFormO(null)}
          onDone={(msg) => { setFormO(null); setToastO({ owner: formO.owner, value: msg }); setLedgerKey((k) => k + 1); setReload((k) => k + 1); }} />
      )}
      {toast && <div className="fxs-toast" role="status" data-rc-toast>{toast}</div>}
    </main>
  );
}

/** 玩家明細：最上面頭像、名字、編號、狀態、餘額、✕；動作；狀態條；這個人的流水帳（新的在上面） */
function PlayerSheet({ p, reloadKey, onClose, onOp }: { p: CardPlayer; reloadKey: number; onClose: () => void; onOp: (op: CardOp) => void }) {
  const [entries, setEntries] = useState<CardEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void getCardLedger(p.userId).then((r) => { if (alive) setEntries(r.ok ? r.data.entries : []); });
    return () => { alive = false; };
  }, [p.userId, reloadKey]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fxs-mask rc-mask" onClick={onClose}>
      <div className="fxs-sheet rc-sheet" role="dialog" aria-label={`${p.name} 的房卡`} onClick={(e) => e.stopPropagation()} data-rc-sheet={p.shortId}>
        <div className="rc-dh">
          <FxsAvatar url={p.avatarUrl} name={p.name} />
          <div className="nm"><b>{p.name}</b><span>{p.shortId}{p.suspended ? "・暫停中" : p.playing ? "・對局中" : ""}</span></div>
          <div className={`rc-bal${balCls(p.balance)}`} data-rc-sheet-bal={p.balance}>{fmtCards(p.balance)}<small>張</small></div>
          <button type="button" className="fxs-x" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        <div className="rc-da">
          <button type="button" className="fxs-btn gold sm" onClick={() => onOp("topup")} data-rc-op="topup">充值</button>
          <button type="button" className="fxs-btn sm" onClick={() => onOp("reclaim")} data-rc-op="reclaim">回收</button>
          {p.suspended
            ? <button type="button" className="fxs-btn gold sm" onClick={() => onOp("resume")} data-rc-op="resume">恢復</button>
            : <button type="button" className="fxs-btn danger sm" onClick={() => onOp("suspend")} data-rc-op="suspend">暫停</button>}
        </div>
        {(p.suspended || p.playing) && (
          <div className="rc-da rc-side-note">
            {p.suspended && p.suspendedAt
              ? <div className="rc-note" data-rc-note="suspended">{fmtAt(p.suspendedAt)} 暫停</div>
              : p.playing && <div className="rc-note info" data-rc-note="playing">{GAME[p.playing.game] ?? p.playing.game} 房 {p.playing.code}</div>}
          </div>
        )}
        <div className="rc-db" data-rc-ledger>
          {entries === null ? <span className="fxs-muted">讀取中…</span>
            : entries.length === 0 ? <div className="fxs-empty">沒有紀錄</div>
              : entries.map((e, i) => (
                <LedgerRow key={`${e.kind}-${e.at}-${i}`} e={e} expanded={open === i} onToggle={() => setOpen(open === i ? null : i)} />
              ))}
        </div>
      </div>
    </div>
  );
}

const KIND: Record<CardEntry["kind"], [string, string]> = {
  topup: ["充值", "ok"], charge: ["扣卡", "gold"], reclaim: ["回收", "clr"], suspend: ["暫停", "void"], resume: ["恢復", "ok"],
};
/** 流水帳一筆：時間、種類、內容、張數、這筆之後的餘額；扣卡一場一列，點了展開每一把／每一局 */
function LedgerRow({ e, expanded, onToggle }: { e: CardEntry; expanded: boolean; onToggle: () => void }) {
  const [label, tone] = KIND[e.kind];
  const who = e.actor === "system" ? "系統" : "老闆";
  const charge = e.kind === "charge";
  const unit = e.game === "thirteen" ? "局" : "把";
  const desc = charge ? <>{GAME[e.game ?? ""] ?? e.game} 房 {e.roomCode}<small>{e.hands?.length ?? 0} {unit}</small></> : who;
  const row = (
    <>
      <span className="t">{fmtAt(e.at)}</span>
      <span><span className={`fxs-tag ${tone} sm`}>{label}</span></span>
      <span className="d">{desc}</span>
      <span className={`dl${e.cards === null ? "" : e.cards > 0 ? " pos" : " neg"}`}>{e.cards === null ? "" : e.cards > 0 ? `+${e.cards}` : fmtCards(e.cards)}</span>
      <span className="af">{e.balanceAfter === null ? "" : fmtCards(e.balanceAfter)}</span>
    </>
  );
  return (
    <>
      {charge ? <button type="button" className="rc-l grp" aria-expanded={expanded} onClick={onToggle} data-rc-entry={e.kind}>{row}</button>
        : <div className="rc-l" data-rc-entry={e.kind}>{row}</div>}
      {charge && expanded && (e.hands ?? []).map((h) => (
        <div key={h} className="rc-l sub"><span /><span /><span className="d">第 {h} {unit}</span><span className="dl neg">−1</span><span /></div>
      ))}
    </>
  );
}

const TITLE: Record<CardOp, string> = { topup: "充值", reclaim: "回收", suspend: "暫停", resume: "恢復" };
/** 充值、回收（張數）、暫停、恢復（沒有欄位）；opId 視窗打開時產生一次，重試用同一個 */
function OpForm({ op, p, onClose, onDone }: { op: CardOp; p: CardPlayer; onClose: () => void; onDone: (msg: string) => void }) {
  const [opId] = useState(() => crypto.randomUUID());
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const withCards = op === "topup" || op === "reclaim";
  const parsed = parseCardInput(raw);
  const n = parsed.ok ? parsed.n : 0;
  const hint = withCards ? cardInputHint(parsed) : null;
  const valid = !withCards || parsed.ok;
  const after = op === "topup" ? p.balance + n : p.balance - n;
  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true); setErr(false);
    const r = await cardWrite(op, { userId: p.userId, opId, ...(withCards ? { cards: n } : {}) });
    setBusy(false);
    if (!r.ok) { setErr(true); return; }
    const bal = r.data.balance ?? p.balance;
    onDone(op === "topup" ? `已充值 ${n} 張，${p.name} 現在 ${fmtCards(bal)} 張` : op === "reclaim" ? `已回收 ${n} 張，${p.name} 現在 ${fmtCards(bal)} 張`
      : op === "suspend" ? `已暫停 ${p.name}` : `已恢復 ${p.name}`);
  };
  const okLabel = busy ? "處理中…" : op === "topup" ? `充值${n ? ` ${n} 張` : ""}` : op === "reclaim" ? `回收${n ? ` ${n} 張` : ""}` : TITLE[op];
  return (
    <div className="fxs-mask" onClick={() => { if (!busy) onClose(); }}>
      <form className="rc-form" role="dialog" aria-label={TITLE[op]} data-rc-form={op} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3>{TITLE[op]}<span>{p.name}・{p.shortId}</span></h3>
        {withCards && (
          <>
            {op === "topup" && (
              <div className="rc-chips">
                {[10, 50, 100, 500].map((c) => <button key={c} type="button" className={n === c ? "on" : ""} onClick={() => setRaw(String(c))}>{c}</button>)}
              </div>
            )}
            <label>張數
              <input className="fxs-in" inputMode="numeric" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)}
                aria-invalid={hint ? true : undefined} aria-describedby={hint ? "rc-cards-err" : undefined} data-rc-cards />
            </label>
            {hint && <div className="fxs-err" id="rc-cards-err" role="alert" data-rc-cards-err>{hint}</div>}
            {n > 0 && (
              <div className="rc-pv" data-rc-preview={after}>
                <b className={p.balance < 0 ? "neg" : "pos"}>{fmtCards(p.balance)}</b>→<b className={after < 0 ? "neg" : "pos"} data-rc-after={after}>{fmtCards(after)}</b>張
              </div>
            )}
          </>
        )}
        <div className="rc-fb">
          {err && <span className="fxs-err" role="alert" data-rc-err>沒有送出成功</span>}
          <button type="button" className="fxs-btn sm" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className={`fxs-btn sm${op === "topup" || op === "resume" ? " gold" : " danger"}`} disabled={busy || !valid} data-rc-ok={op}>{okLabel}</button>
        </div>
      </form>
    </div>
  );
}
