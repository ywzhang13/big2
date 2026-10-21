// npm test 用的 Node 模組 hook（不需要另外安裝套件）：
//   - 支援專案裡沒寫副檔名的 import，以及 tsconfig 的 "@/..." 路徑
//   - 用專案已有的 typescript 把 .ts 轉成 JS（會移除只當型別用的 import）
//   - 路由裡的 "@/lib/mahjong/db"、"broadcast" 換成 tests/support 的記憶體版本（不連資料庫）；
//     "gameLogic" 換成 forced-deal（沒指定花牌時和真的完全一樣，用來測開局花牌）；
//     "records/store"（對局紀錄的資料庫存取）換成記憶體版本；"auth"（驗證登入 token）、"guest/store"（遊客帳號與猜錯次數）、"pairing/store"（主畫面登入交接）換成記憶體版本；
//     "mahjong/donate/store"（斗內的自摸次數）換成記憶體 PostgreSQL 版本（跑真的 SQL 函式）；
//     "mahjong/effects/store"（互動特效冷卻）換成記憶體 PostgreSQL 版本（跑真的 SQL 函式）；
//     "next/server" 的 after() 在測試裡不跑
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STUBS = {
  "@/lib/mahjong/db": "tests/support/stub-db.ts",
  "@/lib/mahjong/broadcast": "tests/support/stub-broadcast.ts",
  "@/lib/mahjong/gameLogic": "tests/support/forced-deal.ts",
  "@/lib/records/store": "tests/support/stub-records-store.ts",
  "@/lib/broadcast": "tests/support/stub-broadcast.ts",
  "@/lib/auth": "tests/support/stub-auth.ts",
  "@/lib/guest/store": "tests/support/stub-guest-store.ts",
  "@/lib/pairing/store": "tests/support/stub-pairing-store.ts",
  "@/lib/mahjong/donate/store": "tests/support/stub-donate-store.ts",
  "@/lib/mahjong/effects/store": "tests/support/stub-effects-store.ts",
  "next/server": "tests/support/stub-next-server.ts",
};

// scripts/ts-register.mjs 用 { stubs: false } 註冊：只轉 TypeScript、解析路徑，連真的資料庫
let useStubs = true;
export async function initialize(data) {
  if (data?.stubs === false) useStubs = false;
}

export async function resolve(spec, ctx, next) {
  if (useStubs && STUBS[spec]) return next(pathToFileURL(path.join(ROOT, STUBS[spec])).href, ctx);
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href;
  const isRel = spec.startsWith("./") || spec.startsWith("../");
  if ((isRel || spec.startsWith("file:")) && !path.extname(spec)) {
    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, ctx);
    }
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return next(url, ctx);
}
