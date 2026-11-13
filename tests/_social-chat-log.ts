// 三遊戲共用聊天框（components/social/chatLog.ts、SocialChatBox.tsx；老闆 2026-11-13：聊天只存這一場、觀戰看得到不能說）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../lib/social/events";
import {
  __peekChatLog, __resetChatLog, addChatEffect, addChatMessage, bindChatLog, loadChatHistory, setChatLogOpen, type HistoryResult,
} from "../components/social/chatLog";
import SocialChatBox, { UnreadBadge } from "../components/social/SocialChatBox";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const msg = (id: string, ts: number, from = "p2", extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, kind: "text", from, fromName: from === "me" ? "我" : "老王", fromSeat: 1, text: `訊息${id}`, ts, ...extra });
const ok = (messages: ChatMessage[]) => async (): Promise<HistoryResult> => ({ ok: true, messages });
const ids = () => __peekChatLog().entries.map((e) => e.id).join(",");
const box = (p: Partial<Parameters<typeof SocialChatBox>[0]> = {}) =>
  renderToStaticMarkup(createElement(SocialChatBox, { variant: "dock", open: true, onClose: () => {}, emptyHint: "說句話，和大家聊聊吧", ...p }));

async function main() {
  // 歷史＋即時：依伺服器時間排序、同一則（歷史和即時各收到一次）只留一則；歷史不算未讀
  {
    __resetChatLog();
    bindChatLog("acc|room1|me", "me");
    addChatMessage(msg("c", 300));
    check(__peekChatLog().unread === 1, "收合時別人的新訊息：未讀 +1");
    await loadChatHistory(ok([msg("a", 100), msg("b", 200), msg("c", 300)]));
    check(ids() === "a,b,c", "歷史和即時合併：由舊到新、同一個 id 只留一則");
    check(__peekChatLog().unread === 1 && __peekChatLog().status === "ready", "歷史裡的訊息不算未讀");
    addChatMessage(msg("c", 300));
    check(__peekChatLog().unread === 1, "重複收到同一則：不重複計未讀");
    addChatMessage(msg("d", 400, "me"));
    check(__peekChatLog().unread === 1 && ids().endsWith("d"), "自己發的訊息：進清單但不算未讀");
    addChatEffect({ id: "fx1", ts: 500, fromName: "阿德", toName: "老王", label: "拍手" });
    check(__peekChatLog().unread === 1 && ids().endsWith("fx1"), "互動紀錄：進清單、不算未讀");
    setChatLogOpen(true);
    check(__peekChatLog().unread === 0, "打開聊天框：未讀歸零");
    addChatMessage(msg("e", 600));
    check(__peekChatLog().unread === 0, "開著時收到新訊息：不算未讀");
    setChatLogOpen(false);
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
    const unread = __peekChatLog().unread;
    await loadChatHistory(ok([v("https://v/old?sig=2"), msg("t1", 200)]));
    const e1 = __peekChatLog().entries[0];
    check(e1.type === "msg" && e1.msg.url === "https://v/old?sig=2", "重新讀歷史：同一則語音換成新簽發的網址");
    check(ids() === "v1,t1" && __peekChatLog().unread === unread, "換網址：仍然只有一則、順序不變、未讀數不變");
    await loadChatHistory(ok([v(null), msg("t1", 200)]));
    const e2 = __peekChatLog().entries[0];
    check(e2.type === "msg" && e2.msg.url === null, "檔案已清掉（null）：取代舊網址，顯示「語音已過期」");
    check(box().includes("語音已過期") && !box().includes("data-chat-log-voice"), "畫面：過期的語音不顯示成能播放");
    check(ids() === "v1,t1" && __peekChatLog().unread === unread, "換成 null：仍然只有一則、順序不變、未讀數不變");
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
    check(__peekChatLog().status === "closed" && ids() === "" && __peekChatLog().unread === 0, "房間已關閉：舊內容和未讀都清掉");
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
  // 未讀徽章
  {
    __resetChatLog();
    bindChatLog("k", "me");
    const badge = () => renderToStaticMarkup(createElement(UnreadBadge));
    check(badge() === "", "沒有未讀：不顯示徽章");
    addChatMessage(msg("a", 1));
    addChatMessage(msg("b", 2));
    check(/data-chat-unread="2"/.test(badge()) && badge().includes("2 則未讀"), "有未讀：顯示數字與讀屏文字");
    for (let i = 0; i < 120; i++) addChatMessage(msg(`n${i}`, 10 + i));
    check(badge().includes(">99+<"), "超過 99：顯示 99+");
  }
  console.log(failed ? `❌ 失敗 ${failed} 項` : "全部通過");
  process.exit(failed ? 1 : 0);
}
void main();
