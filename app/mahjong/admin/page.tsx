"use client";
// 斗內後台（老馬 2026-10-31；老柯對接格式第 2 節，小宜〈自摸特效庫與斗內系統〉3、6.2）：只有老闆帳號。
// 權限在伺服器：先打一次後台 API，401／403 就只顯示「沒有權限」，不顯示任何資料（直接打網址也一樣）。
// 四個分頁：斗內紀錄（記一筆＝兩步確認、作廢要填原因；自動帶入應斗、預覽抵扣）、自摸次數（應斗、清除）、玩家特效（開通／收回）、操作紀錄。
// 自摸次數與自動抵扣（小宜〈斗內卡收起與後台自摸次數〉v2、老柯 API 格式；老闆 2026-10-31：剩的繼續欠、多的算打賞、一次 NT$10）
// 老闆 2026-10-31：文字越少越好——不顯示有效日期、到期、說明文字；沒有匿名。
import { useCallback, useEffect, useRef, useState } from "react";
import { useMjAuth } from "@/hooks/useMjAuth";
import {
  addDonation, deductPreview, findPlayers, fmtTaipei, fxName, getAudit, getDonations, getPlayerFx, getZimoCounts, grantFx, nowTaipeiLocal, revokeFx,
  taipeiIso, voidDonation, ZIMO_FX_LIST, ZIMO_UNIT, type AdminPlayer, type AuditRecord, type DonationRecord, type PlayerFx, type ZimoCountRow, type ZimoFxCode,
} from "@/lib/mahjong/zimoFxClient";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import "@/components/mahjong/fxshop/fxshop.css";

type Tab = "donations" | "zimo" | "fx" | "audit";
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
            {([["donations", "斗內紀錄"], ["zimo", "自摸次數"], ["fx", "玩家特效"], ["audit", "操作紀錄"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} data-admin-tab={id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        </div>
        {tab === "donations" ? <DonationsTab /> : tab === "zimo" ? <ZimoTab /> : tab === "fx" ? <FxTab /> : <AuditTab />}
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

function Chosen({ p, onClear, due }: { p: AdminPlayer; onClear: () => void; due?: ZimoCountRow | null }) {
  return (
    <div className="fxs-chosen" data-admin-chosen={p.name}>
      <FxsAvatar url={p.avatarUrl} name={p.name} /><b>{p.name}</b><span className="fxs-muted">#{p.shortId}</span>
      <button type="button" className="fxs-btn sm" onClick={onClear}>換人</button>
      {due && due.count > 0 && <span className="due" data-admin-due={due.count}>應斗 <b>{nt(due.owed)}</b>・{due.count} 次</span>}
    </div>
  );
}

/** 抵扣預覽：應斗 NT$80 − NT$50 → 剩 NT$30（3 次）／歸零／打賞（小宜規格 v2 3.9 的表） */
function DeductLine({ count, amount }: { count: number; amount: number }) {
  const d = deductPreview(count, amount);
  if (count <= 0) return <div className="fxs-deduct" data-admin-deduct="tip"><span className="fxs-tag gold">打賞 {nt(d.tip)}</span></div>;
  return (
    <div className="fxs-deduct" data-admin-deduct={d.remaining > 0 ? "left" : "zero"}>
      <span className="k">應斗</span><span>{nt(count * ZIMO_UNIT)}</span><span className="op">−</span><span>{nt(amount)}</span><span className="op">→</span>
      {d.remaining > 0 ? <span className="left">剩 {nt(d.remaining * ZIMO_UNIT)}（{d.remaining} 次）</span> : <span className="fxs-tag ok">歸零</span>}
      {d.tip > 0 && <span className="fxs-tag gold">打賞 {nt(d.tip)}</span>}
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
  const [toast, showToast] = useToast();
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
      {adding && <AddDonation onDone={(m) => { setAdding(false); load(); showToast(m); }} />}
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
      {toast}
    </>
  );
}

/** 記一筆：選玩家（自動帶入應斗）、金額、實收時間、備註 → 確認（重列玩家、金額和抵扣結果）→ 送出。只記帳，不開通特效；抵扣由伺服器在同一個交易裡算 */
function AddDonation({ onDone }: { onDone: (msg: string) => void }) {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [due, setDue] = useState<ZimoCountRow | null>(null);
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState(false); // 老闆自己改過金額：之後不再被應斗覆蓋（換人才重新帶入）
  const [at, setAt] = useState(nowTaipeiLocal);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = Number(amount);
  const valid = !!p && Number.isInteger(n) && n >= 1 && n <= 999999 && !!at;
  // 選好人：查他目前的次數和應斗，金額欄帶入應斗（0 次就留空）
  useEffect(() => {
    if (!p) { setDue(null); return; }
    let alive = true;
    void getZimoCounts().then((r) => {
      if (!alive) return;
      const row = r.ok ? r.data.players.find((x) => x.userId === p.userId) ?? null : null;
      setDue(row);
      if (!typed) setAmount(row && row.owed > 0 ? String(row.owed) : "");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在換人時查、帶入
  }, [p?.userId]);
  const pick = (x: AdminPlayer | null) => { setP(x); setTyped(false); setConfirm(false); if (!x) setAmount(""); };
  const count = due?.count ?? 0;
  const submit = async () => {
    if (!p || !valid || busy) return;
    setBusy(true);
    const r = await addDonation(p.userId, n, taipeiIso(at), note.trim());
    setBusy(false);
    // 提示只寫金額不寫次數（記帳時剛好又自摸的話，實際抵扣以伺服器為準，避免數字對不上）
    if (r.ok) onDone(`已記一筆 ${p.name} ${nt(n)}`); else { setErr(errText(r.error)); setConfirm(false); }
  };
  return (
    <div className="fxs-card" data-admin-add-form>
      <div className="fxs-form">
        <div className="full">{p ? <Chosen p={p} due={due} onClear={() => pick(null)} /> : <PlayerSearch onPick={pick} />}</div>
        <label>金額
          <input className="fxs-in" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 6)); setTyped(true); setConfirm(false); }} data-admin-amount />
        </label>
        <label>時間
          <input className="fxs-in" type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setConfirm(false); }} data-admin-at />
        </label>
        <label className="full">備註
          <input className="fxs-in" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} data-admin-note />
        </label>
      </div>
      {!confirm && valid && due !== undefined && <DeductLine count={count} amount={n} />}
      {confirm && p ? (
        <div className="fxs-confirm" data-admin-confirm>
          <FxsAvatar url={p.avatarUrl} name={p.name} /><b>{p.name}・{nt(n)}</b>
          <button type="button" className="fxs-btn gold" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void submit()} data-admin-submit>確定記帳</button>
          <button type="button" className="fxs-btn" onClick={() => setConfirm(false)}>返回修改</button>
          <DeductLine count={count} amount={n} />
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

/** 底部提示（2.4 秒消失） */
function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => { setMsg(m); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setMsg(""), 2400); }, []);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [msg ? <div className="fxs-toast" role="status" data-admin-toast>✓ {msg}</div> : null, show] as const;
}

/** 自摸次數：每人一列（頭像、名字、上次減少的方式和時間、次數、應斗）；搜尋、排序在前端做。老闆 2026-10-31：次數只靠記一筆自動抵扣，拿掉清除 */
function ZimoTab() {
  const [rows, setRows] = useState<ZimoCountRow[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [desc, setDesc] = useState(true);
  const [err, setErr] = useState("");
  const sortIds = (list: ZimoCountRow[], d: boolean) =>
    [...list].sort((a, b) => (d ? b.count - a.count : a.count - b.count) || a.name.localeCompare(b.name, "zh-Hant")).map((r) => r.userId);
  const load = useCallback(async (d: boolean) => {
    const r = await getZimoCounts();
    if (!r.ok) { setErr(errText(r.error)); return; }
    r.data.players.forEach((x) => names.set(x.userId, x.name));
    setRows(r.data.players); setOrder(sortIds(r.data.players, d)); setErr("");
  }, []);
  useEffect(() => { void load(true); }, [load]);
  const flip = () => { const d = !desc; setDesc(d); if (rows) setOrder(sortIds(rows, d)); };

  const byId = new Map(rows?.map((r) => [r.userId, r]) ?? []);
  const key = q.trim().toLowerCase();
  const shown = order.map((id) => byId.get(id)!).filter((r) => r && (!key || r.name.toLowerCase().includes(key)));
  return (
    <>
      <div className="fxs-zbar">
        <input className="fxs-in" placeholder="搜尋 LINE 名稱" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋 LINE 名稱" data-admin-zsearch />
        <button type="button" className="fxs-sort" onClick={flip} aria-label={`依次數排序，目前${desc ? "多到少" : "少到多"}`} data-admin-zsort={desc ? "desc" : "asc"}>
          次數 <span className="arr">{desc ? "↓" : "↑"}</span>
        </button>
      </div>
      {err && <div className="fxs-err">{err}</div>}
      {!rows && !err && <span className="fxs-muted">讀取中…</span>}
      <div className="fxs-list" data-admin-zlist>
        {rows && rows.length === 0 && <div className="fxs-empty">沒有紀錄</div>}
        {rows && rows.length > 0 && shown.length === 0 && <div className="fxs-empty">找不到</div>}
        {shown.map((r) => (
          <div key={r.userId} className={`fxs-zc${r.count === 0 ? " zero" : ""}`} data-admin-zrow={r.name} data-count={r.count}>
            <FxsAvatar url={r.avatarUrl} name={r.name} />
            <div className="who">
              <b>{r.name}</b>
              <span className="rs">
                {r.lastResetSource === "donation" ? <span className="fxs-tag gold sm">斗內</span> : r.lastResetSource === "clear" ? <span className="fxs-tag clr sm">清除</span> : r.lastResetSource === "system" ? <span className="fxs-tag clr sm">系統重置</span> : null}
                {r.lastResetAt != null ? fmtTaipei(r.lastResetAt) : "—"}
              </span>
            </div>
            <div className="nb">
              <span className="n">{r.count}<small>次</small></span>
              {r.count > 0 && <span className="owe">應斗 <b>{nt(r.owed)}</b></span>}
            </div>
          </div>
        ))}
      </div>
    </>
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
    case "zimo_clear": return `清除 ${who} 自摸 ${Number(d.cleared) || 0} 次`;
    case "zimo_reset_all": return `系統重置：全部玩家自摸次數從 11/1 起從 0 開始（${Number(d.users) || 0} 人、共 ${Number(d.cleared) || 0} 次，舊紀錄保留）`;
    case "donation_void": return `作廢 ${who} ${nt(Number(d.amount) || 0)}${d.reason ? `（${String(d.reason)}）` : ""}`;
    case "fx_grant": return `開通 ${who} ${fxList(d.fx)}`;
    case "fx_revoke": return `收回 ${who} ${fxList(d.fx)}`;
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
          <span className="t">{fmtTaipei(a.at)}</span><span>{auditText(a)}{a.action === "donation_add" && <span className="s">{deductNote(a.detail ?? {})}</span>}</span>
        </div>
      ))}
    </div>
  );
}
