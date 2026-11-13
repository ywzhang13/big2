// 三遊戲共用聊天框（components/social/chatLog.ts、SocialChatBox.tsx；老闆 2026-11-13：聊天只存這一場、觀戰看得到不能說）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../lib/social/events";
import {
  __peekChatLog, __resetChatLog, addChatEffect, addChatMessage, bindChatLog, loadChatHistory, setChatLogOpen, type HistoryResult,
} from "../components/social/chatLog";
import SocialChatBox from "../components/social/SocialChatBox";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const msg = (id: string, ts: number, from = "p2", extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, kind: "text", from, fromName: from === "me" ? "我" : "老王", fromSeat: 1, text: `訊息${id}`, ts, ...extra });
const ok = (messages: ChatMessage[]) => async (): Promise<HistoryResult> => ({ ok: true, messages });
const ids = () => __peekChatLog().entries.map((e) => e.id).join(",");
const box = (p: Partial<Parameters<typeof SocialChatBox>[0]> = {}) =>
  renderToStaticMarkup(createElement(SocialChatBox, { variant: "dock", open: true, onClose: () => {}, emptyHint: "說句話，和大家聊聊吧", ...p }));

async function main() {
  // 歷史＋即時：依伺服器時間排序、同一則（歷史和即時各收到一次）只留一則
  {
    __resetChatLog();
    bindChatLog("acc|room1|me", "me");
    addChatMessage(msg("c", 300));
    check(ids() === "c", "收到別人的新訊息：進清單");
    await loadChatHistory(ok([msg("a", 100), msg("b", 200), msg("c", 300)]));
    check(ids() === "a,b,c", "歷史和即時合併：由舊到新、同一個 id 只留一則");
    check(__peekChatLog().status === "ready", "讀完歷史：狀態 ready");
    addChatMessage(msg("c", 300));
    check(ids() === "a,b,c", "重複收到同一則：不重複加");
    addChatMessage(msg("d", 400, "me"));
    check(ids().endsWith("d"), "自己發的訊息：進清單");
    addChatEffect({ id: "fx1", ts: 500, fromName: "阿德", toName: "老王", label: "拍手" });
    check(ids().endsWith("fx1"), "互動紀錄：進清單");
    setChatLogOpen(true);
    check(__peekChatLog().open, "打開聊天框");
    addChatMessage(msg("e", 600));
    check(ids().endsWith("e"), "開著時收到新訊息：進清單");
    setChatLogOpen(false);
    check(!("unread" in __peekChatLog()), "不再計算未讀數（老闆 2026-11-13：聊天鈕不顯示幾則未讀的紅色數字）");
  }
  // 換場清空；舊的一場晚回來的歷史丟掉
  {
    __resetChatLog();
    bindChatLog("acc|room1|me", "me");
    let release: (r: HistoryResult) => void = () => {};
    const p = loadChatHistory(() => new Promise<HistoryResult>((r) => { release = r; }));
    check(__peekChatLog().status === "loading", "讀歷史中：載入中");
    bindChatLog("acc|room2|me", "me");
    release({ ok: true, messages: [msg("old", 1)] });
    await p;
    check(ids() === "" && __peekChatLog().key === "acc|room2|me", "讀的時候換房：舊房的歷史不會混進新房");
    bindChatLog("acc|room2|me", "me");
    addChatMessage(msg("x", 10));
    bindChatLog("acc|room2|me", "me");
    check(ids() === "x", "同一場重複綁定：不清空");
    bindChatLog(null);
    addChatMessage(msg("y", 20));
    check(ids() === "", "離開（key＝null）：清空、不再收");
  }
  // 重新讀歷史：同一則語音換成新的網址（簽名到期重簽）或 null（檔案已清掉）（審伯 2026-11-13 必修②）
  {
    __resetChatLog();
    bindChatLog("k", "me");
    const v = (url: string | null) => msg("v1", 100, "p2", { kind: "voice", text: undefined, url, durationMs: 3000 });
    addChatMessage(v("https://v/old?sig=1"));
    addChatMessage(msg("t1", 200));
    await loadChatHistory(ok([v("https://v/old?sig=2"), msg("t1", 200)]));
    const e1 = __peekChatLog().entries[0];
    check(e1.type === "msg" && e1.msg.url === "https://v/old?sig=2", "重新讀歷史：同一則語音換成新簽發的網址");
    check(ids() === "v1,t1", "換網址：仍然只有一則、順序不變");
    await loadChatHistory(ok([v(null), msg("t1", 200)]));
    const e2 = __peekChatLog().entries[0];
    check(e2.type === "msg" && e2.msg.url === null, "檔案已清掉（null）：取代舊網址，顯示「語音已過期」");
    check(box().includes("語音已過期") && !box().includes("data-chat-log-voice"), "畫面：過期的語音不顯示成能播放");
    check(ids() === "v1,t1", "換成 null：仍然只有一則、順序不變");
    await loadChatHistory(ok([v("https://v/back?sig=3"), msg("t1", 200)]));
    const e3 = __peekChatLog().entries[0];
    check(e3.type === "msg" && e3.msg.url === "https://v/back?sig=3", "再讀到新網址：恢復可播放");
  }
  // 語音播放交給遊戲：播放中、失敗的狀態照遊戲給的顯示
  {
    __resetChatLog();
    bindChatLog("k", "me");
    addChatMessage(msg("v9", 1, "p2", { kind: "voice", text: undefined, url: "https://v/9", durationMs: 2000 }));
    const toggled: string[] = [];
    const vb = (playingId: string | null, failedId: string | null) => box({ voice: { playingId, failedId, toggle: (id) => void toggled.push(id) } });
    check(vb("v9", null).includes("暫停語音") && vb(null, null).includes("播放語音"), "播放中顯示「暫停」，沒在播顯示「播放」（由遊戲的播放器決定）");
    check(vb(null, "v9").includes("語音無法播放，點擊重試"), "遊戲回報播放失敗：顯示「語音無法播放，點擊重試」");
    check(/<button[^>]*disabled=""[^>]*data-chat-log-voice/.test(box()), "沒給播放器：語音鈕停用，不會自己另開播放器");
  }
  // 遊戲得知房間已關閉（例如送出時回 410 room_closed）
  {
    __resetChatLog();
    bindChatLog("k", "me");
    addChatMessage(msg("a", 1));
    const { markChatLogClosed } = await import("../components/social/chatLog");
    markChatLogClosed();
    check(__peekChatLog().status === "closed" && ids() === "", "markChatLogClosed：清掉內容，狀態改成已關閉");
    check(box().includes("房間已關閉，本場聊天已清除"), "畫面：房間已關閉，本場聊天已清除");
    bindChatLog(null);
    markChatLogClosed();
    check(__peekChatLog().status === "idle", "沒有綁定一場時呼叫：不動作");
  }
  // 關房競態（審伯 2026-11-13 必修）：關閉後晚到的歷史、聊天、互動都不能把內容補回來
  {
    const { markChatLogClosed } = await import("../components/social/chatLog");
    const closedEmpty = () => __peekChatLog().status === "closed" && ids() === "";
    // 1. 歷史請求送出 → 410 關房 → 舊的歷史回應（成功）才到
    __resetChatLog();
    bindChatLog("k1", "me");
    let release: (r: HistoryResult) => void = () => {};
    const p1 = loadChatHistory(() => new Promise<HistoryResult>((r) => { release = r; }));
    markChatLogClosed();
    release({ ok: true, messages: [msg("old1", 1), msg("old2", 2)] });
    await p1;
    check(closedEmpty(), "關房後才到的歷史（成功）：不會把訊息補回來，維持已關閉、零訊息");
    // 2. 一樣的順序，舊回應是失敗
    __resetChatLog();
    bindChatLog("k1", "me");
    const p2 = loadChatHistory(() => new Promise<HistoryResult>((r) => { release = r; }));
    markChatLogClosed();
    release({ ok: false, reason: "failed" });
    await p2;
    check(closedEmpty(), "關房後才到的歷史（失敗）：不會改成「無法載入」，維持已關閉");
    // 3. 舊回應是例外（網路斷）
    __resetChatLog();
    bindChatLog("k1", "me");
    let rejectIt: (e: Error) => void = () => {};
    const p3 = loadChatHistory(() => new Promise<HistoryResult>((_, rej) => { rejectIt = rej; }));
    markChatLogClosed();
    rejectIt(new Error("net"));
    await p3;
    check(closedEmpty(), "關房後才到的歷史（網路例外）：維持已關閉");
    // 4. 同一場關閉後再讀歷史（回到前景、網路恢復）：不讀、不恢復
    let called = 0;
    await loadChatHistory(async () => { called++; return { ok: true, messages: [msg("again", 3)] }; });
    check(called === 0 && closedEmpty(), "同一場關閉後重讀歷史：不送請求、不恢復內容");
    // 5. 同一場關閉後收到聊天、互動
    addChatMessage(msg("late-msg", 4));
    addChatEffect({ id: "late-fx", ts: 5, fromName: "阿德", toName: "老王", label: "拍手" });
    check(closedEmpty(), "同一場關閉後收到聊天、互動：不加進清單");
    // 6. 兩個歷史請求同時在讀：一個回報房間不在（404），另一個晚一點成功回來
    __resetChatLog();
    bindChatLog("k2", "me");
    let relA: (r: HistoryResult) => void = () => {}, relB: (r: HistoryResult) => void = () => {};
    const pa = loadChatHistory(() => new Promise<HistoryResult>((r) => { relA = r; }));
    const pb = loadChatHistory(() => new Promise<HistoryResult>((r) => { relB = r; }));
    relA({ ok: false, reason: "closed" });
    await pa;
    relB({ ok: true, messages: [msg("b1", 1)] });
    await pb;
    check(closedEmpty(), "兩個請求同時在讀、其中一個回報關房：另一個晚到的成功回應不能把內容補回來");
    // 7. 換到新的一場：照常讀歷史、收聊天和互動
    bindChatLog("k3", "me");
    check(__peekChatLog().status === "idle" && ids() === "", "換到新的一場：重設，不再是已關閉");
    await loadChatHistory(ok([msg("n1", 1)]));
    addChatMessage(msg("n2", 2));
    addChatEffect({ id: "nfx", ts: 3, fromName: "阿德", label: "愛心" });
    check(__peekChatLog().status === "ready" && ids() === "n1,n2,nfx", "新的一場：歷史、聊天、互動都正常");
    // 8. 舊場關閉前發出、換場後才到的歷史：也不會混進新場
    __resetChatLog();
    bindChatLog("k4", "me");
    const p8 = loadChatHistory(() => new Promise<HistoryResult>((r) => { release = r; }));
    markChatLogClosed();
    bindChatLog("k5", "me");
    release({ ok: true, messages: [msg("k4-old", 1)] });
    await p8;
    check(__peekChatLog().key === "k5" && ids() === "" && __peekChatLog().status === "idle", "舊場關閉、換場後才到的舊歷史：不混進新場");
  }
  // 讀取失敗、房間關閉
  {
    __resetChatLog();
    bindChatLog("k", "me");
    await loadChatHistory(async () => ({ ok: false, reason: "failed" }));
    check(__peekChatLog().status === "error", "讀不到、清單是空的：顯示錯誤（可重試）");
    await loadChatHistory(async () => { throw new Error("net"); });
    check(__peekChatLog().status === "error", "網路例外也當讀取失敗");
    addChatMessage(msg("a", 1));
    await loadChatHistory(async () => ({ ok: false, reason: "failed" }));
    check(__peekChatLog().status === "ready" && ids() === "a", "已有訊息時重連讀不到：保留現有內容");
    await loadChatHistory(async () => ({ ok: false, reason: "closed" }));
    check(__peekChatLog().status === "closed" && ids() === "", "房間已關閉：舊內容清掉");
  }
  // 畫面：各種狀態
  {
    __resetChatLog();
    check(box({ open: false }) === "", "收起時不畫");
    bindChatLog("k", "me");
    await loadChatHistory(ok([]));
    const empty = box();
    check(empty.includes("還沒有訊息") && empty.includes("說句話，和大家聊聊吧") && empty.includes("data-chat-log-empty"), "空狀態：還沒有訊息＋提示");
    check(empty.includes(">聊天室<") && !empty.includes("本場聊天<") && !empty.includes("關房後清除"), "標題：聊天室（不寫本場聊天、關房後清除）");
    check(!/<button/.test(empty), "沒有「收起」鈕（點外面就關）");
    check(!empty.includes("data-chat-log-alert") && !empty.includes("data-chat-log-readonly"), "玩家、沒輪到：沒有提示條、沒有唯讀說明");
    const ro = box({ readOnlyText: "觀戰中，僅能觀看聊天與互動" });
    check(ro.includes("觀戰中，僅能觀看") && ro.includes("data-chat-log-readonly") && !/<input|<textarea/.test(ro), "觀戰：顯示「觀戰中，僅能觀看」，沒有輸入框");
    const al = box({ alert: "輪到你出牌" });
    check(al.includes("data-chat-log-alert") && al.includes("輪到你出牌") && !al.includes("收起") && !/<button/.test(al), "輪到自己：只有一條細提示，沒有按鈕");
    addChatMessage(msg("t1", Date.UTC(2026, 10, 13, 4, 5), "p2", { text: "<b>你好</b>" }));
    addChatMessage(msg("v1", 2, "me", { kind: "voice", text: undefined, url: "https://x/v.m4a", durationMs: 4200 }));
    addChatMessage(msg("v2", 3, "p2", { kind: "voice", text: undefined, url: null, durationMs: 3000 }));
    addChatEffect({ id: "f1", ts: 4, fromName: "阿德", toName: "老王", label: "拍手" });
    addChatEffect({ id: "f2", ts: 5, fromName: "阿德", label: "愛心" });
    const h = box();
    check(h.includes("&lt;b&gt;你好&lt;/b&gt;") && !h.includes("<b>你好"), "文字照原文顯示（不當 HTML）");
    check(h.includes("data-chat-log-voice") && h.includes("語音 4 秒"), "語音：播放鈕＋長度");
    check(h.includes("語音已過期") && (h.match(/data-chat-log-voice/g) ?? []).length === 1, "語音檔已清掉（url null）：不顯示成能播放");
    check(/阿德<\/span> 對 <span class="who">老王<\/span> 使用了 拍手/.test(h), "互動紀錄：阿德 對 老王 使用了 拍手");
    check(/阿德<\/span> 使用了 愛心/.test(h), "互動沒有對象：省略對象");
    check(/class="scb-msg mine"/.test(h), "自己的訊息靠右（mine）");
    check(h.includes("本場聊天從這裡開始"), "不到上限：寫「本場聊天從這裡開始」");
    __resetChatLog();
    bindChatLog("k", "me");
    await loadChatHistory(ok(Array.from({ length: 200 }, (_, i) => msg(`m${i}`, i))));
    check(box().includes("只保留本場最近 200 則"), "到 200 則上限：不說成全部歷史");
  }
  // 讀取中、錯誤、已關閉的畫面
  {
    __resetChatLog();
    bindChatLog("k", "me");
    let release: (r: HistoryResult) => void = () => {};
    const p = loadChatHistory(() => new Promise<HistoryResult>((r) => { release = r; }));
    check(box().includes("載入聊天中…"), "讀取中：載入聊天中…");
    release({ ok: false, reason: "failed" });
    await p;
    const e = box({ onRetry: () => {} });
    check(e.includes("聊天暫時無法載入") && e.includes("重試"), "讀取失敗：聊天暫時無法載入＋重試");
    await loadChatHistory(async () => ({ ok: false, reason: "closed" }));
    check(box().includes("房間已關閉，本場聊天已清除"), "房間關閉：房間已關閉，本場聊天已清除");
  }
  console.log(failed ? `❌ 失敗 ${failed} 項` : "全部通過");
  process.exit(failed ? 1 : 0);
}
void main();
