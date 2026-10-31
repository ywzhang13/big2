import type { NextConfig } from "next";
import { immutableHeaders } from "./lib/staticCache";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // 語音轉檔用 ffmpeg-static 附的執行檔：不打包進 bundle（路徑才對），並確保部署時把執行檔帶進語音路由
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: { "/api/mahjong/voice": ["./node_modules/ffmpeg-static/ffmpeg"] },
  // 牌面、特效圖和音效、字型、首頁圖長期快取（省量，見 lib/staticCache.ts；換素材必改檔名）
  async headers() {
    return immutableHeaders();
  },
};

export default nextConfig;
