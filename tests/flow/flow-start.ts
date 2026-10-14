// 開房開局同時送兩次：只開一局、狀態不被蓋掉、事件不重複；開局八仙過海／七搶一也一樣。
// 對照組把樂觀鎖關掉（＝修之前「讀完整筆蓋回去」），證明測試抓得到問題。
import { POST as start } from "../../app/api/mahjong/start/route";
import { force } from "../support/forced-deal";
import { rooms, opts, stats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

async function call(body: object) {
  const r = await start(new Request("http://x", { method: "POST", body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
function lobby() {
  rooms.R = {
    id: "R", code: "T", status: "waiting", host_id: "p0",
    game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState,
  };
  sent.length = 0;
}
const count = (ev: string) => sent.filter((e) => e.event === ev).length;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

const RUNS = 30;
async function race(unsafe: boolean) {
  opts.unsafe = unsafe;
  stats.conflicts = 0;
  const fail = { plain: 0, baXian: 0, qiQiangYi: 0 };
  for (let i = 0; i < RUNS; i++) {
    opts.delayMs = 1 + (i % 8);

    // 一般開局
    lobby(); force.flowers = null;
    const r = await Promise.all([call({ playerId: "p0" }), call({ playerId: "p0" })]);
    const s = rooms.R.game_state;
    // 存下來的手牌要和廣播出去的手牌一致（沒被第二次開局蓋掉）
    const dealt = sent.filter((e) => e.event === "mj_deal_hand").map((e) => JSON.stringify((e.payload.hand as { id: number }[]).map((t) => t.id)));
    const saved = s.players.map((p) => JSON.stringify(p.hand.filter((t) => t.suit !== "f").map((t) => t.id)));
    const okPlain = r.map((x) => x.status).sort().join() === "200,400" && rooms.R.status === "playing"
      && count("mj_game_start") === 1 && dealt.length === 4 && JSON.stringify(dealt) === JSON.stringify(saved);
    if (!okPlain) fail.plain++;

    // 開局八仙過海：只結算一次
    lobby(); force.flowers = { 2: [1, 2, 3, 4, 5, 6, 7, 8] };
    await Promise.all([call({ playerId: "p0" }), call({ playerId: "p0" })]);
    const b = rooms.R.game_state;
    const okBa = rooms.R.status === "finished" && count("mj_game_start") === 1 && count("mj_game_over") === 1
      && JSON.stringify(b.playerScores) === JSON.stringify(b.settlement?.deltas) && b.playerScores!.reduce((x, y) => x + y, 0) === 0;
    if (!okBa) fail.baXian++;

    // 開局七搶一：只送一次等待
    lobby(); force.flowers = { 3: [1, 2, 3, 4, 5, 6, 7], 1: [8] };
    await Promise.all([call({ playerId: "p0" }), call({ playerId: "p0" })]);
    const q = rooms.R.game_state;
    const okQ = rooms.R.status === "playing" && q.pendingFlowerRob?.robberSeat === 3
      && count("mj_game_start") === 1 && count("mj_flower_rob_pending") === 1;
    if (!okQ) fail.qiQiangYi++;
  }
  opts.unsafe = false; opts.delayMs = 5; force.flowers = null;
  return { fail, conflicts: stats.conflicts };
}
{
  const safe = await race(false);
  eq(safe.fail, { plain: 0, baXian: 0, qiQiangYi: 0 },
    `S1 修好後：同時開局兩次（一般／開局八仙／開局七搶一）各 ${RUNS} 次，都只開一局、一個 200 一個 400、存檔和廣播的手牌一致、八仙只結算一次（樂觀鎖擋下並重做 ${safe.conflicts} 次）`);
  const unsafe = await race(true);
  eq(Object.values(unsafe.fail).every((n) => n > 0), true,
    `S2 對照組（關掉樂觀鎖＝修之前）：一般錯 ${unsafe.fail.plain}、八仙錯 ${unsafe.fail.baXian}、七搶一錯 ${unsafe.fail.qiQiangYi} 次`);
}
{
  lobby();
  const r = await call({ playerId: "p0" });
  const again = await call({ playerId: "p0" });
  eq([r.status, again.status, again.body.error, count("mj_game_start")], [200, 400, "遊戲已開始", 1], "S3 依序送兩次開局：第二次 400「遊戲已開始」，只廣播一次");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
