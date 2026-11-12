"use client";

// 歷史紀錄面板（小宜規格 v2 §9）：摘要列固定、一場一列、載入更多
// 斗內改版（小宜〈斗內改版〉A，老闆 2026-11-02）：點一列開明細（每位玩家這場的胡牌、放槍、自摸次數，我這場的結清狀態）

import { useCallback, useEffect, useRef, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import type { MjAuthUser } from "@/hooks/useMjAuth";
import { Avatar } from "./MjLobbyAuth";
import MjDonate from "./MjDonate";
import MjReplay from "./replay/MjReplay";
import { fetchReplayList, ERROR_TEXT, type ReplayError } from "./replay/replayApi";
import { expiryText } from "./replay/replayView";

interface RecordPlayer {
  seat: number;
  playerName: string;
  totalScore: number;
  isMe: boolean;
  /** 這場胡牌（含自摸）、自摸、放槍幾次（老柯 2026-11-02）；沒有紀錄＝null（前端顯示「—」）：
   *  胡牌、放槍要這場每一把都有紀錄（上線後開局）才有；自摸舊場次照舊從自摸紀錄算（只有 LINE 帳號） */
  wins?: number | null;
  selfDraws?: number | null;
  dealIns?: number | null;
  /** 他這場 11/1 後的自摸有沒有收過（老闆 2026-11-08）：true＝已結清、false＝未結清、null／undefined＝不適用（沒有 11/1 後自摸、或是老闆帳號） */
  settled?: boolean | null;
}

interface RecordItem {
  id: string;
  roomCode: string;
  endedAt: string;
  endReason: "completed" | "dissolved";
  totalRounds: number;
  basePoints: number;
  fanPoints: number;
  myScore: number;
  players: RecordPlayer[];
  /** 這場總共打了幾把（舊紀錄沒有＝null，不顯示「共 N 把」） */
  handsPlayed?: number | null;
  /** 我這場 11/1 之後的自摸：zimo 次、due 應給、結清了沒；沒有就是 null */
  myDue?: { zimo: number; due: number; settled: boolean } | null;
}

interface RecordsPage {
  items: RecordItem[];
  nextCursor: string | null;
  summary?: { matches: number; totalScore: number };
}

const PAGE_SIZE = 20;

const timeFmt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatTime(iso: string): string {
  const parts = Object.fromEntries(timeFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function scoreText(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US");
  return n > 0 ? `+${abs}` : n < 0 ? `−${abs}` : "0";
}

const scoreClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");

function RecordRow({ r, onOpen }: { r: RecordItem; onOpen: (r: RecordItem, el: HTMLElement) => void }) {
  return (
    <div className="mjl-row tap" role="button" tabIndex={0} data-record-row={r.roomCode}
      onClick={(e) => onOpen(r, e.currentTarget)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r, e.currentTarget); } }}>
      <div className="meta">
        <span className="t">{formatTime(r.endedAt)}</span>
        <span className="dot">・</span>
        <span className="code">房 {r.roomCode}</span>
        <span className="dot">・</span>
        <span>{r.totalRounds}圈</span>
        <span className="dot">・</span>
        <span>底{r.basePoints}/台{r.fanPoints}</span>
        {r.endReason === "dissolved" && <span className="mjl-badge">中途解散</span>}
        <span className="sp" />
        <span className={`mine ${scoreClass(r.myScore)}`}>{scoreText(r.myScore)}</span>
        <span className="go" aria-hidden>›</span>
      </div>
      <div className="mjl-seats">
        {/* 老闆 2026-11-02：列表不顯示「摸N」，點進明細才看胡牌、放槍、自摸次數 */}
        {r.players.map((p) => (
          <div key={p.seat} className={`mjl-seat${p.isMe ? " me" : ""}`}>
            <span className="n">{p.playerName}</span>
            <span className={`s ${scoreClass(p.totalScore)}`}>{scoreText(p.totalScore)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 場次明細裡的「牌局回放」區塊（小宜〈分階段設計補充〉第一階段入口）：以伺服器回應判斷能不能看，不靠倒數文字授權 */
function ReplayEntry({ matchId, onOpen, onUnauthorized }: { matchId: string; onOpen: () => void; onUnauthorized: () => void }) {
  const [st, setSt] = useState<{ k: "loading" } | { k: "ok"; expiresAt: string } | { k: "err"; e: ReplayError }>({ k: "loading" });
  const check = useCallback(async () => {
    setSt({ k: "loading" });
    const r = await fetchReplayList(matchId);
    if (!r.ok) setSt({ k: "err", e: r.error });
    else if (r.data.hands.length === 0) setSt({ k: "err", e: "no_data" });
    else setSt({ k: "ok", expiresAt: r.data.expiresAt });
  }, [matchId]);
  useEffect(() => { void check(); }, [check]);
  const exp = st.k === "ok" ? expiryText(st.expiresAt, Date.now()) : null;
  return (
    <div className="replay" data-record-replay={st.k === "err" ? st.e : st.k}>
      <div className="txt">
        <b>牌局回放</b>
        <span className="sub" role="status">
          {st.k === "loading" ? "正在確認回放…" : exp ? `${exp.text}${exp.at ? `・${exp.at}` : ""}` : ERROR_TEXT[(st as { e: ReplayError }).e]}
        </span>
      </div>
      {/* 只有能看（或還在確認）才放「觀看回放」；過期、無權限、沒資料只留原因文字，不放看起來能按的鈕（小宜 2026-11-13） */}
      {st.k === "err" && st.e === "failed" ? (
        <button type="button" className="mjl-btn ghost" onClick={() => void check()}>重試</button>
      ) : st.k === "err" && st.e === "not_logged_in" ? (
        <button type="button" className="mjl-btn ghost" onClick={onUnauthorized}>返回登入</button>
      ) : st.k !== "err" ? (
        <button type="button" className="mjl-btn primary" disabled={st.k !== "ok"} onClick={onOpen} data-record-replay-open>觀看回放</button>
      ) : null}
    </div>
  );
}

/** 一場明細（A2、A3）：關閉＝×、Esc、點遮罩；關閉後焦點回到那一列 */
function RecordDetail({ r, onClose, onReplay, onUnauthorized }: { r: RecordItem; onClose: () => void; onReplay: () => void; onUnauthorized: () => void }) {
  const xRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    xRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const n = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const noHands = r.players.every((p) => p.wins == null); // 舊場次：沒有每一把的紀錄
  return (
    <div className="mjl-dmask" onClick={onClose}>
      <div className="mjl-detail" role="dialog" aria-modal="true" aria-labelledby="mjl-detail-t" onClick={(e) => e.stopPropagation()} data-record-detail={r.roomCode}>
        <div className="hd">
          <b id="mjl-detail-t">房 {r.roomCode}</b>
          <span className="sub">{formatTime(r.endedAt)}・{r.totalRounds}圈{r.handsPlayed ? `・共 ${r.handsPlayed} 把` : ""}</span>
          <button ref={xRef} type="button" className="x" aria-label="關閉" onClick={onClose}>×</button>
        </div>
        <div className="bd">
          {r.myDue && r.myDue.zimo > 0 && (
            <div className="mydue" data-record-mydue={r.myDue.settled ? "settled" : "unsettled"}>
              你這場自摸 {r.myDue.zimo} 次・NT${r.myDue.due.toLocaleString("en-US")}
              <span className={`pill ${r.myDue.settled ? "ok" : "no"}`}>{r.myDue.settled ? "已結清" : "未結清"}</span>
            </div>
          )}
          {/* 老闆 2026-11-02：不列第幾把誰自摸，改成每位玩家這場的胡牌、放槍、自摸次數；舊場次沒有每把紀錄＝「—」 */}
          <table className="stats" data-record-stats={noHands ? "none" : "on"}>
            <thead><tr><th scope="col">玩家</th><th scope="col">分數</th><th scope="col">胡牌</th><th scope="col">放槍</th><th scope="col">自摸</th></tr></thead>
            <tbody>
              {r.players.map((p) => (
                <tr key={p.seat} className={p.isMe ? "me" : ""} data-record-stat-seat={p.seat}>
                  <th scope="row">{p.playerName}</th>
                  <td className={scoreClass(p.totalScore)}>{scoreText(p.totalScore)}</td>
                  <td data-k="win">{n(p.wins)}</td><td data-k="dealIn">{n(p.dealIns)}</td>
                  <td data-k="selfDraw" data-record-settled={p.settled == null ? undefined : p.settled ? "settled" : "unsettled"}>
                    <div className="selfdraw-cell">
                      <span>{n(p.selfDraws)}</span>
                      {!!p.selfDraws && p.settled != null && <span className={`tag ${p.settled ? "ok" : "no"}`}>{p.settled ? "已結清" : "未結清"}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {noHands && <p className="note">這場打的時候還沒有記錄胡牌、放槍</p>}
          <ReplayEntry matchId={r.id} onOpen={onReplay} onUnauthorized={onUnauthorized} />
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mjl-rec-list" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mjl-sk">
          <div className="bar" style={{ width: "58%" }} />
          <div className="bar" style={{ width: "100%", height: 14 }} />
        </div>
      ))}
    </div>
  );
}

export default function MjRecords({
  user,
  onClose,
  onCreate,
  onUnauthorized,
}: {
  user: MjAuthUser;
  onClose: () => void;
  onCreate: () => void;
  onUnauthorized: () => void;
}) {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<{ matches: number; totalScore: number } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false); // 第一頁回來了
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useCallback(() => titleRef.current?.focus(), []);
  const [open, setOpen] = useState<RecordItem | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openDetail = useCallback((r: RecordItem, el: HTMLElement) => { openerRef.current = el; setOpen(r); }, []);
  const closeDetail = useCallback(() => { setOpen(null); openerRef.current?.focus(); }, []);
  // 回放播放器：蓋在整個歷史紀錄上面；關掉回到同一場的明細
  const [replay, setReplay] = useState(false);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setFailed(false);
      try {
        const qs = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : "&summary=1"}`;
        const res = await mjFetch(`/api/mahjong/records?${qs}`, { method: "GET" });
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as RecordsPage;
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        if (data.summary) setSummary(data.summary);
        setNextCursor(data.nextCursor);
        setLoaded(true);
      } catch {
        setFailed(true); // 已載入的列保留
      } finally {
        setLoading(false);
      }
    },
    [onUnauthorized]
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const total = summary?.totalScore ?? 0;

  return (
    <div className="mjl mjl-rec">
      <div className="mjl-rec-head">
        <button type="button" className="back" onClick={onClose} aria-label="返回">‹</button>
        <h2 ref={titleRef} tabIndex={-1}>歷史紀錄</h2>
        <span className="sp" />
        <div className="mjl-who">
          <Avatar user={user} />
          <span className="nm">{user.displayName}</span>
        </div>
      </div>
      <div className="mjl-rec-wrap">
        <div className="mjl-rec-sum">
          <div className="cell">
            <span className="k">場數</span>
            <span className={`v${summary && summary.matches > 0 ? "" : " zero"}`}>{summary?.matches ?? 0}</span>
          </div>
          <div className="cell">
            <span className="k">累計</span>
            <span className={`v ${scoreClass(total)}`}>{scoreText(total)}</span>
          </div>
        </div>
        {/* 斗內卡：摘要列下面、紀錄列表上面（LINE 玩家、累計自摸 > 0 才出現） */}
        <MjDonate user={user} focusBack={focusTitle} />

        {!loaded && loading ? (
          <Skeleton />
        ) : loaded && items.length === 0 ? (
          <div className="mjl-hollow">
            {/* 老闆 2026-10-21：空狀態只留「還沒有紀錄」和「建立房間」 */}
            <p className="t1">還沒有紀錄</p>
            <button type="button" className="mjl-btn primary" style={{ width: 220 }} onClick={onCreate}>
              建立房間
            </button>
          </div>
        ) : (
          <div className="mjl-rec-list">
            {items.map((r) => (
              <RecordRow key={r.id} r={r} onOpen={openDetail} />
            ))}
            {failed ? (
              <div className="mjl-err" role="alert" style={{ alignSelf: "center", margin: "4px 0 10px" }}>
                載入失敗
                <button type="button" onClick={() => load(loaded ? nextCursor : null)}>再試一次</button>
              </div>
            ) : nextCursor ? (
              <button type="button" className="mjl-more" disabled={loading} onClick={() => load(nextCursor)}>
                {loading ? <span className="mjl-spin" /> : "載入更多"}
              </button>
            ) : (
              <p className="mjl-end">沒有更多了</p>
            )}
          </div>
        )}
      </div>
      {open && !replay && <RecordDetail r={open} onClose={closeDetail} onReplay={() => setReplay(true)} onUnauthorized={onUnauthorized} />}
      {open && replay && <MjReplay matchId={open.id} onClose={() => setReplay(false)} onUnauthorized={onUnauthorized} />}
    </div>
  );
}
