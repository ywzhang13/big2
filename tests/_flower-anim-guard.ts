// 自己補花動畫的巢狀 setTimeout 序號保護（FlowerAnimGuard）：
// 補花進行中如果觸發新局、換房、卸載或伺服器快照已經更新，舊的計時器回呼都不能再寫 state。
import { FlowerAnimGuard } from "../lib/mahjong/flowerAnimGuard";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// 1. 正常情況：同一段動畫從頭到尾，序號都沒變，isStale 一路是 false
{
  const g = new FlowerAnimGuard();
  const token = g.start();
  check(!g.isStale(token), "動畫一開始，自己的序號不會是過期的");
  check(!g.isStale(token), "動畫播到一半，序號還是這一段，不會過期");
}

// 2. 補花進行中觸發新局：invalidate 之後，舊的巢狀計時器序號要變成過期，不能再寫 state
{
  const g = new FlowerAnimGuard();
  const token = g.start(); // 補花動畫開始，這張花的摸牌格 setState 已經寫過
  // 模擬「補花進行中觸發新局」：mj_game_start 呼叫 invalidate()
  g.invalidate();
  check(g.isStale(token), "補花進行中觸發新局，舊動畫的序號要過期，剩下的巢狀計時器不能再把手牌蓋回去");
}

// 3. 把所有計時器快轉跑完（模擬 setTimeout 鏈）：invalidate 之後，鏈裡每一步都要被擋下來，不會有任何一步寫 state
{
  const g = new FlowerAnimGuard();
  const token = g.start();
  const writes: string[] = [];
  // 模擬 showFlower 的巢狀鏈：每一步都要先檢查 isStale 才能「寫 state」
  const step = (label: string) => { if (!g.isStale(token)) writes.push(label); };
  step("花出現");
  g.invalidate(); // 快轉到一半時，伺服器快照已經更新／換房／卸載
  step("補花字樣"); // 這一步應該被擋下來，不會顯示舊的「補花」字樣
  step("換下一張花或定案");
  check(writes.length === 1 && writes[0] === "花出現", "計時器快轉跑完：invalidate 之後的每一步都被擋下來，狀態不會回到舊手牌、也不會顯示舊的補花字樣");
}

// 4. 換房、卸載各自呼叫一次 invalidate：舊序號還是過期，不會因為呼叫第二次又復活
{
  const g = new FlowerAnimGuard();
  const token = g.start();
  g.invalidate(); // 換房
  g.invalidate(); // 卸載
  check(g.isStale(token), "換房、卸載各自呼叫 invalidate，舊序號還是過期的");
}

// 5. invalidate 之後開始「新的」一段動畫：新序號是有效的，不會被舊的 invalidate 波及
{
  const g = new FlowerAnimGuard();
  const oldToken = g.start();
  g.invalidate();
  const newToken = g.start(); // 新局重新摸到花，開始新的一段動畫
  check(g.isStale(oldToken), "舊動畫的序號仍然過期");
  check(!g.isStale(newToken), "新局重新開始的動畫序號是有效的，可以正常寫 state");
}

if (failed) process.exit(1);
