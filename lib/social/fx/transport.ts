// 三款共用的互動道具送收（小宜〈十三支共用聊天互動 v1〉§6～7：照麻將 lib/mahjong/fx/transport.ts，送出網址由遊戲傳進來）。
// 送：POST <effectUrl> { roomId, effect, to }（十三支：/api/thirteen/effect，回傳格式和麻將一樣）。發送者由伺服器用登入帳號認。
// 收：遊戲把座位頻道的 mj_effect 交給 receiveSocialFx；發送者自己也會收到，API 回應和廣播是同一則，用伺服器給的 id 去重。
// 冷卻以伺服器為準：成功照 cooldownMs、429 照 retryAfterMs 倒數；target_protected（對方剛被打過）不算自己的冷卻；
// target_arranging（對方還在理牌，十三支）回「理牌中」。麻將這次不換，繼續用自己的 transport。
import { mjFetch } from "@/lib/mahjong/clientAuth";
import { isFxReady, isLightFx, type FxKind } from "@/lib/mahjong/fx/engine";
import type { EffectEvent } from "../events";

/** 伺服器的特效名稱 ↔ 前端的 */
export const API_NAME: Record<FxKind, string> = { love: "heart", cash: "money", egg: "egg", water: "water", punch: "punch", clap: "clap" };
const FROM_API: Record<string, FxKind> = { heart: "love", money: "cash", egg: "egg", water: "water", punch: "punch", clap: "clap" };

export interface SocialFxMessage { id: string; kind: FxKind; from: number; to: number; fromId: string; fromName: string; toName: string }
export type SendFxResult = { ok: true }
  | { ok: false; reason: "loading" | "busy" | "cooldown" | "target_protected" | "target_arranging" | "no_target" | "failed" | "stale"; leftMs?: number };

/** 送出要用的 IO（測試換成假的） */
export type FxIO = { now(): number; post(url: string, body: object): Promise<{ status: number; body: Record<string, unknown> }>; ready(): boolean };
const browserIO: FxIO = {
  now: () => Date.now(),
  async post(url, body) {
    const r = await mjFetch(url, { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  },
  ready: isFxReady,
};
let io: FxIO = browserIO;

type Listener = (m: SocialFxMessage) => void;
const listeners = new Set<Listener>();
export function subscribeSocialFx(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

const seen = new Set<string>();
/** 收到伺服器的特效（廣播或 API 回應）；同一則只處理一次 */
export function receiveSocialFx(e: EffectEvent): void {
  const kind = FROM_API[e?.effect];
  if (!kind || !e.id || seen.has(e.id)) return;
  seen.add(e.id);
  if (seen.size > 300) seen.delete(seen.values().next().value!);
  const m: SocialFxMessage = { id: e.id, kind, from: e.fromSeat, to: e.toSeat, fromId: e.from, fromName: e.fromName, toName: e.toName };
  listeners.forEach((l) => l(m));
}

// 冷卻：輕組（愛心、砸錢、拍手）、重組（雞蛋、潑水、拳擊）各自一個
type Group = "light" | "heavy";
const groupOf = (k: FxKind): Group => (isLightFx(k) ? "light" : "heavy");
let readyAt: Partial<Record<Group, number>> = {};
export function socialFxCooldownLeft(kind: FxKind, now = io.now()): number { return Math.max(0, (readyAt[groupOf(kind)] ?? 0) - now); }

/** 這一桌：送出網址、房間、四家的 playerId、自己的座位。
 *  session＝送出網址＋房間＋自己的 playerId＋座位（審伯 R1）：任一項換了（換遊戲、換房、換帳號、換座位）或解除綁定（離場），
 *  之前送出的請求一律作廢——晚到的 200／429／失敗都不播、不進事件清單、不改冷卻、不動送出鎖。
 *  同一個 session 重讀 players（新陣列、同一批人）或換階段再綁一次：冷卻保留、送出中的照常生效 */
type Table = { effectUrl: string; roomId: string; players: { id: string; seat: number }[]; mySeat: number };
const keyOf = (t: Table) => [t.effectUrl, t.roomId, t.players.find((p) => p.seat === t.mySeat)?.id ?? "", t.mySeat].join("|");
let table: Table | null = null;
let tableKey: string | null = null; // 目前綁定的 session（解除綁定時是 null）
let cdKey: string | null = null; // readyAt 屬於哪個 session（離場後重入同一個 session，冷卻照舊）
let gen = 0; // session 世代：換 session 或解除綁定就 +1，舊請求比對不到就作廢
export function bindSocialFxTable(t: Table | null): void {
  const k = t ? keyOf(t) : null;
  if (k !== tableKey) gen++;
  if (k && k !== cdKey) { readyAt = {}; cdKey = k; }
  tableKey = k;
  table = t;
}

let sendingGen: number | null = null; // 送出鎖屬於哪個世代：舊世代的請求不擋新 session，結束時也不清新 session 的鎖
export async function sendSocialFx(kind: FxKind, toSeat: number | null): Promise<SendFxResult> {
  const t = table;
  const to = t?.players.find((p) => p.seat === toSeat && p.seat !== t.mySeat)?.id;
  if (!t || !to) return { ok: false, reason: "no_target" };
  if (!io.ready()) return { ok: false, reason: "loading" };
  const left = socialFxCooldownLeft(kind);
  if (left > 0) return { ok: false, reason: "cooldown", leftMs: left };
  if (sendingGen === gen) return { ok: false, reason: "busy" }; // 只擋同一個 session 上一則還在送（連點）
  const my = gen;
  sendingGen = my;
  try {
    const r = await io.post(t.effectUrl, { roomId: t.roomId, effect: API_NAME[kind], to });
    if (my !== gen) return { ok: false, reason: "stale" };
    const body = r.body as { effect?: EffectEvent; cooldownMs?: number; retryAfterMs?: number; reason?: string; error?: string };
    if (r.status === 200 && body.effect) {
      readyAt[groupOf(kind)] = io.now() + (body.cooldownMs ?? 0);
      receiveSocialFx(body.effect);
      return { ok: true };
    }
    if (body.reason === "target_arranging" || body.error === "target_arranging") return { ok: false, reason: "target_arranging" };
    if (r.status === 429) {
      const leftMs = body.retryAfterMs ?? 0;
      if (body.reason === "target_protected") return { ok: false, reason: "target_protected", leftMs };
      readyAt[groupOf(kind)] = io.now() + leftMs;
      return { ok: false, reason: "cooldown", leftMs };
    }
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: my === gen ? "failed" : "stale" };
  } finally {
    if (sendingGen === my) sendingGen = null;
  }
}

/** 測試用 */
export function __testSocialFx(fake: FxIO): void { io = fake; readyAt = {}; table = null; tableKey = null; cdKey = null; gen++; seen.clear(); sendingGen = null; }
