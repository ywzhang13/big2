// npm test：逐一跑 tests/_*.ts（計分單元測試）和 tests/flow/*.ts（API 流程測試，記憶體版資料庫）。
// 每個檔案用獨立的 node 行程跑，最後彙總 ✅／❌ 數量；任何一個檔案失敗就以非 0 結束。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const groups = [
  ["單元測試", readdirSync(here).filter((f) => /^_.*\.ts$/.test(f)).map((f) => path.join(here, f))],
  ["API 流程測試", readdirSync(path.join(here, "flow")).filter((f) => f.endsWith(".ts")).map((f) => path.join(here, "flow", f))],
];
const register = path.join(here, "support", "register.mjs");
let failed = 0;
for (const [label, files] of groups) {
  let pass = 0, fail = 0;
  console.log(`\n=== ${label} ===`);
  for (const file of files.sort()) {
    const r = spawnSync(process.execPath, ["--import", register, file], { encoding: "utf8" });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const p = (out.match(/✅/g) ?? []).length;
    const f = (out.match(/❌/g) ?? []).length;
    pass += p; fail += f;
    const ok = r.status === 0 && f === 0;
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${path.relative(here, file)}：通過 ${p}、失敗 ${f}`);
    if (!ok) console.log(out.split("\n").filter((l) => !l.startsWith("✅")).join("\n"));
  }
  console.log(`${label}合計：通過 ${pass}、失敗 ${fail}`);
}
process.exit(failed > 0 ? 1 : 0);
