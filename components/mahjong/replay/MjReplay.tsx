"use client";

// 麻將牌局回放播放器（第一階段：只有網站內回放，沒有下載）。
// 規格：小宜〈麻將回放-UIUX設計與實作規格.md〉＋〈麻將回放-分階段設計補充-2026-11-13.md〉；資料：老柯 lib/mahjong/replay/API.md。
// 牌桌直接用打牌時的 MjBoard／MjBoardMobile（關掉所有操作），回放控制放在牌桌外面，不蓋牌面。

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import MjBoard from "@/components/mahjong/MjBoard";
import MjBoardMobile from "@/components/mahjong/MjBoardMobile";
import MjResultMobile from "@/components/mahjong/MjResultMobile";
import { replayFrames, type ReplayView, type SeatSnap } from "@/lib/mahjong/replay/log";
import { boardAt, clock, expiryText, resultAt, stepDelay } from "./replayView";
import { ERROR_TEXT, fetchReplayHand, fetchReplayList, type ReplayError, type ReplayList } from "./replayApi";
import "./replay.css";

const MOBILE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)"; // 和打牌、觀戰畫面同一條（app/mahjong/watch）
function useMobileLandscape(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(MOBILE_LANDSCAPE_QUERY);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE_LANDSCAPE_QUERY).matches,
    () => false
  );
}

const WIND = ["東", "南", "西", "北"];
const SPEEDS = [1, 2, 4];
const noop = () => {};

type Loaded = { rec: ReplayView; frames: SeatSnap[][] };
type HandSlot = Loaded | "loading" | "failed";

export default function MjReplay({ matchId, onClose, onUnauthorized }: { matchId: string; onClose: () => void; onUnauthorized: () => void }) {
  const mobile = useMobileLandscape();
  const [list, setList] = useState<ReplayList | null>(null);
  const [fatal, setFatal] = useState<ReplayError | null>(null);
  const [hands, setHands] = useState<Record<number, HandSlot>>({});
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(0); // -1＝這局最後一步（往前跨局時，那一局還沒載入，不知道長度）
  const [seat, setSeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const loadList = useCallback(async () => {
    setFatal(null);
    setList(null);
    const r = await fetchReplayList(matchId);
    if (!r.ok) { setFatal(r.error); return; }
    if (r.data.hands.length === 0) { setFatal("no_data"); return; }
    setList(r.data);
    setSeat(r.data.mySeat);
  }, [matchId]);
  useEffect(() => { void loadList(); }, [loadList]);

  const handNo = list?.hands[idx]?.handNo;
  const slot = handNo != null ? hands[handNo] : undefined;

  const loadHand = useCallback(async (no: number) => {
    setHands((h) => ({ ...h, [no]: "loading" }));
    const r = await fetchReplayHand(matchId, no);
    if (!r.ok) {
      // 讀取失敗：只標這一局，給重試；過期、失權、沒有資料：停止播放、整個換成狀態畫面（不留牌面、不留控制列）
      if (r.error === "failed") { setHands((h) => ({ ...h, [no]: "failed" })); setPlaying(false); return; }
      setPlaying(false); setFatal(r.error); return;
    }
    setHands((h) => ({ ...h, [no]: { rec: r.data.replay, frames: replayFrames(r.data.replay) } }));
  }, [matchId]);
  useEffect(() => { if (handNo != null && hands[handNo] === undefined) void loadHand(handNo); }, [handNo, hands, loadHand]);

  const loaded = slot && typeof slot === "object" ? slot : null;
  const len = loaded?.rec.events.length ?? 0;
  const cur = loaded ? (step < 0 ? len : Math.min(step, len)) : 0;
  useEffect(() => { if (loaded && step < 0) setStep(loaded.rec.events.length); }, [loaded, step]);

  // 到期時間一到就停：清掉牌面、顯示「回放已過期」
  useEffect(() => {
    if (!list) return;
    const left = Date.parse(list.expiresAt) - Date.now();
    if (left <= 0) { setFatal("expired"); return; }
    const t = setTimeout(() => { setPlaying(false); setFatal("expired"); }, Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [list]);

  const lastIdx = (list?.hands.length ?? 1) - 1;
  const atStart = idx === 0 && cur === 0;
  const atEnd = idx === lastIdx && loaded != null && cur === len;

  // 局末結算畫面：到這局最後一步就顯示（和打牌時一樣），按「查看牌桌」收起；離開最後一步再回來會重新顯示
  const [resultHidden, setResultHidden] = useState(false);
  const atHandEnd = loaded != null && cur === len;
  useEffect(() => { if (!atHandEnd) setResultHidden(false); }, [atHandEnd, idx]);

  const next = useCallback(() => {
    if (!loaded) return;
    if (cur < len) setStep(cur + 1);
    else if (idx < lastIdx) { setIdx(idx + 1); setStep(0); }
  }, [loaded, cur, len, idx, lastIdx]);
  const prev = useCallback(() => {
    if (!loaded) return;
    if (cur > 0) setStep(cur - 1);
    else if (idx > 0) { setIdx(idx - 1); setStep(-1); }
  }, [loaded, cur, idx]);

  // 播放：照實際打牌的間隔（見 stepDelay）；每局播到最後一步就暫停、出結算畫面，再按播放才接下一局
  useEffect(() => {
    if (!playing || !loaded) return;
    if (cur === len) { setPlaying(false); return; }
    const t = setTimeout(next, stepDelay(loaded.rec, cur, speed));
    return () => clearTimeout(t);
  }, [playing, loaded, cur, len, speed, next]);

  const manual = (fn: () => void) => () => { setPlaying(false); fn(); };
  const togglePlay = () => {
    if (atEnd) { setIdx(0); setStep(0); setPlaying(true); return; } // 重新播放：回第一局起點
    if (!playing && atHandEnd) { next(); setPlaying(true); return; } // 這局播完：接著播下一局
    setPlaying((p) => !p);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); prev(); }
      else if (e.key === "Home") { e.preventDefault(); setPlaying(false); setStep(0); }
      else if (e.key === "End") { e.preventDefault(); setPlaying(false); setStep(len); }
      else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const board = useMemo(() => (loaded ? boardAt(loaded.rec, loaded.frames, cur, seat) : null), [loaded, cur, seat]);
  const result = useMemo(() => (loaded ? resultAt(loaded.rec, loaded.frames) : null), [loaded]);

  const nameOf = (s: number) => list?.players.find((p) => p.seat === s)?.name ?? `座位 ${s + 1}`;
  const seatLabel = (s: number) => (s === list?.mySeat ? `自己（${nameOf(s)}）` : nameOf(s));
  const expiry = list ? expiryText(list.expiresAt, Date.now()) : null;
  const rec = loaded?.rec;
  const roundLabel = rec && rec.round != null && rec.game != null ? `${WIND[(rec.round - 1) % 4]}風圈 第${rec.game}局` : undefined;
  const nowMs = rec && cur > 0 ? rec.events[cur - 1].t : 0;
  const totalMs = rec ? Math.max(rec.durationMs, rec.events[len - 1]?.t ?? 0) : 0;

  // ---------- 狀態畫面（取代整個播放器，不顯示牌面） ----------
  if (fatal) {
    const back = fatal === "not_player" ? "返回歷史紀錄" : "返回場次明細";
    return (
      <div className={`mjr${mobile ? " m" : ""}`} role="dialog" aria-modal="true" aria-label="牌局回放" data-replay-state={fatal}>
        <div className="mjr-top"><button type="button" className="mjr-back" onClick={onClose}>‹ {back}</button><h1>牌局回放</h1><span /></div>
        <div className="mjr-msg" role="alert">
          <p>{ERROR_TEXT[fatal]}</p>
          <div className="row">
            {fatal === "failed" && <button type="button" className="mjr-btn gold" onClick={() => void loadList()}>重試</button>}
            {fatal === "not_logged_in" && <button type="button" className="mjr-btn gold" onClick={onUnauthorized}>返回登入</button>}
            <button type="button" className="mjr-btn" onClick={onClose}>{back}</button>
          </div>
        </div>
      </div>
    );
  }

  const boardProps = board && {
    ...board,
    availableActions: [], pendingAddKong: null, robKong: false, pendingFlowerRob: null, robFlower: false,
    eyeOptions: [], eyeWithTing: false, chiForbidden: [], declareFx: [], paceNote: null,
    needsDraw: false, needsDiscard: false, isMyTurn: false, playerName: nameOf(seat),
    slowDraw: null, actionNotice: null, onDraw: noop, onDiscard: noop, onAction: noop,
  };
  const ready = loaded != null;
  const players = boardProps?.players ?? [];

  const seatSelect = (
    <label className="mjr-sel">
      <span className="mjr-sr">視角</span>
      <select value={seat} disabled={!ready} onChange={(e) => setSeat(Number(e.target.value))} aria-label="視角">
        {[0, 1, 2, 3].map((s) => <option key={s} value={s}>視角：{seatLabel(s)}</option>)}
      </select>
    </label>
  );
  const handSelect = (
    <label className="mjr-sel">
      <select value={idx} disabled={!ready} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); setStep(0); }} aria-label="選局" data-replay-hand-select>
        {list?.hands.map((h, i) => (
          <option key={h.handNo} value={i}>第 {h.handNo} 局{mobile ? "" : ` / ${list.hands[list.hands.length - 1].handNo} 局`}</option>
        ))}
      </select>
    </label>
  );
  const transport = (
    <>
      <button type="button" className="mjr-icon" onClick={manual(prev)} disabled={!ready || atStart} aria-label="上一步">⏮</button>
      <button type="button" className="mjr-icon play" onClick={togglePlay} disabled={!ready} aria-label={atEnd ? "重新播放" : playing ? "暫停" : "播放"} data-replay-play>
        {atEnd ? "↻" : playing ? "❚❚" : "▶"}
      </button>
      <button type="button" className="mjr-icon" onClick={manual(next)} disabled={!ready || atEnd} aria-label="下一步">⏭</button>
      <div className="mjr-bar">
        <input type="range" min={0} max={len} value={cur} disabled={!ready}
          onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }}
          aria-label="進度" aria-valuetext={`第 ${handNo ?? ""} 局，動作 ${cur}／${len}`} data-replay-range />
        <div className="t">
          <span>{clock(nowMs)}</span>
          {mobile && expiry && <span className={`mjr-exp${expiry.at ? " soon" : ""}`}>{expiry.text}</span>}
          <span>{clock(totalMs)}</span>
        </div>
      </div>
      <label className="mjr-sel speed">
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="倍速">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
    </>
  );

  return (
    <div className={`mjr${mobile ? " m" : ""}`} role="dialog" aria-modal="true" aria-label="牌局回放" data-replay-state={ready ? "ready" : "loading"}>
      {/* 手機：不另外放頂列（小宜 2026-11-13：空間讓給牌桌），返回放在控制列最左邊，牌桌左上 ☰ 也能離開 */}
      {!mobile && (
        <div className="mjr-top">
          <button type="button" className="mjr-back" onClick={onClose}>‹ 返回場次明細</button>
          <h1>牌局回放</h1>
          <span />
        </div>
      )}

      <div className="mjr-stage" data-replay-step={cur} data-replay-seat={seat}>
        {boardProps ? (
          mobile ? (
            <MjBoardMobile {...boardProps} roomCode={list?.roomCode ?? ""} roundLabel={roundLabel} onLeave={onClose} leaveLabel="離開回放" />
          ) : (
            <MjBoard {...boardProps} />
          )
        ) : slot === "failed" ? (
          <div className="mjr-msg" role="alert">
            <p>{ERROR_TEXT.failed}</p>
            <div className="row">
              <button type="button" className="mjr-btn gold" onClick={() => handNo != null && void loadHand(handNo)}>重試</button>
              <button type="button" className="mjr-btn" onClick={onClose}>返回場次明細</button>
            </div>
          </div>
        ) : (
          <div className="mjr-msg" role="status"><p>正在載入回放…</p></div>
        )}
        {/* 局末：和打牌時同一個結算畫面（只看、不能按下一局）；收起後看最後一步的牌桌 */}
        {result && board && atHandEnd && !resultHidden && (
          <div className="mjr-result" data-replay-result>
            <MjResultMobile
              spectator desktop={!mobile} hasRounds={false} onNextGame={async () => null} onLeave={noop}
              winner={result.winner} winners={result.winners} settlement={result.settlement} isZimo={result.isZimo} fromName={result.fromName}
              remainingWall={result.remainingWall} players={players} mySeat={seat} myId="" playerScores={board.playerScores}
              tingSeats={board.tingSeats} eyeSeats={board.eyeSeats} dice={board.dice} doorSeat={board.doorSeat} dealerSeat={board.dealerSeat}
            />
            <button type="button" className="mjr-btn mjr-seetable" onClick={() => setResultHidden(true)} data-replay-see-table>查看牌桌</button>
          </div>
        )}
        {result && atHandEnd && resultHidden && (
          <button type="button" className="mjr-btn mjr-seetable" onClick={() => setResultHidden(false)} data-replay-see-result>查看結算</button>
        )}
      </div>

      <div className="mjr-ctl">
        {mobile ? (
          <div className="mjr-row">
            <button type="button" className="mjr-icon" onClick={onClose} aria-label="返回場次明細">‹</button>
            {seatSelect}
            {handSelect}
            {transport}
          </div>
        ) : (
          <>
            <div className="mjr-row">
              <div className="mjr-seats" role="group" aria-label="視角">
                <span className="k">視角</span>
                {[0, 1, 2, 3].map((s) => (
                  <button key={s} type="button" className={`mjr-btn${s === seat ? " on" : ""}`} aria-pressed={s === seat} disabled={!ready} onClick={() => setSeat(s)} data-replay-view={s}>
                    {s === seat && <span aria-hidden>✓ </span>}{seatLabel(s)}
                  </button>
                ))}
              </div>
              {handSelect}
              <span className="sp" />
              {expiry && <span className={`mjr-exp${expiry.at ? " soon" : ""}`}>{expiry.text}{expiry.at ? `・${expiry.at}` : ""}</span>}
            </div>
            <div className="mjr-row">{transport}</div>
          </>
        )}
      </div>

      <div className="mjr-portrait" role="alert">
        <p>請將手機橫向，方便觀看牌局</p>
        <button type="button" className="mjr-btn" onClick={onClose}>返回場次明細</button>
      </div>
    </div>
  );
}
