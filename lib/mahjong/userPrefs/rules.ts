// 偏好設定（跟著 LINE 帳號存）的白名單：外觀兩項（牌背、桌布）＋語音訊息兩項（自動播放、音量）。純資料，不連任何服務。
// 規格：小宜〈偏好設定面板-設計規格-2026-10-20〉§4、〈麻將聊天與語音訊息-UIUX設計規格-2026-10-21〉「音訊設定」。
// 牌面底色不開放（老闆決定只保留原本的白色），所以沒有 face；帶了 face 就當多欄位整份拒絕。
// 快速主題不另外存：主題＝牌背和桌布的組合，前端對照得出來（存兩份會出現「主題和牌背不一致」）。
// 格式 v3（2026-10-23 加語音）：PUT 只收 v3。資料庫裡上線前存的 v2 讀出來時補上語音的預設值，當成 v3 回給前端。
export const PREF_BACKS = ["jade", "vermilion", "indigo", "ink", "rose", "brass", "sakura", "rosepink", "coral"] as const;
export const PREF_FELTS = ["green", "night", "wine", "black"] as const;
/** 語音音量三段：低、一般、高（前端對到實際音量；規格預設一般＝70%） */
export const PREF_VOICE_VOLS = ["low", "mid", "high"] as const;

export interface AccountPrefs {
  v: 3;
  back: (typeof PREF_BACKS)[number];
  felt: (typeof PREF_FELTS)[number];
  autoVoice: boolean; // 收到語音時自動播放
  voiceVol: (typeof PREF_VOICE_VOLS)[number];
}
export const VOICE_DEFAULTS = { autoVoice: true, voiceVol: "mid" } as const;

const KEYS_V3 = ["v", "back", "felt", "autoVoice", "voiceVol"] as const;
const KEYS_V2 = ["v", "back", "felt"] as const;

const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const lookOk = (o: Record<string, unknown>) =>
  (PREF_BACKS as readonly unknown[]).includes(o.back) && (PREF_FELTS as readonly unknown[]).includes(o.felt);

/** 驗證前端送來的（PUT）：五個欄位都要在、v 是 3、值都要在白名單裡，多的欄位（含 face）不收。不合格回 null（整份不存，不做部分修正） */
export function parseAccountPrefs(x: unknown): AccountPrefs | null {
  if (!isObj(x) || !exactKeys(x, KEYS_V3) || x.v !== 3 || !lookOk(x)) return null;
  if (typeof x.autoVoice !== "boolean" || !(PREF_VOICE_VOLS as readonly unknown[]).includes(x.voiceVol)) return null;
  return { v: 3, back: x.back as AccountPrefs["back"], felt: x.felt as AccountPrefs["felt"], autoVoice: x.autoVoice, voiceVol: x.voiceVol as AccountPrefs["voiceVol"] };
}

/** 讀資料庫裡存的（GET）：v3 照驗；v2（上線前存的）補上語音預設值轉成 v3；其他都當沒存（null） */
export function readStoredPrefs(x: unknown): AccountPrefs | null {
  if (isObj(x) && x.v === 2 && exactKeys(x, KEYS_V2) && lookOk(x)) {
    return { v: 3, back: x.back as AccountPrefs["back"], felt: x.felt as AccountPrefs["felt"], ...VOICE_DEFAULTS };
  }
  return parseAccountPrefs(x);
}
