// 斗內下架（老柯 2026-11-20；規劃 v1 第 2 節第 5 點：斗內系統下架、不刪資料，只停止新增；後台的作廢／撤回關閉）。
// 停用的寫入：後台記打賞、作廢、以場結清、撤回結清這 4 支 POST，和每局結算時記自摸次數（mj_zimo_wins）。
//   停用時路由一律回 410 { error: "donate_disabled" }，不查也不寫任何資料（不做登入檢查，免得多一次往返；同 zimo-counts/clear）。
//   為什麼作廢、撤回也要關：它們會觸發 mj_fx_auto_sync，自動收回系統開通的特效（20261109_mahjong_fx_auto_donate.sql 規則第 2 點）。
// 資料表、SQL 函式、查詢（GET）全部保留，舊紀錄老闆後台照樣查得到。
// 恢復開關：伺服器環境變數 MJ_DONATE_WRITES=1 時照舊寫入（原本的程式一行都沒刪）。正式站不設＝停用；
//   設這個開關只在「老闆要恢復斗內」或退回時用（上線計畫），舊的斗內流程測試也是設這個開關照舊跑。
export const donateWritesEnabled = (env: Record<string, string | undefined> = process.env) => env.MJ_DONATE_WRITES === "1";

export const donateDisabledResponse = (): Response =>
  Response.json({ error: "donate_disabled", message: "斗內已停用" }, { status: 410, headers: { "cache-control": "no-store" } });

/** 包住原本的寫入路由：停用時回 410、開關打開才跑原本的程式 */
export const unlessDonateDisabled = (handler: (request: Request) => Promise<Response>) =>
  (request: Request): Promise<Response> => (donateWritesEnabled() ? handler(request) : Promise.resolve(donateDisabledResponse()));
