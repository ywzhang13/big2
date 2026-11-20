// 房卡前端（老馬 2026-11-20；小宜〈房卡系統 v1.2〉、老柯〈給老馬-房卡與斗內下架-API說明〉）：
//   B 開房、加入、開局被擋：認得 403 suspended／player_suspended，其他錯誤不當成被擋
//   C 右上角房卡張數：負數紅色寫「−12」、0 灰、老闆和遊客（balance null）不顯示
//   D 被擋的視窗：帳號已暫停＋暫停時間（不寫聯絡誰）；不能開局＋房號＋座位、名字
//   E 斗內下架：麻將大廳沒有斗內後台入口；自摸特效設定沒有「未開通／全部開通」
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const C = await import("../components/roomCard/client");
const RoomCardChip = (await import("../components/roomCard/RoomCardChip")).default;
const BlockedDialog = (await import("../components/roomCard/BlockedDialog")).default;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

// ---- B ----
{
  const at = Date.parse("2026-11-19T02:30:00Z"); // 台北 11/19 10:30
  const s = C.blockedFrom({ error: "suspended", message: "帳號已暫停", suspendedAt: at });
  const p = C.blockedFrom({ error: "player_suspended", players: [{ seat: 1, name: "老王" }] }, "6014");
  ok(s?.kind === "suspended" && s.at === at, "B1 403 suspended → 帳號已暫停（帶暫停時間）");
  ok(p?.kind === "players" && p.code === "6014" && p.players[0].name === "老王", "B2 403 player_suspended → 不能開局（房號、被暫停的人）");
  ok(C.blockedFrom({ error: "not_your_seat" }) === null && C.blockedFrom(null) === null && C.blockedFrom("x") === null, "B3 其他錯誤、沒有內容：不當成被擋（照原本的錯誤處理）");
  ok(C.fmtAt(at) === "11/19 10:30" && C.fmtCards(-12) === "−12" && C.fmtCards(0) === "0" && C.fmtCards(23) === "23", "B4 時間照台北「11/19 10:30」；負數寫「−12」");
}

// ---- C ----
{
  const me = (balance: number | null, isOwner = false) => ({ isOwner, balance, suspended: false, suspendedAt: null });
  const neg = html(createElement(RoomCardChip, { me: me(-12) })), zero = html(createElement(RoomCardChip, { me: me(0) })), pos = html(createElement(RoomCardChip, { me: me(23) }));
  ok(/class="rc-chip neg" data-rc-chip="-12"/.test(neg) && /−12<\/span>$/.test(neg), "C1 負數：紅色（rc-chip neg）寫「−12」");
  ok(/class="rc-chip zero"/.test(zero) && /class="rc-chip" data-rc-chip="23"/.test(pos), "C2 0 張灰色、有卡金色");
  ok(!/房卡|張<\/span>/.test(pos.replace(/aria-label="[^"]*"/, "")), "C3 沒有「房卡」「張」這些字（只有圖示和數字）");
  ok(html(createElement(RoomCardChip, { me: me(null, true) })) === "" && html(createElement(RoomCardChip, { me: me(null) })) === "" && html(createElement(RoomCardChip, { me: null })) === "",
    "C4 老闆、遊客（balance null）、還沒讀到：不顯示");
}

// ---- D ----
{
  const at = Date.parse("2026-11-19T02:30:00Z");
  const sus = html(createElement(BlockedDialog, { blocked: { kind: "suspended", at }, onClose: () => {} }));
  const st = html(createElement(BlockedDialog, { blocked: { kind: "players", code: "6014", players: [{ seat: 1, name: "老王" }] }, onClose: () => {} }));
  ok(/<b>帳號已暫停<\/b>/.test(sus) && /暫停時間<\/span><b>11\/19 10:30<\/b>/.test(sus) && /知道了/.test(sus) && !/聯絡|老闆|LINE/.test(sus), "D1 帳號已暫停：暫停時間一列、知道了；不寫聯絡誰");
  ok(/<b>不能開局<\/b><span class="sub">房 6014<\/span>/.test(st) && /data-rc-blocked-seat="1"><span>座位 2　老王<\/span><b class="rc-red">帳號已暫停<\/b>/.test(st), "D2 不能開局：房號、座位 2 老王 帳號已暫停（紅字）");
  ok(html(createElement(BlockedDialog, { blocked: null, onClose: () => {} })) === "", "D3 沒有被擋：不顯示");
}

// ---- E ----
{
  const mj = readFileSync("app/mahjong/page.tsx", "utf8"), prefs = readFileSync("components/mahjong/MjPrefsPanel.tsx", "utf8"), hook = readFileSync("hooks/useMahjong.ts", "utf8");
  ok(!/href="\/mahjong\/admin"/.test(mj) && !/斗內後台<\/a>/.test(mj), "E1 麻將大廳拿掉斗內後台入口（房卡後台入口在總大廳頭像選單）");
  ok(!/未開通・只能預覽|✓ 全部開通/.test(prefs), "E2 自摸特效設定拿掉「未開通／全部開通」（伺服器已經全部開放）");
  ok(/player_suspended/.test(hook) && /!playerSuspended\) onAuthErrorRef/.test(hook), "E3 麻將開局回 403 player_suspended 不當成登入問題（不會把房主踢回大廳）");
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
