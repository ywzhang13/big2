// 自摸配音跟「自摸」大字同一刻（老闆 2026-11-28「麻將自摸的聲音應該跟自摸的字一起出來」）。
// 配音（hooks/useTableSounds.ts 的 useTableVoice）在伺服器回報有人自摸的那一刻就唸，但胡牌演出（hooks/useWinShow.tsx）
// 的「自摸」大字要等：大牌段（有的話）播完，再加上自摸特效自己的時間（雷霆 1.66 秒、如來 2.66 秒、隕石 1.25 秒…）。
// 做法：這一手要演出「自摸」字時，useWinShow 先 arm(手)；配音要唸 zimo 時先 hold 住，等演出在字出現那一刻 cue()。
// 保險：跳過、換局、離開（release）或等太久（MAX_WAIT_MS）照樣唸出來，配音不會被吃掉。
// 只管自摸；胡（放槍）、吃碰槓、牌名照舊馬上唸。
export const ZIMO_VOICE_MAX_WAIT_MS = 9000;

type Timer = ReturnType<typeof setTimeout>;

export function createZimoVoiceGate(timers: { set: (f: () => void, ms: number) => Timer; clear: (t: Timer) => void } = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }) {
  let armed: string | null = null; // 哪一手會演出「自摸」字（手＝局數識別）
  let cued: string | null = null;  // 這一手的字已經出現過（配音晚到就直接唸）
  let pending: { hand: string; play: () => void; t: Timer } | null = null;
  const flush = () => {
    if (!pending) return;
    const p = pending; pending = null; timers.clear(p.t); p.play();
  };
  return {
    /** useWinShow：這一手會播「自摸」字（自摸浮層、自摸特效、隕石；可能排在大牌段後面） */
    arm(hand: string) { armed = hand; cued = null; },
    /** useTableVoice：要唸自摸時先問一下；回傳 true＝先扣住，字出現時才唸 */
    hold(hand: string, play: () => void): boolean {
      if (armed !== hand || cued === hand) return false;
      flush();
      pending = { hand, play, t: timers.set(flush, ZIMO_VOICE_MAX_WAIT_MS) };
      return true;
    },
    /** 演出：「自摸」字出現的那一刻 */
    cue(hand: string) { if (armed === hand) cued = hand; if (pending?.hand === hand) flush(); },
    /** 演出結束、跳過、換局、離開：還扣著的照樣唸，然後解除 */
    release(hand?: string) { if (!hand || pending?.hand === hand) flush(); if (!hand || armed === hand) armed = null; },
    /** 換局、離開時配音那邊清掉：扣著的不唸（跟配音佇列 reset 一致） */
    drop() { if (pending) { timers.clear(pending.t); pending = null; } },
  };
}

/** 玩家頁、觀戰頁共用同一個（同一個分頁只會有一張牌桌） */
export const zimoVoiceGate = createZimoVoiceGate();
