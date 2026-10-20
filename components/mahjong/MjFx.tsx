"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FX_KINDS, FX_LABEL, abortFx, enqueueFx, preloadFx, setFxLayer, unlockAudio, type FxKind } from "@/lib/mahjong/fx/engine";
import { fxCooldownLeft, sendFx, setFxTable, subscribeFx, type FxMessage } from "@/lib/mahjong/fx/transport";

const ICON: Record<FxKind, string> = {
  love: "/mahjong-fx/heart-glossy.png", cash: "/mahjong-fx/bill-classic.png", egg: "/mahjong-fx/egg-lottie-whole.webp",
  water: "/mahjong-fx/bucket-water.webp", punch: "/mahjong-fx/glove-red.png",
};
const VERB: Record<FxKind, string> = { love: "送愛心", cash: "砸錢", egg: "丟雞蛋", water: "潑水", punch: "出拳" };

/** 互動特效（小宜〈互動特效-5種定案規格〉）：牌桌右下 🎯 鈕 → 選一位玩家 → 5 種特效；全螢幕特效層 pointer-events:none，不擋出牌、吃碰胡。
 *  suspended＝結算畫面：特效全部收掉 */
export default function MjFx({
  players, mySeat, suspended, desk,
}: {
  players: { id: string; name: string; seat: number }[];
  mySeat: number;
  suspended: boolean;
  desk: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [table, setTable] = useState<DOMRect | null>(null);


  useEffect(() => {
    setFxLayer(layerRef.current);
    void preloadFx().then((ok) => setReady(ok));
    return () => { abortFx(); setFxLayer(null); };
  }, []);

  useEffect(() => setFxTable(players.map((p) => ({ id: p.id, seat: p.seat })), mySeat), [players, mySeat]);

  // 結算畫面出現：整層清空
  useEffect(() => { if (suspended) abortFx(); }, [suspended]);

  // 冷卻倒數
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [open]);

  // 量牌桌位置：入口鈕在牌桌內緣右下、訊息在左下
  useLayoutEffect(() => {
    const el = document.querySelector("[data-mj-table]");
    if (!el) return;
    const measure = () => setTable(el.getBoundingClientRect());
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [desk, players.length]);

  // 收到特效：排進播放佇列（一次只播一個），左下顯示一行
  useEffect(() => subscribeFx((m: FxMessage) => {
    if (suspended) return;
    const queued = enqueueFx({ kind: m.kind, from: m.from, to: m.to, mySeat, crack: true, muted: false });
    if (!queued) return; // 素材還沒好、分頁在背景、排太多：這則不播
    const id = m.id;
    const text = `${m.from === mySeat ? "你" : m.fromName} 對 ${m.to === mySeat ? "你" : m.toName} ${VERB[m.kind]}`;
    setToasts((ts) => [...ts, { id, text }].slice(desk ? -3 : -2));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3200);
  }), [mySeat, suspended, desk]);

  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote((n) => (n === t ? null : n)), 1500);
  };
  const fire = async (kind: FxKind) => {
    unlockAudio();
    const r = await sendFx(kind, target);
    setNow(() => Date.now()); // 冷卻倒數馬上照伺服器給的時間更新
    if (r.ok) return;
    const sec = Math.ceil((r.leftMs ?? 0) / 1000);
    flash(r.reason === "busy" ? "送出中…" : r.reason === "loading" ? "素材還在載入" : r.reason === "cooldown" ? `冷卻中，還要 ${sec} 秒`
      : r.reason === "target_protected" ? `對方剛被打過，還要 ${sec} 秒`
      : r.reason === "failed" ? "送出失敗" : "先選一位玩家");
  };

  const others = players.filter((p) => p.seat !== mySeat).sort((a, b) => ((a.seat - mySeat + 4) % 4) - ((b.seat - mySeat + 4) % 4));
  const btn = desk ? 48 : 36, inset = desk ? 14 : 6;

  return (
    <>
      {/* 特效層：pointer-events:none 不能拿掉（播放中吃碰胡、打出照常按得到） */}
      <div ref={layerRef} className="mjfx-layer" data-fx-layer />
      {table && !suspended && mySeat >= 0 && (
        <>
          <div className="mjfx-toasts" style={{ left: table.left + inset, bottom: window.innerHeight - table.bottom + inset }}>
            {toasts.map((t) => <div key={t.id} className="mjfx-toast">{t.text}</div>)}
          </div>
          <button
            type="button"
            aria-label="互動特效"
            data-fx-btn
            className="mjfx-btn"
            style={{ width: btn, height: btn, left: table.right - inset - btn, top: table.bottom - inset - btn }}
            onClick={() => { unlockAudio(); setOpen((o) => !o); }}
          >
            🎯
          </button>
          {open && (
            <div
              className="mjfx-panel"
              data-fx-panel
              style={{ right: window.innerWidth - table.right + inset, bottom: window.innerHeight - table.bottom + inset + btn + 6 }}
            >
              <div className="who">
                {others.map((p) => (
                  <button type="button" key={p.seat} data-fx-target={p.seat} className={target === p.seat ? "on" : ""} onClick={() => setTarget(p.seat)}>{p.name}</button>
                ))}
              </div>
              <div className="kinds">
                {FX_KINDS.map((k) => {
                  const left = fxCooldownLeft(k, now);
                  return (
                    <button type="button" key={k} data-fx-kind={k} disabled={target == null || !ready} onClick={() => fire(k)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ICON[k]} alt="" />
                      <span>{FX_LABEL[k]}</span>
                      {left > 0 && <b className="cd" data-fx-cd>{Math.ceil(left / 1000)}</b>}
                    </button>
                  );
                })}
              </div>
              <p className="hint" data-fx-note>{note ?? (!ready ? "素材載入中…" : target == null ? "先選一位玩家" : "點一下就送出")}</p>
                          </div>
          )}
        </>
      )}
    </>
  );
}

