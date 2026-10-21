// 互動特效的發送和接收（集中在這裡；畫面只呼叫 sendFx／subscribeFx）。
// 送：POST /api/mahjong/effect（老柯〈互動特效-後端介面說明-給老馬-2026-10-21〉）。發送者由伺服器用登入帳號認，前端只帶房間和對方 playerId。
// 收：自己座位頻道的 mj_effect（useMahjong 收到後呼叫 receiveFx）。發送者自己也會收到；API 回應和廣播是同一則，用伺服器給的 id 去重。
// 冷卻以伺服器為準：成功時照 cooldownMs 倒數，429 時照 retryAfterMs 倒數；被擋下的就不播，不會播半套。
// 收到的特效一次只播一個、照順序排隊（engine.ts，上限 QUEUE_MAX），所以多人同時丟不會疊在一起。
import { mjFetch } from "../clientAuth";
import { isFxReady, isLightFx, type FxKind } from "./engine";

/** 伺服器的特效名稱 ↔ 前端的 */
const API_NAME: Record<FxKind, string> = { love: "heart", cash: "money", egg: "egg", water: "water", punch: "punch" };
const FROM_API: Record<string, FxKind> = { heart: "love", money: "cash", egg: "egg", water: "water", punch: "punch" };

/** 伺服器送來的特效（mj_effect 的 effect，也是 API 回應裡的 effect） */
export interface FxEvent { id: string; effect: string; from: string; fromName: string; fromSeat: number; to: string; toName: string; toSeat: number; ts: number }
export interface FxMessage { id: string; kind: FxKind; from: number; to: number; fromId: string; fromName: string; toName: string }
// cooldown：自己這一組還在冷卻；target_protected：對方剛被重組打過，還在保護期（自己的冷卻不會開始）
export type SendFxResult = { ok: true } | { ok: false; reason: "loading" | "busy" | "cooldown" | "target_protected" | "no_target" | "failed"; leftMs?: number };

type Listener = (m: FxMessage) => void;
const listeners = new Set<Listener>();
export function subscribeFx(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

const seen = new Set<string>();
/** 收到伺服器的特效（廣播或 API 回應）；同一則只處理一次 */
export function receiveFx(e: FxEvent) {
  const kind = FROM_API[e?.effect];
  if (!kind || !e.id || seen.has(e.id)) return;
  seen.add(e.id);
  if (seen.size > 300) seen.delete(seen.values().next().value!);
  const m: FxMessage = { id: e.id, kind, from: e.fromSeat, to: e.toSeat, fromId: e.from, fromName: e.fromName, toName: e.toName };
  listeners.forEach((l) => l(m));
}

// 冷卻：輕組（愛心、砸錢）、重組（雞蛋、潑水、拳擊）各自共用一個（伺服器為準，畫面倒數只是提示）
type Group = "light" | "heavy";
const groupOf = (k: FxKind): Group => (isLightFx(k) ? "light" : "heavy");
const readyAt: Partial<Record<Group, number>> = {};
export function fxCooldownLeft(kind: FxKind, now = Date.now()) { return Math.max(0, (readyAt[groupOf(kind)] ?? 0) - now); }

let roomId = "";
let table: { id: string; seat: number }[] = [];
let mySeat = -1;
export function setFxRoom(id: string) { roomId = id; }
export function setFxTable(players: { id: string; seat: number }[], me: number) { table = players; mySeat = me; }

let sending = false;
export async function sendFx(kind: FxKind, toSeat: number | null): Promise<SendFxResult> {
  const to = table.find((p) => p.seat === toSeat && p.seat !== mySeat)?.id;
  if (!to) return { ok: false, reason: "no_target" };
  if (!isFxReady()) return { ok: false, reason: "loading" };
  const left = fxCooldownLeft(kind);
  if (left > 0) return { ok: false, reason: "cooldown", leftMs: left };
  // 別人的特效正在播也照樣送出：伺服器照冷卻判斷，自己看到的動畫排在後面播。只擋「上一則還在送」（連點）
  if (sending) return { ok: false, reason: "busy" };
  sending = true;
  try {
    const r = await mjFetch("/api/mahjong/effect", { method: "POST", body: JSON.stringify({ roomId, effect: API_NAME[kind], to }) });
    const body = (await r.json().catch(() => ({}))) as { effect?: FxEvent; cooldownMs?: number; retryAfterMs?: number; reason?: string };
    if (r.ok && body.effect) {
      readyAt[groupOf(kind)] = Date.now() + (body.cooldownMs ?? 0);
      receiveFx(body.effect);
      return { ok: true };
    }
    if (r.status === 429) {
      const leftMs = body.retryAfterMs ?? 0;
      // 對方在保護期：不是自己冷卻，按鈕不倒數
      if (body.reason === "target_protected") return { ok: false, reason: "target_protected", leftMs };
      readyAt[groupOf(kind)] = Date.now() + leftMs;
      return { ok: false, reason: "cooldown", leftMs };
    }
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    sending = false;
  }
}
