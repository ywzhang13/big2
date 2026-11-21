"use client";
// 三款共用的互動道具（小宜〈十三支共用聊天互動 v1〉§4、§6：從麻將 MjFx 抽出來，網址、名牌錨點、選單位置、能不能丟都由遊戲傳進來）。
//   ・點對方名牌（命中範圍至少 44×44，以名牌中心往外擴）→ 名牌旁跳出直排選單 → 點一下就丟。點自己沒反應；點選單外、4 秒沒操作、換局、卸載都收起
//   ・遊戲說這家現在不能丟（例如十三支「理牌中」）：不開選單，名牌下方出現那句提示 1.8 秒
//   ・選單最下面「關閉互動」：不播這位玩家丟給自己的特效，只在這一房有效
//   ・收到的特效交給播放引擎；hold＝true 時（十三支牌型大字播放中）先排著，hold 結束再播。卸載（進結算）時特效層整層清空
//   ・只有 LINE 登入、已入座的人能丟（enabled）；訪客看得到特效但不能丟
// 特效層 pointer-events: none，不擋牌桌操作。互動音效音量、靜音跟著共用設定（usePrefs）
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FX_ICON, FX_LABEL, MENU_ORDER, abortFx, bindFxBlockRoom, createFxMenu, playSocialFx, preloadFx, setFxBlocked, setFxLayer, setFxVolume, shouldPlayFx, unlockAudio, useFxBlocked, type FxKind } from "@/lib/social/fx";
import { bindSocialFxTable, sendSocialFx, socialFxCooldownLeft, subscribeSocialFx, type SocialFxMessage } from "@/lib/social/fx/transport";
import { noteUnderPlate, placeBesidePlate, type MenuPlacement, type SocialMenuPlace } from "@/lib/social/fx/place";
import { rectOf, type Box } from "@/lib/social/anchors";
import { fxGain, usePrefs } from "@/lib/mahjong/prefs";

const MIN_HIT = 44;
const NOTE_MS = 1800;

export default function SocialFxMenu({ players, mySeat, enabled, desk, hand, roomId, effectUrl, keyOf, placement, blockedReason, noteBelow, hold = false }: {
  players: { id: string; name: string; seat: number }[];
  mySeat: number;
  /** LINE 登入、已入座 */
  enabled: boolean;
  desk: boolean;
  /** 換局就收起選單和提示（例：第幾局） */
  hand: string;
  roomId: string;
  /** 例：/api/thirteen/effect */
  effectUrl: string;
  /** 座位 → 名牌的 data-fx-seat 值（十三支：b／r／t／l） */
  keyOf: (seat: number) => string;
  /** 選單在名牌哪一邊、怎麼對齊 */
  placement: (seat: number) => MenuPlacement;
  /** 這家現在不能丟的原因（例：「理牌中」）；null＝可以 */
  blockedReason?: (seat: number) => string | null;
  /** 名牌下面掛著的東西（提示要放在它下面），例如思考中泡泡 */
  noteBelow?: (seat: number) => Box | null;
  /** true＝先別播收到的特效（排著，false 時照順序播） */
  hold?: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu] = useState(() => createFxMenu());
  const { target, note, now } = useSyncExternalStore(menu.subscribe, menu.get, menu.get);
  const [place, setPlace] = useState<(SocialMenuPlace & { seat: number }) | null>(null);
  const [ready, setReady] = useState(false);
  const [deny, setDeny] = useState<{ seat: number; text: string } | null>(null);
  const denyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFxLayer(layerRef.current);
    void preloadFx().then((ok) => setReady(ok));
    Object.values(FX_ICON).forEach((u) => { const i = new Image(); i.src = u; void i.decode().catch(() => {}); });
    return () => { abortFx(); setFxLayer(null); };
  }, []);
  useEffect(() => {
    bindSocialFxTable(roomId ? { effectUrl, roomId, players: players.map((p) => ({ id: p.id, seat: p.seat })), mySeat } : null);
  }, [effectUrl, roomId, players, mySeat]);
  useEffect(() => () => bindSocialFxTable(null), []); // 離場（卸載）：解除這一桌，送出中的請求晚到一律作廢（審伯 R1）
  const gain = fxGain(usePrefs());
  useEffect(() => setFxVolume(gain), [gain]);

  const myId = players.find((p) => p.seat === mySeat)?.id ?? "";
  const blockKey = roomId && myId ? `${roomId}|${myId}|${mySeat}` : null;
  useEffect(() => { bindFxBlockRoom(blockKey); }, [blockKey]);

  // 換局、不能用了、卸載：選單和提示立刻清空，送出中的結果作廢
  useLayoutEffect(() => () => menu.reset(), [menu, hand, enabled]);
  useEffect(() => () => { if (denyTimer.current) clearTimeout(denyTimer.current); }, []);

  // 收到特效：hold 時先排著
  const holdRef = useRef(hold);
  const pending = useRef<SocialFxMessage[]>([]);
  const keyRef = useRef(keyOf);
  useEffect(() => { holdRef.current = hold; keyRef.current = keyOf; }, [hold, keyOf]);
  useEffect(() => {
    const play = (m: SocialFxMessage) => {
      if (!shouldPlayFx(m, mySeat)) return; // 被關閉互動的玩家丟給我的：不播
      const k = keyRef.current;
      playSocialFx({ kind: m.kind, fromKey: k(m.from), toKey: k(m.to), meKey: k(mySeat) });
    };
    const off = subscribeSocialFx((m) => { if (holdRef.current) pending.current.push(m); else play(m); });
    const t = setInterval(() => {
      if (holdRef.current || !pending.current.length) return;
      const list = pending.current; pending.current = [];
      list.forEach(play);
    }, 150);
    return () => { off(); clearInterval(t); pending.current = []; };
  }, [mySeat]);

  // 點名牌：在 document 上判斷點到哪一家
  useEffect(() => {
    if (!enabled) return;
    const others = players.filter((p) => p.seat !== mySeat).map((p) => p.seat);
    const hit = (x: number, y: number) => others.find((seat) => {
      const r = rectOf(`[data-fx-seat="${keyOf(seat)}"]`);
      if (!r) return false;
      const w = Math.max(r.right - r.left, MIN_HIT), h = Math.max(r.bottom - r.top, MIN_HIT), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
    });
    const inMenu = (t: EventTarget | null) => !!menuRef.current && t instanceof Node && menuRef.current.contains(t);
    const down = (e: PointerEvent) => { if (!inMenu(e.target) && hit(e.clientX, e.clientY) === undefined) menu.close(); };
    const click = (e: MouseEvent) => {
      if (inMenu(e.target)) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("button, a, input, [role='button']") && !el.closest("[data-fx-seat]")) return; // 名牌附近的其他按鈕照它自己的作用
      const seat = hit(e.clientX, e.clientY);
      if (seat === undefined) return;
      const why = blockedReason?.(seat) ?? null;
      if (why) {
        menu.close();
        setDeny({ seat, text: why });
        if (denyTimer.current) clearTimeout(denyTimer.current);
        denyTimer.current = setTimeout(() => setDeny(null), NOTE_MS);
        return;
      }
      setDeny(null);
      unlockAudio();
      menu.toggle(seat);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click);
    window.addEventListener("resize", menu.close);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("click", click); window.removeEventListener("resize", menu.close); };
  }, [enabled, players, mySeat, menu, keyOf, blockedReason]);

  // 選單位置：照遊戲指定的那一邊，超出畫面夾回來
  useLayoutEffect(() => {
    if (target == null || target === mySeat || !menuRef.current) return;
    const plate = rectOf(`[data-fx-seat="${keyOf(target)}"]`);
    if (!plate) return;
    const m = menuRef.current;
    setPlace({ seat: target, ...placeBesidePlate(placement(target), plate, m.offsetWidth, m.offsetHeight, innerWidth, innerHeight) });
  }, [target, mySeat, desk, keyOf, placement]);

  const fire = async (kind: FxKind) => {
    if (!enabled) return;
    unlockAudio();
    menu.touch();
    const same = menu.guard();
    const r = await sendSocialFx(kind, target);
    if (!same() || (!r.ok && r.reason === "stale")) return; // 舊 session 的結果：不出任何提示
    menu.touch();
    if (r.ok) return;
    const sec = Math.ceil((r.leftMs ?? 0) / 1000);
    menu.flash(r.reason === "busy" ? "送出中…" : r.reason === "loading" ? "素材還在載入" : r.reason === "cooldown" ? `冷卻中，還要 ${sec} 秒`
      : r.reason === "target_protected" ? `對方剛被打過，還要 ${sec} 秒` : r.reason === "target_arranging" ? "理牌中"
      : r.reason === "failed" ? "送出失敗" : "先選一位玩家");
  };

  const who = players.find((p) => p.seat === target);
  const blocked = useFxBlocked(who?.id);
  const pos = place && place.seat === target ? place : null;
  const open = enabled && target != null && target !== mySeat && !!who;
  const tip = open ? note ?? (!ready ? "素材載入中…" : null) : null;
  const tipSeat = tip ? target : deny?.seat ?? null;
  const tipText = tip ?? deny?.text ?? null;
  const tipPlate = tipSeat != null ? rectOf(`[data-fx-seat="${keyOf(tipSeat)}"]`) : null;
  const tipAt = tipPlate ? noteUnderPlate(tipPlate, noteBelow?.(tipSeat!) ?? null) : null;
  return (
    <>
      <div ref={layerRef} className="mjfx-layer" data-fx-layer />
      {open && (
        <div ref={menuRef} className={`mjfx-menu ${desk ? "d" : "m"} col`} data-fx-menu={target} data-fx-side={pos?.arrowSide}
          role="group" aria-label={`丟特效給 ${who.name}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }} onPointerDown={menu.touch}>
          {pos && <i className={`arr ${pos.arrowSide}`} style={{ top: pos.arrow }} aria-hidden="true" />}
          <div className="kinds">
            {MENU_ORDER.map((k) => {
              const left = socialFxCooldownLeft(k, now);
              return (
                <button type="button" key={k} data-fx-kind={k} disabled={!ready} onClick={() => fire(k)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={FX_ICON[k]} alt="" />
                  <span>{FX_LABEL[k]}</span>
                  {left > 0 && <b className="cd" data-fx-cd>{Math.ceil(left / 1000)}</b>}
                </button>
              );
            })}
          </div>
          <div className="block">
            <span id={`scfx-block-${target}`}>關閉互動</span>
            <button type="button" role="switch" aria-checked={blocked} aria-labelledby={`scfx-block-${target}`} data-fx-block={who.id}
              className={`mjp-switch ${blocked ? "on" : ""}`} onClick={() => { menu.touch(); setFxBlocked(who.id, !blocked); }}>
              <i />
            </button>
          </div>
        </div>
      )}
      {tipText && tipAt && (
        <p className="mjfx-note" data-fx-note={tipText === deny?.text && !tip ? "deny" : "menu"} role="status" style={{ left: tipAt.left, top: tipAt.top, width: tipAt.width }}>
          {tipText}
        </p>
      )}
    </>
  );
}
