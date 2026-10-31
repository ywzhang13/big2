// 省量（老馬 2026-11-01）：牌桌、觀戰畫面以即時推播為主，輪詢只當保險（lib/mahjong/syncPolicy.ts）
import { OFFLINE_POLL_MS, SAFETY_POLL_MS, SyncPolicy } from "../lib/mahjong/syncPolicy";

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

if (failed) { console.log(`❌ 失敗 ${failed} 項`); process.exit(1); }
