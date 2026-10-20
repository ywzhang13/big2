// 遊戲內互動特效的規則（純資料，不連任何服務）。規格：小宜〈互動特效-5種定案規格-2026-10-20〉，冷卻依老闆 2026-10-21 定案。
// 每一種都要指定同桌另一位玩家當目標；冷卻在伺服器擋（前端倒數只是提示）。
//   ・發送冷卻分兩組共用：輕組（愛心、砸錢）5 秒、重組（雞蛋、潑水、拳擊）10 秒，兩組互不影響
//   ・重組另有接收保護：同一個目標被任何人用重組打中後，10 秒內任何人都不能再用重組打他；輕組不受影響
export const EFFECTS = ["heart", "money", "egg", "water", "punch"] as const;
export type EffectKind = (typeof EFFECTS)[number];
export const isEffect = (x: unknown): x is EffectKind => typeof x === "string" && (EFFECTS as readonly string[]).includes(x);

export type EffectGroup = "light" | "heavy";
export const EFFECT_GROUP: Record<EffectKind, EffectGroup> = {
  heart: "light",
  money: "light",
  egg: "heavy",
  water: "heavy",
  punch: "heavy",
};
/** 發送冷卻（同組共用） */
export const GROUP_COOLDOWN_MS: Record<EffectGroup, number> = { light: 5000, heavy: 10000 };
/** 接收保護（只有重組有；0＝沒有） */
export const GROUP_PROTECT_MS: Record<EffectGroup, number> = { light: 0, heavy: 10000 };

export type TakeResult = { ok: true } | { ok: false; reason: "cooldown" | "target_protected"; retryAfterMs: number };

/** SQL 回的 jsonb → TakeResult（測試的 stub 也用這個） */
export function toResult(data: unknown): TakeResult {
  const d = (data ?? {}) as { ok?: boolean; reason?: string; retry_after_ms?: number };
  if (d.ok) return { ok: true };
  if (d.reason !== "cooldown" && d.reason !== "target_protected") throw new Error(`特效冷卻回傳格式不對：${JSON.stringify(data)}`);
  return { ok: false, reason: d.reason, retryAfterMs: Math.max(1, Number(d.retry_after_ms) || 1) };
}
