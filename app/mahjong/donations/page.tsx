"use client";
// 公開斗內排行榜（老馬 2026-10-31；老柯對接格式第 3 節）：「本週」「總斗內」兩個頁籤（預設本週），每列只有名次、頭像、名字、金額（沒有帳號 id）。
// 老闆 2026-10-31：文字越少越好——不放日期區間、「每週一歸零」、感謝回饋之類的說明；沒有匿名。不用登入。
import { useEffect, useState } from "react";
import { getLeaderboard, type BoardRow } from "@/lib/mahjong/zimoFxClient";
import { FxsAvatar } from "@/components/mahjong/fxshop/FxsAvatar";
import "@/components/mahjong/fxshop/fxshop.css";

export default function MahjongDonationsPage() {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [tab, setTab] = useState<"week" | "all">("week");
  useEffect(() => {
    let alive = true;
    void getLeaderboard(tab).then((r) => { if (!alive) return; setFailed(!r.ok); if (r.ok) setRows(r.rows); });
    return () => { alive = false; };
  }, [tab, tries]);

  return (
    <main className="fxs" data-donations-page>
      <div className="fxs-wrap">
        <div className="fxs-top">
          <button type="button" className="fxs-btn" onClick={() => { window.location.href = "/mahjong"; }} data-fxs-back>返回</button>
          <h1>斗內榜</h1>
          <div className="fxs-tabs" role="tablist">
            {([["week", "本週"], ["all", "總斗內"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} data-board-tab={id}
                onClick={() => { if (tab !== id) { setRows(null); setFailed(false); setTab(id); } }}>{label}</button>
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
          <div className="fxs-empty" data-board-empty>{tab === "week" ? "本週還沒有斗內" : "還沒有斗內"}</div>
        ) : (
          <ol className="fxs-board" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.rank} className={`fxs-row${r.rank <= 3 ? " top" : ""}`} data-board-row={r.rank}>
                <span className="rk">{r.rank}</span>
                <FxsAvatar url={r.avatarUrl} name={r.name} />
                <span className="nm">{r.name}</span>
                <span className="amt">NT${r.amount.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
