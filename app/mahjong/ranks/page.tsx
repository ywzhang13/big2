"use client";
// 排行榜（老馬 2026-10-31；小宜〈輸贏排行榜-UIUX實作規格〉）：左上切「輸贏／斗內」、右上切「本週／總輸贏（總斗內）」，預設「輸贏・本週」。
// 網址 /mahjong/ranks?type=win|donate&range=week|all，切換時 replaceState，重新整理還在同一頁。不用登入；有登入時自己那列標金色，捲出畫面就釘在底部。
// 老闆 2026-10-31：文字越少越好；輸贏只寫「分」不寫 NT$。
import { useEffect, useRef, useState } from "react";
import { getLeaderboard, getScoreBoard } from "@/lib/mahjong/zimoFxClient";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import "@/components/mahjong/fxshop/fxshop.css";

type Kind = "win" | "donate";
type Range = "week" | "all";
/** 兩種榜共用的一列：value＝分數或金額 */
interface Row { rank: number; name: string; avatarUrl: string | null; value: number; me: boolean }

const KINDS: [Kind, string][] = [["win", "輸贏"], ["donate", "斗內"]];
const scoreText = (n: number) => { const a = Math.abs(n).toLocaleString("en-US"); return n > 0 ? `+${a}` : n < 0 ? `−${a}` : "0"; };
const scoreClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");

async function load(kind: Kind, range: Range): Promise<Row[] | null> {
  if (kind === "win") {
    const r = await getScoreBoard(range);
    return r.ok ? r.rows.map((x) => ({ rank: x.rank, name: x.name, avatarUrl: x.avatarUrl, value: x.score, me: x.me === true })) : null;
  }
  const r = await getLeaderboard(range);
  return r.ok ? r.rows.map((x) => ({ rank: x.rank, name: x.name, avatarUrl: x.avatarUrl, value: x.amount, me: x.me === true })) : null;
}

function RowBody({ r, kind }: { r: Row; kind: Kind }) {
  return (
    <>
      <span className="rk">{r.rank}</span>
      <FxsAvatar url={r.avatarUrl} name={r.name} />
      <span className="nm">{r.name}</span>
      {kind === "win"
        ? <span className={`sc ${scoreClass(r.value)}`} data-score={r.value}>{scoreText(r.value)}<small>分</small></span>
        : <span className="amt">NT${r.value.toLocaleString("en-US")}</span>}
    </>
  );
}

export default function MahjongRanksPage() {
  // 先讀網址再抓資料（null＝還沒讀），避免先抓預設那一頁又換掉
  const [sel, setSel] = useState<{ kind: Kind; range: Range } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [pin, setPin] = useState(false);
  const meRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSel({ kind: q.get("type") === "donate" ? "donate" : "win", range: q.get("range") === "all" ? "all" : "week" });
  }, []);
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    void load(sel.kind, sel.range).then((r) => { if (!alive) return; setFailed(r == null); setRows(r); });
    return () => { alive = false; };
  }, [sel, tries]);

  // 自己那列看不到時才釘在底部
  const me = rows?.find((r) => r.me) ?? null;
  useEffect(() => {
    const el = meRef.current;
    if (!me || !el) { setPin(false); return; }
    const io = new IntersectionObserver(([e]) => setPin(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [me]);

  const go = (next: { kind: Kind; range: Range }) => {
    if (sel && next.kind === sel.kind && next.range === sel.range) return;
    setRows(null); setFailed(false); setSel(next);
    window.history.replaceState(null, "", `/mahjong/ranks?type=${next.kind}&range=${next.range}`);
  };
  const backToMe = () => meRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const kind = sel?.kind ?? "win", range = sel?.range ?? "week";
  const isTop = (r: Row) => r.rank <= 3 && (kind === "donate" || r.value > 0); // 輸贏榜的金框只給正分

  return (
    <main className="fxs" data-ranks-page data-kind={kind} data-range={range}>
      <div className="fxs-wrap">
        <div className="fxs-top">
          <button type="button" className="fxs-btn" onClick={() => { window.location.href = "/mahjong"; }} data-fxs-back>返回</button>
          <div className="fxs-kind" role="tablist" aria-label="排行榜種類">
            {KINDS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? "on" : ""} data-rank-kind={id}
                onClick={() => go({ kind: id, range })}>{label}</button>
            ))}
          </div>
          <div className="fxs-tabs" role="tablist">
            {([["week", "本週"], ["all", kind === "win" ? "總輸贏" : "總斗內"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={range === id} className={range === id ? "on" : ""} data-board-tab={id}
                onClick={() => go({ kind, range: id })}>{label}</button>
            ))}
          </div>
        </div>
        {failed ? (
          <div className="fxs-empty">
            讀取失敗
            <div style={{ marginTop: 12 }}><button type="button" className="fxs-btn" onClick={() => { setFailed(false); setRows(null); setTries((n) => n + 1); }}>重試</button></div>
          </div>
        ) : rows == null ? (
          <div className="fxs-empty">讀取中…</div>
        ) : rows.length === 0 ? (
          <div className="fxs-empty" data-board-empty>
            {kind === "win" ? (range === "week" ? "本週還沒有對局" : "還沒有對局") : (range === "week" ? "本週還沒有斗內" : "還沒有斗內")}
          </div>
        ) : (
          <ol className={`fxs-board${me ? " pinpad" : ""}`} style={{ listStyle: "none", margin: 0, paddingLeft: 0 }}>
            {rows.map((r, i) => (
              <li key={i} ref={r === me ? meRef : undefined} className={`fxs-row${isTop(r) ? " top" : ""}${r.me ? " me" : ""}`} data-board-row={r.rank} data-me={r.me || undefined}>
                <RowBody r={r} kind={kind} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {me && pin && (
        <button type="button" className={`fxs-row me fxs-me-pin${isTop(me) ? " top" : ""}`} onClick={backToMe} aria-label="捲到我的名次" data-me-pin>
          <RowBody r={me} kind={kind} />
        </button>
      )}
    </main>
  );
}
