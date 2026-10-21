import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // 語音轉檔用 ffmpeg-static 附的執行檔：不打包進 bundle（路徑才對），並確保部署時把執行檔帶進語音路由
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: { "/api/mahjong/voice": ["./node_modules/ffmpeg-static/ffmpeg"] },
};

export default nextConfig;
