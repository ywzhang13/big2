// 麻將遊戲內打字聊天與語音訊息的規則（純資料、純函式，不連任何服務）。
// 規格：小宜〈麻將聊天與語音訊息-UIUX設計規格-2026-10-21〉、阿妍〈麻將打字聊天與語音-方案評估-2026-10-21〉§1-2。
// 不過濾髒話（老闆 2026-10-21 決定）；只擋發太快、太長、不是聲音的檔案。

export type ChatKind = "text" | "voice";

/** 快捷短語：前端送 id，伺服器換成文字（和自由文字共用冷卻） */
export const PHRASES = { nice: "好牌", wait: "等我一下", hurry: "快點啦", thanks: "謝謝" } as const;
export type PhraseId = keyof typeof PHRASES;
export const isPhrase = (x: unknown): x is PhraseId => typeof x === "string" && Object.prototype.hasOwnProperty.call(PHRASES, x);

/**
 * 冷卻（伺服器擋，前端倒數只是提示）。文字（含快捷短語）和語音各算各的。
 *   每則間隔 2 秒；最近 5 則都在窗口內 → 從最後一則起冷卻 burstCooldownMs。
 */
export const RATE: Record<ChatKind, { cooldownMs: number; burstCount: number; burstWindowMs: number; burstCooldownMs: number }> = {
  text: { cooldownMs: 2000, burstCount: 5, burstWindowMs: 15000, burstCooldownMs: 15000 },
  voice: { cooldownMs: 2000, burstCount: 5, burstWindowMs: 30000, burstCooldownMs: 30000 },
};

export const MAX_TEXT_CHARS = 40;
export const MAX_VOICE_SECONDS = 10;
export const MIN_VOICE_MS = 400; // 前端不到 0.5 秒就不送；轉檔後的長度會差一點，伺服器放寬到 0.4 秒
export const MAX_VOICE_BYTES = 512 * 1024; // 上傳原檔上限（10 秒 Opus 約 40KB、AAC 約 160KB）
export const VOICE_URL_TTL_S = 60 * 60; // 播放網址 1 小時有效
export const VOICE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 房間還開著，語音檔最多也只留 24 小時

/**
 * 文字清洗：去掉控制字元、雙向覆寫與零寬字元（會讓名字或訊息看起來被竄改），空白收成一格。
 * 不做 HTML 跳脫：前端一律當純文字顯示（React 會自動跳脫，不可用 dangerouslySetInnerHTML）。
 * 長度用字元數（emoji 算 1 個）。
 */
export function cleanText(raw: unknown): { error: "bad_request" | "empty_text" | "text_too_long" } | { text: string } {
  if (typeof raw !== "string") return { error: "bad_request" };
  if (raw.length > MAX_TEXT_CHARS * 8) return { error: "text_too_long" }; // 超長的直接擋，不做後面的處理
  const text = raw
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { error: "empty_text" };
  if (Array.from(text).length > MAX_TEXT_CHARS) return { error: "text_too_long" };
  return { text };
}
