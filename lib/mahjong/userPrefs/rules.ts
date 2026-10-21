// 偏好設定（跟著 LINE 帳號存）的白名單：只有外觀兩項（牌背、桌布）。純資料，不連任何服務。
// 規格：小宜〈偏好設定面板-設計規格-2026-10-20〉§4。聲音、互動開關只存在各自的裝置，伺服器不收。
// 牌面底色不開放（老闆決定只保留原本的白色），所以沒有 face；帶了 face 就當多欄位整份拒絕。
// 快速主題不另外存：主題＝這兩項的組合，前端對照得出來（存兩份會出現「主題和牌背不一致」）。
export const PREF_BACKS = ["jade", "vermilion", "indigo", "ink", "rose", "brass", "sakura", "rosepink", "coral"] as const;
export const PREF_FELTS = ["green", "night", "wine", "black"] as const;

export interface AccountPrefs {
  v: 2;
  back: (typeof PREF_BACKS)[number];
  felt: (typeof PREF_FELTS)[number];
}

const KEYS = ["v", "back", "felt"] as const;

/** 驗證：三個欄位都要在、v 是 2、值都要在白名單裡，多的欄位（含 face）不收。不合格回 null（整份不存，不做部分修正） */
export function parseAccountPrefs(x: unknown): AccountPrefs | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).length !== KEYS.length || !KEYS.every((k) => k in o)) return null;
  if (o.v !== 2) return null;
  if (!(PREF_BACKS as readonly unknown[]).includes(o.back)) return null;
  if (!(PREF_FELTS as readonly unknown[]).includes(o.felt)) return null;
  return { v: 2, back: o.back as AccountPrefs["back"], felt: o.felt as AccountPrefs["felt"] };
}
