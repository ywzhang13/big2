"use client";
// 三款共用的開房、加入、取名、等人（小宜〈共用開房流程 v1.1〉2026-11-19）。
//   各遊戲自己放：品牌區（brand）、右上角帳號列（top）、送 API；這裡不能引用登入程式（大老二頁面不能有 LINE 登入入口）
//   畫面只放標題、欄位、按鈕，不放說明字（老闆）
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cutName, validName } from "./name";
import "./gameLobby.css";

// ---------------------------------------------------------------------------- 暱稱欄
export function NameField({ value, fromLine, onChange, onEnter }: {
  value: string;
  /** LINE 帶入、還沒改過：欄位右邊顯示「● LINE 名稱」 */
  fromLine: boolean;
  onChange: (v: string) => void;
  onEnter?: () => void;
}) {
  const composing = useRef(false);
  return (
    <div className="gl-field gl-name">
      <input className="gl-in" data-gl-name placeholder="暱稱" aria-label="暱稱" value={value} autoComplete="off"
        // 輸入時就擋住第 9 個字；注音、拼音組字中先不切，組完再切（不然組字會被打斷）
        onChange={(e) => onChange(composing.current ? e.target.value : cutName(e.target.value))}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(e) => { composing.current = false; onChange(cutName(e.currentTarget.value)); }}
        onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300); }} // 手機叫出鍵盤：捲到畫面中間（同麻將）
        onKeyDown={(e) => { if (e.key === "Enter" && !composing.current) onEnter?.(); }} />
      {fromLine && <span className="gl-line" data-gl-line><i />LINE 名稱</span>}
    </div>
  );
}

/** 暱稱欄的狀態：預設值由遊戲給（game_name → LINE 名稱前 8 個字 → 空白）；一改字「● LINE 名稱」就消失 */
export function useNameInput(initial: { name: string; fromLine: boolean }) {
  const [name, setName] = useState(initial.name);
  const [fromLine, setFromLine] = useState(initial.fromLine);
  return { name, fromLine, valid: validName(name), onChange: (v: string) => { setName(v); setFromLine(false); } };
}

// ---------------------------------------------------------------------------- 開房
export type LobbySection =
  | { kind: "single"; key: string; title: string; cols: number; options: number[]; unit?: string; value: number }
  | { kind: "custom"; key: string; title: string; cols: number; options: number[]; unit?: string; value: number; min: number; max: number }
  | { kind: "stepper"; key: string; title: string; min: number; max: number; step: number; unit: string; value: number; normalize?: (n: number) => number };

/** 自訂的數字：只收範圍內的整數，其他（空白、小數、文字）回 null */
export function parseCustom(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

type SectionState = { value: number; custom: boolean; text: string };
/** 每張卡現在的值：自訂不合法回 null（建立房間不能按） */
export function sectionValue(s: LobbySection, st: SectionState): number | null {
  if (s.kind === "custom" && st.custom) return parseCustom(st.text, s.min, s.max);
  if (s.kind === "stepper") return st.text === "" ? null : clamp((s.normalize ?? ((n) => n))(Number(st.text) || s.min), s.min, s.max);
  return st.value;
}

function SectionCard({ s, st, set }: { s: LobbySection; st: SectionState; set: (p: Partial<SectionState>) => void }) {
  if (s.kind === "stepper") {
    const v = sectionValue(s, st) ?? s.value;
    const fix = (n: number) => String(clamp((s.normalize ?? ((x) => x))(n), s.min, s.max));
    return (
      <div className="gl-card" data-gl-card={s.key}>
        <h4>{s.title}</h4>
        <div className="gl-step">
          <button type="button" className="gl-opt" data-gl-minus={s.key} aria-label={`減 ${s.step} ${s.unit}`} disabled={v <= s.min} onClick={() => set({ text: fix(v - s.step) })}>−</button>
          <label className="gl-opt on">
            <input data-gl-step={s.key} inputMode="numeric" aria-label={s.title} value={st.text}
              onChange={(e) => set({ text: e.target.value.replace(/\D/g, "").slice(0, String(s.max).length) })}
              onBlur={() => set({ text: fix(Number(st.text) || s.min) })} />
            <span>{s.unit}</span>
          </label>
          <button type="button" className="gl-opt" data-gl-plus={s.key} aria-label={`加 ${s.step} ${s.unit}`} disabled={v >= s.max} onClick={() => set({ text: fix(v + s.step) })}>＋</button>
        </div>
      </div>
    );
  }
  const custom = s.kind === "custom" && st.custom;
  return (
    <div className="gl-card" data-gl-card={s.key}>
      <h4>{s.title}</h4>
      <div className="gl-opts" style={{ gridTemplateColumns: `repeat(${s.cols}, 1fr)` }}>
        {s.options.map((o) => (
          <button type="button" key={o} className={`gl-opt${!custom && st.value === o ? " on" : ""}`} data-gl-opt={`${s.key}:${o}`} aria-pressed={!custom && st.value === o}
            onClick={() => set({ value: o, custom: false })}>{o}{s.unit ?? ""}</button>
        ))}
        {s.kind === "custom" && (custom ? (
          <input className={`gl-opt on${sectionValue(s, st) === null ? " bad" : ""}`} data-gl-custom={s.key} inputMode="numeric" aria-label={`自訂${s.title}`} autoFocus value={st.text}
            onChange={(e) => set({ text: e.target.value.slice(0, 8) })} /> // 照原樣交給 parseCustom 判斷（不偷刪字元：12.5 不會變成 125）
        ) : (
          <button type="button" className="gl-opt" data-gl-custom-on={s.key} onClick={() => set({ custom: true })}>自訂</button>
        ))}
      </div>
    </div>
  );
}

export function CreateRoomShell({ brand, top, className = "", sections, initialName, busy, error, onCreate, onBack, attrs }: {
  brand: ReactNode;
  top?: ReactNode;
  className?: string;
  sections: LobbySection[];
  initialName: { name: string; fromLine: boolean };
  busy: boolean;
  error: string;
  /** 「代號 → 值」和送出的名字（去掉前後空白），遊戲自己送 API */
  onCreate: (values: Record<string, number>, name: string) => void;
  onBack: () => void;
  attrs?: Record<string, string>;
}) {
  const nm = useNameInput(initialName);
  const [st, setSt] = useState<Record<string, SectionState>>(() => Object.fromEntries(sections.map((s) => [s.key, { value: s.value, custom: false, text: String(s.value) }])));
  const values = Object.fromEntries(sections.map((s) => [s.key, sectionValue(s, st[s.key])]));
  const ok = !!nm.valid && Object.values(values).every((v) => v !== null);
  const go = () => { if (ok && !busy) onCreate(values as Record<string, number>, nm.valid!); };
  const has = sections.length > 0;
  return (
    <div className={`gl${has ? " has-set" : ""} ${className}`} data-gl="create" {...attrs}>
      {top}
      <div className="gl-brand">{brand}</div>
      {has && <div className="gl-set">{sections.map((s) => <SectionCard key={s.key} s={s} st={st[s.key]} set={(p) => setSt((cur) => ({ ...cur, [s.key]: { ...cur[s.key], ...p } }))} />)}</div>}
      <div className="gl-col">
        <NameField value={nm.name} fromLine={nm.fromLine} onChange={nm.onChange} onEnter={go} />
        <button type="button" className="gl-btn gl-go" data-gl-go="create" disabled={!ok || busy} onClick={go}>{busy ? "建立中…" : "建立房間"}</button>
        {error && <p className="gl-err" role="alert">{error}</p>}
        <button type="button" className="gl-back" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- 加入、邀請連結取名
export function JoinByCode({ brand, top, className = "", initialName, busy, error, onJoin, onBack }: {
  brand: ReactNode;
  top?: ReactNode;
  className?: string;
  initialName: { name: string; fromLine: boolean };
  busy: boolean;
  error: string;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}) {
  const nm = useNameInput(initialName);
  const [code, setCode] = useState("");
  const ok = /^\d{4}$/.test(code) && !!nm.valid;
  const go = () => { if (ok && !busy) onJoin(code, nm.valid!); };
  return (
    <div className={`gl ${className}`} data-gl="join">
      {top}
      <div className="gl-brand">{brand}</div>
      <div className="gl-col">
        <input className="gl-in code" data-gl-code inputMode="numeric" maxLength={4} placeholder="房號" aria-label="房號" value={code} autoComplete="off"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        <NameField value={nm.name} fromLine={nm.fromLine} onChange={nm.onChange} onEnter={go} />
        <button type="button" className="gl-btn gl-go" data-gl-go="join" disabled={!ok || busy} onClick={go}>{busy ? "加入中…" : "加入"}</button>
        {error && <p className="gl-err" role="alert">{error}</p>}
        <button type="button" className="gl-back" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}

/** 點邀請連結進來、這台還沒存過名字（第一次）才出現；有名字就直接入座，不經過這頁 */
export function InviteNamePrompt({ brand, top, className = "", code, initialName, busy, error, onJoin, onBack }: {
  brand: ReactNode;
  top?: ReactNode;
  className?: string;
  code: string;
  initialName: { name: string; fromLine: boolean };
  busy: boolean;
  error: string;
  onJoin: (name: string) => void;
  onBack?: () => void;
}) {
  const nm = useNameInput(initialName);
  const go = () => { if (nm.valid && !busy) onJoin(nm.valid); };
  return (
    <div className={`gl ${className}`} data-gl="invite">
      {top}
      <div className="gl-brand">{brand}</div>
      <div className="gl-col">
        <h2 className="gl-ttl">加入房間<b>{code}</b></h2>
        <NameField value={nm.name} fromLine={nm.fromLine} onChange={nm.onChange} onEnter={go} />
        <button type="button" className="gl-btn gl-go" data-gl-go="invite" disabled={!nm.valid || busy} onClick={go}>{busy ? "加入中…" : "加入"}</button>
        {error && <p className="gl-err" role="alert">{error}</p>}
        {error && onBack && <button type="button" className="gl-back" onClick={onBack}>返回</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- 等人
export type WaitingSeat = { seat: number; name: string; avatarUrl?: string | null; me: boolean; host: boolean };

function SeatRow({ p }: { p: WaitingSeat | undefined }) {
  if (!p) return <div className="gl-seat empty" data-gl-seat="" />;
  return (
    <div className={`gl-seat${p.me ? " me" : ""}`} data-gl-seat={p.seat}>
      <span className="av">{Array.from(p.name)[0] ?? ""}{p.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- LINE 頭像是外部網址
        <img src={p.avatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}</span>
      <span className="nm">{p.name}</span>
      {p.host && <span className="gl-tag host">房主</span>}
    </div>
  );
}

export function WaitingRoom({ className = "", code, inviteUrl, summary, seats, isHost, full = false, onStart, onLeave }: {
  className?: string;
  code: string;
  inviteUrl: string;
  /** 設定摘要（十三支「8局」「理牌 45 秒」「底分 100」；沒有就不出現這一排） */
  summary: string[];
  /** 座位 0～3 上的人（空位不給） */
  seats: WaitingSeat[];
  isHost: boolean;
  /** 進來時房間已滿、自己不在裡面 */
  full?: boolean;
  onStart: () => Promise<{ ok: boolean; message?: string }>;
  onLeave: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);
  const n = seats.length;
  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, setBusy: (b: boolean) => void, fail: string) => {
    setBusy(true); setMsg("");
    try { const r = await fn(); if (!r.ok) setMsg(r.message ?? fail); } catch { setMsg(fail); } finally { setBusy(false); }
  };
  return (
    <div className={`gl wait ${className}`} data-gl="wait">
      <div className="gl-col a">
        <div className="gl-code">
          <small>房號</small>
          <b data-gl-room>{code}</b>
          <button type="button" className={`gl-copy${copied ? " ok" : ""}`} data-gl-copy
            onClick={() => { void navigator.clipboard?.writeText(inviteUrl).then(() => setCopied(true), () => {}); }}>{copied ? "已複製" : "複製邀請連結"}</button>
        </div>
        {summary.length > 0 && <div className="gl-chips">{summary.map((s) => <span key={s}>{s}</span>)}</div>}
        <div className="gl-leave">
          <button type="button" className="gl-btn line" data-gl-leave disabled={leaving} onClick={() => run(onLeave, setLeaving, "現在不能退出")}>
            {full ? "返回" : leaving ? "退出中…" : "退出房間"}
          </button>
          {msg && <p className="gl-err" role="alert" style={{ marginTop: 6 }}>{msg}</p>}
        </div>
      </div>
      <div className="gl-col b">
        <div className="gl-seats">{[0, 1, 2, 3].map((i) => <SeatRow key={i} p={seats.find((s) => s.seat === i)} />)}</div>
        <div className="gl-act">
          {full ? <p className="gl-err full" role="alert">房間已滿</p>
            : n < 4 ? <div className="gl-btn mute" data-gl-status>等待玩家 {n}/4</div>
            : isHost ? <button type="button" className="gl-btn" data-gl-start disabled={starting} onClick={() => run(onStart, setStarting, "開局失敗")}>{starting ? "開始中…" : "開始遊戲"}</button>
            : <div className="gl-btn mute" data-gl-status>等待房主開始</div>}
        </div>
      </div>
    </div>
  );
}

