// 十三支審伯三項必修（2026-11-18）：components/thirteen/roomScreen.ts
//   M1 末局亮牌、總結算中重新整理：用上次入座存的房間 id 讀狀態（不再呼叫 join），房號被別場重用也不會誤入；總結算看過了就不重播
//   M2 非末局亮牌、結算確認前、確認後收到解散關房：都進關房總結算（能回大廳）
//   M3 等人畫面開局、退出遇到網路例外：顯示錯誤、解除等待，網路回來可以再按
import { clearLastJoin, finalSeen, guarded, loadLastJoin, markFinalSeen, revealScreen, saveLastJoin } from "../components/thirteen/roomScreen";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

// ---- M1 ----
{
  const s = memStore();
  const j = { roomId: "room-old", code: "1234", playerId: "p0", seat: 2, channel: "th-p-x" };
  saveLastJoin(s, j);
  const got = loadLastJoin(s, "1234");
  ok(got?.roomId === "room-old" && got.seat === 2, "M1a 重新整理（網址 #room=1234）：拿回上次的房間 id 和座位，直接讀那一場的狀態／410 紀錄，不再用房號 join");
  ok(loadLastJoin(s, "5678") === null, "M1b 網址換成別的房號：不用舊的，照常 join");
  ok(got?.roomId !== "room-new", "M1c 房號 1234 被新的一場重用：讀的仍是舊場 room-old（四家名字、末局牌、總分來自舊場紀錄），不會誤入新場");
  ok(!finalSeen(s, "room-old"), "M1d 還沒看過總結算：重新整理會播末局亮牌");
  markFinalSeen(s, "room-old");
  ok(finalSeen(s, "room-old") && !finalSeen(s, "room-x"), "M1e 總結算中重新整理：直接回總結算，不重播亮牌（只認這一場）");
  clearLastJoin(s);
  ok(loadLastJoin(s, "1234") === null, "M1f 回十三支大廳／退出房間：清掉，之後同房號照常 join");
}

// ---- M2 ----
{
  const base = { hasShow: true, showFinal: false, confirmed: false, newHandStarted: false, closed: false };
  ok(revealScreen(base) === "reveal", "M2a 一般局亮牌中、沒關房：照常播亮牌");
  ok(revealScreen({ ...base, closed: true }) === "closed", "M2b 非末局亮牌中收到解散關房：進關房總結算");
  ok(revealScreen({ ...base, closed: true }) === "closed", "M2c 本局結算、還沒按確認時解散：進關房總結算（不再倒數開下一局）");
  ok(revealScreen({ ...base, confirmed: true, closed: true }) === "closed", "M2d 按了確認、等其他人時解散：進關房總結算（不會停在「等其他人…」）");
  ok(revealScreen({ ...base, showFinal: true, closed: true }) === "reveal" && revealScreen({ ...base, showFinal: true, confirmed: true, closed: true }) === "final",
    "M2e 整場打完（末局，房間也關了）：先播完末局亮牌，按「看總結算」才進總結算（原本行為不變）");
  ok(revealScreen({ ...base, hasShow: false, closed: true }) === "closed", "M2f 不在亮牌中被關房：關房總結算");
}

// ---- M3 ----
{
  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    const st = { busy: false, msg: "", busyLog: [] as boolean[] };
    await guarded(fn, (b) => { st.busy = b; st.busyLog.push(b); }, (m) => { st.msg = m; }, "開局失敗").catch(() => {});
    return st;
  };
  const net = await run(async () => { throw new TypeError("Failed to fetch"); });
  ok(!net.busy && net.busyLog[0] === true, "M3a 開局／退出時網路例外：等待狀態解除（按鈕不會一直停在「退出中…」或停用）");
  ok(net.msg === "網路不穩，請再試一次", "M3b 網路例外：顯示「網路不穩，請再試一次」");
  const again = await run(async () => ({ ok: true }));
  ok(!again.busy && again.msg === "", "M3c 網路回來再按一次：照常執行、錯誤字清掉");
  const refused = await run(async () => ({ ok: false, message: "人數不足" }));
  ok(!refused.busy && refused.msg === "人數不足", "M3d 伺服器拒絕：照舊顯示伺服器的原因");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
if (failed) process.exit(1);
