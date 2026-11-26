// 自動換新版用（lib/autoUpdate.ts）：回這個部署建置時的版本號。不快取，每次都問到現在線上的那一版
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ v: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
