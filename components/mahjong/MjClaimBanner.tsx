"use client";

// 「輪到你可以吃／碰／槓／胡」的提示（小宜 2026-10-17 方向 A「金色橫幅」，老闆修改版）：
// ・整條從底部升起，底邊對齊我的資訊列上緣、往上長進牌桌下緣：不蓋我的手牌，也不動版面（.mjm-app 的 grid、--row-action 都不改）
// ・按鈕手機 48px、電腦 62px；「過」推到最右邊、深色，和宣告按鈕拉開
// ・老闆：拿掉左邊「誰打出哪張」（牌桌中間看得到）；上緣 6 秒倒數只是提醒，時間到不會自動過，一定等玩家自己按
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile from "./MjTile";

const NAMES: Record<string, string> = { chi: "吃", pong: "碰", kong: "槓", add_kong: "加槓", concealed_kong: "暗槓" };

export default function MjClaimBanner({
  actions,
  onAction,
  winLabel,
  passLabel,
  extra,
  desk = false,
}: {
  actions: { type: string; tiles?: Tile[] }[];
  onAction: (type: string, tiles?: Tile[]) => void;
  winLabel: string;
  passLabel: string;
  /** 其他要一起放的按鈕（例如眼牌鈕：動作列被橫幅蓋住，所以放進來） */
  extra?: React.ReactNode;
  desk?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 這一組選項（換一組＝新的宣告機會，倒數重來）；按過就先收起來，等下一組
  const sig = actions.map((a) => `${a.type}:${(a.tiles ?? []).map((t) => t.id).join(".")}`).join("|");
  const [pressed, setPressed] = useState<string | null>(null);
  const show = actions.length > 0 && pressed !== sig;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!show || !el) return;
    // 底邊對齊「我的資訊列」上緣（手機 .mjm-me-info、電腦 [data-my-info]）
    const place = () => {
      const info = document.querySelector(desk ? "[data-my-info]" : ".mjm-me-info")?.getBoundingClientRect();
      el.style.bottom = `${info ? Math.max(0, window.innerHeight - info.top) : 0}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [show, sig, desk]);

  if (!show || typeof document === "undefined") return null;
  const press = (type: string, tiles?: Tile[]) => {
    setPressed(sig);
    onAction(type, tiles);
  };
  const tw = desk ? 20 : 15;
  const th = desk ? 27 : 20;
  return createPortal(
    <div ref={ref} className={`mjm-claimbar${desk ? " desk" : ""}`} data-claim-banner>
      <div className="bar">
        {/* 倒數只是提醒：走完就停在 0，不會自動按「過」 */}
        <span key={sig} className="cd" aria-hidden />
        <span className="btns">
          {actions.map((a, i) => (
            <button key={`${a.type}-${i}`} type="button" className={`b${a.type === "win" ? " win" : ""}`} onClick={() => press(a.type, a.tiles)}>
              {a.type === "win" ? winLabel : NAMES[a.type] ?? a.type}
              {(a.type === "chi" || a.type === "add_kong") && a.tiles && (
                <span className="tiles">
                  {a.tiles.map((t) => <MjTile key={t.id} tile={t} width={tw} height={th} />)}
                </span>
              )}
            </button>
          ))}
        </span>
        {extra}
        <button type="button" className="b pass" onClick={() => press("pass")}>{passLabel}</button>
      </div>
    </div>,
    document.body,
  );
}
