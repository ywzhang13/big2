// 十三支預覽頁的開關：本機開發（next dev）一律可開；正式 build（next start、Vercel）要設 THIRTEEN_PREVIEW=1 才可開，
// 所以正式站沒設這個變數時，預覽頁一律 404（帶任何查詢參數都一樣）。預覽站啟動 next start 時加 THIRTEEN_PREVIEW=1。
// 只在伺服器讀（不是 NEXT_PUBLIC_，build 時不會被寫死進前端）。
export function previewAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.THIRTEEN_PREVIEW === "1";
}
