// 麻將換三款共用名牌＋中央看板（小宜〈麻將換共用元件 v1〉§2、§3，2026-11-21）：
//   G  共用名牌 GamePlate 新加的選填參數；不給就和原本一樣（十三支不變）
//   P  手機牌桌（MjBoardMobile）四家都是共用名牌：特效錨點＝絕對座位號、莊N、聽／眼／MIGI 小旗、觀戰、輪到誰；不再有風位小章、拉N、「（你）」
//   C  中央看板：下＝自己、右＝下家、上＝對家、左＝上家；開門紅框（不寫「門」）、輪到誰金字；剩餘、圈局、骰子
//   L  手機格線：上列 46、左右欄 88
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { MjPlayer } from "../hooks/useMahjong";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const GamePlate = (await import("../components/GamePlate")).default;
const MjBoardMobile = (await import("../components/mahjong/MjBoardMobile")).default;
const CB = await import("../components/mahjong/MjCenterBoard").catch(() => null);

// ---- G 共用名牌 ----
{
  const h = clean(renderToStaticMarkup(createElement(GamePlate, { seat: "l", name: "小明", score: 3, plateId: 1 })));
  ok(/^<div class="gp" data-seat="l" data-fx-seat="l" data-gp-seat="1">/.test(h) && !/gp-flag|gp-view|in-flow| on"/.test(h), "G1 不給新參數：和原本一樣（data-fx-seat＝座位字母、沒有小旗和觀戰）——十三支不變");
  const p = { seat: "r", name: "阿德", score: -2, plateId: 1, fxSeat: 1, on: true, inFlow: true, flag: createElement("i", { id: "f" }), badge: createElement("b", { id: "d" }), viewers: createElement("u", { id: "v" }) } as unknown as Parameters<typeof GamePlate>[0];
  const g = clean(renderToStaticMarkup(createElement(GamePlate, p)));
  ok(/class="gp on in-flow" data-seat="r" data-fx-seat="1"/.test(g) && /<span class="gp-l2"><span class="gp-sc is-neg">−2<\/span><\/span>/.test(g) && /<span class="gp-dl"><b id="d"><\/b><\/span>/.test(g)
    && /<span class="gp-flag"><i id="f"><\/i><\/span>/.test(g) && /<span class="gp-view"><u id="v"><\/u><\/span>/.test(g),
    "G2 新參數：fxSeat 改特效錨點、on 整塊金、inFlow 跟著排版走、小旗在右上、莊N 在頭像正下方（B1：分數那一行只放分數）、觀戰在右下");
}

// ---- P 手機牌桌四家 ----
const names = ["阿美", "小林", "阿德", "老王"];
const players: MjPlayer[] = names.map((name, seat) => ({ id: `p${seat}`, name, seat, tileCount: 16, flowers: [], discards: [], revealed: [], isDealer: seat === 2, viewerCount: seat === 1 ? 3 : 0 }));
const props = {
  players, mySeat: 0, myHand: [], currentTurn: 3, dealerSeat: 2, lastDiscard: null, availableActions: [], pendingAddKong: null, robKong: false, pendingFlowerRob: null, robFlower: false,
  tingSeats: [2, 3], eyeSeats: [2, 1], eyeOptions: [], eyeWithTing: false, opponentHands: null, declareFx: [], wallRemaining: 72, hasDrawn: false, needsDraw: false, needsDiscard: false,
  isMyTurn: false, playerName: "阿美", drawnTileId: null, slowDraw: null, actionNotice: null, onDraw: () => {}, onDiscard: () => {}, onAction: () => {}, dice: [3, 5, 2] as [number, number, number],
  doorSeat: 1, playerScores: [12, -4, -8, 0], dealerConsecutive: 2, roomCode: "1234", roundLabel: "東風圈 第1局", onLeave: () => {},
};
const h = clean(renderToStaticMarkup(createElement(MjBoardMobile, props as unknown as Parameters<typeof MjBoardMobile>[0])));
const plate = (seat: number) => { const i = h.indexOf(`data-fx-seat="${seat}"`); const s = h.lastIndexOf('<div class="gp', i); return h.slice(s, h.indexOf('</div>', i) + 6); };
{
  const seats = [...h.matchAll(/<div class="gp[^"]*" data-seat="([btlr])" data-fx-seat="(\d)"/g)].map((m) => m[1] + m[2]).sort();
  ok(seats.join() === "b0,l3,r1,t2", `P1 四家都是共用名牌，特效錨點是絕對座位號：自己 b0、下家 r1、對家 t2、上家 l3（實際 ${seats.join()}）`);
  ok(/class="gp is-me in-flow"/.test(plate(0)) && /class="gp on in-flow"/.test(plate(3)), "P2 自己頭像金圈、名字金色；輪到老王（座 3）那塊整塊金");
  ok(/class="mj-gp-dl" data-plate-dealer="2">莊2</.test(plate(2)) && !/mj-gp-dl/.test(plate(0)), "P3 莊家阿德第二行「莊2」，別家沒有");
  ok(/gp-flag"><span class="mjm-tag migi/.test(plate(2)) && /gp-flag"><span class="mjm-tag ting/.test(plate(3)) && /gp-flag"><span class="mjm-tag eye/.test(plate(1)) && !/gp-flag/.test(plate(0)),
    "P4 右上角小旗：聽＋眼＝MIGI（阿德）、只聽＝聽（老王）、只眼＝眼（小林）；沒有就不掛");
  ok(/gp-view"><span class="spx-badge"[^>]*data-spectate-count="3"/.test(plate(1)), "P5 右下角觀戰人數（小林 3 人）");
  ok(!/mjm-plate|mjm-wind|mjm-me-who|（你）|拉\d|門</.test(h) && !/\d+ 張 · 莊/.test(h), "P6 拿掉：舊名牌、風位小章、拉N、（你）、「門」、其他家「N 張 · 莊」");
}

{
  // 宣告（MIGI／眼牌）那一刻：名牌亮框（mjm-declare），小旗彈出（.mjm-tag.pop）＝DeclareFx 飛行的終點（它找 [data-fx-seat] 裡的 .mjm-tag.pop）
  const { MjPlate } = (await import("../components/mahjong/MjBoardMobile")) as unknown as { MjPlate?: (p: Record<string, unknown>) => React.ReactElement };
  const m = MjPlate ? clean(renderToStaticMarkup(createElement(MjPlate, { player: players[2], rel: "t", on: false, score: 0, ting: true, eye: true, fx: { both: true } }))) : "";
  const e = MjPlate ? clean(renderToStaticMarkup(createElement(MjPlate, { player: players[1], rel: "r", on: false, score: 0, ting: false, eye: true, fx: { both: false } }))) : "";
  ok(/class="gp in-flow mjm-declare mjm-dc-migi" data-seat="t" data-fx-seat="2"/.test(m) && /<span class="gp-flag"><span class="mjm-tag migi pop">MIGI<\/span><\/span>/.test(m)
    && /mjm-declare mjm-dc-eye/.test(e) && /<span class="gp-flag"><span class="mjm-tag eye pop">眼<\/span><\/span>/.test(e),
    "P7 宣告那一刻：名牌亮框（MIGI 綠、眼牌紫），右上角小旗彈出——宣告動畫飛到這顆小旗");
}

// ---- C 中央看板 ----
{
  ok(!!CB, "C0 有中央看板元件 MjCenterBoard");
  const w = (pos: string) => h.match(new RegExp(`<span class="w ${pos}[^"]*" data-cb-wind="${pos}" data-cb-seat="(\\d)"[^>]*>(.)</span>`));
  const b = w("b"), r = w("r"), t = w("t"), l = w("l");
  ok(!!(b && r && t && l) && b![1] === "0" && r![1] === "1" && t![1] === "2" && l![1] === "3", "C1 方向：下＝自己（座 0）、右＝下家（1）、上＝對家（2）、左＝上家（3）");
  ok(!!(b && r && t && l) && r![2] === "東" && t![2] === "南" && l![2] === "西" && b![2] === "北", "C2 風字照開門那家是東依序排（開門＝座 1：東、2 南、3 西、0 北）");
  ok(/class="w r door" data-cb-wind="r" data-cb-seat="1" data-cb-door=""/.test(h) && /class="w l turn" data-cb-wind="l" data-cb-seat="3" data-cb-turn=""/.test(h), "C3 開門那格紅框（door）、輪到誰那格金字放大（turn）");
  ok(/data-cb-wall="">72</.test(h) && /class="rnd">東風圈 第1局</.test(h) && /data-center-dice/.test(h) && !/class="mjm-info"/.test(h), "C4 中間：剩餘 72、圈局、骰子；舊的資訊盤拿掉");
}

// ---- L 手機格線 ----
{
  const css = readFileSync("app/globals.css", "utf8");
  ok(/--row-top: 54px;/.test(css) && /--col-side: 88px;/.test(css), "L1 手機上列 54（B1 名牌加高 6，對家的旗不被切）、左右欄 88（小宜 v1 §2-1）");
  ok(/\.mj-cb \{[^}]*width: 104px; height: 92px;/.test(css) && /\.mj-cb \.w \{[^}]*width: 16px; height: 16px;[^}]*display: flex; align-items: center; justify-content: center;/.test(css) && /\.mj-cb\.d \{ --cb-s: 1\.5; \}/.test(css),
    "L2 看板 104×92、風位格 16×16 字上下左右置中；桌機 1.5 倍");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
