// 十三支審伯兩項必修（2026-11-18 第二批）：components/thirteen/roomScreen.ts
//   N 本局結算「確認」：只有請求成功（200）或伺服器快照證明自己按過，才顯示已確認；斷線、503、伺服器拒絕要顯示錯誤、可以重按；
//     倒數到了自動確認失敗也會再試；重按成功後就是已確認（四家都確認，伺服器馬上開下一局）
//   K 末局重新整理只收到 410（沒有 serverNow）：用分頁記下的時差、或回應的 Date 標頭算伺服器時間；
//     本機快或慢兩分鐘、亮牌後第 3 秒重新整理，都接在約第 3 秒；過了 settleAt 直接顯示結算
import { confirmView, revealClock, sendConfirm, shouldAutoConfirm, skewFromDateHeader, skewOnClosed, saveSkew, loadSkew, type ConfirmState } from "../components/thirteen/roomScreen";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

// ---- N ----
{
  let st: ConfirmState = null;
  const set = (s: ConfirmState) => { st = s; };
  const seen: boolean[] = [];
  const watch = (s: ConfirmState) => { set(s); seen.push(confirmView(s, "h1", [], "p0").confirmed); };
  await sendConfirm(async () => { throw new TypeError("Failed to fetch"); }, "h1", watch);
  let v = confirmView(st, "h1", [], "p0");
  ok(!v.confirmed && !v.sending && v.error === "網路不穩，請再按一次" && !seen.includes(true), "N1 斷線：從頭到尾都不顯示已確認，顯示「網路不穩，請再按一次」，按鈕可以再按");
  await sendConfirm(async () => ({ ok: false, message: "伺服器忙碌，請稍後再試" }), "h1", set);
  v = confirmView(st, "h1", [], "p0");
  ok(!v.confirmed && v.error === "伺服器忙碌，請稍後再試", "N2 503／伺服器拒絕：不算確認，顯示伺服器給的原因");
  await sendConfirm(async () => ({ ok: true }), "h1", set);
  v = confirmView(st, "h1", [], "p0");
  ok(v.confirmed && !v.error, "N3 重按成功：顯示已確認（等其他人…），四家都確認時伺服器馬上開下一局");
  ok(confirmView(null, "h1", ["p1", "p0"], "p0").confirmed && !confirmView(null, "h1", ["p1"], "p0").confirmed, "N4 伺服器快照 nextReady 有自己＝已確認（例如重新整理）；沒有就不算");
  ok(!confirmView({ key: "h1", status: "done" }, "h2", [], "p0").confirmed, "N5 上一局的確認不算到下一局");
  const auto = (o: Partial<Parameters<typeof shouldAutoConfirm>[0]>) => shouldAutoConfirm({ now: 10_000, autoAt: 9_000, confirmed: false, sending: false, lastAutoAt: null, ...o });
  ok(auto({}) && !auto({ now: 8_000 }) && !auto({ sending: true }) && !auto({ confirmed: true }) && !auto({ lastAutoAt: 9_500 }) && auto({ lastAutoAt: 6_900 }),
    "N6 倒數到了自動確認；送出中、已確認不重送；失敗後隔 3 秒會再自動試一次（不會卡住）");
}

// ---- K ----
{
  const S = Date.UTC(2026, 10, 18, 8, 0, 0, 250); // 伺服器亮牌時間（毫秒）
  const rv = { revealedAt: S, settleAt: S + 9000 };
  for (const off of [120_000, -120_000]) {
    const serverAt = S + 3000;                       // 亮牌後第 3 秒重新整理
    const sentAt = serverAt + off - 40, recvAt = serverAt + off + 40; // 本機時間＝伺服器 ± 2 分鐘，來回 80 ms
    const fromHdr = skewFromDateHeader(new Date(serverAt).toUTCString(), sentAt, recvAt);
    const skew = skewOnClosed(null, fromHdr, 0);
    const c = revealClock(rv, skew, recvAt, recvAt);
    ok(Math.abs(c.elapsed - 3000) <= 1000 && !c.pastSettle, `K1 本機${off > 0 ? "快" : "慢"} 2 分鐘、只有 410：用 Date 標頭算時差，接在約第 3 秒（實際 ${(c.elapsed / 1000).toFixed(2)} 秒）`);
  }
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  saveSkew(store, -120_000);
  const sk = skewOnClosed(loadSkew(store), 999, 0);
  const c2 = revealClock(rv, sk, S + 3000 + 120_000, 0);
  ok(sk === -120_000 && c2.elapsed === 3000, "K2 分頁之前量過時差（200 回應）：重新整理後優先用它（毫秒級），一樣接在第 3 秒");
  const late = revealClock(rv, -120_000, S + 9500 + 120_000, 0);
  ok(late.pastSettle && late.elapsed >= 9000, "K3 重新整理時已經過了 settleAt：直接顯示結算（不重播）");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
if (failed) process.exit(1);
