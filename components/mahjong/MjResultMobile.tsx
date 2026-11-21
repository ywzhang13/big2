"use client";

// 結算浮層（一般胡牌、流局、八仙過海、七搶一、總積分榜）：外框換成三款共用的 GameResultFrame（小宜〈麻將換共用元件 v1〉§4）。
// 左欄：胡法、誰胡（MIGI／眼／聽接在名字後）、誰放槍、骰子、看牌庫、台數明細（「N 台」、不帶正負號）；
// 右欄：四家（胡的那家金框、名字下「胡」「莊N」膠囊）攤牌＋輸贏＋累計；下面「還在等…」、同意 n/4、離開＋下一局。
// 整場打完：總積分榜（名次、胡／放槍／自摸、總分），只有「回大廳」。觀戰者：沒有同意小牌子，只有「離開觀戰」。
// 金額一律用後端的 settlement。844×390 一塊，桌機整塊等比放大（上限 2.4，和十三支一樣）。

import { useLayoutEffect, useRef, useState } from "react";
import type { HandStats, Settlement } from "@/lib/mahjong/gameState";
import type { Tile } from "@/lib/mahjong/tiles";
import type { MjPlayer, MjWinner, MjHandReveal } from "@/hooks/useMahjong";
import GameResultFrame, { type GrItem, type GrRow } from "@/components/gameResult/GameResultFrame";
import { RevealTiles, WaitsList } from "./MjReveal";
import { Die } from "./MjBoardMobile";
import MjTile from "./MjTile";

const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];
const BASE_W = 844, BASE_H = 390, CAP = 2.4;
const TILE = { w: 14, ht: 19, ww: 12, wh: 16 }; // 844×390 基準；桌機靠整塊放大，不另外換尺寸

interface MjResultMobileProps {
  winner: MjWinner & { allHands?: MjHandReveal[] };
  winners?: MjWinner[];
  players: MjPlayer[];
  mySeat: number;
  myId: string;
  fromName?: string; // 放槍者（一般胡牌、非自摸）
  isZimo: boolean;
  settlement?: Settlement;
  playerScores?: number[];
  hasRounds: boolean;
  gameOver?: boolean;
  /** 整場打完時每家的胡牌／放槍／自摸次數（重新整理後拿不到就不顯示） */
  handStats?: HandStats;
  /** 這局剩下的牌牆（牌庫），第 0 張是下一張要摸的；沒有就不顯示「看牌庫」 */
  remainingWall?: Tile[];
  nextGameReady?: string[];
  /** 回傳被拒絕時要顯示的訊息（成功或已由登入流程處理時是 null） */
  onNextGame: () => Promise<string | null>;
  onLeave: () => void;
  /** 觀戰者（老馬 2026-10-30）：不能按下一局（伺服器開下一局後畫面自己接續），離開按鈕寫「離開觀戰」 */
  spectator?: boolean;
  /** 舊參數：桌機現在是整塊等比放大，不用另外傳；留著讓呼叫端不用改 */
  desktop?: boolean;
  tingSeats?: number[];
  eyeSeats?: number[];
  /** 這局開局的三顆骰子；dealerSeat＝莊家（doorSeat 舊參數，結算不再顯示風位） */
  dice?: [number, number, number];
  doorSeat?: number;
  dealerSeat?: number;
  /** 莊家連莊次數（0＝第一次做莊）：名字下「莊N」 */
  dealerConsecutive?: number;
  /** 總積分榜標題下那一行（例：「4 圈・底 100 台 20」） */
  roomLine?: string;
  /** 整場打完一打開先看哪一頁（預設最後一局；測試用 "rank" 直接看總積分榜） */
  initialFinalTab?: "last" | "rank";
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** 和外框同一個容器（fixed inset 0）量大小：一般頁面是整個視窗，回放裡是牌桌區 */
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) setZ(Math.min(r.width / BASE_W, r.height / BASE_H, CAP)); };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, z };
}

export default function MjResultMobile({
  winner,
  winners,
  players,
  mySeat,
  myId,
  fromName,
  isZimo,
  settlement,
  playerScores,
  hasRounds,
  gameOver,
  handStats,
  remainingWall,
  nextGameReady,
  onNextGame,
  onLeave,
  spectator = false,
  tingSeats = [],
  eyeSeats = [],
  dice,
  dealerSeat,
  dealerConsecutive = 0,
  roomLine,
  initialFinalTab = "last",
}: MjResultMobileProps) {
  const isDraw = winner.seat < 0;
  const flowerName = winner.score.fans.find((f) => FLOWER_WIN_NAMES.includes(f.name))?.name;
  const allWinners = winners && winners.length > 0 ? winners : isDraw ? [] : [winner];
  const multi = allWinners.length > 1;
  const hands = winner.allHands ?? [];
  const { ref: fitRef, z } = useFitScale();

  const nameOf = (seat: number) => players.find((p) => p.seat === seat)?.name ?? "";
  const iAmReady = nextGameReady?.includes(myId) ?? false;
  // 按下一局：送出中先鎖住按鈕；被拒絕時在按鈕上面顯示原因（之前錯誤被吞掉，看起來像按了沒反應）
  const [sending, setSending] = useState(false);
  const [nextErr, setNextErr] = useState<string | null>(null);
  // 牌庫：展開時蓋在四家攤牌上面（攤牌的位置照留，下面的按鈕不會動）
  const [wallOpen, setWallOpen] = useState(false);
  const hasWall = !!remainingWall && remainingWall.length > 0;
  const pressNext = async () => {
    setSending(true);
    setNextErr(null);
    try {
      setNextErr(await onNextGame());
    } finally {
      setSending(false);
    }
  };
  const readyCount = players.filter((p) => nextGameReady?.includes(p.id)).length;
  const waiting = players.filter((p) => !nextGameReady?.includes(p.id)).map((p) => (p.id === myId ? "你" : p.name));
  const leaveLabel = spectator ? "離開觀戰" : gameOver ? "回大廳" : "離開";
  // 整場打完（老闆 2026-11-22「回大廳用以前的方式呈現，看得到最後一把的手牌胡什麼」）：分頁「最後一局／總積分榜」，預設最後一局
  const [finalTab, setFinalTab] = useState<"last" | "rank">(initialFinalTab);
  const finalTabs = gameOver && playerScores ? [
    { key: "last", label: "最後一局", on: finalTab === "last", onClick: () => setFinalTab("last"), attrs: { "data-mj-final-tab": "last" } as const },
    { key: "rank", label: "總積分榜", on: finalTab === "rank", onClick: () => setFinalTab("rank"), attrs: { "data-mj-final-tab": "rank" } as const },
  ] : undefined;
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);

  // ---- 整場打完：總積分榜（高分在前），只有回大廳 ----
  if (gameOver && playerScores && finalTab === "rank") {
    const ranking = [...players].sort((a, b) => playerScores[b.seat] - playerScores[a.seat]);
    const rows: GrRow[] = ranking.map((p, i) => ({
      key: p.seat, rank: i, name: p.name, me: !spectator && p.seat === mySeat, delta: playerScores[p.seat],
      stats: handStats ? [
        // 胡＝別人放槍給他的胡（老闆 2026-11-22：自摸另外算、不重複）。伺服器的 wins 含自摸（lib/mahjong/gameLogic.ts tallyHandStats），
        // 在這裡扣掉，正在打的房間的舊資料也照新算法顯示，伺服器資料不用改
        { label: "胡", value: Math.max(0, (handStats.wins[p.seat] ?? 0) - (handStats.selfDraws[p.seat] ?? 0)), attrs: { "data-hand-stat": p.seat } },
        { label: "放槍", value: handStats.dealIns[p.seat] ?? 0 },
        { label: "自摸", value: handStats.selfDraws[p.seat] ?? 0 },
      ] : undefined,
      attrs: { "data-mj-result-seat": p.seat },
    }));
    return (
      <>
        <div ref={fitRef} aria-hidden style={{ position: "fixed", inset: 0, visibility: "hidden", pointerEvents: "none" }} />
        <GameResultFrame tabs={finalTabs} title="總積分榜" subs={roomLine ? [roomLine] : undefined} rows={rows} scaleVar={String(z)}
          primary={{ label: leaveLabel, onClick: onLeave, attrs: { "data-mj-result-leave": "" } }} attrs={{ "data-mj-result": "final" }} />
      </>
    );
  }

  // ---- 每局結算 ----
  const title = isDraw ? "流局" : flowerName ?? (isZimo ? "自摸" : "胡");
  const subs = [
    !isDraw && (
      <span className="mj-gr-who" key="who">
        {allWinners.map((w, i) => (
          <span key={w.seat}>
            {i > 0 && "、"}
            {w.name}
            {/* 名字後面接藥丸：地聽＋眼牌＝MIGI；只有眼牌＝眼；只有地聽（舊牌局）＝聽 */}
            {tingSeats.includes(w.seat) && eyeSeats.includes(w.seat) ? (
              <span className="mjm-tag migi" style={{ marginLeft: 4, verticalAlign: "middle" }}>MIGI</span>
            ) : eyeSeats.includes(w.seat) ? (
              <span className="mjm-tag eye" style={{ marginLeft: 4, verticalAlign: "middle" }}>眼</span>
            ) : tingSeats.includes(w.seat) ? (
              <span className="mjm-tag ting" style={{ marginLeft: 4, verticalAlign: "middle" }}>聽</span>
            ) : null}
          </span>
        ))}{" "}
        胡牌
      </span>
    ),
    !isDraw && !flowerName && !isZimo && fromName && <span className="mj-gr-from" key="from">{fromName} 放槍</span>,
    dice && (
      <span className="mj-gr-dice" key="dice">
        <Die value={dice[0]} size={14} />
        <Die value={dice[1]} size={14} />
        <Die value={dice[2]} size={14} />
      </span>
    ),
  ].filter(Boolean);

  const fans = !isDraw && !multi ? winner.score.fans : null;
  const items: GrItem[] | undefined = fans?.map((f) => ({ label: f.name, value: f.value, format: "plain", unit: " 台" }));
  const total: GrItem | undefined = fans ? { label: "共", value: winner.score.totalFan, format: "plain", unit: " 台" } : undefined;

  const rows: GrRow[] = bySeat.map((p) => {
    const w = allWinners.find((x) => x.seat === p.seat);
    const h = hands.find((x) => x.seat === p.seat);
    const dealer = p.seat === dealerSeat;
    return {
      key: p.seat,
      me: !spectator && p.seat === mySeat,
      tone: w ? "win" : undefined,
      name: p.name,
      marks: (w || dealer) ? (
        <>
          {w && <span className="gr-mark hu">胡</span>}
          {dealer && <span className="gr-mark dl">莊{dealerConsecutive > 0 ? dealerConsecutive : ""}</span>}
        </>
      ) : undefined,
      body: (
        <div className="mj-gr-body">
          {w && multi && <div className="ln">胡 {w.score.totalFan} 台：{w.score.fans.map((f) => f.name).join("、")}</div>}
          <WaitsList waits={w?.waits} w={TILE.ww} ht={TILE.wh} />
          {h && <RevealTiles h={h} winner={w} nameOf={nameOf} w={TILE.w} ht={TILE.ht} />}
        </div>
      ),
      delta: settlement ? settlement.deltas[p.seat] ?? 0 : null,
      sub: settlement && hasRounds && playerScores ? `累計 ${signed(playerScores[p.seat] ?? 0)}` : undefined,
      attrs: { "data-mj-result-seat": p.seat },
    };
  });

  const wall = hasWall && wallOpen ? (
    <div className="mj-gr-wall" data-wall>
      <div className="hd">
        <span>牌庫・剩 <b>{remainingWall!.length}</b> 張</span>
        <button type="button" className="x" onClick={() => setWallOpen(false)}>收起</button>
      </div>
      <div className="tiles">
        {remainingWall!.map((t) => (
          <span key={t.id}><MjTile tile={t} width={TILE.w} height={TILE.ht} /></span>
        ))}
      </div>
    </div>
  ) : undefined;

  const canNext = hasRounds && !spectator && !gameOver;
  return (
    <>
      <div ref={fitRef} aria-hidden style={{ position: "fixed", inset: 0, visibility: "hidden", pointerEvents: "none" }} />
      <GameResultFrame
        tabs={finalTabs}
        title={title}
        titleTone={isDraw ? "draw" : undefined}
        subs={subs}
        tool={hasWall ? { label: wallOpen ? "收起牌庫" : `看牌庫（${remainingWall!.length}）`, onClick: () => setWallOpen((o) => !o), attrs: { "data-wall-toggle": "", "data-wall-open": wallOpen ? "1" : "0" } } : undefined}
        items={items}
        total={total}
        rows={rows}
        overlay={wall}
        next={canNext && readyCount > 0 && waiting.length > 0 ? `還在等 ${waiting.join("、")} 按下一局` : null}
        error={canNext ? nextErr : null}
        ready={canNext ? {
          label: `同意 ${readyCount}/4`,
          chips: players.map((p) => ({ key: p.seat, name: p.name, ok: nextGameReady?.includes(p.id) ?? false })),
        } : null}
        secondary={canNext ? { label: leaveLabel, onClick: onLeave, attrs: { "data-mj-result-leave": "" } } : undefined}
        primary={canNext
          ? { label: iAmReady ? "已同意" : sending ? "送出中…" : "下一局", disabled: iAmReady || sending, onClick: () => void pressNext(), attrs: { "data-mj-result-next": "" } }
          : { label: leaveLabel, onClick: onLeave, attrs: { "data-mj-result-leave": "" } }}
        scaleVar={String(z)}
        attrs={{ "data-mj-result": isDraw ? "draw" : "hand", ...(finalTabs ? { "data-mj-final": "last" } : {}) }}
      />
    </>
  );
}
