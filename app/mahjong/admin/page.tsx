"use client";
// 斗內後台（老馬 2026-10-31；老柯對接格式第 2 節，小宜〈自摸特效庫與斗內系統〉3、6.2）：只有老闆帳號。
// 權限在伺服器：先打一次後台 API，401／403 就只顯示「沒有權限」，不顯示任何資料（直接打網址也一樣）。
// 四個分頁：斗內紀錄（記一筆打賞＝兩步確認、作廢要填原因）、未結清（依人、依場次已收／撤回）、玩家特效（一次全開／收回）、操作紀錄。
// 老闆 2026-11-02 斗內改成以場結清（小宜〈斗內改版〉A、C、D；老柯〈斗內以場結清〉API 草案）：一場應給＝11/1 之後的自摸次數 × NT$10，
// 「已收」要填實收金額，預設＝應給合計，多給算打賞、少給不能送出；「記一筆」只記打賞，不再抵扣。
// 老闆 2026-10-31：文字越少越好——不顯示有效日期、到期、說明文字；沒有匿名。
import { useCallback, useEffect, useRef, useState } from "react";
import { useMjAuth } from "@/hooks/useMjAuth";
import {
  addDonation, findPlayers, fmtTaipei, fxName, getAudit, getDonateOverview, getDonations, getPlayerFx, getPlayerMatches, getUnsettled, grantFx, nowTaipeiLocal,
  payCheck, revokeBatch, revokeFx, settleMatches, taipeiIso, voidDonation, ZIMO_FX_LIST,
  type AdminPlayer, type AuditRecord, type DonationRecord, type DonateOverview, type PlayerFx, type SettledMatch, type SettleMatch, type UnsettledPlayer,
} from "@/lib/mahjong/zimoFxClient";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import "@/components/mahjong/fxshop/fxshop.css";

type Tab = "donations" | "unpaid" | "overview" | "fx" | "audit";
type Scope = "week" | "all";
const ERR: Record<string, string> = {
  bad_request: "資料有誤", unknown_player: "找不到這位玩家", owner_permanent: "老闆帳號永久全開", not_voidable: "這筆已作廢", forbidden: "沒有權限", not_logged_in: "沒有權限",
};
const errText = (e: string) => ERR[e] ?? "失敗，再試一次";
const nt = (n: number) => `NT$${n.toLocaleString("en-US")}`;
/** 帳號 id → 名字（記帳、搜尋時順手記下；操作紀錄只存 id） */
const names = new Map<string, string>();

export default function MahjongAdminPage() {
  const auth = useMjAuth();
  const [api, setApi] = useState<"checking" | "ok" | "denied">("checking");
  const [tab, setTab] = useState<Tab>("donations");
  const authBusy = auth.status === "checking" || auth.status === "pairing" || auth.status === "handoff";
  const access = authBusy ? "checking" : auth.status !== "in" ? "denied" : api;

  useEffect(() => {
    if (auth.status !== "in") return;
    let alive = true;
    void getDonations("week").then((r) => { if (alive) setApi(r.ok ? "ok" : "denied"); });
    return () => { alive = false; };
  }, [auth.status]);

  const back = <button type="button" className="fxs-btn" onClick={() => { window.location.href = "/mahjong"; }} data-fxs-back>返回</button>;
  if (access !== "ok") {
    return (
      <main className="fxs" data-admin-page={access}>
        <div className="fxs-deny">
          {access === "checking" ? <span className="fxs-muted">讀取中…</span> : <><b data-admin-denied>沒有權限</b>{back}</>}
        </div>
      </main>
    );
  }
  return (
    <main className="fxs" data-admin-page="ok">
      <div className="fxs-wrap">
        <div className="fxs-top">
          {back}
          <h1>斗內後台</h1>
          <div className="fxs-tabs" role="tablist">
            {([["donations", "斗內紀錄"], ["unpaid", "未結清"], ["overview", "斗內總覽"], ["fx", "玩家特效"], ["audit", "操作紀錄"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} data-admin-tab={id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        </div>
        {tab === "donations" ? <DonationsTab /> : tab === "unpaid" ? <UnpaidTab /> : tab === "overview" ? <OverviewTab /> : tab === "fx" ? <FxTab /> : <AuditTab />}
      </div>
    </main>
  );
}

/** 找 LINE 玩家：至少 1 個字（有些人的 LINE 名字只有一個字），停手 300ms 才查；結果有頭像、名字、帳號後四碼（同名時分得出來） */
function PlayerSearch({ onPick }: { onPick: (p: AdminPlayer) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminPlayer[] | null>(null);
  const seq = useRef(0);
  const long = q.trim().length >= 1;
  useEffect(() => {
    const k = ++seq.current;
    if (!long) return;
    const t = setTimeout(async () => {
      const r = await findPlayers(q.trim());
      if (k !== seq.current) return;
      setList(r.ok ? r.data.players : []);
      if (r.ok) r.data.players.forEach((p) => names.set(p.userId, p.name));
    }, 300);
    return () => clearTimeout(t);
  }, [q, long]);
  const shown = long ? list : null;
  return (
    <div>
      <input className="fxs-in" placeholder="搜尋 LINE 名稱" value={q} onChange={(e) => setQ(e.target.value)} data-admin-search aria-label="搜尋 LINE 名稱" />
      {shown && (
        <div className="fxs-pick" data-admin-results>
          {shown.length === 0 ? <span className="fxs-muted" style={{ padding: 8 }}>找不到</span> : shown.map((p) => (
            <button key={p.userId} type="button" onClick={() => onPick(p)} data-admin-pick={p.name}>
              <FxsAvatar url={p.avatarUrl} name={p.name} /> {p.name} <span className="id">#{p.shortId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chosen({ p, onClear }: { p: AdminPlayer; onClear: () => void }) {
  return (
    <div className="fxs-chosen" data-admin-chosen={p.name}>
      <FxsAvatar url={p.avatarUrl} name={p.name} /><b>{p.name}</b><span className="fxs-muted">#{p.shortId}</span>
      <button type="button" className="fxs-btn sm" onClick={onClear}>換人</button>
    </div>
  );
}

function DonationsTab() {
  const [scope, setScope] = useState<Scope>("week");
  const [data, setData] = useState<{ scope: Scope; records: DonationRecord[] } | null>(null);
  const [just, setJust] = useState<string | null>(null); // 剛記的那筆：標示到手動切頁籤或再記一筆為止
  const pendingJust = useRef<string | null>(null); // 剛記好、還沒捲到的那筆
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);
  const [toast, showToast] = useToast();
  useEffect(() => {
    let alive = true;
    void getDonations(scope).then((r) => {
      if (!alive) return;
      if (r.ok) {
        const want = pendingJust.current; // 這次回應是記好之後才發的（更早的被 alive 擋掉）：本週找不到就是舊日期，清單依實收時間排，要到全部找
        if (want && scope === "week" && !r.data.records.some((d) => d.id === want)) { setScope("all"); return; }
        setErr(""); setData({ scope, records: r.data.records }); r.data.records.forEach((d) => names.set(d.userId, d.name));
      }
      else setErr(errText(r.error));
    });
    return () => { alive = false; };
  }, [scope, reload]);
  const shown = data?.scope === scope ? data : null; // 切頁籤後、新資料回來前不顯示另一個頁籤的金額和清單
  const total = shown?.records.filter((d) => !d.voided).reduce((a, d) => a + d.amount, 0);
  const pickScope = (id: Scope) => {
    if (id === scope) return;
    setScope(id); setJust(null); setErr(""); pendingJust.current = null;
    window.scrollTo(0, 0);
  };
  /** 記好後：重抓清單，找到那筆就捲過去 */
  const onAdded = (id: string, msg: string) => {
    setAdding(false); setJust(id); pendingJust.current = id;
    load(); showToast(msg);
  };
  const justRow = useCallback((el: HTMLDivElement | null) => {
    if (!el || !pendingJust.current) return;
    pendingJust.current = null;
    el.scrollIntoView({ block: "center" });
  }, []);

  const doVoid = async (id: string) => {
    if (!reason.trim()) return;
    const r = await voidDonation(id, reason.trim());
    if (r.ok) { setVoiding(null); setReason(""); setErr(""); load(); } else setErr(errText(r.error));
  };
  return (
    <>
      <div className="fxs-bar">
        <span className="fxs-muted">{scope === "week" ? "本週" : "全部"}</span><span className="sum" data-admin-total>{total === undefined ? "…" : nt(total)}</span>
        <div className="fxs-seg" style={{ marginLeft: "auto" }}>
          {([["week", "本週"], ["all", "全部"]] as const).map(([id, label]) => (
            <button key={id} type="button" className={scope === id ? "on" : ""} aria-pressed={scope === id} onClick={() => pickScope(id)}>{label}</button>
          ))}
        </div>
        <button type="button" className="fxs-btn gold" onClick={() => setAdding((v) => !v)} data-admin-add>{adding ? "取消" : "＋ 記一筆打賞"}</button>
      </div>
      {adding && <AddTip onDone={onAdded} />}
      {err && <div className="fxs-err">{err}</div>}
      <div className="fxs-list" style={{ marginTop: 12 }} data-admin-records>
        {shown?.records.length === 0 && <div className="fxs-empty">沒有紀錄</div>}
        {shown?.records.map((d) => (
          <div key={d.id} ref={d.id === just ? justRow : undefined} className={`fxs-rec${d.voided ? " void" : ""}${d.id === just ? " just" : ""}`} data-admin-record={d.id} data-voided={d.voided} data-admin-just={d.id === just ? "" : undefined}>
            <FxsAvatar url={d.avatarUrl} name={d.name} />
            <div className="who"><b>{d.name}</b><span>{fmtTaipei(d.donatedAt)}{d.note ? `・${d.note}` : ""}</span></div>
            <span className="amt">{nt(d.amount)}</span>
            {d.voided ? <span className="fxs-tag void" title={d.voidReason ?? ""}>已作廢</span>
              : <button type="button" className="fxs-btn sm danger" onClick={() => { setVoiding(voiding === d.id ? null : d.id); setReason(""); }} data-admin-void={d.id}>作廢</button>}
            {voiding === d.id && (
              <div className="fxs-voidbox">
                <input className="fxs-in" placeholder="作廢原因" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="作廢原因" data-admin-void-reason />
                <button type="button" className="fxs-btn danger" disabled={!reason.trim()} onClick={() => void doVoid(d.id)} data-admin-void-confirm>確定作廢</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {toast}
    </>
  );
}

/** 記一筆打賞（小宜〈斗內改版〉C7）：只記錢，不結清任何場次；選玩家、金額、實收時間、備註 → 確認 → 送出 */
function AddTip({ onDone }: { onDone: (id: string, msg: string) => void }) {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState(nowTaipeiLocal);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sending = useRef(false); // 連點：state 要等重新渲染才更新，同一瞬間的第二下會漏掉
  const n = Number(amount);
  const valid = !!p && Number.isInteger(n) && n >= 1 && n <= 999999 && !!at;
  const submit = async () => {
    if (!p || !valid || sending.current) return;
    sending.current = true;
    setBusy(true); setErr("");
    const r = await addDonation(p.userId, n, taipeiIso(at), note.trim());
    sending.current = false;
    setBusy(false);
    if (r.ok) onDone(r.data.id, `已記打賞 ${p.name} ${nt(n)}・${fmtTaipei(Date.parse(taipeiIso(at))).slice(0, 5)}`);
    else { setErr(errText(r.error)); setConfirm(false); }
  };
  return (
    <div className="fxs-card" data-admin-add-form>
      <div className="fxs-form">
        <div className="full">{p ? <Chosen p={p} onClear={() => { setP(null); setConfirm(false); }} /> : <PlayerSearch onPick={(x) => { setP(x); setConfirm(false); }} />}</div>
        <label>金額
          <input className="fxs-in" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 6)); setConfirm(false); }} data-admin-amount />
        </label>
        <label>時間
          <input className="fxs-in" type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setConfirm(false); }} data-admin-at />
        </label>
        <label className="full">備註
          <input className="fxs-in" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} data-admin-note />
        </label>
      </div>
      {confirm && p ? (
        <div className="fxs-confirm" data-admin-confirm>
          <FxsAvatar url={p.avatarUrl} name={p.name} /><b>打賞・{p.name}・{nt(n)}</b>
          <button type="button" className="fxs-btn gold" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void submit()} data-admin-submit>確定</button>
          <button type="button" className="fxs-btn" onClick={() => setConfirm(false)}>返回修改</button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="fxs-btn gold" disabled={!valid} onClick={() => setConfirm(true)} data-admin-next>下一步</button>
        </div>
      )}
      {err && <div className="fxs-err" ref={revealErr} role="alert">{err}</div>}
    </div>
  );
}

/** 手機橫向表單比畫面高：錯誤訊息出現時捲進畫面 */
const revealErr = (el: HTMLDivElement | null) => { el?.scrollIntoView({ block: "nearest" }); };

/** 底部提示（預設 2.4 秒消失；結清可撤回的提示 5 秒） */
function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => { setMsg(m); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setMsg(""), 2400); }, []);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [msg ? <div className="fxs-toast" role="status" data-admin-toast>✓ {msg}</div> : null, show] as const;
}

/** 未結清（小宜〈斗內改版〉C1～C6，取代「自摸次數」）：依人列出 → 點一個人開彈窗，一場一場「已收」、勾多場一起結清、可撤回。
 *  老闆 2026-11-02：明細改用彈窗，關掉就回到原本的列表（位置、搜尋字都還在） */
function UnpaidTab() {
  const [rows, setRows] = useState<UnsettledPlayer[] | null>(null);
  const [q, setQ] = useState("");
  const [who, setWho] = useState<UnsettledPlayer | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    void getUnsettled().then((r) => {
      if (!alive) return;
      if (!r.ok) { setErr(errText(r.error)); return; }
      r.data.players.forEach((x) => names.set(x.userId, x.name));
      setRows([...r.data.players].sort((a, b) => b.amount - a.amount)); setErr(""); // 伺服器已依「金額多、最早未結清」排好，這裡只保證金額多的在上
    });
    return () => { alive = false; };
  }, [reload]);
  const close = () => {
    const name = who?.name;
    setWho(null); setReload((n) => n + 1);
    // 焦點回到剛剛點的那一列（列表重新整理後那個人可能已經全部結清、不在列表上）
    setTimeout(() => (document.querySelector(`[data-admin-owe="${CSS.escape(name ?? "")}"]`) as HTMLElement | null)?.focus(), 0);
  };
  const key = q.trim().toLowerCase();
  const shown = rows?.filter((r) => !key || r.name.toLowerCase().includes(key)) ?? [];
  const total = rows?.reduce((s, r) => s + r.amount, 0) ?? 0;
  if (rows && rows.length === 0) {
    return <div className="fxs-allclear" data-admin-allclear><span className="ck">✓</span><b>全部結清</b><span className="fxs-muted">沒有人欠款</span></div>;
  }
  return (
    <>
      <div className="fxs-zbar">
        <span className="fxs-muted">未結清</span><span className="sum" data-admin-unpaid-total>{rows ? nt(total) : "…"}</span>
        {rows && <span className="fxs-muted">{rows.length} 人</span>}
        <input className="fxs-in" style={{ marginLeft: "auto", maxWidth: 280 }} placeholder="搜尋 LINE 名稱" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋 LINE 名稱" data-admin-zsearch />
      </div>
      {err && <div className="fxs-err">{err}</div>}
      {!rows && !err && <span className="fxs-muted">讀取中…</span>}
      <div className="fxs-list" data-admin-owe-list>
        {rows && rows.length > 0 && shown.length === 0 && <div className="fxs-empty">找不到</div>}
        {shown.map((r) => (
          <button key={r.userId} type="button" className="fxs-owe" onClick={() => setWho(r)} data-admin-owe={r.name} data-amount={r.amount}>
            <FxsAvatar url={r.avatarUrl} name={r.name} />
            <span className="who"><b>{r.name}</b><span>{r.matches} 場・自摸 {r.zimo} 次{r.myTableCount > 0 && `・其中 ${r.myTableCount} 場有我在桌`}</span></span>
            <span className="amt">{nt(r.amount)}</span><span className="go">›</span>
          </button>
        ))}
      </div>
      {who && (
        <div className="fxs-mask sheet" onClick={close}>
          <div className="fxs-sheet" role="dialog" aria-modal="true" aria-label={`${who.name} 的未結清場次`} onClick={(e) => e.stopPropagation()} data-admin-settle-sheet>
            <PlayerSettle p={who} onBack={close} />
          </div>
        </div>
      )}
    </>
  );
}

/** 玩家斗內總覽（老闆 2026-11-08，接續〈斗內次數調查報告-2026-11-08〉建議②）：查一個人，不用自己對照對戰紀錄 */
function OverviewTab() {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [data, setData] = useState<DonateOverview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!p) { setData(null); setErr(""); return; }
    let alive = true;
    setData(null); setErr("");
    void getDonateOverview(p.userId).then((r) => {
      if (!alive) return;
      if (!r.ok) { setErr(errText(r.error)); return; }
      setData(r.data);
    });
    return () => { alive = false; };
  }, [p]);
  return (
    <div className="fxs-card" data-admin-overview>
      <div className="full">{p ? <Chosen p={p} onClear={() => setP(null)} /> : <PlayerSearch onPick={setP} />}</div>
      {p && !data && !err && <span className="fxs-muted">讀取中…</span>}
      {err && <div className="fxs-err">{err}</div>}
      {data && (
        <div className="fxs-overview-grid" data-admin-overview-result>
          <div className="cell"><span className="fxs-muted">自摸總次數</span><b data-k="totalHands">{data.totalHands}</b></div>
          <div className="cell"><span className="fxs-muted">11/1 後打過</span><b data-k="afterCutoffMatches">{data.afterCutoffMatches} 場</b></div>
          <div className="cell"><span className="fxs-muted">已結清</span><b data-k="settledMatches">{data.settledMatches} 場</b></div>
          <div className="cell"><span className="fxs-muted">未結清</span><b data-k="unsettledMatches">{data.unsettledMatches} 場</b></div>
          <div className="cell due"><span className="fxs-muted">還欠</span><b data-k="due">{data.isOwner ? "—" : nt(data.due)}</b></div>
        </div>
      )}
    </div>
  );
}

const code = (c: string | null) => c ?? "—";
const when = (m: { endedAt: number | null; startedAt?: number | null }) => m.endedAt ?? m.startedAt ?? 0;
const SETTLE_ERR: Record<string, string> = {
  not_finished: "這場還沒打完，不能結清", already_settled: "這場已經結清了", nothing_due: "這場沒有要給的", short: "實收不夠", bad_amount: "金額有誤", not_found: "這批已經撤回了",
};

/** 一個人的場次：未結清（勾選、已收）＋還在打的（不能結清）＋最近 30 天已結清（撤回整批）。
 *  老闆 2026-11-02：已收要填實收金額，預設＝應給合計，多給算打賞、少給不能送出 */
function PlayerSettle({ p, onBack }: { p: UnsettledPlayer; onBack: () => void }) {
  type Data = { unpaid: SettleMatch[]; playing: SettleMatch[]; paid: SettledMatch[] };
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [paying, setPaying] = useState<string[] | null>(null); // 正在填實收金額的場次
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [just, setJust] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ text: string; batchId: string } | null>(null);
  const [asking, setAsking] = useState<SettledMatch | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1); // 重新抓（同一個檔案其他分頁的做法：effect 裡 then 再 setState，不在 effect 本體同步 setState）
  useEffect(() => {
    let alive = true;
    void getPlayerMatches(p.userId).then((r) => {
      if (!alive) return;
      if (!r.ok) { setErr(SETTLE_ERR[r.error] ?? errText(r.error)); return; }
      setData({ unpaid: r.data.unpaid, playing: r.data.playing, paid: r.data.paid });
    });
    return () => { alive = false; };
  }, [p.userId, reload]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const unpaid = [...(data?.unpaid ?? [])].sort((a, b) => when(b) - when(a));
  const playing = data?.playing ?? [];
  const done = [...(data?.paid ?? [])].sort((a, b) => b.settledAt - a.settledAt);
  const owed = unpaid.reduce((s, m) => s + m.due, 0);
  const dueOf = (ids: string[]) => ids.reduce((s, id) => s + (unpaid.find((m) => m.roomId === id)?.due ?? 0), 0);
  const selDue = dueOf(sel);
  const payDue = paying ? dueOf(paying) : 0;
  const chk = payCheck(payDue, Number(paid));

  const startPay = (ids: string[]) => { setPaying(ids); setPaid(String(dueOf(ids))); setErr(""); };
  const submit = async () => {
    if (!paying || !chk.ok || busy) return;
    setBusy(true); setErr("");
    const r = await settleMatches(p.userId, paying, Number(paid));
    if (!r.ok) {
      setBusy(false);
      const shortBy = Number(r.body?.shortBy) || 0;
      setErr(r.error === "short" && shortBy > 0 ? `實收不夠，還差 ${nt(shortBy)}` : SETTLE_ERR[r.error] ?? errText(r.error));
      if (r.error !== "short") { setPaying(null); load(); }
      return;
    }
    const ids = paying;
    setPaying(null); setSel((s) => s.filter((x) => !ids.includes(x)));
    load();
    setBusy(false);
    setJust(ids); setTimeout(() => setJust([]), 1600);
    setUndo({ text: `已結清 ${r.data.rooms.length} 場 ${nt(r.data.due)}${r.data.tip > 0 ? `・打賞 ${nt(r.data.tip)}` : ""}`, batchId: r.data.batchId });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  };
  const revoke = async (batchId: string, reason: string) => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = await revokeBatch(batchId, reason);
    if (!r.ok) setErr(SETTLE_ERR[r.error] ?? errText(r.error));
    setUndo(null); setAsking(null);
    load();
    setBusy(false);
  };
  const toggle = (id: string) => { setPaying(null); setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  // 彈窗：打開時焦點在關閉鈕；Esc 先取消金額欄，再按一次才關彈窗（撤回確認框開著時由確認框自己處理）
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || asking) return;
      if (paying) setPaying(null); else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking, paying, onBack]);
  const batchOf = (m: SettledMatch) => done.filter((x) => x.batchId === m.batchId);

  return (
    <div className="fxs-settle" data-admin-settle={p.name}>
      <div className="fxs-shead">
        <FxsAvatar url={p.avatarUrl} name={p.name} /><b>{p.name}</b>
        {data && (owed > 0 ? <span className="sum" data-admin-settle-owed={owed}>{nt(owed)}</span> : <span className="fxs-tag ok" data-admin-settle-owed={0}>全部結清</span>)}
        <button ref={closeRef} type="button" className="fxs-x" onClick={onBack} aria-label="關閉" data-admin-settle-back>✕</button>
      </div>
      {err && <div className="fxs-err" data-admin-settle-err>{err}</div>}
      {!data && !err && <span className="fxs-muted">讀取中…</span>}
      {data && (unpaid.length === 0 && playing.length === 0
        ? <div className="fxs-allclear sm"><span className="ck">✓</span><b>全部結清</b></div>
        : <div className="fxs-list" data-admin-unpaid>
          {unpaid.map((m) => {
            const on = sel.includes(m.roomId);
            return (
              <div key={m.roomId} className={`fxs-m${on ? " sel" : ""}`} data-admin-match={code(m.roomCode)} data-due={m.due}>
                <label className="ck">
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(m.roomId)} aria-label={`選 房 ${code(m.roomCode)}`} data-admin-match-check={code(m.roomCode)} />
                </label>
                <span className="t">{fmtTaipei(when(m))}</span>
                <b className="code">房 {code(m.roomCode)}</b>
                <span className="z">自摸 {m.zimo} 次{m.myTable && <> <span className="fxs-tag gold sm" data-admin-mytable={code(m.roomCode)}>我在桌</span></>}</span>
                <span className="amt">{nt(m.due)}</span>
                <button type="button" className="fxs-btn sm gold" disabled={busy} onClick={() => startPay([m.roomId])} data-admin-paid={code(m.roomCode)}>已收</button>
              </div>
            );
          })}
          {/* 還在打的場次：自摸照樣算進玩家的斗內卡，但要整場打完才能結清（老柯風險 1） */}
          {playing.map((m) => (
            <div key={m.roomId} className="fxs-m live" data-admin-playing={code(m.roomCode)}>
              <span className="ck" />
              <span className="t">{m.startedAt ?? m.endedAt ? fmtTaipei(when(m)) : "打牌中"}</span>
              <b className="code">{m.roomCode ? `房 ${m.roomCode}` : ""}</b>
              <span className="z">自摸 {m.zimo} 次{m.myTable && <> <span className="fxs-tag gold sm" data-admin-mytable={code(m.roomCode)}>我在桌</span></>}</span>
              <span className="amt">{nt(m.due)}</span>
              <span className="fxs-tag clr sm">進行中</span>
            </div>
          ))}
        </div>)}
      {done.length > 0 && <>
        <div className="fxs-sub">已結清</div>
        <div className="fxs-list" data-admin-done>
          {done.map((m) => (
            <div key={m.settlementId} className={`fxs-m done${just.includes(m.roomId) ? " just" : ""}`} data-admin-done-match={code(m.roomCode)}>
              <span className="ck" />
              <span className="t">{fmtTaipei(when(m))}</span>
              <b className="code">房 {code(m.roomCode)}</b>
              <span className="z">自摸 {m.zimo} 次{m.myTable && <> <span className="fxs-tag gold sm" data-admin-mytable={code(m.roomCode)}>我在桌</span></>}</span>
              <span className="amt">{nt(m.due)}</span>
              <button type="button" className="fxs-btn sm" disabled={busy} onClick={() => setAsking(m)} data-admin-unsettle={code(m.roomCode)}>撤回</button>
            </div>
          ))}
        </div>
      </>}
      {paying ? (
        <div className="fxs-act pay" data-admin-pay>
          <span className="k">收 {paying.length} 場・應給 <b>{nt(payDue)}</b></span>
          <label className="in">實收 NT$
            <input className="fxs-in" inputMode="numeric" autoFocus value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="實收金額" data-admin-pay-amount />
          </label>
          {chk.short > 0 ? <span className="short" data-admin-pay-short={chk.short}>還差 {nt(chk.short)}</span>
            : chk.tip > 0 ? <span className="fxs-tag gold" data-admin-pay-tip={chk.tip}>多 {nt(chk.tip)} 算打賞</span> : null}
          <span className="sp" />
          <button type="button" className="fxs-btn" disabled={busy} onClick={() => setPaying(null)}>取消</button>
          <button type="button" className="fxs-btn gold" disabled={!chk.ok || busy} onClick={() => void submit()} data-admin-pay-submit>確定結清</button>
        </div>
      ) : sel.length > 0 ? (
        <div className="fxs-act" data-admin-act>
          <span className="k">已選 {sel.length} 場 <b>{nt(selDue)}</b></span>
          <span className="sp" />
          <button type="button" className="fxs-btn gold" disabled={busy} onClick={() => startPay(sel)} data-admin-settle-sel>結清 {sel.length} 場</button>
        </div>
      ) : undo ? (
        <div className="fxs-toast" role="status" data-admin-toast>✓ {undo.text}
          <button type="button" className="fxs-link" disabled={busy} onClick={() => void revoke(undo.batchId, "結清後馬上撤回")} data-admin-toast-undo>撤回</button>
        </div>
      ) : null}
      {asking && (
        <UnsettleDialog rows={batchOf(asking)} name={p.name} busy={busy} onCancel={() => setAsking(null)} onOk={() => void revoke(asking.batchId, "撤回結清")} />
      )}
    </div>
  );
}

/** 撤回確認（C4）：一批結清（同一筆斗內）一起撤回，金額＝那筆實收（含打賞）。打開時焦點在「取消」；Esc、點遮罩＝取消 */
function UnsettleDialog({ rows, name, busy, onCancel, onOk }: { rows: SettledMatch[]; name: string; busy: boolean; onCancel: () => void; onOk: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const first = rows[0];
  if (!first) return null;
  return (
    <div className="fxs-mask" onClick={onCancel}>
      <div className="fxs-dlg" role="alertdialog" aria-modal="true" aria-labelledby="fxs-unsettle-t" onClick={(e) => e.stopPropagation()} data-admin-unsettle-dlg>
        <b id="fxs-unsettle-t">撤回結清</b>
        <span className="fxs-muted">{name}・{fmtTaipei(first.settledAt)}・{rows.map((r) => `房 ${code(r.roomCode)}`).join("、")}</span>
        <span className="big">{nt(first.amount)}</span>
        {(rows.length > 1 || first.tip > 0) && <span className="fxs-muted">同一次收的{rows.length > 1 ? ` ${rows.length} 場` : ""}{first.tip > 0 ? `（含打賞 ${nt(first.tip)}）` : ""}會一起撤回</span>}
        <div className="btns">
          <button ref={cancelRef} type="button" className="fxs-btn" onClick={onCancel}>取消</button>
          <button type="button" className="fxs-btn dangerfill" disabled={busy} onClick={onOk} data-admin-unsettle-ok>撤回</button>
        </div>
      </div>
    </div>
  );
}

/** 玩家特效：選玩家 → 一張狀態卡（小宜〈斗內改版〉D1）。開通一次全開 6 種（老闆 2026-11-02），永久、沒有到期日（2026-11-04），只有開通和收回；老闆帳號永久全開 */
function FxTab() {
  const [p, setP] = useState<AdminPlayer | null>(null);
  return (
    <div className="fxs-card">
      {p ? <><Chosen p={p} onClear={() => setP(null)} /><PlayerFxEditor key={p.userId} userId={p.userId} /></> : <PlayerSearch onPick={setP} />}
    </div>
  );
}

function PlayerFxEditor({ userId }: { userId: string }) {
  const [info, setInfo] = useState<PlayerFx | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    void getPlayerFx(userId).then((r) => { if (!alive) return; if (r.ok) setInfo(r.data); else setErr(errText(r.error)); });
    return () => { alive = false; };
  }, [userId, reload]);

  const run = async (f: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = await f();
    setBusy(false);
    if (r.ok) setReload((n) => n + 1); else setErr(errText(r.error ?? ""));
  };
  const ALL = ZIMO_FX_LIST.map((f) => f.code);
  const grant = () => run(async () => { const r = await grantFx(userId, ALL); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  const revoke = () => run(async () => { const r = await revokeFx(userId); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  // 有任何一種有效開通＝全部開通（伺服器同規則）；老闆 2026-11-04：開通是永久的，不顯示到期日
  const on = !!info && (info.permanent || Object.keys(info.active).length > 0);

  return (
    <>
      {info && (
        <div className={`fxs-grant${on ? " on" : ""}`} data-admin-grant-card={info.permanent ? "permanent" : on ? "on" : "off"}>
          <div className="st">
            {info.permanent ? <span className="fxs-tag gold" data-admin-permanent>永久全開</span>
              : on ? <b className="ok">已開通全部</b>
              : <><b>未開通</b><span className="fxs-muted">6 種特效一次全開</span></>}
          </div>
          {!info.permanent && (
            <div className="acts">
              {on ? <button type="button" className="fxs-btn danger" disabled={busy} onClick={() => void revoke()} data-admin-revoke-all>收回</button>
                : <button type="button" className="fxs-btn gold" disabled={busy} onClick={() => void grant()} data-admin-grant>開通全部</button>}
            </div>
          )}
          <div className="chips">
            {ZIMO_FX_LIST.map(({ code, name }) => <span key={code} className={`fxs-tag sm${on ? " ok" : ""}`} data-admin-fx={code}>{name}</span>)}
          </div>
        </div>
      )}
      {err && <div className="fxs-err">{err}</div>}
    </>
  );
}

const fxList = (v: unknown) => (v === "all" ? "全部" : Array.isArray(v) ? v.map((x) => fxName(String(x))).join("、") : fxName(String(v ?? "")));
/** 操作紀錄 detail 裡的房號：rooms[{ roomCode }]（老柯 match_settle／match_unsettle）、roomCodes 或 roomCode */
const roomCodes = (d: Record<string, unknown>): string[] =>
  Array.isArray(d.rooms) ? d.rooms.map((r) => String((r as { roomCode?: unknown }).roomCode ?? "")).filter(Boolean)
    : Array.isArray(d.roomCodes) ? d.roomCodes.map(String) : d.roomCode != null ? [String(d.roomCode)] : [];
/** 結清的灰字：・房 1294、房 5502（・打賞 NT$X） */
function settleNote(d: Record<string, unknown>): string {
  const codes = roomCodes(d), tip = Number(d.tip) || 0;
  return `${codes.length ? `・${codes.map((c) => `房 ${c}`).join("、")}` : ""}${tip > 0 ? `・打賞 ${nt(tip)}` : ""}`;
}
function auditText(a: AuditRecord): string {
  const who = names.get(a.targetUserId) ?? `#${a.targetUserId.slice(-4)}`;
  const d = a.detail ?? {};
  switch (a.action) {
    // 10/31～11/2 的記一筆有抵扣欄位（舊制），之後的記一筆都是打賞
    case "donation_add": return typeof d.deducted === "number" ? `記一筆 ${who} ${nt(Number(d.amount) || 0)}` : `打賞 ${who} ${nt(Number(d.amount) || 0)}`;
    case "match_settle": return `結清 ${who} ${roomCodes(d).length || Number(d.matches) || 1} 場 ${nt(Number(d.amount) || 0)}`;
    case "match_unsettle": return `撤回 ${who}${roomCodes(d).length ? ` ${roomCodes(d).map((c) => `房 ${c}`).join("、")}` : ""} ${nt(Number(d.amount) || 0)}`;
    case "zimo_clear": return `清除 ${who} 自摸 ${Number(d.cleared) || 0} 次`;
    case "zimo_reset_all": return `系統重置：全部玩家自摸次數從 11/1 起從 0 開始（${Number(d.users) || 0} 人、共 ${Number(d.cleared) || 0} 次，舊紀錄保留）`;
    case "donation_void": return `作廢 ${who} ${nt(Number(d.amount) || 0)}${d.reason ? `（${String(d.reason)}）` : ""}`;
    case "fx_grant": return `開通 ${who} ${Array.isArray(d.fx) && d.fx.length >= ZIMO_FX_LIST.length ? "全部特效" : fxList(d.fx)}${d.auto ? "（系統自動：有斗內）" : ""}`;
    case "fx_revoke": return `收回 ${who} ${d.fx === undefined || d.fx === "all" || (Array.isArray(d.fx) && d.fx.length >= ZIMO_FX_LIST.length) ? "全部特效" : fxList(d.fx)}${d.auto ? "（系統自動：斗內作廢）" : ""}`;
    case "fx_select": return `${who} 換成 ${fxList(d.fx)}`;
    default: return `${a.action} ${who}`;
  }
}

/** 記一筆的抵扣灰字（小宜規格 v2 3.3 的表）：舊紀錄沒有抵扣欄位，不顯示 */
function deductNote(d: Record<string, unknown>): string {
  if (typeof d.deducted !== "number" || typeof d.remaining !== "number") return "";
  const tip = Number(d.tip) || 0, parts: string[] = [];
  if (d.deducted === 0 && d.remaining === 0) parts.push("沒有應斗");
  else {
    if (d.deducted > 0) parts.push(`抵扣 ${d.deducted} 次`);
    parts.push(d.remaining > 0 ? `剩 ${d.remaining} 次` : "歸零");
  }
  if (tip > 0) parts.push(`打賞 ${nt(tip)}`);
  return parts.map((x) => `・${x}`).join("");
}

function AuditTab() {
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all = await getDonations("all"); // 操作紀錄只有帳號 id：用斗內紀錄補名字
      if (all.ok) all.data.records.forEach((d) => names.set(d.userId, d.name));
      const r = await getAudit();
      if (!alive) return;
      if (r.ok) setRows(r.data.records); else setErr(errText(r.error));
    })();
    return () => { alive = false; };
  }, []);
  return (
    <div className="fxs-list" data-admin-audit>
      {err && <div className="fxs-err">{err}</div>}
      {rows?.length === 0 && <div className="fxs-empty">沒有紀錄</div>}
      {rows?.map((a) => (
        <div key={a.id} className="fxs-audit" data-admin-audit-row={a.action}>
          <span className="t">{fmtTaipei(a.at)}</span><span>{auditText(a)}{a.action === "donation_add" && <span className="s">{deductNote(a.detail ?? {})}</span>}{a.action === "match_settle" && <span className="s">{settleNote(a.detail ?? {})}</span>}</span>
        </div>
      ))}
    </div>
  );
}
