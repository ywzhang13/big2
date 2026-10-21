"use client";

// 手機橫向牌桌（小宜規格 2026-10-14）。只在 (orientation: landscape) and (max-height: 500px)
// 由 page.tsx 掛載；桌機仍用 MjBoard。版面與尺寸對應 globals.css 的 .mjm-* 樣式。

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld } from "@/lib/mahjong/gameState";
import { MjMeldArrow } from "./MjMeldArrow";
import MjTableMenu from "./MjTableMenu";
import type { MjPlayer, MjOpponentHand } from "@/hooks/useMahjong";
import type { MjBoardProps } from "./MjBoard";
import { paceText } from "./paceText";
import MjTile, { TileMatchContext, tileKind } from "./MjTile";
import { SlowDrawTile } from "./MjHand";
import MjFlowerTag from "./MjFlowerTag";
import MjClaimFx from "./MjClaimFx";
import MjClaimBanner from "./MjClaimBanner";
import { seatWindChar } from "./seatWind";

interface MjBoardMobileProps extends MjBoardProps {
  roomCode: string;
  roundLabel?: string;
  basePoints?: number;
  fanPoints?: number;
  onLeave: () => void;
}

function scoreClass(score: number) {
  return score > 0 ? "pos" : score < 0 ? "neg" : "zero";
}

function Score({ score }: { score?: number }) {
  if (score == null) return null;
  return (
    <span className={`mjm-sc ${scoreClass(score)}`}>
      {score > 0 ? "+" : ""}
      {score}
    </span>
  );
}

/** short＝左右家名牌（寬度固定）：連莊只顯示數字，「莊2」＝連 2 */
function DealerTag({ player, consecutive, withLa, short }: { player: MjPlayer; consecutive?: number; withLa?: boolean; short?: boolean }) {
  if (!player.isDealer) return null;
  const n = consecutive ?? 0;
  return (
    <span className="mjm-tag dealer">
      莊{n > 0 ? (short ? n : ` 連${n}${withLa ? `·拉${n}` : ""}`) : ""}
    </span>
  );
}

/** 吃碰槓（花改成 MjFlowerTag 收合）。暗槓：自己看得到牌面，別家全部蓋牌（我眼牌時 reveal＝翻開）。
 *  rot＝左右家：每張包一格、由 CSS 轉 ±90° 朝向主人，每一副自己一直列，放在靠海底那一欄（沒有吃碰槓也留著，當作和金框的間距） */
function Melds({ revealed, w, h, mine, reveal, rot, seat, mySeat }: { revealed: Meld[]; w: number; h: number; mine?: boolean; reveal?: boolean; rot?: boolean; seat: number; mySeat: number }) {
  // data-claim-seat：吃碰槓提示（MjClaimFx）從這裡量剛吃碰的那一副在哪
  if (revealed.length === 0) return rot ? <div className="mjm-meldcol" data-claim-seat={seat} /> : null;
  const tile = (t: Tile, faceDown: boolean) =>
    rot ? (
      <span key={t.id} className="rcell" style={{ width: h, height: w }}><MjTile tile={t} width={w} height={h} faceDown={faceDown} matchable /></span>
    ) : (
      <MjTile key={t.id} tile={t} width={w} height={h} faceDown={faceDown} matchable />
    );
  return (
    <div className={rot ? "mjm-meldcol" : "mjm-melds"} data-claim-seat={seat}>
      {revealed.map((meld, mi) => (
        <div key={mi} className="mjm-meld">
          {meld.tiles.map((t) => tile(t, !mine && !reveal && meld.type === "concealed_kong"))}
          <MjMeldArrow meld={meld} owner={seat} mySeat={mySeat} size={9} vertical={rot} />
        </div>
      ))}
    </div>
  );
}

// 牌背只用到 faceDown，牌面內容不會顯示
const BACK_TILE: Tile = { id: -1, suit: "z", rank: 7, display: "" };

/** 左右家的手牌欄：金框外、朝向主人；16 張那一列靠金框，摸進的第 17 張放外側那一列（像自己的手牌一樣分開）。
 *  沒眼牌＝牌背（張數＝tileCount）；我眼牌＝同一個位置翻成牌面，摸進的那張加金框 */
function SideHand({ count, h }: { count: number; h?: MjOpponentHand }) {
  type Cell = { key: string; tile: Tile; drew: boolean; back: boolean };
  let cells: Cell[];
  if (h) {
    const drew = h.drawnTileId != null ? h.hand.find((t) => t.id === h.drawnTileId) : undefined;
    cells = [...h.hand.filter((t) => t !== drew), ...(drew ? [drew] : [])].map((t) => ({ key: String(t.id), tile: t, drew: t === drew, back: false }));
  } else {
    cells = Array.from({ length: count }, (_, i) => ({ key: `b${i}`, tile: BACK_TILE, drew: false, back: true }));
  }
  const cell = (c: Cell) => (
    <span key={c.key} className="cell">
      <div className={c.drew ? "drew" : undefined}>
        <MjTile tile={c.tile} width={12} height={16} faceDown={c.back} />
      </div>
    </span>
  );
  return (
    <div className="mjm-sidehand">
      <div className="col main">{cells.map(cell)}</div>
    </div>
  );
}

function TingTag({ on, pop }: { on: boolean; pop?: boolean }) {
  return on ? <span className={`mjm-tag ting ${pop ? "pop" : ""}`}>聽</span> : null;
}

function EyeTag({ on, pop }: { on: boolean; pop?: boolean }) {
  return on ? <span className={`mjm-tag eye ${pop ? "pop" : ""}`}>眼</span> : null;
}

/** 聽／眼標示：地聽＋眼牌＝只顯示 MIGI（小宜眼牌 v5）；只有眼牌＝眼；只有地聽（舊牌局）＝聽 */
function DeclareTags({ ting, eye, fx }: { ting: boolean; eye: boolean; fx?: { both: boolean } }) {
  if (ting && eye) return <span className={`mjm-tag migi ${fx ? "pop" : ""}`}>MIGI</span>;
  if (eye) return <EyeTag on pop={!!fx} />;
  return <TingTag on={ting} pop={!!fx} />;
}

/** 名牌宣告特效：牌桌中央的字飛到名牌時（--fx-arrive），名牌亮一下、標示才彈出來（桌機共用） */
export function fxClass(fx?: { both: boolean }) {
  return fx ? `mjm-declare ${fx.both ? "mjm-dc-migi" : "mjm-dc-eye"}` : "";
}

/**
 * 宣告特效（桌機、手機共用）：先在牌桌中央出現，停一下再縮小飛進宣告者名牌（data-fx-seat）上的標示。
 * MIGI＝方案 A 綠色大字＋牌桌變暗，1.41 秒到；一般眼牌＝紫色小卡片、牌桌不變暗，0.83 秒到；之後由 hook 移除。
 * 飛的字掛到 body，才不會被牌桌裁掉；pointer-events: none，不擋動作列
 */
export function DeclareFx({ seat, name, migi, desk }: { seat: number; name: string; migi?: boolean; desk?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  // 畫面出來前量好起點（牌桌中央）和終點（名牌上的標示），直接寫進飛的字的樣式
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    const el = flyRef.current;
    if (!box || !el) return;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const plate = document.querySelector(`[data-fx-seat="${seat}"]`);
    const t = (plate?.querySelector(".mjm-tag.pop, .mjm-pop") ?? plate)?.getBoundingClientRect();
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--fx-dx", `${t ? t.left + t.width / 2 - x : 0}px`);
    el.style.setProperty("--fx-dy", `${t ? t.top + t.height / 2 - y : 0}px`);
  }, [seat]);
  const kind = `${migi ? "a" : "eye"} ${desk ? "desk" : ""}`;
  return (
    <div ref={ref} className={`mjm-fx ${kind}`} aria-hidden>
      {migi && <div className="bg" />}
      {createPortal(
        <div ref={flyRef} className={`mjm-fly ${kind}`} aria-hidden>
          {migi ? (
            <>
              <div className="word">MIGI</div>
              <div className="who">{name}</div>
            </>
          ) : (
            <div className="card">
              <div className="word">眼牌</div>
              <div className="who">{name}</div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 我眼牌時：對家取代牌背條，翻開手牌（一列）；摸進的那張排最後＋金框 */
function EyeHand({ h, w, ht }: { h: MjOpponentHand; w: number; ht: number }) {
  const drew = h.drawnTileId != null ? h.hand.find((t) => t.id === h.drawnTileId) : undefined;
  const tiles = [...h.hand.filter((t) => t !== drew), ...(drew ? [drew] : [])];
  return (
    <div className="mjm-eyehand">
      {tiles.map((t) => (
        <div key={t.id} className={t === drew ? "drew" : undefined}>
          <MjTile tile={t} width={w} height={ht} />
        </div>
      ))}
    </div>
  );
}

/** 對家沒眼牌時的手牌：一張一張的牌背（和左右家一樣，顏色跟著偏好設定的牌背）。
 *  張數是 3n＋2（16 張＋剛摸進一張）時，最後一張是摸進來的，和其他牌隔開一點（老闆 2026-10-22） */
function TopBacks({ count }: { count: number }) {
  const drew = count % 3 === 2;
  const tile = (i: number) => <MjTile key={i} tile={BACK_TILE} width={12} height={16} faceDown />;
  return (
    <div className="mjm-topbacks" data-top-backs={count}>
      {Array.from({ length: drew ? count - 1 : count }, (_, i) => tile(i))}
      {drew && <span className="drew" data-top-drew>{tile(count - 1)}</span>}
    </div>
  );
}

/** 左右家：兩行直式名牌＋牌背條＋吃碰槓／花（牌不旋轉） */
function SidePanel({
  player,
  isCurrent,
  isDoor,
  score,
  dealerConsecutive,
  isTing,
  isEye,
  fx,
  opponent,
  windChar,
  side,
  busy,
  mySeat,
}: {
  side: "left" | "right";
  player: MjPlayer | undefined;
  isCurrent: boolean;
  isDoor: boolean;
  windChar: string;
  score?: number;
  dealerConsecutive?: number;
  isTing: boolean;
  isEye: boolean;
  fx?: { both: boolean };
  opponent?: MjOpponentHand;
  busy?: boolean;
  mySeat: number;
}) {
  if (!player) return <div className={`mjm-side ${side}`} />;
  const plate = (
    <div className={`mjm-plate mjm-plate-v ${isCurrent ? "on" : ""} ${fxClass(fx)}`} data-fx-seat={player.seat}>
      <div className="l1">
        <span className={`mjm-wind ${isDoor ? "door" : ""}`}>{windChar}</span>
        <span className="mjm-nm">{player.name}</span>
      </div>
      {/* 名牌固定大小：標示一行（不換行）、分數獨立一行，標示變多也不會把名牌撐大 */}
      <div className="l2">
        <DealerTag player={player} consecutive={dealerConsecutive} short />
        <DeclareTags ting={isTing} eye={isEye} fx={fx} />
      </div>
      <div className="l3">
        <Score score={score} />
      </div>
    </div>
  );
  // 吃碰區 v2：由外往內＝名牌（下面接花膠囊）→ 手牌欄（12×16）→ 吃碰槓（17×23、轉向、靠海底）。
  // 我眼牌時牌背翻成牌面、暗槓翻開，吃碰槓縮成 10×14（翻開的手牌要比吃碰牌大）；吃碰欄有最小寬度，縮小時版面不跳（左右家版面 2026-10-17）
  return (
    <div className={`mjm-side ${side} handside`}>
      <div className="sideplate">
        {plate}
        <MjFlowerTag flowers={player.flowers} name={player.name} w={12} h={16} popW={20} popH={27} busy={busy} />
      </div>
      <SideHand count={player.tileCount} h={opponent} />
      <Melds revealed={opponent?.revealed ?? player.revealed} w={opponent ? 10 : 17} h={opponent ? 14 : 23} reveal={!!opponent} rot seat={player.seat} mySeat={mySeat} />
    </div>
  );
}

/** 左右家棄牌：每欄 4 張，牌旋轉朝向該家 */
/** 左右家海底：每欄 15×20 的牌直排，一欄最多 6 張（左右家版面 2026-10-17）。
 *  一欄放幾張看牌桌中間那一列實際多高：667、726 這類矮螢幕放不下 6 張就改 5 張（最少 4 張），
 *  還差一點時把牌與牌的間距從 1px 壓小，不會被上下的海底切掉 */
const DIS_V_TILE = 15;
function VerticalDiscards({ tiles, side }: { tiles: Tile[]; side: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ per: 6, gap: 1 });
  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!row) return;
    const measure = () => {
      const h = row.clientHeight;
      const per = Math.max(4, Math.min(6, Math.floor(h / DIS_V_TILE)));
      const gap = per > 1 ? Math.max(0, Math.min(1, (h - per * DIS_V_TILE) / (per - 1))) : 1;
      setFit((f) => (f.per === per && f.gap === gap ? f : { per, gap }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  const cols: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += fit.per) cols.push(tiles.slice(i, i + fit.per));
  return (
    <div ref={ref} className={`mjm-dis-v ${side}`}>
      {cols.map((col, ci) => (
        <div key={ci} className="col" style={{ gap: fit.gap }}>
          {col.map((t) => (
            <div key={t.id} className="cell">
              <MjTile tile={t} width={15} height={20} matchable />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// 骰子點位（100×100 的座標）：左右兩欄 28／72、上下三排 28／50／72，每一面都對稱
const DIE_PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

/** 骰子（桌機、手機共用）：SVG 畫的白色圓角骰子，點的大小一致；1、4 點紅色，其他黑色 */
export function Die({ value, size = 18 }: { value: number; size?: number }) {
  const id = useId();
  const pips = DIE_PIPS[value] ?? DIE_PIPS[1];
  const color = value === 1 || value === 4 ? "#c81e1e" : "#1c1917";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flex: "0 0 auto", filter: "drop-shadow(0 1.5px 1.5px rgba(0,0,0,.45))" }} aria-label={`${value} 點`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e7e2d6" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="20" fill={`url(#${id})`} stroke="rgba(120,100,70,.45)" strokeWidth="2" />
      {pips.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9.5" fill={color} />
      ))}
    </svg>
  );
}

export default function MjBoardMobile({
  players,
  mySeat,
  myHand,
  currentTurn,
  dealerSeat,
  lastDiscard,
  availableActions,
  pendingAddKong,
  robKong,
  pendingFlowerRob,
  robFlower,
  tingSeats,
  eyeSeats,
  eyeOptions,
  opponentHands,
  declareFx,
  wallRemaining,
  needsDraw,
  needsDiscard,
  isMyTurn,
  playerName,
  drawnTileId,
  slowDraw,
  actionNotice,
  focusDiscard,
  paceNote,
  onDiscard,
  onAction,
  dice,
  doorSeat,
  playerScores,
  dealerConsecutive,
  roomCode,
  roundLabel,
  basePoints,
  fanPoints,
  onLeave,
  chatButton,
}: MjBoardMobileProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 眼牌：記住是對哪一組選項按下的，換回合自動失效
  const [eyeArmedKey, setEyeArmedKey] = useState<string | null>(null);

  const seatPlayer = (offset: number) => players.find((p) => p.seat === (mySeat + offset) % 4);
  const top = seatPlayer(2);
  const left = seatPlayer(3);
  const right = seatPlayer(1);
  const me = players.find((p) => p.seat === mySeat);
  const windOf = (seat: number) => seatWindChar(seat, doorSeat, dealerSeat);
  const nameOf = (seat: number) => players.find((p) => p.seat === seat)?.name ?? "";
  const scoreOf = (p?: MjPlayer) => (p && playerScores ? playerScores[p.seat] : undefined);

  const isTing = tingSeats.includes(mySeat);
  const isEye = eyeSeats.includes(mySeat);
  // 地聽／眼牌後由伺服器處理出牌，不能自己選牌
  const canPick = needsDiscard && !isTing && !isEye;
  const canEye = canPick && eyeOptions.length > 0;
  const eyeKey = eyeOptions.join(",");
  const eyeArmed = canEye && eyeArmedKey === eyeKey;
  // 按下眼牌：可以打的牌往上浮、點一下就打出並宣告；其他的變暗不能點
  const eyePick = (id: number) => eyeArmed && eyeOptions.includes(id);
  const eyeBlocked = (id: number) => eyeArmed && !eyeOptions.includes(id);
  const fxOf = (seat?: number) => declareFx.find((f) => f.seat === seat);
  const migiFx = declareFx.find((f) => f.both);
  const eyeFx = declareFx.find((f) => !f.both);
  const oppOf = (seat?: number) => opponentHands?.find((h) => h.seat === seat);
  // 輪到我打牌或有吃碰槓胡按鈕時，花的展開面板收起來，不擋操作
  const flowerBusy = needsDiscard || availableActions.length > 0;

  // 不是我出牌時也能點手牌查場上同一種牌（老闆 2026-10-17）：牌一樣往上抬，但沒有「打出」鈕。
  // 輪到我（摸牌、出牌各一次）或開新的一局（剩餘張數變多）就清掉選取，避免查完剛好輪到我時一按就打掉。
  // 看 isMyTurn／needsDiscard 而不是 canPick：眼牌、地聽的人 canPick 一直是 false，也要清
  const turnStage = isMyTurn ? (needsDiscard ? 2 : 1) : 0;
  const [prevPick, setPrevPick] = useState({ turnStage, wall: wallRemaining });
  if (prevPick.turnStage !== turnStage || prevPick.wall !== wallRemaining) {
    setPrevPick({ turnStage, wall: wallRemaining });
    if (turnStage > prevPick.turnStage || wallRemaining > prevPick.wall) setSelectedId(null);
  }
  // 選取的牌已經不在手上、或按了眼牌（點牌直接打出）→ 視為沒選
  const selected = !eyeArmed ? myHand.find((t) => t.id === selectedId) ?? null : null;

  // 摸進的那張分開顯示（找不到就把最後一張當摸進的）
  let drawnTile: Tile | null = null;
  let mainTiles = myHand;
  if (drawnTileId != null) { // 牌 id 可能是 0
    drawnTile = myHand.find((t) => t.id === drawnTileId) ?? null;
    if (drawnTile) {
      mainTiles = myHand.filter((t) => t.id !== drawnTileId);
    } else if (myHand.length > 0) {
      drawnTile = myHand[myHand.length - 1];
      mainTiles = myHand.slice(0, -1);
    }
  }

  const handTile = (t: Tile) => (
    <div key={t.id} className={eyePick(t.id) ? "mjm-pick" : undefined} style={eyeBlocked(t.id) ? { opacity: 0.35 } : undefined}>
      <MjTile
        tile={t}
        width="var(--tile-hand-w)"
        height="var(--tile-hand-h)"
        selected={selected?.id === t.id}
        onClick={() => {
          if (eyeBlocked(t.id)) return;
          if (eyeArmed) {
            onDiscard(t.id, true);
            return;
          }
          setSelectedId((prev) => (prev === t.id ? null : t.id));
        }}
      />
    </div>
  );

  const eyeToggle = canEye && (
    <button
      type="button"
      className={`mjm-btn eye ${eyeArmed ? "on" : ""}`}
      aria-pressed={eyeArmed}
      onClick={() => setEyeArmedKey(eyeArmed ? null : eyeKey)}
    >
      眼牌
    </button>
  );

  const status = (() => {
    if (pendingAddKong) return { text: `${nameOf(pendingAddKong.seat)} 加槓中`, me: false };
    if (pendingFlowerRob) return { text: `等待 ${nameOf(pendingFlowerRob.robberSeat)}`, me: false };
    if (paceNote) return { text: paceText(paceNote, nameOf(paceNote.seat)), me: false };
    if (lastDiscard != null && lastDiscard.from === mySeat && currentTurn === mySeat) return { text: "等待其他玩家", me: false };
    if (isMyTurn) return { text: needsDraw ? "輪到你摸牌" : "輪到你打牌", me: true };
    return { text: `等待 ${nameOf(currentTurn)}`, me: false };
  })();

  const winLabel = robFlower ? "七搶一" : robKong ? "搶槓胡" : "胡";

  return (
    <TileMatchContext.Provider value={selected ? tileKind(selected) : null}>
    <div className="mjm-app">
      <MjClaimFx notice={actionNotice} name={actionNotice ? nameOf(actionNotice.seat) : ""} mySeat={mySeat} />
      {/* 左上選單：設定、房號、圈局、底台、離開（唯一的設定入口） */}
      <MjTableMenu roomCode={roomCode} roundLabel={roundLabel} basePoints={basePoints} fanPoints={fanPoints} onLeave={onLeave} />

      {/* 對家 */}
      <div className="mjm-top">
        {top && (
          <>
            <div className={`mjm-plate ${top.seat === currentTurn ? "on" : ""} ${fxClass(fxOf(top.seat))}`} data-fx-seat={top.seat}>
              <span className={`mjm-wind ${doorSeat === top.seat ? "door" : ""}`}>{windOf(top.seat)}</span>
              <span className="mjm-nm">{top.name}</span>
              <DealerTag player={top} consecutive={dealerConsecutive} />
              <DeclareTags ting={tingSeats.includes(top.seat)} eye={eyeSeats.includes(top.seat)} fx={fxOf(top.seat)} />
              <Score score={scoreOf(top)} />
            </div>
            <MjFlowerTag flowers={top.flowers} name={top.name} w={12} h={16} popW={20} popH={27} busy={flowerBusy} />
            {oppOf(top.seat) ? (
              <>
                {/* 眼牌模式：手牌 16×22 比吃碰槓 12×16 大 */}
                <EyeHand h={oppOf(top.seat)!} w={16} ht={22} />
                <Melds revealed={oppOf(top.seat)!.revealed} w={12} h={16} reveal seat={top.seat} mySeat={mySeat} />
              </>
            ) : (
              <>
                <TopBacks count={top.tileCount} />
                <Melds revealed={top.revealed} w={12} h={16} seat={top.seat} mySeat={mySeat} />
              </>
            )}
          </>
        )}
      </div>

      {/* 左家 | 牌桌 | 右家 */}
      <div className="mjm-mid">
        <SidePanel
          mySeat={mySeat}
          side="left"
          player={left}
          isCurrent={left?.seat === currentTurn}
          isDoor={left != null && doorSeat === left.seat}
          score={scoreOf(left)}
          dealerConsecutive={dealerConsecutive}
          isTing={left != null && tingSeats.includes(left.seat)}
          isEye={left != null && eyeSeats.includes(left.seat)}
          fx={fxOf(left?.seat)}
          opponent={oppOf(left?.seat)}
          busy={flowerBusy}
          windChar={left ? windOf(left.seat) : ""}
        />

        <div className="mjm-table" data-mj-table>
          {/* 對家棄牌：第一張在右、往左長 */}
          <div className="mjm-dis-h rev">
            {(top?.discards ?? []).map((t) => (
              <MjTile key={t.id} tile={t} width={18} height={24} matchable />
            ))}
          </div>

          <div className="mjm-mid-row">
            <VerticalDiscards tiles={left?.discards ?? []} side="left" />
            {/* 中間：剩餘張數＋風圈＋骰子同一個框（老闆 2026-10-17），剛打出的牌在右（一直亮到下一張打出） */}
            <div className="mjm-center">
              <div className="mjm-info">
                <span className="big">{wallRemaining}</span>
                <span className="lab">剩餘</span>
                {roundLabel && <span className="rnd">{roundLabel}</span>}
                {dice && (
                  <span className="dice" data-center-dice>
                    <Die value={dice[0]} size={10} />
                    <Die value={dice[1]} size={10} />
                    <Die value={dice[2]} size={10} />
                  </span>
                )}
              </div>
              {pendingAddKong ? (
                <div className="mjm-focus alert">
                  <div className="tile"><MjTile tile={pendingAddKong.tile} width={30} height={41} /></div>
                  <span className="cap">{nameOf(pendingAddKong.seat)} 加槓中</span>
                </div>
              ) : focusDiscard ? (
                <div className="mjm-focus" data-focus-discard={focusDiscard.tile.id}>
                  <div className="tile"><MjTile tile={focusDiscard.tile} width={30} height={41} /></div>
                  <span className="cap">{nameOf(focusDiscard.from)} 打出</span>
                </div>
              ) : null}
            </div>
            <VerticalDiscards tiles={right?.discards ?? []} side="right" />
          </div>

          {/* 我的棄牌：第一張在左、往右長 */}
          <div className="mjm-dis-h">
            {(me?.discards ?? []).map((t) => (
              <MjTile key={t.id} tile={t} width={18} height={24} matchable />
            ))}
          </div>

          {/* 七搶一：只蓋牌桌，按鈕在動作列 */}
          {pendingFlowerRob && (
            <div className="mjm-overlay">
              <div className="mjm-card">
                <span className="ttl">七　搶　一</span>
                <div className="big-t"><MjTile tile={pendingFlowerRob.tile} width={44} height={60} /></div>
                <span className="sub">{nameOf(pendingFlowerRob.fromSeat)} 摸到第 8 張花</span>
              </div>
            </div>
          )}
          {/* 宣告特效：四家都看得到，從牌桌中央飛進宣告者名牌（MIGI 大、暗桌；一般眼牌小、不暗桌） */}
          {migiFx && <DeclareFx seat={migiFx.seat} name={nameOf(migiFx.seat)} migi />}
          {eyeFx && <DeclareFx seat={eyeFx.seat} name={nameOf(eyeFx.seat)} />}
        </div>

        <SidePanel
          mySeat={mySeat}
          side="right"
          player={right}
          isCurrent={right?.seat === currentTurn}
          isDoor={right != null && doorSeat === right.seat}
          score={scoreOf(right)}
          dealerConsecutive={dealerConsecutive}
          isTing={right != null && tingSeats.includes(right.seat)}
          isEye={right != null && eyeSeats.includes(right.seat)}
          fx={fxOf(right?.seat)}
          opponent={oppOf(right?.seat)}
          busy={flowerBusy}
          windChar={right ? windOf(right.seat) : ""}
        />
      </div>

      {/* 狀態／動作列（固定 46px） */}
      <div className="mjm-action">
        {availableActions.length > 0 ? (
          <>
            {/* 吃碰槓胡的按鈕改由金色橫幅（MjClaimBanner，疊層）顯示，眼牌鈕也一起放進去（動作列會被橫幅蓋住） */}
            <MjClaimBanner actions={availableActions} onAction={onAction} winLabel={winLabel} passLabel={robKong || robFlower ? "不搶" : "過"} extra={eyeToggle} />
          </>
        ) : canPick && selected ? (
          <>
            <span className="mjm-status me">輪到你打牌</span>
            {eyeToggle}
            <button
              type="button"
              className="mjm-btn wide"
              onClick={() => {
                onDiscard(selected.id);
                setSelectedId(null);
              }}
            >
              打出
              <MjTile tile={selected} width={20} height={27} />
            </button>
          </>
        ) : canEye ? (
          <>
            <span className="mjm-status me">輪到你打牌</span>
            {eyeToggle}
          </>
        ) : (
          <span className={`mjm-status ${status.me ? "me" : "wait"}`}>{status.text}</span>
        )}
      </div>

      {/* 我的資訊列＋手牌 */}
      <div className="mjm-me">
        <div className="mjm-me-info">
          {/* 左右兩邊等寬，吃碰區夾在中間就會置中；左邊放不下時不縮，吃碰區往右讓 */}
          <div className="mjm-me-l">
            {/* 風位＋名字＋標示包一層當宣告特效的錨點（外觀不變，分數留在外面） */}
            <span className={`mjm-me-who ${fxClass(fxOf(mySeat))}`} data-fx-seat={mySeat}>
              <span className={`mjm-wind ${doorSeat === mySeat ? "door" : ""}`}>{windOf(mySeat)}</span>
              <span className="mjm-nm">{playerName}</span>
              {me && <DealerTag player={me} consecutive={dealerConsecutive} withLa />}
              <DeclareTags ting={isTing} eye={isEye} fx={fxOf(mySeat)} />
            </span>
            <Score score={scoreOf(me)} />
            {me && <MjFlowerTag flowers={me.flowers} name={me.name} w={14} h={19} popW={20} popH={27} busy={flowerBusy} />}
          </div>
          {me && <Melds revealed={me.revealed} w={14} h={19} mine seat={mySeat} mySeat={mySeat} />}
          <div className="mjm-me-r">
            {chatButton}
            <span className="cnt">{myHand.length} 張</span>
          </div>
        </div>
        <div className="mjm-hand">
          <div className="main">{mainTiles.map(handTile)}</div>
          {drawnTile && (
            <div className="drawn">
              {slowDraw?.tileId === drawnTile.id ? (
                <SlowDrawTile key={drawnTile.id} tile={drawnTile} win={slowDraw.win} width="var(--tile-hand-w)" height="var(--tile-hand-h)" />
              ) : (
                handTile(drawnTile)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </TileMatchContext.Provider>
  );
}
