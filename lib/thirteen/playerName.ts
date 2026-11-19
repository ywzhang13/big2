// 入座名字的規則（共用開房流程 2026-11-19；小宜設計說明 v1.1 第 4-3 節，和前端 components/gameLobby/name.ts validName 一致）：
// 去掉前後空白（含全形空白）後 1～8 個字；字數用 Array.from 算，中文字、英文字母、表情符號都算 1 個字。
export const NAME_MAX = 8;
export const NAME_MESSAGE = "名字要是 1～8 個字";

/** 合法回傳去掉前後空白的名字，不合法回 null */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const len = Array.from(name).length;
  return len >= 1 && len <= NAME_MAX ? name : null;
}
