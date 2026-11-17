// 十三支等人與牌桌畫面（components/thirteen/ThWaiting.tsx、ThTable.tsx）：靜態渲染檢查
//   W 等人（沿用麻將等人畫面的結構）：房主滿 4 人才能按「開始遊戲」；不滿顯示「等待玩家 (n/4)」；其他人看到「等待房主開始遊戲」
//   T 牌桌：自己在下、下家右、對家上、上家左；自己攤開送出的三墩（13 張牌面），他家各 13 張牌背；
//     還沒送出的人頭上「思考中…」泡泡、送出後消失；中央只有倒數；沒有「已送出」「幾家已送出」「進入亮牌」這類引導字（老闆 2026-11-18）
//   C 整場結束按「回十三支大廳」：離開房間後關閉訊息不再算數（closedFor），畫面回得了大廳
//   A 理牌時間：最少 15、最多 120、只能是 15 的倍數，可以直接輸入、「＋」加 15；後端已收 15～120，照送
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { autoArrange, parseCards } from "../lib/thirteen";
import ThWaiting from "../components/thirteen/ThWaiting";
import ThTable from "../components/thirteen/ThTable";
import { closedFor, type ThGameView, type ThWaitingView } from "../components/thirteen/useThirteenRoom";
import { normalizeArrangeSec, plusArrangeSec, toServerArrangeSec } from "../components/thirteen/arrangeTime";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length; // 算牌只算 <img>：React 19 伺服器渲染會另外為每張圖加 <link rel=preload>

// ---- W 等人 ----
const seats = [{ seat: 0, name: "老闆", playerId: "p0" }, { seat: 1, name: "小明", playerId: "tb1" }, { seat: 2, name: "阿明", playerId: "p2" }];
const waiting = (n: number): ThWaitingView => ({ status: "waiting", code: "1234", hostId: "p0", settings: { arrangeSec: 60, totalHands: 2 }, seats: [...seats, { seat: 3, name: "小華", playerId: "tb2" }].slice(0, n) });
const w = (n: number, me: string) => renderToStaticMarkup(createElement(ThWaiting, { view: waiting(n), myPlayerId: me, onStart: async () => ({ ok: true }), onLeave: async () => ({ ok: true }) }));
{
  const h3 = w(3, "p0"), h4 = w(4, "p0"), g4 = w(4, "p2");
  ok(/disabled=""[^>]*>等待玩家 \(3\/4\)</.test(h3) && count(h3, /等待中\.\.\./g) === 1, "W1 房主、3 人：開始鈕停用、寫「等待玩家 (3/4)」，空位一格「等待中...」（同麻將）");
  ok(/>開始遊戲</.test(h4) && !/disabled=""[^>]*>開始遊戲</.test(h4), "W2 房主、滿 4 人：「開始遊戲」可以按");
  ok(/等待房主開始遊戲/.test(g4) && !/data-th-start/.test(g4), "W3 不是房主、滿 4 人：看到「等待房主開始遊戲」，沒有開始鈕");
  ok(/1234/.test(h4) && /理牌 60 秒/.test(h4) && /2局/.test(h4) && /老闆 \(你\) \*/.test(h4.replace(/<!-- -->/g, "")) && /退出房間/.test(h4), "W4 房間碼、理牌秒數與局數、自己標「(你)」、房主「*」、退出房間（同麻將）");
  ok(/class="mjl mjl-wait-page/.test(h4) && /class="mjw /.test(h4) && /mjw-seat/.test(h4) && /mjw-start/.test(h4), "W5 直接用麻將等人畫面的樣式（mjl-wait-page、mjw、mjw-seat、mjw-start）");
}

// ---- T 牌桌 ----
const hand = parseCards("2D 3S 4S 5S 8C 8D 8H 8S TC TD JH KS AD");
const players = (submitted: boolean[]) => ["老闆", "小明", "阿明", "小華"].map((name, seat) => ({ id: `p${seat}`, name, seat, submitted: submitted[seat] }));
const game = (mySeat: number, submitted: boolean[], phase: ThGameView["phase"] = "arranging"): ThGameView => ({
  status: "playing", code: "1234", sv: 5, phase, handNo: 1, settings: { arrangeSec: 60, totalHands: 2 }, serverNow: 1_000_000,
  arrangeDeadline: 1_000_000 + 42_000, players: players(submitted), me: { seat: mySeat, hand, arrangement: autoArrange(hand) }, reveal: null,
});
const t = (v: ThGameView, now = 1_000_000) => renderToStaticMarkup(createElement(ThTable, { view: v, now, clockSkew: 0 }));
{
  const h = t(game(2, [true, false, true, true]));
  const at = (pos: string) => new RegExp(`th-at-${pos}" data-seat="(\\d)"`).exec(h)?.[1];
  ok(at("bottom") === "2" && at("right") === "3" && at("top") === "0" && at("left") === "1", `T1 我坐 2 號：自己在下、3 號在右、0 號在上、1 號在左（實際 下${at("bottom")} 右${at("right")} 上${at("top")} 左${at("left")}）`);
  ok(count(h, /<img[^>]*card-front-/g) === 13 && count(h, /<img[^>]*card-back\.v2/g) === 39, `T2 自己攤開送出的三墩（13 張牌面），他家三家各 13 張牌背（牌面 ${count(h, /<img[^>]*card-front-/g)}、牌背 ${count(h, /<img[^>]*card-back\.v2/g)}）`);
  ok(/rotate\(90deg\)/.test(h) && /rotate\(-90deg\)/.test(h) && /rotate\(180deg\)/.test(h) && /rotate\(0deg\)/.test(h), "T3 他家牌背轉向自己的座位：左家 90°、右家 −90°、對家 180°，自己不轉");
  ok(count(h, /data-th-thinking=/g) === 1 && /data-th-thinking="1"/.test(h) && /思考中/.test(h), "T4 只有還沒送出的小明（1 號）頭上有「思考中…」泡泡");
  ok(/0:42/.test(h) && !/已送出/.test(h) && !/理牌中/.test(h), "T5 中央倒數照伺服器截止時間（還剩 42 秒＝0:42）；沒有「已送出」「理牌中」字樣");
  ok(/0:12/.test(t(game(2, [true, false, true, true]), 1_030_000)) && /is-low/.test(t(game(2, [true, false, true, true]), 1_035_000)), "T6 時間往前走倒數跟著減；剩 10 秒內變紅");
  const all = t(game(2, [true, true, true, true]));
  ok(count(all, /data-th-thinking=/g) === 0, "T7 四家都送出：沒有任何「思考中…」泡泡");
  const r = t(game(2, [true, true, true, true], "revealed"));
  ok(!/th-clock/.test(r) && !/進入亮牌/.test(r) && !/已送出/.test(r) && !/\d+ \/ \d+ 已送出/.test(r), "T8 亮牌階段：不倒數、沒有「進入亮牌」「已送出」「n / 4 已送出」引導字");
}

// ---- C 整場結束回大廳 ----
{
  const closed = { roomId: "r1", message: "這場已經結束", record: null };
  ok(closedFor(closed, { roomId: "r1" })?.message === "這場已經結束", "C1 還在這間房：顯示「這場已經結束」");
  ok(closedFor(closed, null) === null, "C2 按「回十三支大廳」（離開房間、join 清空）：不再是關閉狀態 → 畫面回大廳（修正前一直停在結束畫面）");
  ok(closedFor(closed, { roomId: "r2" }) === null && closedFor(null, { roomId: "r1" }) === null, "C3 換到另一間房：舊房間的關閉訊息不算數");
}

// ---- A 理牌時間 ----
{
  ok([["15", 15], ["120", 120], ["7", 15], ["0", 60], ["", 60], ["999", 120], ["50", 45], ["53", 60], ["abc", 60], [37, 30]].every(([i, o]) => normalizeArrangeSec(i as string) === o),
    "A1 直接輸入：四捨五入到 15 的倍數、夾在 15～120；空白或亂打回預設 60");
  ok(plusArrangeSec(15) === 30 && plusArrangeSec(105) === 120 && plusArrangeSec(120) === 120, "A2 「＋」每按一次加 15 秒，到 120 為止");
  ok(toServerArrangeSec(15) === 15 && toServerArrangeSec(45) === 45 && toServerArrangeSec(120) === 120 && toServerArrangeSec(50) === 45, "A3 後端已收 15～120（d72e01e）：照正規化後的秒數送，不再夾 30～60");
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
