// 靜態素材長期快取（2026-11-01 省量：原本 Vercel 預設 max-age=0，每次開頁每個檔案都要再問一次，10 月約占總請求 34%）。
// 瀏覽器下載過一次就一年內不再發請求。⚠️ 代價：同一個檔名換內容，老玩家會一直看到舊檔——
// 換素材一律改檔名或加版本號（見 README「靜態素材快取」）；scripts/asset-hashes.mjs 和 tests/_save-requests.ts 會擋下「同檔名換內容」。
// PWA 圖示（/mahjong-app）、manifest、頁面、API 都不加。
export const IMMUTABLE_ASSET_DIRS = ["tiles", "mahjong-fx", "fonts", "home"] as const;
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** next.config 的 headers() 用 */
export function immutableHeaders() {
  return IMMUTABLE_ASSET_DIRS.map((dir) => ({ source: `/${dir}/:path*`, headers: [{ key: "Cache-Control", value: IMMUTABLE_CACHE }] }));
}
