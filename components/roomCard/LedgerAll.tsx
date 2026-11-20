"use client";
// 房卡後台「流水帳」頁籤（小宜〈房卡 v1.2〉4-4 後半；API：老柯〈房卡第二批〉第 1 節 GET /api/admin/cards/ledger/all）
//   統計格（期間、充值、扣卡、回收；不受種類影響）、篩選種類（全部／充值／扣卡／回收）和期間（今天／本週／本月／全部）、
//   列比玩家明細多一欄「玩家」、最下面「載入更多」。相鄰、同人同房的扣卡在畫面上併成一列（ledgerRows.groupLedger）。
//   「斗內欠款轉房卡」那 26 筆（actorKind＝donate_debt）內容欄用標籤標出來，和老闆手動回收分得開。
// 帳號綁定：頁面用 key＝帳號 id 掛這個元件，換人就整個重來；切篩選時舊的回應晚到也不寫回（seq 比對）
import { useEffect, useRef, useState } from "react";
import { fmtAt, fmtCards, getLedgerAll, type LedgerAllEntry, type LedgerAllPage, type LedgerKind, type LedgerPeriod } from "./client";
import { groupLedger, periodLabel } from "./ledgerRows";

const GAME: Record<string, string> = { mahjong: "麻將", thirteen: "十三支" };
const UNIT: Record<string, string> = { mahjong: "把", thirteen: "局" };
const KIND: Record<LedgerKind, [string, string]> = {
  topup: ["充值", "ok"], charge: ["扣卡", "gold"], reclaim: ["回收", "clr"], suspend: ["暫停", "void"], resume: ["恢復", "ok"],
};
const KINDS: [LedgerKind | null, string][] = [[null, "全部"], ["topup", "充值"], ["charge", "扣卡"], ["reclaim", "回收"]];
const PERIODS: [LedgerPeriod, string][] = [["today", "今天"], ["week", "本週"], ["month", "本月"], ["all", "全部"]];

type Data = { stats: LedgerAllPage["stats"]; serverNow: number; entries: LedgerAllEntry[]; next: string | null };

export default function LedgerAll() {
  const [kind, setKind] = useState<LedgerKind | null>(null);
  const [period, setPeriod] = useState<LedgerPeriod>("week");
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const load = async (cursor: string | null) => {
    const my = ++seq.current;
    setBusy(true); setFailed(false);
    const r = await getLedgerAll({ kind, period, cursor });
    if (my !== seq.current) return; // 篩選已經換了：舊的回應丟掉
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    setData((prev) => ({
      stats: r.data.stats, serverNow: r.data.serverNow, next: r.data.nextCursor,
      entries: cursor && prev ? [...prev.entries, ...r.data.entries] : r.data.entries,
    }));
  };
  // 換篩選：清掉舊的列，從第一頁重讀
  useEffect(() => {
    setData(null); setOpen(null);
    void load(null);
    const s = seq;
    return () => { s.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load 只依賴 kind、period
  }, [kind, period]);

  const s = data?.stats;
  return (
    <div data-rc-ledger-all>
      <div className="rc-sum" data-rc-ledger-sum>
        <div className="cell"><span>期間</span><b className="sm">{data ? periodLabel(period, data.serverNow) : "—"}</b></div>
        <div className="cell pos"><span>充值</span><b data-rc-stat="topup">{s ? (s.topup ? `+${s.topup}` : "0") : "—"}</b></div>
        <div className="cell neg"><span>扣卡</span><b data-rc-stat="charge">{s ? fmtCards(-s.charge) : "—"}</b></div>
        <div className="cell"><span>回收</span><b data-rc-stat="reclaim">{s ? fmtCards(-s.reclaim) : "—"}</b></div>
      </div>
      <div className="fxs-bar rc-filters">
        <div className="fxs-seg" role="group" aria-label="種類">
          {KINDS.map(([k, n]) => <button key={n} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)} data-rc-lk={k ?? "all"}>{n}</button>)}
        </div>
        <div className="fxs-seg" role="group" aria-label="期間">
          {PERIODS.map(([p, n]) => <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)} data-rc-lp={p}>{n}</button>)}
        </div>
      </div>
      <div className="rc-l all hd"><span>時間</span><span>種類</span><span>玩家</span><span>內容</span><span className="r">張數</span><span className="r">餘額</span></div>
      <div className="fxs-list" data-rc-ledger-rows>
        {data === null ? (failed ? null : <span className="fxs-muted">讀取中…</span>)
          : data.entries.length === 0 ? <div className="fxs-empty">沒有紀錄</div>
            : groupLedger(data.entries).map((r) => r.kind === "one"
              ? <Row key={r.e.cursor} e={r.e} />
              : (
                <div key={r.key} className="rc-grp">
                  <Row e={r.first} group={{ count: r.items.length, cards: r.cards, open: open === r.key, toggle: () => setOpen(open === r.key ? null : r.key) }} />
                  {open === r.key && r.items.map((x) => <Row key={x.cursor} e={x} sub />)}
                </div>
              ))}
      </div>
      <div className="fxs-empty rc-more">
        {failed ? <span className="fxs-err" role="alert">讀不到資料 <button type="button" className="fxs-btn sm" onClick={() => void load(data?.next ?? null)}>重試</button></span>
          : data?.next ? <button type="button" className="fxs-btn sm" disabled={busy} onClick={() => void load(data.next)} data-rc-more>{busy ? "讀取中…" : "載入更多"}</button>
            : null}
      </div>
    </div>
  );
}

function Row({ e, group, sub }: { e: LedgerAllEntry; group?: { count: number; cards: number; open: boolean; toggle: () => void }; sub?: boolean }) {
  const [label, tone] = KIND[e.kind];
  const unit = UNIT[e.game ?? ""] ?? "把";
  const cards = group ? group.cards : e.cards;
  const desc = sub ? `第 ${e.handNo} ${unit}`
    : e.kind === "charge" ? (group ? <>{group.open ? "▾ " : "▸ "}{GAME[e.game ?? ""] ?? e.game} 房 {e.roomCode}<small>{group.count} {unit}</small></> : `${GAME[e.game ?? ""] ?? e.game} 房 ${e.roomCode} 第 ${e.handNo} ${unit}`)
      : e.actorKind === "donate_debt" ? <span className="fxs-tag gold sm rc-debt" data-rc-donate-debt>{e.actor}</span>
        : e.actorKind === "system" ? "系統" : "老闆";
  const cells = (
    <>
      <span className="t">{sub ? "" : fmtAt(e.at)}</span>
      <span>{sub ? "" : <span className={`fxs-tag ${tone} sm`}>{label}</span>}</span>
      <span className="w">{sub ? "" : e.name}</span>
      <span className="d">{desc}</span>
      <span className={`dl${cards === null ? "" : cards > 0 ? " pos" : " neg"}`}>{cards === null ? "" : cards > 0 ? `+${cards}` : fmtCards(cards)}</span>
      <span className="af">{sub || e.balanceAfter === null ? "" : `餘 ${fmtCards(e.balanceAfter)}`}</span>
    </>
  );
  if (group) return <button type="button" className="rc-l all grp" aria-expanded={group.open} onClick={group.toggle} data-rc-entry="charge-group">{cells}</button>;
  return <div className={`rc-l all${sub ? " sub" : ""}`} data-rc-entry={sub ? "charge-hand" : e.kind}>{cells}</div>;
}
