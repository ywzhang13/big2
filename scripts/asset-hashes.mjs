// 長期快取素材的內容雜湊清單（scripts/immutable-assets.json）。換素材必須改檔名或加版本號：
//   node scripts/asset-hashes.mjs          → 檢查（同檔名內容變了、新檔沒登記，都列出來並回傳非 0）
//   node scripts/asset-hashes.mjs --write  → 新增檔案後更新清單（只會加新檔、刪掉已不存在的；同檔名換內容照樣拒絕）
// 目錄要和 next.config.ts 的 IMMUTABLE_ASSET_DIRS 一致（tests/_immutable-assets.ts 會比對）
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIRS = ["tiles", "mahjong-fx", "fonts", "home"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
export const LIST = path.join(ROOT, "scripts", "immutable-assets.json");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
export function currentHashes() {
  const out = {};
  for (const d of DIRS) for (const f of walk(path.join(PUB, d)).sort()) {
    out["/" + path.relative(PUB, f).split(path.sep).join("/")] = createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
  }
  return out;
}
/** 比對：changed＝同檔名內容不同（不允許）；added＝清單裡沒有的新檔；removed＝清單有但檔案已不在 */
export function diffHashes(saved, now) {
  return {
    changed: Object.keys(now).filter((k) => k in saved && saved[k] !== now[k]),
    added: Object.keys(now).filter((k) => !(k in saved)),
    removed: Object.keys(saved).filter((k) => !(k in now)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const saved = existsSync(LIST) ? JSON.parse(readFileSync(LIST, "utf8")) : {};
  const now = currentHashes();
  const d = diffHashes(saved, now);
  if (d.changed.length) {
    console.error("❌ 這些檔案同檔名換了內容（玩家會一直看到舊檔）。請改檔名或加版本號，例如 storm-wall.webp → storm-wall.v2.webp：\n  " + d.changed.join("\n  "));
    process.exit(1);
  }
  if (process.argv.includes("--write")) {
    writeFileSync(LIST, JSON.stringify(now, null, 1) + "\n");
    console.log(`已更新 ${path.relative(ROOT, LIST)}：新增 ${d.added.length}、移除 ${d.removed.length}，共 ${Object.keys(now).length} 個檔`);
  } else if (d.added.length) {
    console.error("❌ 新檔還沒登記，請執行 node scripts/asset-hashes.mjs --write：\n  " + d.added.join("\n  "));
    process.exit(1);
  } else console.log(`✅ ${Object.keys(now).length} 個長期快取素材都和清單一致`);
}
