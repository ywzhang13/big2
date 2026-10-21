// ffmpeg-static 沒有附型別：預設匯出是執行檔路徑（不支援的平台為 null）
declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}
