// 偏好頁選用被拒（老柯 2026-10-31：403 not_granted 帶 selected）：前端照伺服器說的改回目前實際套用的那一種，不停在被拒的那張
//   R1 403 帶 selected → 回那一種；R2 403 沒帶 → null（顯示「套用失敗」）；R3 其他錯誤（網路、500）→ null；R4 成功 → null
import { rejectedSelected } from "../lib/mahjong/zimoFxClient";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
eq(rejectedSelected({ ok: false, status: 403, error: "not_granted", body: { error: "not_granted", selected: "frost" } }), "frost", "R1 403 not_granted 帶 selected：改回伺服器上實際套用的那一種");
eq(rejectedSelected({ ok: false, status: 403, error: "not_granted", body: { error: "not_granted" } }), null, "R2 403 沒帶 selected：不改，顯示套用失敗");
eq([rejectedSelected({ ok: false, status: 0, error: "network" }), rejectedSelected({ ok: false, status: 500, error: "server", body: { selected: "frost" } })], [null, null], "R3 網路錯誤、500：不改");
eq(rejectedSelected({ ok: true, data: { selected: "storm" } }), null, "R4 成功：不走這條");
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
