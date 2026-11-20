"use client";
// 總大廳歷史紀錄（小宜〈房卡 v1.2〉第 3 節 h1～h4、h6；API：老柯〈房卡第二批〉第 2 節 GET /api/records）
//   最上面一列：返回 ‹、標題、頁籤（全部／麻將／十三支／大老二）、自己的名字。
//   統計條：「全部」只有場數；單一遊戲：場數、總輸贏。每一筆：日期時間、遊戲標籤、房號、局數、（中途解散）、自己的輸贏 ›；第二行同桌四家，自己金框。
//   不顯示扣幾張房卡（伺服器也不給）。大老二一律「沒有紀錄」（大老二紀錄沒有記是誰打的）。
//   點一筆開單場明細：房號、遊戲標籤、時間、局數、四個人各一列（各遊戲自己的明細這一版沒有接，麻將回放照舊在麻將大廳的歷史紀錄）。
// 帳號綁定：外層用 key＝帳號 id 掛 HistoryList，換人就整個重來；換頁籤時舊的回應晚到也不寫回（seq 比對）
import { useEffect, useRef, useState } from "react";
import { useMjAuth } from "@/hooks/useMjAuth";
import { Avatar } from "@/components/mahjong/MjLobbyAuth";
import { getHistory, type HistoryItem, type HistoryPage, type RecordGame } from "./client";
import "./roomCard.css";

const TABS: [RecordGame, string][] = [["all", "全部"], ["mahjong", "麻將"], ["thirteen", "十三支"], ["big2", "大老二"]];
const GAME: Record<HistoryItem["game"], string> = { mahjong: "麻將", thirteen: "十三支", big2: "大老二" };

const timeFmt = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function fmtTime(iso: string): string {
  const p = Object.fromEntries(timeFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
const scoreText = (n: number) => { const a = Math.abs(n).toLocaleString("en-US"); return n > 0 ? `+${a}` : n < 0 ? `−${a}` : "0"; };
const scoreCls = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");
/** 局數：麻將「1 圈・共 6 把」；十三支「8 局」，中途解散加「・打了 5 局」 */
export function roundsLabel(r: HistoryItem): string {
  if (r.game === "mahjong") return `${r.totalRounds ?? "—"} 圈${r.handsPlayed ? `・共 ${r.handsPlayed} 把` : ""}`;
  if (r.game === "thirteen") return `${r.totalHands ?? "—"} 局${r.endReason === "dissolved" && r.handsPlayed != null ? `・打了 ${r.handsPlayed} 局` : ""}`;
  return "";
}

export default function HistoryPageView({ initialTab }: { initialTab: RecordGame }) {
  const auth = useMjAuth();
  // 從哪個頁籤開：頁面從網址 ?game= 讀好傳進來（十三支大廳的入口是 thirteen）；預設全部
  const [tab, setTab] = useState<RecordGame>(initialTab);
  const pick = (g: RecordGame) => {
    setTab(g);
    const q = new URLSearchParams(window.location.search);
    if (g === "all") q.delete("game"); else q.set("game", g);
    history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : ""));
  };
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.href = "/"; };
  const user = auth.status === "in" ? auth.user : null;
  return (
    <div className="mjl mjl-rec" data-rc-history={user ? "ok" : auth.status}>
      <div className="mjl-rec-head">
        <button type="button" className="back" onClick={back} aria-label="返回" data-rc-history-back>‹</button>
        <h2>歷史紀錄</h2>
        <div className="rc-tabs" role="tablist">
          {TABS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => pick(k)} data-rc-hist-tab={k}>{n}</button>)}
        </div>
        <span className="sp" />
        {user && <div className="mjl-who"><Avatar user={user} /><span className="nm">{user.displayName}</span></div>}
      </div>
      {user ? <HistoryList key={user.id} tab={tab} />
        : (
          <div className="mjl-rec-wrap">
            {auth.status === "checking" || auth.status === "pairing" || auth.status === "handoff"
              ? <p className="rc-hist-empty">讀取中…</p>
              : <div className="mjl-hollow"><p className="t1">登入 LINE 才看得到歷史紀錄</p>
                <button type="button" className="mjl-btn primary" style={{ width: 220 }} onClick={() => void auth.signIn(null)}>用 LINE 登入</button></div>}
          </div>
        )}
    </div>
  );
}

function HistoryList({ tab }: { tab: RecordGame }) {
  const [data, setData] = useState<{ items: HistoryItem[]; next: string | null; summary: HistoryPage["summary"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<HistoryItem | null>(null);
  const seq = useRef(0);
  const load = async (cursor: string | null) => {
    const my = ++seq.current;
    setBusy(true); setFailed(false);
    const r = await getHistory(tab, cursor);
    if (my !== seq.current) return; // 頁籤已經換了
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    setData((prev) => ({ items: cursor && prev ? [...prev.items, ...r.data.items] : r.data.items, next: r.data.nextCursor, summary: r.data.summary }));
  };
  useEffect(() => {
    setData(null); setOpen(null);
    if (tab !== "big2") void load(null); // 大老二一律沒有紀錄，不問
    const s = seq;
    return () => { s.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load 只依賴 tab
  }, [tab]);

  if (tab === "big2") return <div className="mjl-rec-wrap"><p className="rc-hist-empty" data-rc-hist-empty="big2">沒有紀錄</p></div>;
  const total = data?.summary.totalScore ?? null;
  return (
    <div className="mjl-rec-wrap">
      <div className="mjl-rec-sum" data-rc-hist-sum>
        <div className="cell"><span className="k">場數</span><span className={`v${data && data.summary.matches > 0 ? "" : " zero"}`}>{data?.summary.matches ?? 0}</span></div>
        {tab !== "all" && <div className="cell"><span className="k">總輸贏</span><span className={`v ${scoreCls(total ?? 0)}`}>{scoreText(total ?? 0)}</span></div>}
      </div>
      {data === null && !failed ? <p className="rc-hist-empty">讀取中…</p>
        : data && data.items.length === 0 ? <p className="rc-hist-empty" data-rc-hist-empty={tab}>沒有紀錄</p>
          : (
            <div className="mjl-rec-list" data-rc-hist-list>
              {(data?.items ?? []).map((r) => (
                <div key={r.id} className="mjl-row tap" role="button" tabIndex={0} data-rc-hist-row={`${r.game}-${r.roomCode}`}
                  onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(r); } }}>
                  <div className="meta">
                    <span className="t">{fmtTime(r.endedAt)}</span>
                    <span className={`rc-g ${r.game}`}>{GAME[r.game]}</span>
                    <span className="code">房 {r.roomCode}</span>
                    <span className="dot">・</span>
                    <span>{roundsLabel(r)}</span>
                    {r.endReason === "dissolved" && <span className="mjl-badge">中途解散</span>}
                    <span className="sp" />
                    <span className={`mine ${scoreCls(r.myScore)}`}>{scoreText(r.myScore)}</span>
                    <span className="go" aria-hidden>›</span>
                  </div>
                  <div className="mjl-seats">
                    {r.players.map((p) => (
                      <div key={p.seat} className={`mjl-seat${p.isMe ? " me" : ""}`}>
                        <span className="n">{p.playerName}</span>
                        <span className={`s ${scoreCls(p.totalScore)}`}>{scoreText(p.totalScore)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {failed ? (
                <div className="mjl-err" role="alert" style={{ alignSelf: "center", margin: "4px 0 10px" }}>
                  載入失敗<button type="button" onClick={() => void load(data?.next ?? null)}>再試一次</button>
                </div>
              ) : data?.next ? (
                <button type="button" className="mjl-more" disabled={busy} onClick={() => void load(data.next)} data-rc-hist-more>{busy ? <span className="mjl-spin" /> : "載入更多"}</button>
              ) : data && data.items.length > 0 ? <p className="mjl-end">沒有更多了</p> : null}
            </div>
          )}
      {open && <HistoryDetail r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HistoryDetail({ r, onClose }: { r: HistoryItem; onClose: () => void }) {
  const xRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    xRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="mjl-dmask" onClick={onClose}>
      <div className="mjl-detail" role="dialog" aria-modal="true" aria-labelledby="rc-hist-dt" onClick={(e) => e.stopPropagation()} data-rc-hist-detail={r.roomCode}>
        <div className="hd">
          <b id="rc-hist-dt">房 {r.roomCode}</b>
          <span className={`rc-g ${r.game}`}>{GAME[r.game]}</span>
          <span className="sub">{fmtTime(r.endedAt)}・{roundsLabel(r)}{r.endReason === "dissolved" ? "・中途解散" : ""}</span>
          <button ref={xRef} type="button" className="x" aria-label="關閉" onClick={onClose}>×</button>
        </div>
        <div className="bd">
          {r.players.map((p) => (
            <div key={p.seat} className={`rc-kv${p.isMe ? " me" : ""}`}><span>{p.playerName}</span><b className={scoreCls(p.totalScore)}>{scoreText(p.totalScore)}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}
