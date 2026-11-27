import { register } from "node:module";
// TEST_BIG2_REAL_DB=1：大老二 store 用真程式碼（見 loader-hooks.mjs 的 realBig2Db）
register("./loader-hooks.mjs", import.meta.url, { data: { realBig2Db: process.env.TEST_BIG2_REAL_DB === "1" } });
// 座位頻道名稱用伺服器金鑰做 HMAC（lib/mahjong/access.ts）；測試給一個假值，不連任何服務
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
