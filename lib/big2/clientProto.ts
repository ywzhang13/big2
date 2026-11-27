// 大老二前後端換版用的版本標記（老柯 2026-11-27，手牌不外流 R2）。
// 這版起手牌不走公開廣播，前端開局後要帶入座憑證讀狀態拿牌；上線前就開著的舊分頁不會這樣做，開局就會缺牌、不能出牌。
// 所以開局的入口（ready-check、ready、舊的 deal）要帶 proto＝目前版本，沒帶的一律 426，舊分頁開不了局（不會進到缺牌的牌局），
// 回到等人畫面後由自動換新版（lib/autoUpdate.ts）重新整理。這不是安全檢查，只是擋舊版前端。
export const BIG2_CLIENT_PROTO = 2;

export const isCurrentBig2Client = (body: { proto?: unknown } | null | undefined) => body?.proto === BIG2_CLIENT_PROTO;

export const outdatedBig2Client = () =>
  Response.json({ error: "client_outdated", message: "遊戲已更新，請重新整理頁面" }, { status: 426 });
