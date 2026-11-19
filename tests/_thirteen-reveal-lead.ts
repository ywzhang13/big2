// 十三支「開始比牌」動畫被吃掉（老闆 2026-11-19 回報「開局的開始比牌動畫有時候只有 0.幾秒」）。
// 原因：前端的亮牌動畫起點＝伺服器的 revealedAt（四家同步、重新整理接著播），但伺服器把 revealedAt 記成「決定亮牌的那一刻」；
//   之後還要存檔、廣播（逐一用 REST 送）、即時頻道送到瀏覽器、前端等 0.12 秒再讀一次狀態、回應傳回來，畫面才畫出亮牌。
//   這段 0.5～1 秒已經算在動畫裡，「開始比牌」大字（0.9 秒）只剩一點點、甚至整個跳過；開頭的音效晚 0.4 秒以上就不播。
// 修法：亮牌時把動畫起點排在 REVEAL_TIMING.LEAD_MS 之後（伺服器時間），結算面板、自動下一局跟著往後；四家照樣同一個起點。
//   L1 亮牌時：revealedAt＝亮牌那一刻＋LEAD_MS（至少 1 秒）、settleAt＝revealedAt＋演出長度、nextHandAt＝settleAt＋30 秒
//   L2 模擬 1000 局 × 四家（延遲照正式站 2026-11-19 實測；見報告）：每家看到「開始比牌」大字的長度、開頭音效有沒有播
//   L3 同上，另外 5% 的人多慢 0.5～1.5 秒（手機網路差、伺服器冷啟動；假設值）：不慢的 95% 都完整，慢的只補回一部分
import { newRoomState, type ThirteenGameState } from "../lib/thirteen/db";
import { REVEAL_TIMING, revealDurationMs, revealIfReady, seatPlayers, SETTLE_WAIT_MS, startHand } from "../lib/thirteen/flow";
import { autoArrange } from "../lib/thirteen/arrange";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const LEAD = (REVEAL_TIMING as { LEAD_MS?: number }).LEAD_MS ?? 0; // 修正前沒有這個常數＝0
const START_WORD_MS = 900;   // 前端「開始比牌」大字的長度（components/thirteen/revealTimeline.ts MS.startWord）
const SFX_LATE_MS = 400;     // 前端音效晚超過 0.4 秒就不播（components/thirteen/sfx.ts useRevealSfx）

// L1
{
  const s: ThirteenGameState = newRoomState({ arrangeSec: 30, totalHands: 8, scoreRule: "v4" });
  seatPlayers(s, [0, 1, 2, 3].map((seat) => ({ id: `s${seat}`, room_id: "r", player_id: `p${seat}`, name: `p${seat}`, seat, user_id: null })));
  startHand(s, 1_000_000);
  const rule = { lucky: s.rest[0]?.rank ?? null };
  for (const p of s.players) p.arrangement = autoArrange(p.hand, rule);
  const now = 1_010_000;
  revealIfReady(s, now);
  const d = revealDurationMs(s.hands[0].result);
  eq([LEAD >= 1000, s.revealedAt, s.settleAt, s.nextHandAt], [true, now + LEAD, now + LEAD + d, now + LEAD + d + SETTLE_WAIT_MS],
    `L1 亮牌：動畫起點 revealedAt＝亮牌那一刻＋${LEAD} 毫秒（至少 1 秒，留給存檔、廣播、瀏覽器收到）；settleAt、nextHandAt 跟著往後`);
}

// L2、L3：每家「從伺服器決定亮牌，到自己畫面畫出亮牌」的延遲 D（毫秒）
// 實測（正式站 Vercel 請求紀錄，2026-11-19 一場 5 次「送出／下一局」）：觸發的請求進伺服器 → 四家補抓狀態的請求進伺服器，20 筆 410～602
const GAPS = [431, 443, 447, 455, 439, 442, 446, 453, 581, 585, 592, 602, 410, 421, 425, 436, 417, 429, 433, 451];
let seed = 20261119;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const U = (a: number, b: number) => a + (b - a) * rnd();
function delay(tail: boolean): number {
  const gap = GAPS[Math.floor(rnd() * GAPS.length)];
  const pre = U(30, 80);        // 觸發的請求進來到記下亮牌時間（登入、鎖、讀房間）
  const back = U(110, 250);     // 補抓狀態：伺服器處理＋回傳（從台灣量正式站來回 130～230 毫秒，加上讀資料庫）
  const render = U(0, 100);     // 亮牌畫面每 0.1 秒更新一次
  const skewBias = U(30, 80);   // 時差估計偏差：伺服器時間是在請求後段才記，前端當成來回中點
  return gap - pre + back + render + skewBias + (tail ? U(500, 1500) : 0);
}
function simulate(tailRate: number) {
  const word: number[] = []; let sfx = 0, n = 0;
  for (let hand = 0; hand < 1000; hand++) for (let seat = 0; seat < 4; seat++) {
    const t = delay(rnd() < tailRate) - LEAD;           // 第一次畫出亮牌時，動畫已經走到哪裡（負的＝還沒開始）
    word.push(Math.max(0, START_WORD_MS - Math.max(0, t))); // 前端掛上大字時照當時的進度，已經過去的部分看不到
    if (t <= SFX_LATE_MS) sfx++;
    n++;
  }
  word.sort((a, b) => a - b);
  return { n, min: Math.round(word[0]), p10: Math.round(word[Math.floor(n * 0.1)]), median: Math.round(word[Math.floor(n / 2)]), full: word.filter((w) => w >= START_WORD_MS).length, sfx };
}
{
  const r = simulate(0);
  console.log(`L2 模擬（LEAD=${LEAD}）：${JSON.stringify(r)}`);
  eq([r.n, r.min, r.full, r.sfx], [4000, START_WORD_MS, 4000, 4000],
    `L2 模擬 1000 局 × 四家（實測延遲）：「開始比牌」大字最短 ${r.min / 1000} 秒、中位數 ${r.median / 1000} 秒、完整 0.9 秒的有 ${r.full}／4000 人；開頭音效播了 ${r.sfx}／4000`);
}
{
  const r = simulate(0.05);
  console.log(`L3 模擬（LEAD=${LEAD}）：${JSON.stringify(r)}`);
  eq([r.n, r.p10 === START_WORD_MS, r.full >= 3700], [4000, true, true],
    `L3 另外 5% 的人多慢 0.5～1.5 秒：大字最短 ${r.min / 1000} 秒、完整的有 ${r.full}／4000 人（不慢的 95% 都要完整，至少 3700；慢的那些 LEAD 只補得回一部分）；音效播了 ${r.sfx}／4000`);
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
