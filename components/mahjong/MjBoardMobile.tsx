"use client";

// 手機橫向牌桌（小宜規格 2026-10-14）。只在 (orientation: landscape) and (max-height: 500px)
// 由 page.tsx 掛載；桌機仍用 MjBoard。版面與尺寸對應 globals.css 的 .mjm-* 樣式。

import { useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld } from "@/lib/mahjong/gameState";
import type { MjPlayer } from "@/hooks/useMahjong";
import type { MjBoardProps } from "./MjBoard";
import MjTile from "./MjTile";
import { seatWindChar } from "./seatWind";

const ACTION_NAMES: Record<string, string> = {
  chi: "吃",
  pong: "碰",
  kong: "槓",
  concealed_kong: "暗槓",
  add_kong: "加槓",
  win: "胡",
  pass: "過",
};

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

function DealerTag({ player, consecutive, withLa }: { player: MjPlayer; consecutive?: number; withLa?: boolean }) {
  if (!player.isDealer) return null;
  const n = consecutive ?? 0;
  return (
    <span className="mjm-tag dealer">
      莊{n > 0 ? ` 連${n}${withLa ? `·拉${n}` : ""}` : ""}
    </span>
  );
}

/** 吃碰槓＋花。暗槓：自己看得到牌面，別家全部蓋牌 */
function Melds({ revealed, flowers, w, h, mine }: { revealed: Meld[]; flowers: Tile[]; w: number; h: number; mine?: boolean }) {
  if (revealed.length === 0 && flowers.length === 0) return null;
  return (
    <div className="mjm-melds">
      {revealed.map((meld, mi) => (
        <div key={mi} className="mjm-meld">
          {meld.tiles.map((t) => (
            <MjTile key={t.id} tile={t} width={w} height={h} faceDown={!mine && meld.type === "concealed_kong"} />
          ))}
        </div>
      ))}
      {flowers.length > 0 && (
        <div className="mjm-flowers">
          {flowers.map((f) => (
            <MjTile key={f.id} tile={f} width={w} height={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function TingTag({ on }: { on: boolean }) {
  return on ? <span className="mjm-tag ting">聽</span> : null;
}

function BackBar({ count, width }: { count: number; width: number }) {
  return (
    <div className="mjm-backbar">
      <div className="bar" style={{ width }} />
      <span className="n">{count}</span>
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
  windChar,
}: {
  player: MjPlayer | undefined;
  isCurrent: boolean;
  isDoor: boolean;
  windChar: string;
  score?: number;
  dealerConsecutive?: number;
  isTing: boolean;
}) {
  if (!player) return <div className="mjm-side" />;
  return (
    <div className="mjm-side">
      <div className={`mjm-plate mjm-plate-v ${isCurrent ? "on" : ""}`}>
        <div className="l1">
          <span className={`mjm-wind ${isDoor ? "door" : ""}`}>{windChar}</span>
          <span className="mjm-nm">{player.name}</span>
        </div>
        <div className="l2">
          <DealerTag player={player} consecutive={dealerConsecutive} />
          <TingTag on={isTing} />
          <Score score={score} />
        </div>
      </div>
      <BackBar count={player.tileCount} width={44} />
      <Melds revealed={player.revealed} flowers={player.flowers} w={16} h={22} />
    </div>
  );
}

/** 左右家棄牌：每欄 4 張，牌旋轉朝向該家 */
function VerticalDiscards({ tiles, side }: { tiles: Tile[]; side: "left" | "right" }) {
  const cols: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += 4) cols.push(tiles.slice(i, i + 4));
  return (
    <div className={`mjm-dis-v ${side}`}>
      {cols.map((col, ci) => (
        <div key={ci} className="col">
          {col.map((t) => (
            <div key={t.id} className="cell">
              <MjTile tile={t} width={18} height={24} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Die({ value }: { value: number }) {
  const pips: Record<number, number[]> = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  const on = pips[value] ?? pips[1];
  return (
    <div
      style={{
        width: 18, height: 18, borderRadius: 3, padding: 2, gap: 1,
        display: "grid", gridTemplate: "repeat(3, 1fr) / repeat(3, 1fr)",
        background: "linear-gradient(145deg, #fefcf5, #f1e9cf)",
        border: "1px solid rgba(140,110,60,.5)", boxShadow: "0 1px 3px rgba(0,0,0,.35)",
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} style={{ borderRadius: "50%", background: on.includes(i) ? "#7f1d1d" : "transparent" }} />
      ))}
    </div>
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
  tingOptions,
  wallRemaining,
  needsDraw,
  needsDiscard,
  isMyTurn,
  playerName,
  drawnTileId,
  actionNotice,
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
}: MjBoardMobileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 地聽：記住是對哪一組選項按下的，換回合自動失效
  const [tingArmedKey, setTingArmedKey] = useState<string | null>(null);

  const seatPlayer = (offset: number) => players.find((p) => p.seat === (mySeat + offset) % 4);
  const top = seatPlayer(2);
  const left = seatPlayer(3);
  const right = seatPlayer(1);
  const me = players.find((p) => p.seat === mySeat);
  const windOf = (seat: number) => seatWindChar(seat, doorSeat, dealerSeat);
  const nameOf = (seat: number) => players.find((p) => p.seat === seat)?.name ?? "";
  const scoreOf = (p?: MjPlayer) => (p && playerScores ? playerScores[p.seat] : undefined);

  const isTing = tingSeats.includes(mySeat);
  const canTing = needsDiscard && tingOptions.length > 0;
  const tingKey = tingOptions.join(",");
  const tingArmed = canTing && tingArmedKey === tingKey;
  const tingBlocked = (id: number) => tingArmed && !tingOptions.includes(id);
  // 地聽後由伺服器處理出牌，不能自己選牌
  const canPick = needsDiscard && !isTing;

  // 選取的牌已經不在手上、不能打、或按了地聽後不能選 → 視為沒選
  const picked = canPick ? myHand.find((t) => t.id === selectedId) ?? null : null;
  const selected = picked && !tingBlocked(picked.id) ? picked : null;

  // 摸進的那張分開顯示（找不到就把最後一張當摸進的）
  let drawnTile: Tile | null = null;
  let mainTiles = myHand;
  if (drawnTileId) {
    drawnTile = myHand.find((t) => t.id === drawnTileId) ?? null;
    if (drawnTile) {
      mainTiles = myHand.filter((t) => t.id !== drawnTileId);
    } else if (myHand.length > 0) {
      drawnTile = myHand[myHand.length - 1];
      mainTiles = myHand.slice(0, -1);
    }
  }

  const handTile = (t: Tile) => (
    <div key={t.id} style={canPick && tingBlocked(t.id) ? { opacity: 0.35 } : undefined}>
      <MjTile
        tile={t}
        width="var(--tile-hand-w)"
        height="var(--tile-hand-h)"
        selected={selected?.id === t.id}
        onClick={() => {
          if (!canPick || tingBlocked(t.id)) return;
          setSelectedId((prev) => (prev === t.id ? null : t.id));
        }}
      />
    </div>
  );

  const tingToggle = canTing && (
    <button
      type="button"
      className={`mjm-btn ting ${tingArmed ? "on" : ""}`}
      aria-pressed={tingArmed}
      onClick={() => setTingArmedKey(tingArmed ? null : tingKey)}
    >
      地聽
    </button>
  );

  const status = (() => {
    if (pendingAddKong) return { text: `${nameOf(pendingAddKong.seat)} 加槓中`, me: false };
    if (pendingFlowerRob) return { text: `等待 ${nameOf(pendingFlowerRob.robberSeat)}`, me: false };
    if (actionNotice) return { text: `${nameOf(actionNotice.seat)} ${ACTION_NAMES[actionNotice.type] ?? actionNotice.type}`, me: true };
    if (lastDiscard != null && lastDiscard.from === mySeat && currentTurn === mySeat) return { text: "等待其他玩家", me: false };
    if (isMyTurn) return { text: needsDraw ? "輪到你摸牌" : "輪到你打牌", me: true };
    return { text: `等待 ${nameOf(currentTurn)}`, me: false };
  })();

  const winLabel = robFlower ? "七搶一" : robKong ? "搶槓胡" : "胡";

  return (
    <div className="mjm-app">
      {/* 左上選單鈕：房號、圈局、底台、離開 */}
      <button type="button" className="mjm-menu" aria-label="選單" onClick={() => setMenuOpen((o) => !o)}>
        <i /><i /><i />
      </button>
      {menuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setMenuOpen(false)} />
          <div className="mjm-menu-pop">
            <span className="info">房號 {roomCode}</span>
            {roundLabel && <span className="info">{roundLabel}</span>}
            {basePoints != null && fanPoints != null && (
              <span className="info">底{basePoints} / 台{fanPoints}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onLeave();
              }}
            >
              離開房間
            </button>
          </div>
        </>
      )}

      {/* 對家 */}
      <div className="mjm-top">
        {top && (
          <>
            <div className={`mjm-plate ${top.seat === currentTurn ? "on" : ""}`}>
              <span className={`mjm-wind ${doorSeat === top.seat ? "door" : ""}`}>{windOf(top.seat)}</span>
              <span className="mjm-nm">{top.name}</span>
              <DealerTag player={top} consecutive={dealerConsecutive} />
              <TingTag on={tingSeats.includes(top.seat)} />
              <Score score={scoreOf(top)} />
            </div>
            <BackBar count={top.tileCount} width={92} />
            <Melds revealed={top.revealed} flowers={top.flowers} w={16} h={22} />
          </>
        )}
      </div>

      {/* 左家 | 牌桌 | 右家 */}
      <div className="mjm-mid">
        <SidePanel
          player={left}
          isCurrent={left?.seat === currentTurn}
          isDoor={left != null && doorSeat === left.seat}
          score={scoreOf(left)}
          dealerConsecutive={dealerConsecutive}
          isTing={left != null && tingSeats.includes(left.seat)}
          windChar={left ? windOf(left.seat) : ""}
        />

        <div className="mjm-table">
          {/* 對家棄牌：第一張在右、往左長 */}
          <div className="mjm-dis-h rev">
            {(top?.discards ?? []).map((t) => (
              <MjTile key={t.id} tile={t} width={18} height={24} />
            ))}
          </div>

          <div className="mjm-mid-row">
            <VerticalDiscards tiles={left?.discards ?? []} side="left" />
            <div className="mjm-center">
              <div className="mjm-info">
                <span className="big">{wallRemaining}</span>
                <span className="lab">剩餘</span>
                {roundLabel && <span className="rnd">{roundLabel}</span>}
              </div>
              {pendingAddKong ? (
                <div className="mjm-focus alert">
                  <div className="tile"><MjTile tile={pendingAddKong.tile} width={30} height={41} /></div>
                  <span className="cap">{nameOf(pendingAddKong.seat)} 加槓中</span>
                </div>
              ) : lastDiscard ? (
                <div className="mjm-focus">
                  <div className="tile"><MjTile tile={lastDiscard.tile} width={30} height={41} /></div>
                  <span className="cap">{nameOf(lastDiscard.from)} 打出</span>
                </div>
              ) : dice && !pendingFlowerRob ? (
                <div className="mjm-focus">
                  <div style={{ display: "flex", gap: 3 }}>
                    <Die value={dice[0]} />
                    <Die value={dice[1]} />
                    <Die value={dice[2]} />
                  </div>
                  <span className="cap">{dice[0] + dice[1] + dice[2]} 點開門</span>
                </div>
              ) : null}
            </div>
            <VerticalDiscards tiles={right?.discards ?? []} side="right" />
          </div>

          {/* 我的棄牌：第一張在左、往右長 */}
          <div className="mjm-dis-h">
            {(me?.discards ?? []).map((t) => (
              <MjTile key={t.id} tile={t} width={18} height={24} />
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
        </div>

        <SidePanel
          player={right}
          isCurrent={right?.seat === currentTurn}
          isDoor={right != null && doorSeat === right.seat}
          score={scoreOf(right)}
          dealerConsecutive={dealerConsecutive}
          isTing={right != null && tingSeats.includes(right.seat)}
          windChar={right ? windOf(right.seat) : ""}
        />
      </div>

      {/* 狀態／動作列（固定 46px） */}
      <div className="mjm-action">
        {availableActions.length > 0 ? (
          <>
            {availableActions.map((action, i) => (
              <button
                key={`${action.type}-${i}`}
                type="button"
                className={`mjm-btn ${action.type === "win" ? "win" : ""}`}
                onClick={() => onAction(action.type, action.tiles)}
              >
                {action.type === "win" ? winLabel : ACTION_NAMES[action.type] ?? action.type}
                {(action.type === "chi" || action.type === "add_kong") && action.tiles && (
                  <span style={{ display: "flex", gap: 1 }}>
                    {action.tiles.map((t) => (
                      <MjTile key={t.id} tile={t} width={16} height={22} />
                    ))}
                  </span>
                )}
              </button>
            ))}
            <button type="button" className="mjm-btn ghost" onClick={() => onAction("pass")}>
              {robKong || robFlower ? "不搶" : "過"}
            </button>
            {tingToggle}
          </>
        ) : selected ? (
          <>
            <span className="mjm-status me">輪到你打牌</span>
            {tingToggle}
            <button
              type="button"
              className="mjm-btn wide"
              onClick={() => {
                onDiscard(selected.id, tingArmed);
                setSelectedId(null);
              }}
            >
              {tingArmed ? "打出＋地聽" : "打出"}
              <MjTile tile={selected} width={20} height={27} />
            </button>
          </>
        ) : canTing ? (
          <>
            <span className="mjm-status me">輪到你打牌</span>
            {tingToggle}
          </>
        ) : (
          <span className={`mjm-status ${status.me ? "me" : "wait"}`}>{status.text}</span>
        )}
      </div>

      {/* 我的資訊列＋手牌 */}
      <div className="mjm-me">
        <div className="mjm-me-info">
          <span className={`mjm-wind ${doorSeat === mySeat ? "door" : ""}`}>{windOf(mySeat)}</span>
          <span className="mjm-nm">{playerName}</span>
          {me && <DealerTag player={me} consecutive={dealerConsecutive} withLa />}
          <TingTag on={isTing} />
          <Score score={scoreOf(me)} />
          {me && <Melds revealed={me.revealed} flowers={me.flowers} w={20} h={27} mine />}
          <span className="cnt">{myHand.length} 張</span>
        </div>
        <div className="mjm-hand">
          <div className="main">{mainTiles.map(handTile)}</div>
          {drawnTile && <div className="drawn">{handTile(drawnTile)}</div>}
        </div>
      </div>
    </div>
  );
}
