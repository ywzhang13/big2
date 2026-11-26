import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { immutableHeaders } from "./lib/staticCache";

// 自動換新版（lib/autoUpdate.ts）：建置時的版本號，頁面和 /api/version 都讀這個。
// 優先 BUILD_VERSION（預覽站測試用）→ Vercel 的 commit → 本機 git → 建置時間
function buildVersion(): string {
  if (process.env.BUILD_VERSION) return process.env.BUILD_VERSION;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return String(Date.now()); }
}

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD_VERSION: buildVersion() },
  // 語音轉檔用 ffmpeg-static 附的執行檔：不打包進 bundle（路徑才對），並確保部署時把執行檔帶進語音路由
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: { "/api/mahjong/voice": ["./node_modules/ffmpeg-static/ffmpeg"] },
  // 牌面、特效圖和音效、字型、首頁圖長期快取（省量，見 lib/staticCache.ts；換素材必改檔名）
  async headers() {
    return immutableHeaders();
  },
};

export default nextConfig;
