// 斗內後台：手動清除自摸次數 — 已停用（老闆 2026-10-31：不要手動清除，次數只在記一筆斗內時自動抵扣）。
// 不管誰呼叫、帶什麼參數，一律回 410 { error: "gone" }，不查也不寫任何資料（不登入檢查，免得多一次往返）。
// 已經寫進操作紀錄的 zimo_clear 照樣保留、照樣列在操作紀錄裡；資料庫的 mj_zimo_clear 函式也留著不動（沒有任何程式會呼叫）。
const gone = async (): Promise<Response> => Response.json({ error: "gone" }, { status: 410, headers: { "cache-control": "no-store" } });
export const POST = gone;
export const GET = gone;
