// 房卡規則（老柯 2026-11-20）：每一把開局扣 1 張；麻將連莊不扣；十三支奇數局扣；老闆不扣。
// R1 麻將四圈、中間有 3 把連莊：每人 16 張（連莊那 3 把不扣），每把的號碼都不同
// R2 麻將四圈都沒連莊：16 張；最後一圈的最後一把莊家連莊也不扣
// R3 十三支 8 局扣第 1、3、5、7 局＝4 張；16 局 8 張
// R4 老闆帳號、沒綁帳號的舊座位、重複的帳號都不扣
import { initGame, startNextGame, isAllRoundsComplete } from "../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../lib/mahjong/gameState";
import { chargeableUsers, mahjongChargeHand, thirteenChargesHand } from "../lib/roomCard/rules";
import { OWNER_USER_ID } from "../lib/mahjong/zimoFx/rules";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

/** 照真的 startNextGame 打完 rounds 圈；dealerWins 裡的第 n 把（從 1 數）莊家胡＝下一把連莊。回傳每一把開局時算出的扣卡號碼 */
function playMahjong(rounds: number, dealerWins: Set<number>): (number | null)[] {
  let s: MahjongGameState = initGame([0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` })), { totalRounds: rounds, basePoints: 10, fanPoints: 10 });
  s.dealerSeat = 0;
  s.roundInfo!.initialDealerSeat = 0;
  s.handsCompleted = 0;
  const keys: (number | null)[] = [mahjongChargeHand(s)];
  for (let hand = 1; hand < 200; hand++) {
    // 結束這一把：莊家胡（連莊）或下家胡（下莊）
    s.status = "finished";
    s.winner = { seat: dealerWins.has(hand) ? s.dealerSeat : (s.dealerSeat + 1) % 4 } as MahjongGameState["winner"];
    s.winners = undefined;
    s.handsCompleted = hand;
    if (isAllRoundsComplete(s)) break;
    s = startNextGame(s);
    keys.push(mahjongChargeHand(s));
  }
  return keys;
}

{
  const keys = playMahjong(4, new Set([2, 7, 15]));
  const charged = keys.filter((k) => k !== null);
  eq([keys.length, charged.length, keys.filter((k) => k === null).length], [19, 16, 3], "R1 麻將四圈有 3 把連莊：打了 19 把、扣 16 把、連莊 3 把不扣");
  eq(new Set(charged).size, charged.length, "R1 每一把的號碼都不同（同一把重送才會撞到同一筆）");
  eq([keys[2], keys[3]], [null, 4], "R1 第 2 把莊家胡 → 第 3 把是連莊不扣，第 4 把（下莊）照扣、號碼是 4");
}
{
  eq(playMahjong(4, new Set()).filter((k) => k !== null).length, 16, "R2 麻將四圈沒連莊：16 把都扣");
  const keys = playMahjong(1, new Set([4]));
  eq([keys.length, keys.filter((k) => k !== null).length], [5, 4], "R2 一圈、最後一把莊家連莊：多打 1 把、那把不扣（4 張）");
}
{
  const hands = (n: number) => Array.from({ length: n }, (_, i) => i + 1).filter(thirteenChargesHand);
  eq(hands(8), [1, 3, 5, 7], "R3 十三支 8 局：第 1、3、5、7 局開局扣，每人 4 張");
  eq(hands(16).length, 8, "R3 十三支 16 局：每人 8 張");
  eq([thirteenChargesHand(0), thirteenChargesHand(2), thirteenChargesHand(1.5)], [false, false, false], "R3 第 0 局、偶數局、不是整數都不扣");
}
{
  const a = "00000000-0000-4000-8000-0000000000a1", b = "00000000-0000-4000-8000-0000000000b2";
  eq(chargeableUsers([a, OWNER_USER_ID, null, "u:p3", a, b]), [a, b], "R4 老闆、沒綁帳號、不是 LINE 帳號 id、重複的都不扣");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
