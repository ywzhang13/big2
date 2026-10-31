This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 靜態素材快取（2026-11-01 起，必讀）

牌面（`public/tiles`）、特效圖和音效（`public/mahjong-fx`）、字型（`public/fonts`）、首頁圖（`public/home`）一律送 `Cache-Control: public, max-age=31536000, immutable`（設定在 `lib/staticCache.ts`，由 `next.config.ts` 套用）。玩家下載過一次，一年內都不會再向 Vercel 請求。這是為了省 Vercel 請求數：10 月約 34% 的請求是這些檔案在重新驗證。

**規則：換素材一律改檔名或加版本號，不可以同檔名換內容。**
- 例：`storm-wall.webp` 要換圖 → 新增 `storm-wall.v2.webp`，程式改引用新檔名，舊檔確定沒人用了再刪。
- 同檔名換內容的話，已經下載過的玩家會一直看到舊檔（最長一年），而且沒辦法從伺服器端清掉。
- 新增或刪除素材後執行 `node scripts/asset-hashes.mjs --write`，更新 `scripts/immutable-assets.json`（內容雜湊清單）。
- `npm test`（`tests/_save-requests.ts`）會檢查：同檔名內容變了、新檔沒登記，都會失敗。`--write` 也會拒絕同檔名換內容。
- PWA 圖示（`public/mahjong-app`）、`mahjong.webmanifest`、頁面、API 都不加長快取。

## 驗收與測試（2026-11-01 起）

- **正式站（big2-three.vercel.app）不跑自動測試、不跑大量驗收腳本。** 每一次瀏覽器自動化、每一支 API 呼叫，都算 Vercel 的請求數。10 月正式站上的測試和驗收約占總請求的 2 成。
- 功能驗收一律在**預覽站**（本機 `next start`＋假 Supabase，見 `.preview-fx`）做。正式站的資料庫只能做唯讀比對（直接連資料庫，不經過 Vercel）。
- 上線後在正式站只做少量健康檢查：幾個頁面打一次、看伺服器錯誤紀錄。需要真 LINE 帳號才能驗的項目，請老闆或驗收人員手動點。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
