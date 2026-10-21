"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FX_KINDS, FX_LABEL, abortFx, enqueueFx, preloadFx, setFxLayer, unlockAudio, type FxKind } from "@/lib/mahjong/fx/engine";
import { fxCooldownLeft, sendFx, setFxTable, subscribeFx, type FxMessage } from "@/lib/mahjong/fx/transport";
import { canUseFx, createFxMenu, isColumn, placeFxMenu, relOf, type FxMenuPlace } from "@/lib/mahjong/fx/menu";
import { isGuestTab } from "@/lib/mahjong/clientAuth";

const ICON: Record<FxKind, string> = {
  love: "/mahjong-fx/heart-glossy.png", cash: "/mahjong-fx/bill-classic.png", egg: "/mahjong-fx/egg-lottie-whole.webp",
  water: "/mahjong-fx/bucket-water.webp", punch: "/mahjong-fx/glove-red.png",
};
const MIN_HIT = 44; // 手機點擊範圍至少 44px

/** 互動特效（小宜〈互動特效-5種定案規格〉；入口改版 2026-10-21 老闆）：點對方的名牌 → 名牌旁邊跳出 5 種特效 → 點一下就丟給他。
 *  選單貼在名牌旁邊、有箭頭指著名牌，不放進海底（位置規則見 lib/mahjong/fx/menu.ts）。
 *  點自己的名牌沒反應；點選單外面或 4 秒沒操作就收起。全螢幕特效層 pointer-events:none，不擋出牌、吃碰胡。
 *  只有 LINE 登入、已入座的人能用；訪客、觀戰者、結算畫面都不行。
 *  suspended＝結算畫面：特效全部收掉。hand＝第幾局：結算、換局、卸載時選單和提示立刻清空、計時器全部取消 */
export default function MjFx({
  players, mySeat, suspended, desk, hand,
}: {
  players: { id: string; name: string; seat: number }[];
  mySeat: number;
  suspended: boolean;
  desk: boolean;
  hand: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu] = useState(createFxMenu);
  const { target, note, now } = useSyncExternalStore(menu.subscribe, menu.get, menu.get);
  const [place, setPlace] = useState<(FxMenuPlace & { seat: number }) | null>(null);
  const [ready, setReady] = useState(false);
  // 訪客：這個分頁登入的是遊客帳號（useMjAuth 也是用 isGuestTab() 決定 user.isGuest）。牌桌只在登入後才畫，不會有伺服器渲染不一致
  const [guest] = useState(isGuestTab);

  useEffect(() => {
    setFxLayer(layerRef.current);
    void preloadFx().then((ok) => setReady(ok));
    // 選單的 5 個圖示先載好、解碼好：第一次點名牌時圖示就在，不會先空白一下
    Object.values(ICON).forEach((u) => { const i = new Image(); i.src = u; void i.decode().catch(() => {}); });
    return () => { abortFx(); setFxLayer(null); };
  }, []);

  useEffect(() => setFxTable(players.map((p) => ({ id: p.id, seat: p.seat })), mySeat), [players, mySeat]);

  // 結算畫面出現：整層清空
  useEffect(() => { if (suspended) abortFx(); }, [suspended]);

  const enabled = canUseFx({ guest, mySeat, suspended });
  // 進結算、換局、不能用了、卸載：選單和提示立刻清空（畫面畫出來之前），計時器全部取消，送出中的結果作廢
  useLayoutEffect(() => () => menu.reset(), [menu, hand, suspended, enabled]);

  // 收到特效：交給播放引擎（重組排隊、輕組同時播）
  useEffect(() => subscribeFx((m: FxMessage) => {
    if (suspended) return;
    enqueueFx({ kind: m.kind, from: m.from, to: m.to, mySeat, crack: true, muted: false });
  }), [mySeat, suspended]);

  // 點名牌：在 document 上判斷點到哪一家（名牌元件不用改）。手機名牌比較矮，點擊範圍至少 44×44（以名牌中心往外擴）
  useEffect(() => {
    if (!enabled) return;
    const others = players.filter((p) => p.seat !== mySeat).map((p) => p.seat);
    const hit = (x: number, y: number) => others.find((seat) => {
      const r = document.querySelector(`[data-fx-seat="${seat}"]`)?.getBoundingClientRect();
      if (!r || !r.width) return false;
      const w = Math.max(r.width, MIN_HIT), h = Math.max(r.height, MIN_HIT), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
    });
    const inMenu = (t: EventTarget | null) => !!menuRef.current && t instanceof Node && menuRef.current.contains(t);
    // 按下時：點在選單和對方名牌以外的地方就收起（不攔截，出牌、吃碰胡照常）
    const down = (e: PointerEvent) => { if (!inMenu(e.target) && hit(e.clientX, e.clientY) === undefined) menu.close(); };
    const click = (e: MouseEvent) => {
      if (inMenu(e.target)) return;
      const el = e.target instanceof Element ? e.target : null;
      // 點到名牌附近的其他按鈕（例如花牌膠囊）照它自己的作用，不開選單
      if (el?.closest("button, a, input, [role='button']") && !el.closest("[data-fx-seat]")) return;
      const seat = hit(e.clientX, e.clientY);
      if (seat === undefined) return;
      unlockAudio();
      menu.toggle(seat);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click);
    window.addEventListener("resize", menu.close);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("click", click); window.removeEventListener("resize", menu.close); };
  }, [enabled, players, mySeat, menu]);

  // 選單位置：貼在名牌旁邊（左右家直排、對家橫排），不進海底、不蓋動作列和手牌、不超出畫面
  const rel = target == null ? 0 : relOf(target, mySeat);
  useLayoutEffect(() => {
    if (target == null || rel === 0 || !menuRef.current) return; // 沒開時位置用不到；開給下一家時，畫出來之前就會重算
    const plate = document.querySelector(`[data-fx-seat="${target}"]`)?.getBoundingClientRect();
    const table = document.querySelector("[data-mj-table]")?.getBoundingClientRect();
    if (!plate || !table) return; // 量不到（畫面正在換）：選單留在畫面外，4 秒沒操作會自己收起
    const m = menuRef.current;
    const avoid = [...document.querySelectorAll(".mjm-menu, .mjm-menu-pop, .mjm-gear")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    setPlace({ seat: target, ...placeFxMenu(rel, plate, table, m.offsetWidth, m.offsetHeight, innerWidth, innerHeight, avoid) });
  }, [target, rel, desk]);

  const fire = async (kind: FxKind) => {
    if (!enabled) return;
    unlockAudio();
    menu.touch();
    const same = menu.guard();
    const r = await sendFx(kind, target);
    if (!same()) return; // 送出途中結算、換局或卸載：結果不顯示
    menu.touch(); // 冷卻倒數馬上照伺服器給的時間更新
    if (r.ok) return;
    const sec = Math.ceil((r.leftMs ?? 0) / 1000);
    menu.flash(r.reason === "busy" ? "送出中…" : r.reason === "loading" ? "素材還在載入" : r.reason === "cooldown" ? `冷卻中，還要 ${sec} 秒`
      : r.reason === "target_protected" ? `對方剛被打過，還要 ${sec} 秒`
      : r.reason === "failed" ? "送出失敗" : "先選一位玩家");
  };

  const who = players.find((p) => p.seat === target);
  const pos = place && place.seat === target ? place : null;
  const tip = note ?? (!ready ? "素材載入中…" : null);
  const open = enabled && target != null && rel !== 0 && !!who;
  return (
    <>
      {/* 特效層：pointer-events:none 不能拿掉（播放中吃碰胡、打出照常按得到） */}
      <div ref={layerRef} className="mjfx-layer" data-fx-layer />
      {open && (
        <div
          ref={menuRef}
          className={`mjfx-menu ${desk ? "d" : "m"} ${isColumn(rel) ? "col" : "row"}`}
          data-fx-menu={target}
          data-fx-side={pos?.side}
          role="group"
          aria-label={`丟特效給 ${who.name}`}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
          onPointerDown={menu.touch}
        >
          {pos && <i className={`arr ${pos.side}`} style={pos.side === "t" ? { left: pos.arrow } : { top: pos.arrow }} aria-hidden="true" />}
          <div className="kinds">
            {FX_KINDS.map((k) => {
              const left = fxCooldownLeft(k, now);
              return (
                <button type="button" key={k} data-fx-kind={k} disabled={!ready} onClick={() => fire(k)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ICON[k]} alt="" />
                  <span>{FX_LABEL[k]}</span>
                  {left > 0 && <b className="cd" data-fx-cd>{Math.ceil(left / 1000)}</b>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {open && pos && tip && (
        <p
          className={`mjfx-note ${pos.note.align}`}
          data-fx-note
          role="status"
          style={{ left: pos.note.left, top: pos.note.top, width: pos.note.width }}
        >
          {tip}
        </p>
      )}
    </>
  );
}
