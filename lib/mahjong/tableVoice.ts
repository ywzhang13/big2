// 麻將牌桌配音（老闆 2026-11-26）：打出一張牌唸牌名；吃、碰、槓、胡、自摸唸動作。四家和觀戰者都聽得到。
// 這裡只判斷「這次狀態更新該唸什麼」和「怎麼排隊播」，不碰音訊；出聲在 fx/engine.ts（playVoice），接到牌桌在 hooks/useTableSounds.ts（useTableVoice）。
// 素材：public/mahjong-fx/voice/mjv-<代號>.v1.mp3（切檔對照表在 public/mahjong-fx/voice/README.md）。
// 換素材一律改版號（.v2），不可同檔名換內容（README「靜態素材快取」）。

export type VoiceAction = "chi" | "pong" | "kong" | "hu" | "zimo";
/** 牌的代號：m 萬、p 筒、s 條 1～9；z 字牌 1～7（東南西北中發白）。花牌沒有配音 */
export type VoiceKey = `m${number}` | `p${number}` | `s${number}` | `z${number}` | VoiceAction;

export const VOICE_VERSION = "v1";
export const voiceUrl = (k: VoiceKey) => `/mahjong-fx/voice/mjv-${k}.${VOICE_VERSION}.mp3`;
export const VOICE_ACTIONS: VoiceAction[] = ["chi", "pong", "kong", "hu", "zimo"];
/** 全部 39 個語音檔（34 種牌＋5 個動作），預載用 */
export const ALL_VOICE_KEYS: VoiceKey[] = [
  ...(["m", "p", "s"] as const).flatMap((s) => Array.from({ length: 9 }, (_, i) => `${s}${i + 1}` as VoiceKey)),
  ...Array.from({ length: 7 }, (_, i) => `z${i + 1}` as VoiceKey),
  ...VOICE_ACTIONS,
];

type VTile = { id: number; suit: string; rank: number };
/** 這張牌唸什麼；花牌、看不到的牌（rank 0）回 null */
export function tileVoiceKey(t: { suit: string; rank: number } | null | undefined): VoiceKey | null {
  if (!t) return null;
  if ((t.suit === "m" || t.suit === "p" || t.suit === "s") && t.rank >= 1 && t.rank <= 9) return `${t.suit}${t.rank}` as VoiceKey;
  if (t.suit === "z" && t.rank >= 1 && t.rank <= 7) return `z${t.rank}` as VoiceKey;
  return null;
}

/** 判斷配音要看的牌桌狀態（玩家畫面和觀戰畫面都有這幾個欄位） */
export interface VoiceSnapshot {
  focusDiscard: { tile: VTile; from: number } | null;
  /** 各家亮出來的吃、碰、槓（照座位） */
  melds: { type: "chi" | "pong" | "kong" | "concealed_kong" }[][];
  /** 這局胡的人（一炮多響會有好幾筆）；from＝null 是自摸，有座位是放槍、搶槓 */
  winners: { seat: number; from?: number | null }[];
}

const meldVoice = (t: VoiceSnapshot["melds"][number][number]["type"]): VoiceAction => (t === "chi" ? "chi" : t === "pong" ? "pong" : "kong");

/** 上一個狀態 → 這一個狀態，該唸哪些（照發生順序）。prev＝null（剛進房、換局）只記下來不唸 */
export function voiceEvents(prev: VoiceSnapshot | null, next: VoiceSnapshot): VoiceKey[] {
  if (!prev) return [];
  const out: VoiceKey[] = [];
  // 1. 新打出的牌
  const pk = prev.focusDiscard ? `${prev.focusDiscard.from}:${prev.focusDiscard.tile.id}` : null;
  const nk = next.focusDiscard ? `${next.focusDiscard.from}:${next.focusDiscard.tile.id}` : null;
  if (nk && nk !== pk) { const k = tileVoiceKey(next.focusDiscard!.tile); if (k) out.push(k); }
  // 2. 吃、碰、槓：某家多了一組；或原本的碰變成槓（加槓）
  next.melds.forEach((ms, seat) => {
    const before = prev.melds[seat] ?? [];
    ms.forEach((m, i) => {
      const b = before[i];
      if (!b) out.push(meldVoice(m.type));
      else if (b.type === "pong" && m.type === "kong") out.push("kong");
    });
  });
  // 3. 胡、自摸：這次多了一位胡的人（流局的 seat −1 佔位不算，審伯 R1）。一局只唸一次由 createVoiceTracker 管（R2）
  const had = new Set(realWinners(prev.winners).map((w) => w.seat));
  const fresh = realWinners(next.winners).filter((w) => !had.has(w.seat));
  if (fresh.some((w) => w.from === null)) out.push("zimo"); // 伺服器自摸、八仙過海一定寫 from: null（gameLogic.ts）
  else if (fresh.length) out.push("hu");
  return out;
}

/** 真的胡牌的人：玩家和觀戰畫面流局時 winner 是 { seat: -1 } 佔位（審伯 R1），不是胡 */
const realWinners = (ws: VoiceSnapshot["winners"]) => ws.filter((w) => Number.isInteger(w.seat) && w.seat >= 0 && w.seat <= 3);

/**
 * 一局（同一房、同一局）的配音判斷：記住上一個狀態，算這次要唸什麼。
 * 胡、自摸一局最多唸一次（審伯 R2）：一炮多響分好幾次收到（一家胡 → 三家胡）、兩響順位換掉原座位、廣播和輪詢交錯
 * （中間收到一個還沒有贏家的舊狀態）都不會再唸第二次。換局、換房時 new 一個新的
 */
export function createVoiceTracker() {
  let prev: VoiceSnapshot | null = null;
  let winVoiced = false;
  return {
    next(snap: VoiceSnapshot): VoiceKey[] {
      const out = voiceEvents(prev, snap).filter((k) => {
        if (k !== "hu" && k !== "zimo") return true;
        if (winVoiced) return false;
        winVoiced = true;
        return true;
      });
      if (realWinners(snap.winners).length) winVoiced = true; // 剛進房就已經有人胡：之後也不唸
      prev = snap;
      return out;
    },
  };
}

/** 唸一句的控制：done＝真的播完（或被停掉、沒播出來）才 resolve；stop＝馬上停（還在等音訊叫醒就不播了） */
export type VoicePlayback = { done: Promise<number>; stop: () => void };

/**
 * 播放排隊：一次只播一句，播完才播下一句，不會疊成一團。
 * 正在播的時候最多再排 1 句；又有新的進來，就把排著的那句換成新的（例：打牌「三萬」播到一半被碰，接著唸「碰」；
 * 連續好幾家打牌太快，中間的就跳過、只唸最新的）。
 * reset（換房、換局、離開牌桌，審伯 R4）：丟掉排著的、停掉正在播或還在等音訊叫醒的那句；
 * 舊的那句之後才結束也不會再接著播任何東西（用世代編號隔開），新的句子馬上能播。
 */
export function createVoiceQueue(play: (k: VoiceKey) => VoicePlayback) {
  let gen = 0;
  let current: VoicePlayback | null = null;
  let pending: VoiceKey | null = null;
  const run = async (k: VoiceKey) => {
    const g = gen;
    const pb = play(k);
    current = pb;
    try { await pb.done; } catch { /* 播不出來就跳過 */ }
    if (g !== gen) return; // 已經 reset：這句是舊的，不接下一句、不動新的狀態
    current = null;
    if (pending) { const n = pending; pending = null; void run(n); }
  };
  return {
    push(keys: VoiceKey[]) {
      for (const k of keys) {
        if (!current) void run(k);
        else pending = k;
      }
    },
    reset() { gen++; pending = null; const c = current; current = null; c?.stop(); },
    state: () => ({ playing: !!current, pending }),
  };
}

/** 玩家畫面、觀戰畫面的牌桌狀態 → 配音要看的那幾個欄位。不是在打牌或剛結束（等人、沒狀態）回 null＝不唸 */
export function voiceSnapshotOf(s: {
  status: string;
  focusDiscard?: VoiceSnapshot["focusDiscard"];
  players: { revealed?: VoiceSnapshot["melds"][number] }[];
  winners?: VoiceSnapshot["winners"] | null;
  winner?: VoiceSnapshot["winners"][number] | null;
} | null | undefined): VoiceSnapshot | null {
  if (!s || (s.status !== "playing" && s.status !== "finished")) return null;
  return {
    focusDiscard: s.status === "playing" ? s.focusDiscard ?? null : null,
    melds: s.players.map((p) => p.revealed ?? []),
    winners: realWinners(s.winners?.length ? s.winners : s.winner ? [s.winner] : []), // 流局 seat −1 佔位不算（R1）
  };
}
