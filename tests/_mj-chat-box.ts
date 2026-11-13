// 麻將接上共用聊天框（components/mahjong/MjChatLog.tsx、MjChat.tsx 的聊天鈕、lib/mahjong/chatClient.ts 的 subscribeChat）
//   ・chatClient 收到的聊天（通過這一場檢查、去重後）才通知清單；換房、別房的丟掉
//   ・聊天鈕：未讀數字；玩家按下同時開底板和清單，訪客／觀戰只開清單
//   ・麻將聊天框：觀戰唯讀說明、輪到出牌／吃碰槓胡的提示只在手機抽屜出現、訪客附註
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { documentElement: { style: { setProperty: () => {} } }, addEventListener: () => {}, removeEventListener: () => {}, hidden: false },
  addEventListener: () => {}, removeEventListener: () => {},
});
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const C = await import("../lib/mahjong/chatClient");
const L = await import("../components/social/chatLog");
const { default: MjChatLogBox, toggleMjChatBox } = await import("../components/mahjong/MjChatLog");
const { MjChatButton } = await import("../components/mahjong/MjChat");
type Msg = import("../lib/mahjong/chatClient").ChatMessage;

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const msg = (id: string, from = "p2"): Msg => ({ id, kind: "text", from, fromName: "老王", fromSeat: 1, text: "嗨", ts: Date.now() });

// subscribeChat：只通知這一場、去重後的
{
  const got: string[] = [];
  const off = C.subscribeChat((m) => got.push(m.id));
  C.receiveChat(msg("a"));
  check(got.length === 0, "還沒綁定這一場：不通知");
  C.bindChatSession({ account: "acc", roomId: "r1", roomCode: "1234", myId: "me", mySeat: 0 });
  C.receiveChat(msg("a"), "me", "1234");
  C.receiveChat(msg("a"), "me", "1234");
  check(got.join(",") === "a", "同一則收兩次：只通知一次");
  C.receiveChat(msg("b"), "me", "9999");
  C.receiveChat(msg("c"), "other", "1234");
  check(got.join(",") === "a", "別房、別人座位的：不通知");
  off();
  C.receiveChat(msg("d"), "me", "1234");
  check(got.join(",") === "a", "取消訂閱後不再通知");
  C.bindChatSession(null);
}

// 聊天鈕：未讀、開關
{
  L.__resetChatLog();
  L.bindChatLog("acc|r1|me", "me");
  const btn = (canSend: boolean) => renderToStaticMarkup(createElement(MjChatButton, { canSend, desk: false }));
  check(!btn(true).includes("data-chat-unread"), "沒有未讀：聊天鈕沒有數字");
  L.addChatMessage({ ...msg("x"), ts: 1 });
  L.addChatMessage({ ...msg("y"), ts: 2 });
  check(/data-chat-unread="2"/.test(btn(true)) && btn(true).includes("聊天"), "收起時收到 2 則：聊天鈕右上顯示 2");
  toggleMjChatBox(true, true);
  check(L.__peekChatLog().open && L.__peekChatLog().unread === 0, "玩家按聊天：清單打開、未讀歸零");
  check(/aria-expanded="true"/.test(btn(true)), "打開後聊天鈕標成展開");
  toggleMjChatBox(true, false);
  check(!L.__peekChatLog().open, "收起聊天：清單關上");
  toggleMjChatBox(false, true);
  check(L.__peekChatLog().open && /aria-expanded="true"/.test(btn(false)), "訪客／觀戰按聊天：只開清單（只能看）");
}

// 麻將聊天框
{
  const box = (p: Partial<Parameters<typeof MjChatLogBox>[0]>) => renderToStaticMarkup(createElement(MjChatLogBox, { variant: "dock", mySeat: 0, canSend: true, ...p }));
  const spx = box({ canSend: false, spectator: true });
  check(spx.includes("觀戰中，僅能觀看") && !spx.includes("<input"), "觀戰：觀戰中，僅能觀看，沒有輸入框");
  check(box({ myTurn: true }).includes("輪到你出牌"), "手機、輪到自己出牌：提示條");
  check(box({ claiming: true, myTurn: true }).includes("可以吃碰槓胡"), "手機、有吃碰槓胡：提示條（優先於出牌）");
  check(!box({ variant: "side", myTurn: true, claiming: true }).includes("data-chat-log-alert"), "桌機側欄不蓋牌桌、牌桌上已有「輪到你打牌」：不重複顯示提示（小宜 2026-11-13）");
  check(box({ variant: "side" }).includes("data-chat-slot") && !box({ variant: "dock" }).includes("data-chat-slot"), "桌機側欄留一格放輸入面板（接在訊息下面）；手機不用（面板本來就在聊天室下面）");
  check(!box({ variant: "side", canSend: false, spectator: true }).includes("data-chat-slot"), "觀戰、訪客不能發言：側欄不留輸入面板的格子");
  check(/<header[^>]*>.*data-chat-log-alert.*<\/header>/.test(box({ myTurn: true })), "手機提示併進標題列（不另佔一列）");
  check(!/<button/.test(box({ myTurn: true, claiming: true })), "提示沒有按鈕、標題列沒有收起鈕");
  check(box({}).includes(">聊天室<"), "標題：聊天室");
  check(box({ canSend: false, guest: true }).includes("登入 LINE 後就能聊天"), "訪客：清單下方寫登入 LINE 後就能聊天");
  check(!box({ canSend: false, spectator: true }).includes("登入 LINE"), "觀戰者已是 LINE 登入：不顯示登入提示");
  check(box({}).includes('data-chat-log="dock"') && box({ variant: "side" }).includes('data-chat-log="side"'), "手機接在輸入面板上方（dock）、桌機側欄兩種版型");
}

// 觀戰頻道（每位觀戰者各自一個，老柯 701d501；payload.playerId＝"*spectators"）：收到的聊天、互動進聊天室
{
  const { onSpectatorEvent } = await import("../components/mahjong/MjChatLog");
  const { subscribeFx } = await import("../lib/mahjong/fx/transport");
  const { FX_LABEL } = await import("../lib/mahjong/fx/engine");
  L.__resetChatLog();
  C.bindChatSession({ account: "watcher", roomId: "r9", roomCode: "5555", myId: "*spectator", mySeat: 2 });
  L.bindChatLog("watcher|r9|*spectator", null);
  // 和 useMjChatFeed 一樣的接線
  const off1 = C.subscribeChat(L.addChatMessage);
  const off2 = subscribeFx((m) => L.addChatEffect({ id: m.id, ts: 1, fromName: m.fromName, toName: m.toName, label: FX_LABEL[m.kind] }));
  onSpectatorEvent("mj_chat", { playerId: "*spectators", message: { ...msg("s1"), ts: 10 } }, "5555");
  onSpectatorEvent("mj_chat", { playerId: "*spectators", message: { ...msg("s1"), ts: 10 } }, "5555");
  check(L.__peekChatLog().entries.length === 1 && L.__peekChatLog().unread === 1, "觀戰頻道的聊天：進聊天室、同一則只一則、算未讀（觀戰者 me＝null）");
  check(C.__peekChat().bubbles.some((b) => b.id === "s1"), "觀戰頻道的聊天：名牌旁泡泡照常出現");
  onSpectatorEvent("mj_chat", { playerId: "*spectators", message: { ...msg("s2"), ts: 11 } }, "9999");
  check(L.__peekChatLog().entries.length === 1, "別房（房號不同）的觀戰事件：丟掉");
  onSpectatorEvent("mj_effect", { playerId: "*spectators", effect: { id: "fx-s1", effect: "clap", from: "p1", fromName: "阿德", fromSeat: 1, to: "p3", toName: "老王", toSeat: 3, ts: 12 } }, "5555");
  const fx = L.__peekChatLog().entries.find((e) => e.id === "fx-s1");
  check(!!fx && fx.type === "fx" && fx.label === "拍手" && fx.fromName === "阿德" && fx.toName === "老王", "觀戰頻道的互動：聊天室記一筆「阿德 對 老王 使用了 拍手」");
  onSpectatorEvent("mj_chat", null, "5555");
  onSpectatorEvent("mj_effect", { playerId: "*spectators" }, "5555");
  check(L.__peekChatLog().entries.length === 2, "格式不對的事件：忽略、不出錯");
  off1(); off2();
  C.bindChatSession(null);
}

console.log(failed ? `❌ 失敗 ${failed} 項` : "全部通過");
process.exit(failed ? 1 : 0);
export {};
