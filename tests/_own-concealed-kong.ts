// 審伯退件（自己暗槓，2026-10-29）：公開的 mj_action 只有蓋著的 4 張，自己座位的吃碰槓改用座位頻道 mj_hand_update 帶的 myRevealed。
// myRevealed 要在開局和用完時清掉，而且要剛好比畫面上自己的吃碰槓多一副才採用。
// 下面的 Client 照 useMahjong 的 mj_game_start／mj_hand_update／mj_action（concealed_kong）接法模擬（只留跟這件事有關的部分）。
import { ownConcealedKongMelds } from "../lib/mahjong/stateSync";
import type { Meld } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

const tile = (id: number, rank: number): Tile => ({ id, suit: "m", rank, display: `${rank}萬` });
const kong = (base: number, rank: number): Meld => ({ type: "concealed_kong", tiles: [0, 1, 2, 3].map((i) => tile(base + i, rank)) });

class Client {
  myRevealedRef: Meld[] | null = null;
  revealed: Meld[] = [];
  hand: Tile[] = [];
  gameStart(hand: Tile[]) { this.myRevealedRef = null; this.revealed = []; this.hand = hand; }
  // mj_hand_update：applyNow＝這個事件比 mj_action 先套用到畫面（只存 ref、不套用＝模擬 mj_action 先到）
  handUpdate(myRevealed: Meld[], hand: Tile[], applyNow: boolean) {
    this.myRevealedRef = myRevealed;
    if (applyNow) { this.revealed = myRevealed; this.hand = hand; }
  }
  ownConcealedKongAction() {
    const pending = this.myRevealedRef;
    this.myRevealedRef = null;
    const mine = ownConcealedKongMelds(this.revealed, pending);
    const ids = new Set((mine ?? []).flatMap((m) => m.tiles).map((t) => t.id));
    this.hand = this.hand.filter((t) => !ids.has(t.id));
    this.revealed = mine ?? this.revealed;
  }
}

const hand1 = [...kong(100, 1).tiles, tile(110, 5), tile(111, 6)];

// 0. 正常：myRevealed 先存好、mj_action 到 → 採用，手牌拿掉那 4 張
{
  const c = new Client();
  c.gameStart(hand1);
  c.handUpdate([kong(100, 1)], [tile(110, 5)], false);
  c.ownConcealedKongAction();
  check(c.revealed.length === 1 && c.revealed[0].tiles[0].id === 100, "正常：剛好多一副 → 採用有牌面的暗槓");
  check(c.hand.map((t) => t.id).join(",") === "110,111", `正常：手牌拿掉暗槓的 4 張（剩 ${c.hand.map((t) => t.id).join(",")}）`);
}

// 1. 開局要清掉：上一局暗槓一副留在 ref（mj_action 沒來就換局）；新局自己暗槓時 mj_action 比 mj_hand_update 先到 → 不能用上一局的
{
  const c = new Client();
  c.gameStart(hand1);
  c.handUpdate([kong(100, 1)], [], false); // 上一局最後收到、沒被用掉
  c.gameStart([...kong(200, 9).tiles, tile(210, 2)]); // 新局（牌 id 每局重複使用，舊的 id 也可能撞到新局手牌）
  check(c.myRevealedRef === null, "開局：上一局留下的 myRevealed 已清掉");
  c.ownConcealedKongAction(); // 這次的 mj_hand_update 還沒到
  check(c.revealed.length === 0, "開局後 mj_action 先到：不採用上一局的吃碰槓（先不加這一副）");
  check(c.hand.length === 5, "開局後 mj_action 先到：手牌不被上一局的牌 id 誤刪");
  // 一般寫法若沒在開局清掉：上一局 1 副、新局 0 副，剛好多一副 → 會被誤採用。確認清掉是必要的
  check(ownConcealedKongMelds([], [kong(100, 1)]) !== null, "（對照）沒清掉的話，上一局的 1 副會被當成這一次的暗槓");
}

// 2. 用完要清掉：第一次暗槓採用後，第二次暗槓 mj_action 先到 → 不能再用第一次的
{
  const c = new Client();
  c.gameStart([...hand1, ...kong(120, 3).tiles]);
  c.handUpdate([kong(100, 1)], [], false);
  c.ownConcealedKongAction();
  check(c.myRevealedRef === null, "用完：myRevealed 用過就清掉");
  const before = c.hand.length;
  c.ownConcealedKongAction(); // 第二次暗槓，這次的 mj_hand_update 還沒到
  check(c.revealed.length === 1 && c.hand.length === before, "第二次暗槓 mj_action 先到：不重複套用第一次的（副數、手牌都不變）");
  c.handUpdate([kong(100, 1), kong(120, 3)], c.hand.filter((t) => t.id < 120 || t.id > 123), true);
  check(c.revealed.length === 2 && !c.hand.some((t) => t.id >= 120 && t.id <= 123), "之後 mj_hand_update 到：整份更正成 2 副");
}

// 3. 副數不是剛好多一副：mj_hand_update 已經先套用（畫面已是新的）→ mj_action 不再套用、不再刪手牌
{
  const c = new Client();
  c.gameStart(hand1);
  c.handUpdate([kong(100, 1)], [tile(110, 5), tile(111, 6)], true);
  c.ownConcealedKongAction();
  check(c.revealed.length === 1 && c.hand.length === 2, "mj_hand_update 先到：副數相同 → 不採用，畫面維持 1 副、手牌 2 張");
  check(ownConcealedKongMelds([kong(100, 1)], [kong(100, 1), kong(120, 3), kong(130, 4)]) === null, "多兩副（不是這一次的）→ 不採用");
  check(ownConcealedKongMelds([kong(100, 1)], []) === null, "比畫面少 → 不採用");
  check(ownConcealedKongMelds([], null) === null, "沒收到 → 不採用");
}

process.exit(failed ? 1 : 0);
