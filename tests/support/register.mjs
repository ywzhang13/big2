import { register } from "node:module";
register("./loader-hooks.mjs", import.meta.url);
// 座位頻道名稱用伺服器金鑰做 HMAC（lib/mahjong/access.ts）；測試給一個假值，不連任何服務
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
