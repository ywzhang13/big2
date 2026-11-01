// 省量（老馬 2026-11-01）：牌桌、觀戰畫面以即時推播為主，輪詢只當保險（lib/mahjong/syncPolicy.ts）
import { MAX_STALE_STATE_REFETCH, OFFLINE_POLL_MS, SAFETY_POLL_MS, SyncPolicy } from "../lib/mahjong/syncPolicy";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// 連線狀態 → 補抓間隔
{
  const s = new SyncPolicy();
  check(s.due(0, false), "P1 還沒抓過：馬上要抓");
  s.markSent(0);
  check(!s.live && !s.due(OFFLINE_POLL_MS - 1, false) && s.due(OFFLINE_POLL_MS, false), "P2 還沒訂閱上：照舊每 5 秒");
  s.setChannel("room", true);
  s.markSent(10_000);
  check(s.live && !s.due(10_000 + SAFETY_POLL_MS - 1, false) && s.due(10_000 + SAFETY_POLL_MS, false), "P3 訂閱上了：25 秒沒抓過才補抓");
  s.setChannel("private", false);
  check(!s.live && s.due(10_000 + OFFLINE_POLL_MS, false), "P4 座位頻道還沒訂閱上（或斷了）：回到每 5 秒");
  s.setChannel("private", true);
  s.setChannel("room", false);
  check(!s.live && s.due(10_000 + OFFLINE_POLL_MS, false), "P5 房間頻道斷了（CLOSED／TIMED_OUT／CHANNEL_ERROR）：回到每 5 秒");
  s.setChannel("room", true);
  s.removeChannel("private");
  check(s.live && !s.due(10_000 + OFFLINE_POLL_MS, false), "P6 重連上、拿掉座位頻道：只看房間頻道，回到 25 秒");
  check(!s.due(10_000 + SAFETY_POLL_MS * 10, true), "P7 分頁在背景：再久都不抓");
  s.markSent(50_000);
  check(!s.due(50_000 + SAFETY_POLL_MS - 1, false), "P8 事件觸發、回前景抓過：保險輪詢重新計時（不會緊接著再抓一次）");
  const v = new SyncPolicy(20_000);
  v.setChannel("room", true); v.markSent(0);
  check(!v.due(19_999, false) && v.due(20_000, false), "P9 觀戰畫面用 20 秒");
}

// 版本號跳號
{
  const s = new SyncPolicy();
  check(!s.noteVersion(undefined) && !s.noteVersion("5") && !s.noteVersion(NaN), "V1 事件沒帶版本號（舊伺服器）：不當成漏事件");
  check(!s.noteVersion(10, { fromState: true }), "V2 完整狀態帶版本號：記下來，不算跳號");
  check(!s.noteVersion(11) && !s.noteVersion(11), "V3 下一版、同一版的多個事件（同一次存檔送好幾個事件）：不算跳號");
  check(s.noteVersion(13), "V4 11 之後直接來 13：中間漏了 12 → 要補抓");
  check(!s.noteVersion(12), "V5 晚到的 12（座位頻道和房間頻道不保證順序）：比看過的舊，不算跳號");
  check(!s.noteVersion(20, { fromState: true }) && !s.noteVersion(21), "V6 補抓回來的完整狀態是 20：之後 21 接得上");
  check(!s.noteVersion(15, { fromState: true }) && !s.noteVersion(21) && s.noteVersion(23), "V7 比較舊的完整狀態不會把版本號倒退");
  s.resetVersion();
  check(!s.noteVersion(3) && !s.noteVersion(4), "V8 換房間：版本號重新算（新房間從小的數字開始，不會被舊房間擋住）");
  check(s.noteVersion(6), "V9 換房間後照樣抓得到跳號");
}

// 亂序晚到的舊事件不能把畫面蓋回去（審伯 2026-11-01 複查 ⑨）
{
  // 模擬呼叫端（useMahjong onHeld）：舊的不套用（必要時補抓）；不是舊的才套用並記版本，跳號就補抓
  const sim = () => {
    const s = new SyncPolicy(); const r = { s, shown: [] as number[], refetch: 0, now: 0 };
    const recv = (sv: number) => {
      if (s.isStale(sv)) { if (s.needsRefetchAfterStale(sv, r.now)) { r.refetch++; s.markSent(r.now); } return; }
      r.shown.push(sv); if (s.noteVersion(sv)) { r.refetch++; s.markSent(r.now); }
    };
    return { r, recv };
  };
  {
    const { r, recv } = sim(); recv(10); r.now = 100; recv(9);
    check(r.shown.join() === "10", "O1 先收到 sv=10 再收到 sv=9：9 不套用，畫面停在 10（不退回）");
  }
  {
    const { r, recv } = sim(); recv(8); recv(10);
    check(r.refetch === 1 && r.shown.join() === "8,10", "O2 從 sv=8 直接跳到 sv=10：立刻補抓 1 次");
  }
  {
    const { r, recv } = sim(); recv(10); recv(10); recv(10);
    check(r.shown.join() === "10,10,10" && r.refetch === 0, "O3 同一版的公開事件、座位頻道個人事件（同一次存檔）：都照樣套用");
  }
  {
    // 公開 9 → 公開 10 先到 → 座位頻道的 9（手牌）晚到：不套用，但完整狀態還沒涵蓋 9 → 補抓一次，手牌不會遺失
    const { r, recv } = sim(); recv(9); recv(10); r.now = 50; recv(9);
    check(r.shown.join() === "9,10" && r.refetch === 1, "O4 晚到的個人事件（手牌）：不套用，改成補抓完整狀態 1 次（手牌從伺服器拿回來）");
    r.now = 80; recv(9); recv(8);
    check(r.refetch === 1, "O5 補抓還在路上（3 秒內、送出時已看過 10）：其他晚到的舊事件不重複補抓（請求不變多）");
    r.now = 50 + 3000; recv(9);
    check(r.refetch === 2, "O6 補抓 3 秒還沒涵蓋（回應可能被擋下）：再晚到的舊事件會再補抓");
  }
  {
    const { r, recv } = sim(); r.s.noteVersion(15, { fromState: true }); recv(14);
    check(r.shown.length === 0 && r.refetch === 0, "O7 已套用完整狀態 15：比 15 舊的事件不套用、也不用補抓（狀態已經包含）");
    recv(15); recv(16);
    check(r.shown.join() === "15,16", "O8 完整狀態 15 之後，15、16 的事件照常套用");
  }
  {
    const s = new SyncPolicy(); s.markApplied("p|mj_hand_update|{9}"); s.noteVersion(9); s.noteVersion(10);
    check(s.isStale(9) && s.wasApplied("p|mj_hand_update|{9}") && !s.wasApplied("p|mj_draw_tile|{9}"), "O11 同一個事件重送（內容一樣、已套用過）：認得出來，不用補抓；沒套用過的照樣補抓");
    for (let i = 0; i < 250; i++) s.markApplied(`k${i}`);
    check(!s.wasApplied("p|mj_hand_update|{9}") && s.wasApplied("k249"), "O12 只記最近 200 個（不會越記越多）");
    s.resetVersion();
    check(!s.wasApplied("k249"), "O13 換房間：清掉");
  }
  {
    const s = new SyncPolicy(); s.noteVersion(30);
    check(!s.isStale(undefined) && !s.isStale("3") && !s.isStale(NaN), "O9 沒帶版本號的事件（舊伺服器、聊天）：一律套用");
    s.resetVersion();
    check(!s.isStale(1), "O10 換房間：舊房間的版本不會擋住新房間的小版本");
  }
}

// 事件和完整狀態一起亂序：最後畫面只能是版本最新的狀態（審伯 2026-11-01 複查 必修 4）
{
  // 模擬 useMahjong：事件走 onHeld（舊的丟掉、跳號補抓）、完整狀態走 fetchState（checkState 不是 apply 就不蓋畫面）
  const sim = () => {
    const s = new SyncPolicy(); const r = { screen: null as number | null, fetches: 0, now: 0 };
    const event = (sv: number) => {
      if (s.isStale(sv)) { if (s.needsRefetchAfterStale(sv, r.now)) { r.fetches++; s.markSent(r.now); } return; }
      r.screen = sv; if (s.noteVersion(sv)) { r.fetches++; s.markSent(r.now); }
    };
    const state = (sv: number) => {
      const v = s.checkState(sv);
      if (v === "refetch") { r.fetches++; s.markSent(r.now); return v; }
      if (v === "apply") { r.screen = sv; s.noteVersion(sv, { fromState: true }); }
      return v;
    };
    return { r, event, state };
  };
  {
    const { r, event } = sim(); event(11); event(12); event(11);
    check(r.screen === 12, "S1 12→11 亂序：晚到的 11 不套用，畫面停在 12");
  }
  {
    const { r, event, state } = sim(); event(10); event(12);
    check(r.fetches === 1, "S2 10→12 跳號：立刻補抓 1 次");
    state(12);
    check(r.screen === 12, "S2 補抓回來的 12 照常套用，畫面是 12");
  }
  {
    const { r, event, state } = sim(); event(12);
    check(state(11) === "refetch" && r.screen === 12 && r.fetches === 1, "S3 舊狀態晚回：畫面已經是 12，回來的 11 不蓋掉，再抓一次");
    check(state(12) === "apply" && r.screen === 12, "S3 再抓回來的 12 照常套用");
  }
  {
    const { r, event, state } = sim(); event(10); event(12); event(11); state(11); state(12);
    check(r.screen === 12, "S4 三種一起來（跳號、舊事件、舊狀態）：最後畫面是 12");
  }
  {
    const { r, event, state } = sim(); event(20);
    const v = [state(19), state(19), state(19)];
    check(v.join() === "refetch,refetch,drop" && r.fetches === MAX_STALE_STATE_REFETCH && r.screen === 20, "S5 伺服器一直回舊狀態：最多重抓 2 次就先停（請求不會一直變多），畫面不退回");
    check(state(19) === "refetch", "S6 先停之後，下一次（保險輪詢）還是舊的可以再重抓");
    check(state(21) === "apply" && r.screen === 21, "S7 回來的狀態比畫面新：照常套用");
  }
  {
    const s = new SyncPolicy(); s.noteVersion(30);
    check(s.checkState(undefined) === "apply", "S8 狀態沒帶版本號（大廳、舊伺服器）：照常套用");
    s.resetVersion();
    check(s.checkState(1) === "apply", "S9 換房間：舊房間的版本不會擋住新房間的狀態");
  }
}

// 慢慢摸牌期間排隊的事件：真正執行前再比一次版本（審伯 2026-11-01 複查）
{
  // 模擬 useMahjong：排隊時照舊記版本（noteVersion），釋放佇列時 checkQueued 不是 run 就不改畫面
  const sim = () => {
    const s = new SyncPolicy(); const r = { screen: null as number | null, fetches: 0, now: 0 };
    let queue: (() => void)[] = []; let hold = false;
    const fetch = () => { r.fetches++; s.markSent(r.now); };
    const event = (sv: number, pass = false) => {
      if (s.isStale(sv)) { if (s.needsRefetchAfterStale(sv, r.now)) fetch(); return; }
      const apply = () => { r.screen = sv; };
      if (hold && !pass) queue.push(() => { const v = s.checkQueued(sv, r.now); if (v === "run") apply(); else if (v === "refetch") fetch(); });
      else apply();
      if (s.noteVersion(sv)) fetch();
    };
    const release = () => { hold = false; const q = queue; queue = []; q.forEach((f) => f()); };
    return { s, r, event, release, startHold: () => { hold = true; } };
  };
  {
    const { r, event, release, startHold } = sim();
    event(9); startHold(); event(10); event(11, true);
    check(r.screen === 11, "Q1 sv=10 排隊、sv=11（摸牌事件）立即套用：畫面是 11");
    release();
    check(r.screen === 11 && r.fetches === 1, "Q1 釋放佇列後 10 不蓋掉畫面，畫面仍是 11；完整狀態還沒涵蓋 10，補抓 1 次");
  }
  {
    const { r, event, release, startHold } = sim();
    event(9); startHold(); event(10); event(10); event(11, true); release();
    check(r.fetches === 1, "Q2 排隊裡有兩個 10（公開＋個人）：只補抓 1 次（第二個看到補抓已在路上）");
    release(); release();
    check(r.fetches === 1 && r.screen === 11, "Q2 重複釋放：佇列已清空，不會多補抓");
    r.now = 100; event(10);
    check(r.fetches === 1 && r.screen === 11, "Q2 10 之後重送：補抓已在路上，不多補抓、畫面不退回");
    r.now = 5000; event(10); event(10); event(10);
    check(r.fetches === 2 && r.screen === 11, "Q2 補抓 3 秒沒涵蓋才再補 1 次，之後連續重送不會無限補抓");
  }
  {
    const { s, r, event, release, startHold } = sim();
    event(9); startHold(); event(10); event(11, true); s.noteVersion(11, { fromState: true }); release();
    check(r.screen === 11 && r.fetches === 0, "Q3 釋放前完整狀態 11 已套用（已涵蓋 10）：10 不套用、也不補抓");
  }
  {
    const { r, event, release, startHold } = sim();
    event(9); startHold(); event(10); event(10, true); release();
    check(r.screen === 10 && r.fetches === 0, "Q4 排隊的和立即套用的同一版（10）：照常套用，不補抓");
  }
  {
    const s = new SyncPolicy(); s.noteVersion(30);
    check(s.checkQueued(undefined, 0) === "run", "Q5 沒帶版本號的排隊事件：照常套用");
  }
}

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
