// 碰、明槓的小箭頭（components/mahjong/MjMeldArrow.tsx）：指向打出那張牌的人在「我」畫面上的位置；吃、暗槓不畫。
// 四家視角：同一副碰（主人、打出的人固定），換成四個座位的人看，箭頭方向都要對。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MjMeldArrow } from "../components/mahjong/MjMeldArrow";
import type { Meld } from "../lib/mahjong/gameState";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const dirOf = (meld: Meld, owner: number, mySeat: number) =>
  renderToStaticMarkup(createElement(MjMeldArrow, { meld, owner, mySeat, size: 9 })).match(/data-meld-from="(\w+)"/)?.[1] ?? null;
const tile = (id: number) => ({ id, suit: "m" as const, rank: 5, display: "五萬" });
const meld = (type: Meld["type"], from?: number): Meld => ({ type, tiles: [tile(1), tile(2), tile(3)], ...(from != null ? { from } : {}) }) as Meld;

// 東家（座位 0）碰了北家（座位 3）打的牌：每個人看「打出的人」在自己畫面的哪一邊
const want = ["left", "up", "right", "down"]; // 我是 0：3 在左（上家）；我是 1：3 在對面；我是 2：3 在右（下家）；我是 3：就是我
for (let me = 0; me < 4; me++) {
  ok(dirOf(meld("pong", 3), 0, me) === want[me], `A${me + 1} 我坐 ${me}：東家碰北家的牌，箭頭指${{ left: "左", up: "上", right: "右", down: "下" }[want[me]]}（${dirOf(meld("pong", 3), 0, me)}）`);
}
ok(dirOf(meld("kong", 3), 2, 2) === "right", "A5 明槓（含加槓）也畫：我坐 2 槓了座位 3（我的下家）打的牌，箭頭指右");
ok(dirOf(meld("chi", 3), 0, 0) === null, "A6 吃不畫箭頭（一定是上家打的）");
ok(dirOf(meld("concealed_kong"), 0, 1) === null && dirOf(meld("concealed_kong", 2), 0, 0) === null, "A7 暗槓不畫（不洩漏任何資訊）");
ok(dirOf(meld("pong"), 0, 0) === null, "A8 沒有 from（舊資料）不畫，不會指錯");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
