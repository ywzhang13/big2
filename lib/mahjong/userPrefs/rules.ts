// 偏好設定（跟著 LINE 帳號存）的白名單：外觀兩項（牌背、桌布）＋聲音（語音、互動音效各一條 0～100 音量和靜音）＋自動播放語音。純資料，不連任何服務。
// 規格：小宜〈偏好設定面板-設計規格-2026-10-20〉§4、〈麻將牌桌-設定整併與雙音量及關閉互動-UIUX規格-2026-10-21〉「偏好格式 v4」。
// 牌面底色不開放（老闆決定只保留原本的白色），所以沒有 face；帶了 face 就當多欄位整份拒絕。
// 快速主題不另外存：主題＝牌背和桌布的組合，前端對照得出來（存兩份會出現「主題和牌背不一致」）。
// 「關閉互動」是本房的前端狀態，不存在這裡。
// 格式 v4（2026-10-24 雙音量）：PUT 只收 v4。資料庫裡之前存的 v2、v3 讀出來時轉成 v4 回給前端（v3 的三段音量換成 35／70／100）。
export const PREF_BACKS = ["jade", "vermilion", "indigo", "ink", "rose", "brass", "sakura", "rosepink", "coral"] as const;
export const PREF_FELTS = ["green", "night", "wine", "black"] as const;
/** v3 的語音音量三段換成 v4 的百分比（規格「v3 升級規則」） */
const V3_VOICE_VOL: Record<string, number> = { low: 35, mid: 70, high: 100 };

export interface AccountPrefs {
  v: 4;
  back: (typeof PREF_BACKS)[number];
  felt: (typeof PREF_FELTS)[number];
  voiceVol: number; // 語音音量，整數 0～100
  voiceMuted: boolean; // 語音靜音（取消靜音回到 voiceVol）
  fxVol: number; // 互動音效音量（五種特效、之後的出牌配音），整數 0～100
  fxMuted: boolean;
  autoVoice: boolean; // 收到語音時自動播放
}
export const SOUND_DEFAULTS = { voiceVol: 70, voiceMuted: false, fxVol: 70, fxMuted: false, autoVoice: true } as const;

const KEYS_V4 = ["v", "back", "felt", "voiceVol", "voiceMuted", "fxVol", "fxMuted", "autoVoice"] as const;
const KEYS_V3 = ["v", "back", "felt", "autoVoice", "voiceVol"] as const;
const KEYS_V2 = ["v", "back", "felt"] as const;

const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const lookOk = (o: Record<string, unknown>) =>
  (PREF_BACKS as readonly unknown[]).includes(o.back) && (PREF_FELTS as readonly unknown[]).includes(o.felt);
const vol = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 100;
const look = (o: Record<string, unknown>) => ({ back: o.back as AccountPrefs["back"], felt: o.felt as AccountPrefs["felt"] });

/** 驗證前端送來的（PUT）：八個欄位都要在、v 是 4、音量是 0～100 的整數、開關是布林，多的欄位（含 face）不收。不合格回 null（整份不存，不做部分修正） */
export function parseAccountPrefs(x: unknown): AccountPrefs | null {
  if (!isObj(x) || !exactKeys(x, KEYS_V4) || x.v !== 4 || !lookOk(x)) return null;
  if (!vol(x.voiceVol) || !vol(x.fxVol)) return null;
  if (typeof x.voiceMuted !== "boolean" || typeof x.fxMuted !== "boolean" || typeof x.autoVoice !== "boolean") return null;
  return { v: 4, ...look(x), voiceVol: x.voiceVol as number, voiceMuted: x.voiceMuted, fxVol: x.fxVol as number, fxMuted: x.fxMuted, autoVoice: x.autoVoice };
}

/** 讀資料庫裡存的（GET）：v4 照驗；v3、v2（之前存的）轉成 v4；其他都當沒存（null） */
export function readStoredPrefs(x: unknown): AccountPrefs | null {
  if (isObj(x) && x.v === 2 && exactKeys(x, KEYS_V2) && lookOk(x)) return { v: 4, ...look(x), ...SOUND_DEFAULTS };
  if (isObj(x) && x.v === 3 && exactKeys(x, KEYS_V3) && lookOk(x) && typeof x.autoVoice === "boolean") {
    // 三段音量以外的值（理論上資料庫擋掉了）用預設 70
    return { v: 4, ...look(x), ...SOUND_DEFAULTS, voiceVol: V3_VOICE_VOL[x.voiceVol as string] ?? 70, autoVoice: x.autoVoice };
  }
  return parseAccountPrefs(x);
}
