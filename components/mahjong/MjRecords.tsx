"use client";

// 歷史紀錄面板（小宜規格 v2 §9）：摘要列固定、一場一列（不可點）、載入更多

import { useCallback, useEffect, useState } from "react";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import type { MjAuthUser } from "@/hooks/useMjAuth";
import { Avatar } from "./MjLobbyAuth";

interface RecordPlayer {
  seat: number;
  playerName: string;
  totalScore: number;
  isMe: boolean;
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

function RecordRow({ r }: { r: RecordItem }) {
  return (
    <div className="mjl-row">
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
      </div>
      <div className="mjl-seats">
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
        <h2>歷史紀錄</h2>
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

        {!loaded && loading ? (
          <Skeleton />
        ) : loaded && items.length === 0 ? (
          <div className="mjl-hollow">
            <div className="ic">🀄</div>
            <p className="t1">還沒有紀錄</p>
            <p className="t2">
              打完一整場，或四家同意解散後，
              <br />
              這一場就會記下來。
            </p>
            <button type="button" className="mjl-btn primary" style={{ width: 220 }} onClick={onCreate}>
              建立房間
            </button>
          </div>
        ) : (
          <div className="mjl-rec-list">
            {items.map((r) => (
              <RecordRow key={r.id} r={r} />
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
    </div>
  );
}
