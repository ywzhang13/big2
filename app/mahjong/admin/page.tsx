"use client";
// 斗內後台（老馬 2026-10-31；老柯對接格式第 2 節，小宜〈自摸特效庫與斗內系統〉3、6.2）：只有老闆帳號。
// 權限在伺服器：先打一次後台 API，401／403 就只顯示「沒有權限」，不顯示任何資料（直接打網址也一樣）。
// 三個分頁：斗內紀錄（記一筆＝兩步確認、作廢要填原因）、玩家特效（開通／收回）、操作紀錄。
// 老闆 2026-10-31：文字越少越好——不顯示有效日期、到期、說明文字；沒有匿名。
import { useEffect, useRef, useState } from "react";
import { useMjAuth } from "@/hooks/useMjAuth";
import {
  addDonation, findPlayers, fmtTaipei, fxName, getAudit, getDonations, getPlayerFx, grantFx, nowTaipeiLocal, revokeFx, taipeiIso, voidDonation,
  ZIMO_FX_LIST, type AdminPlayer, type AuditRecord, type DonationRecord, type PlayerFx, type ZimoFxCode,
} from "@/lib/mahjong/zimoFxClient";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import "@/components/mahjong/fxshop/fxshop.css";

type Tab = "donations" | "fx" | "audit";
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
            {([["donations", "斗內紀錄"], ["fx", "玩家特效"], ["audit", "操作紀錄"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} data-admin-tab={id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        </div>
        {tab === "donations" ? <DonationsTab /> : tab === "fx" ? <FxTab /> : <AuditTab />}
      </div>
    </main>
  );
}

/** 找 LINE 玩家：至少 2 字，停手 300ms 才查；結果有頭像、名字、帳號後四碼（同名時分得出來） */
function PlayerSearch({ onPick }: { onPick: (p: AdminPlayer) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminPlayer[] | null>(null);
  const seq = useRef(0);
  const long = Array.from(q.trim()).length >= 2;
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
  const [scope, setScope] = useState<"week" | "all">("week");
  const [data, setData] = useState<{ weekTotal: number; records: DonationRecord[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);
  useEffect(() => {
    let alive = true;
    void getDonations(scope).then((r) => {
      if (!alive) return;
      if (r.ok) { setData(r.data); r.data.records.forEach((d) => names.set(d.userId, d.name)); }
      else setErr(errText(r.error));
    });
    return () => { alive = false; };
  }, [scope, reload]);

  const doVoid = async (id: string) => {
    if (!reason.trim()) return;
    const r = await voidDonation(id, reason.trim());
    if (r.ok) { setVoiding(null); setReason(""); setErr(""); load(); } else setErr(errText(r.error));
  };
  return (
    <>
      <div className="fxs-bar">
        <span className="fxs-muted">本週</span><span className="sum" data-admin-week-total>{data ? nt(data.weekTotal) : "…"}</span>
        <div className="fxs-seg" style={{ marginLeft: "auto" }}>
          {([["week", "本週"], ["all", "全部"]] as const).map(([id, label]) => (
            <button key={id} type="button" className={scope === id ? "on" : ""} aria-pressed={scope === id} onClick={() => setScope(id)}>{label}</button>
          ))}
        </div>
        <button type="button" className="fxs-btn gold" onClick={() => setAdding((v) => !v)} data-admin-add>{adding ? "取消" : "＋ 記一筆"}</button>
      </div>
      {adding && <AddDonation onDone={() => { setAdding(false); load(); }} />}
      {err && <div className="fxs-err">{err}</div>}
      <div className="fxs-list" style={{ marginTop: 12 }} data-admin-records>
        {data?.records.length === 0 && <div className="fxs-empty">沒有紀錄</div>}
        {data?.records.map((d) => (
          <div key={d.id} className={`fxs-rec${d.voided ? " void" : ""}`} data-admin-record={d.id} data-voided={d.voided}>
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
    </>
  );
}

/** 記一筆：選玩家、金額、實收時間、備註 → 確認（重列玩家和金額）→ 送出。只記帳，不開通特效 */
function AddDonation({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState(nowTaipeiLocal);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = Number(amount);
  const valid = !!p && Number.isInteger(n) && n >= 1 && n <= 999999 && !!at;
  const submit = async () => {
    if (!p || !valid || busy) return;
    setBusy(true);
    const r = await addDonation(p.userId, n, taipeiIso(at), note.trim());
    setBusy(false);
    if (r.ok) onDone(); else { setErr(errText(r.error)); setConfirm(false); }
  };
  return (
    <div className="fxs-card" data-admin-add-form>
      <div className="fxs-form">
        <div className="full">{p ? <Chosen p={p} onClear={() => { setP(null); setConfirm(false); }} /> : <PlayerSearch onPick={setP} />}</div>
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
          <FxsAvatar url={p.avatarUrl} name={p.name} /><b>{p.name}・{nt(n)}</b>
          <button type="button" className="fxs-btn gold" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void submit()} data-admin-submit>確定記帳</button>
          <button type="button" className="fxs-btn" onClick={() => setConfirm(false)}>返回修改</button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="fxs-btn gold" disabled={!valid} onClick={() => setConfirm(true)} data-admin-next>下一步</button>
        </div>
      )}
      {err && <div className="fxs-err">{err}</div>}
    </div>
  );
}

/** 玩家特效：選玩家 → 7 種：已開通的可以收回；沒開通的點選後按「開通」（最後點的那種設成使用中） */
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
  const [sel, setSel] = useState<ZimoFxCode[]>([]);
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
    if (r.ok) { setSel([]); setReload((n) => n + 1); } else setErr(errText(r.error ?? ""));
  };
  const grant = () => run(async () => { const r = await grantFx(userId, sel, sel[sel.length - 1]); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  const revoke = (fx?: ZimoFxCode[]) => run(async () => { const r = await revokeFx(userId, fx); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  const active = info?.active ?? {};
  const anyActive = Object.keys(active).length > 0;

  return (
    <>
      {info && (
        <>
          {info.permanent && <div style={{ marginTop: 10 }}><span className="fxs-tag gold" data-admin-permanent>永久全開</span></div>}
          <div className="fxs-fxgrid" data-admin-fxgrid>
            {ZIMO_FX_LIST.map(({ code, name }) => {
              const on = info.permanent || code in active;
              const using = info.selected === code;
              if (on) {
                return (
                  <div key={code} className="fxs-fx on" data-admin-fx={code} data-state="on">
                    {name}
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className="fxs-tag ok">{using ? "使用中" : "已開通"}</span>
                      {!info.permanent && <button type="button" className="fxs-btn sm danger" disabled={busy} onClick={() => void revoke([code])} data-admin-revoke={code}>收回</button>}
                    </span>
                  </div>
                );
              }
              const picked = sel.includes(code);
              return (
                <button key={code} type="button" className={`fxs-fx${picked ? " sel" : ""}`} aria-pressed={picked} data-admin-fx={code} data-state="off"
                  onClick={() => setSel((s) => (picked ? s.filter((x) => x !== code) : [...s, code]))}>
                  {name}
                </button>
              );
            })}
          </div>
          {!info.permanent && (
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              {anyActive && <button type="button" className="fxs-btn danger" disabled={busy} onClick={() => void revoke()} data-admin-revoke-all>全部收回</button>}
              <button type="button" className="fxs-btn gold" disabled={busy || sel.length === 0} onClick={() => void grant()} data-admin-grant>
                開通{sel.length ? ` ${sel.map(fxName).join("、")}` : ""}
              </button>
            </div>
          )}
        </>
      )}
      {err && <div className="fxs-err">{err}</div>}
    </>
  );
}

const fxList = (v: unknown) => (v === "all" ? "全部" : Array.isArray(v) ? v.map((x) => fxName(String(x))).join("、") : fxName(String(v ?? "")));
function auditText(a: AuditRecord): string {
  const who = names.get(a.targetUserId) ?? `#${a.targetUserId.slice(-4)}`;
  const d = a.detail ?? {};
  switch (a.action) {
    case "donation_add": return `記一筆 ${who} ${nt(Number(d.amount) || 0)}`;
    case "donation_void": return `作廢 ${who} ${nt(Number(d.amount) || 0)}${d.reason ? `（${String(d.reason)}）` : ""}`;
    case "fx_grant": return `開通 ${who} ${fxList(d.fx)}`;
    case "fx_revoke": return `收回 ${who} ${fxList(d.fx)}`;
    case "fx_select": return `${who} 換成 ${fxList(d.fx)}`;
    default: return `${a.action} ${who}`;
  }
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
          <span className="t">{fmtTaipei(a.at)}</span><span>{auditText(a)}</span>
        </div>
      ))}
    </div>
  );
}
