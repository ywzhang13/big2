// 長期快取（immutable 一年）的素材：同一個檔名在 main 或這條分支的歷史裡，只能有一種內容（老馬 2026-11-06：神掌手、雲、凹陷曾同名換內容，iPhone 一直用舊圖）。
// 從長期快取清單（scripts/immutable-assets.json）建立那一刻起算；清單裡每個檔名，歷史上出現過的內容都要和現在一樣。要換內容就換檔名。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ok = (c: boolean, m: string) => console.log(`${c ? "✅" : "❌"} ${m}`);
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const manifest = JSON.parse(readFileSync(new URL("../scripts/immutable-assets.json", import.meta.url), "utf8")) as Record<string, string>;
let since = "";
try { since = git("log", "--diff-filter=A", "--format=%H", "--", "scripts/immutable-assets.json").trim().split("\n").pop() ?? ""; } catch { /* 不是 git 工作目錄 */ }
if (!since) ok(true, "I1 不在 git 工作目錄，略過歷史檢查");
else {
  const refs = ["HEAD", ...(git("branch", "--list", "main").trim() ? ["main"] : [])];
  const raw = git("log", "--raw", "--no-abbrev", "--format=", `${since}^..HEAD`, ...refs.slice(1), "--", "public");
  const seen = new Map<string, Set<string>>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [AM]\t(.+)$/);
    if (!m) continue;
    const url = "/" + m[2].replace(/^public\//, "");
    (seen.get(url) ?? seen.set(url, new Set()).get(url)!).add(m[1]);
  }
  const bad = Object.keys(manifest).filter((u) => (seen.get(u)?.size ?? 0) > 1);
  ok(bad.length === 0, `I1 長期快取素材沒有同名換內容（檢查 ${Object.keys(manifest).length} 個檔）${bad.length ? "：" + bad.join("、") : ""}`);
}
