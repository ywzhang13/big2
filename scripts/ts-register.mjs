// 讓 node 直接跑專案裡的 TypeScript 腳本（沿用 npm test 的模組 hook，但不換成測試用的記憶體版本）
import { register } from "node:module";
register("../tests/support/loader-hooks.mjs", import.meta.url, { data: { stubs: false } });
