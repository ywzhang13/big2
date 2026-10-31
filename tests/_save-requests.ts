// 省量改版（老柯 2026-11-01，〈Vercel請求量分析與省量方案〉）
//   Q1 觀戰管理清單：進牌桌拿 1 次；之後 10 分鐘（假時鐘）都沒事件就 0 次（不再每 5 秒輪詢）；回前景拿 1 次；停止後不再拿
//   Q2 有事件（tick 變了，hook 重新開始同步）就拿 1 次
//   Q3 靜態素材：tiles、mahjong-fx、fonts、home 都回 Cache-Control: public, max-age=31536000, immutable；PWA 圖示、manifest、API 不加
//   Q4 長期快取素材不能「同檔名換內容」：目前檔案和 scripts/immutable-assets.json 一致；改了內容、或有新檔沒登記都會被抓到；腳本和 lib/staticCache 的目錄一致
import { startManageSync, type ManageSyncEnv } from "../lib/mahjong/spectate/manageSync";
import { IMMUTABLE_ASSET_DIRS, IMMUTABLE_CACHE, immutableHeaders } from "../lib/staticCache";
import { currentHashes, diffHashes, DIRS, LIST } from "../scripts/asset-hashes.mjs";
import { readFileSync } from "node:fs";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}

// 假時鐘：setTimeout／setInterval 都照時間觸發，看 load 被叫幾次
function fakeEnv() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; f: () => void; every?: number }>();
  const visible: (() => void)[] = [];
  const env: ManageSyncEnv & { setInterval?: (f: () => void, ms: number) => unknown } = {
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; },
    clearTimeout: (t) => { timers.delete(t as number); },
    onVisible: (cb) => { visible.push(cb); return () => { const i = visible.indexOf(cb); if (i >= 0) visible.splice(i, 1); }; },
  };
  // 萬一有人又改回 setInterval（全域的），這裡也照假時鐘跑，測試抓得到
  const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
  (globalThis as { setInterval: unknown }).setInterval = (f: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, f, every: ms }); return id; };
  (globalThis as { clearInterval: unknown }).clearInterval = (t: number) => { timers.delete(t); };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, t] = next; now = t.at;
      if (t.every) t.at += t.every; else timers.delete(id);
      t.f();
    }
    now = end;
  };
  const restore = () => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; };
  return { env, advance, fireVisible: () => visible.slice().forEach((cb) => cb()), restore, pending: () => timers.size };
}

// ---- Q1／Q2 ----
{
  const t = fakeEnv();
  let n = 0;
  const stop = startManageSync(() => n++, t.env);
  t.advance(1); const first = n;
  t.advance(10 * 60 * 1000); const after10min = n;
  t.fireVisible(); const afterVisible = n;
  stop(); t.advance(60 * 1000); t.fireVisible(); const afterStop = n;
  eq([first, after10min, afterVisible, afterStop, t.pending()], [1, 1, 2, 2, 0],
    "Q1 進牌桌拿 1 次；10 分鐘沒事件仍是 1 次（原本會打 120 次）；回前景 +1；停止後計時器和監聽都清乾淨、不再拿");
  // 有事件：hook 依 tick 重新開始同步＝停止舊的、開始新的
  let m = 0;
  let s = startManageSync(() => m++, t.env); t.advance(1);
  for (let i = 0; i < 3; i++) { s(); s = startManageSync(() => m++, t.env); t.advance(1); }
  t.advance(5 * 60 * 1000); s();
  eq(m, 4, "Q2 進牌桌 1 次＋3 個觀戰事件各 1 次＝4 次，事件之間不會自己再拿");
  t.restore();
}

// ---- Q3 快取標頭 ----
{
  const rules = immutableHeaders();
  const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  eq(/async headers\(\)\s*\{\s*return immutableHeaders\(\);/.test(cfg), true, "Q3 next.config.ts 的 headers() 用的就是 immutableHeaders()");
  const cacheOf = (p: string) => rules.find((r) => new RegExp("^" + r.source.replace("/:path*", "/.+") + "$").test(p))?.headers.find((h) => h.key === "Cache-Control")?.value ?? null;
  eq([cacheOf("/tiles/faces/Chun.webp"), cacheOf("/mahjong-fx/zimo/storm/storm-main.webp"), cacheOf("/mahjong-fx/s/zimo-storm-pc.mp3"), cacheOf("/fonts/noto-sans-tc/zimo-black.woff2"), cacheOf("/home/home-big2.webp")],
    Array(5).fill(IMMUTABLE_CACHE), "Q3 牌面、特效圖、特效音效、字型、首頁圖都是一年 immutable");
  eq([cacheOf("/mahjong-app/icon-192.png"), cacheOf("/mahjong.webmanifest"), cacheOf("/api/mahjong/state"), cacheOf("/mahjong"), IMMUTABLE_CACHE],
    [null, null, null, null, "public, max-age=31536000, immutable"], "Q3 PWA 圖示、manifest、API、頁面都不加長快取");
}

// ---- Q4 同檔名換內容會被擋 ----
{
  const saved = JSON.parse(readFileSync(LIST, "utf8"));
  const now = currentHashes();
  const d = diffHashes(saved, now);
  const firstKey = Object.keys(saved)[0];
  const tampered = diffHashes(saved, { ...now, [firstKey]: "0000000000000000", "/tiles/new-tile.webp": "1111111111111111" });
  eq([d.changed, d.added, Object.keys(now).length > 200, tampered.changed, tampered.added, [...DIRS].sort(), [...IMMUTABLE_ASSET_DIRS].sort()],
    [[], [], true, [firstKey], ["/tiles/new-tile.webp"], [...IMMUTABLE_ASSET_DIRS].sort(), [...DIRS].sort()],
    "Q4 目前長期快取素材都和清單一致；同檔名改內容、新檔沒登記都會被抓到；腳本和 lib/staticCache 的目錄一致");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
