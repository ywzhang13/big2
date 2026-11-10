# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## 這個 repo 是什麼

Next.js 16（App Router）+ Supabase 的線上牌桌，**兩套獨立遊戲共用一個專案**：

- **台灣麻將 16 張**（`/mahjong`）— 目前的主力，九成以上的程式碼與活躍開發都在這裡。必須 LINE 登入，含觀戰、聊天／語音、互動特效、自摸特效與斗內後台、排行榜、對局紀錄。
- **大老二**（`/big2`）— 早期的遊戲，程式碼小、改動少，`lib/` 根目錄那批沒有 `mahjong/` 前綴的檔案（`card.ts`、`combo.ts`、`compare.ts`、`rules.ts`、`scoring.ts`、`gameState.ts`）都是它的。

部署在 **Vercel**（`vercel.json`，region `sin1`，每日 cron 清語音檔）。`.github/workflows/deploy.yml` 是 2026-04 遺留的 GitHub Pages workflow，與現況不符，不要當成部署真相。

---

## 指令

```bash
npm run dev            # 本機開發
npm run build          # 正式建置
npm run lint           # eslint（flat config，eslint-config-next）
npx tsc --noEmit       # 型別檢查（tsconfig 本身就是 noEmit）
npm test               # 全部測試：tests/_*.ts（單元）+ tests/flow/*.ts（API 流程）
```

**跑單一測試檔**（runner 會用自訂 Node loader 直接跑 `.ts`，不先編譯）：

```bash
node --import ./tests/support/register.mjs tests/_pinghu.ts
node --import ./tests/support/register.mjs tests/flow/flow-ting.ts
```

**直接跑專案裡的 TypeScript 腳本**（連真的資料庫，不套用測試 stub）：

```bash
node --import ./scripts/ts-register.mjs scripts/mj-voice-purge.ts
```

**靜態素材雜湊清單**（新增／刪除 `public/{tiles,mahjong-fx,fonts,home}` 之後必跑）：

```bash
node scripts/asset-hashes.mjs            # 檢查（同檔名換內容、新檔沒登記 → 非 0）
node scripts/asset-hashes.mjs --write    # 更新 scripts/immutable-assets.json
```

**端對端牌局錄影**（Playwright，需要本機 server 起著）：`node tests/mj-orchestrator.mjs`，輸出在 `tests/videos/`、`tests/mj-test.log`。

環境變數：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（必要）；`UPSTASH_REDIS_REST_URL`／`_TOKEN`（沒設就自動退回純 Postgres，見下）；`CRON_SECRET`、`GUEST_LOGIN_PASSWORD`、`NEXT_PUBLIC_MJ_PREVIEW=1`（預覽站）為選用。

---

## 麻將核心架構（改任何 `/api/mahjong/*` 前必讀）

### 狀態模型：單一 JSONB blob + 樂觀鎖

整局狀態是 `mj_rooms.game_state` 這一個 JSONB 欄位（型別 `MahjongGameState`，`lib/mahjong/gameState.ts`）。每個會改狀態的路由都走同一條流水線：

```ts
return retryOnConflict((fresh) => handle(request, body, fresh, budget));
// handle 內部：
//   loadRoom(roomId, { fresh })                              // fresh=true 跳過 Redis 快取
//   prefetchZimoFx(state)                                    // 不等，和驗證並行
//   seatOwnerError(request, state, playerId)                 // 一律要登入 + 是本人座位
//   waitPaceOnce(state, budget)                              // 特效節奏：伺服器時間到才處理
//   …純函式改狀態（lib/mahjong/gameLogic.ts）…
//   const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, status?)
//   await mjBroadcastBatch(room.code, events, sv)
//   closeMahjongIfOver(...)                                   // 整場打完才關房
```

- `saveGameStateIfUnchanged` 是**條件寫入**：DB 裡的 `stateVersion` 還是讀出來那版才寫得進去，否則丟 `StateConflictError`；`retryOnConflict` 接住後以 `fresh=true` 重讀整個重做（最多 5 次，再失敗回 409）。**不要繞過它直接 `saveGameState`。**
- 回傳的 `sv` 一定要傳給 `mjBroadcastBatch`，前端靠它偵測跳號補抓（見下）。
- `lib/mahjong/cache.ts` 的 Redis 層（Upstash）是**選用的加速**：沒設環境變數時快取與 `withRoomLock` 都變 no-op，行為不變。快取寫入是 fire-and-forget，Postgres 永遠是權威。

### 遊戲規則是純函式

`lib/mahjong/gameLogic.ts`（約 1600 行）、`scoring.ts`、`winCheck.ts` 全是 `state → state` 的純函式，不碰 DB、不碰 React。路由只負責驗證／存檔／廣播，**規則永遠寫在 gameLogic/scoring，不要寫進路由**。事件組裝集中在 `lib/mahjong/events.ts`（只組資料，不存檔不送出）。

### 廣播：公開頻道 vs 座位私人頻道

`lib/mahjong/access.ts` 是存取控制的 SSOT：

- 手牌類事件（`PRIVATE_EVENTS`：`mj_deal_hand`、`mj_draw_tile`、`mj_hand_update`、`mj_available_actions`、`mj_opponent_hands`、`mj_effect`、`mj_chat`、`mj_spectate_request`）**不走公開頻道**，改送到每個座位專屬頻道。
- 座位頻道名是 `HMAC(SUPABASE_SERVICE_ROLE_KEY, "mj-private:<code>:<playerId>")`，只有伺服器算得出來，只透過本人的 join／state 回應告訴前端。
- 新增任何會帶私密資料的事件 → **記得加進 `PRIVATE_EVENTS`**，否則同桌全看得到。

### 視圖投影：絕不把 `MahjongGameState` 直接回給前端

`lib/mahjong/db.ts` 底部三個投影函式，依收件人裁掉資料：`toPublicGameState`（公開）、`toPlayerGameState`（本人，含自己手牌）、`toSpectatorGameState`（觀戰者，含被觀戰那家的手牌）。`userId`、牌牆順序、別家手牌都只能存在伺服器端。

### 前端同步：推播為主、輪詢當保險

`lib/mahjong/syncPolicy.ts` 與 `stateSync.ts` 是**不碰 React 的純邏輯**（`hooks/useMahjong.ts`、`/mahjong/watch`、大老二 `useGame` 共用，測試在 `tests/_sync-policy.ts`、`_state-sync.ts`）：

- 即時連線正常 → 25 秒才補抓一次完整狀態；連線斷了 → 回到 5 秒輪詢；分頁在背景 → 完全不抓。
- 事件帶 `sv`，跳號＝漏事件 → 立刻補抓；比看過的版本舊＝亂序晚到 → 丟掉（避免把畫面蓋回舊狀態）。
- `StateRequestGate` 管「舊回應不能蓋新狀態」「自己的動作在路上時 state 回應不可信」。

這套規則背後有大量實戰修正（漏事件後版本追上仍需套快照等），**改之前先讀該檔的檔頭註解與對應測試**，不要憑直覺調參數。

### 節奏（pace）

`lib/mahjong/pace.ts`：補花、眼牌摸牌的特效播完前，別人不能搶先動作。做法是把 `state.paceUntil` 設成特效播完的伺服器時間，後續任何請求在伺服器端 `waitPaceOnce` 等到時間才處理（不是拒絕，所以前端不用重送，斷線重整也不會卡）。自己視角、別家膠囊、觀戰三邊共用同一組毫秒常數才會對齊。

### 子系統（各自一個 `rules.ts`（純規則）+ `store.ts`（DB 存取））

| 目錄 | 內容 |
|---|---|
| `lib/mahjong/zimoFx/` | 自摸特效庫、斗內、以場結清、後台授權（`admin.ts` 的 `requireOwner`） |
| `lib/mahjong/donate/` | 自摸次數記帳 |
| `lib/mahjong/spectate/` | 觀戰申請／同意／收回（30 秒窗口） |
| `lib/mahjong/chat/` | 文字＋語音訊息、冷卻、ffmpeg 轉 m4a、Storage 清理 |
| `lib/mahjong/effects/` | 6 種互動特效與冷卻分組（輕／重） |
| `lib/mahjong/userPrefs/` | 跟 LINE 帳號走的偏好設定（格式 v4，讀舊版自動升級） |
| `lib/mahjong/fx/` | 前端特效播放引擎（預載、排隊、一次一個、背景分頁清場） |
| `lib/records/` | 對局紀錄 + 關房（`close_room_with_record` 同一個交易） |
| `lib/auth.ts`、`lib/guest/`、`lib/pairing/` | LINE 登入驗證、測試用遊客登入、iPhone 主畫面 App 的登入交接 |

老闆帳號寫死在 `lib/mahjong/zimoFx/rules.ts` 的 `OWNER_USER_ID`；後台 API 一律先 `requireOwner`。

---

## 測試架構

`npm test`（`tests/run-all.mjs`）對每個檔案開獨立 Node 行程跑，用 `tests/support/loader-hooks.mjs` 這個自訂 loader：

1. 用專案的 `typescript` 即時轉譯 `.ts/.tsx`（CSS import 變空模組），支援 `@/` 路徑與省略副檔名。
2. **把資料庫／廣播／登入層整支換成記憶體版本**（`STUBS` 對照表在 loader 開頭）：`@/lib/mahjong/db` → `stub-db.ts`、`broadcast` → `stub-broadcast.ts`、`@/lib/auth` → `stub-auth.ts`、各 `store.ts` → 對應 stub、`next/server` → stub（`after()` 不跑）。
3. 牽涉 SQL 的 stub（prefs、chat、donate、effects、zimoFx、spectate）用 **PGlite 跑真正的 migration 與 SQL 函式**（`tests/support/pg-mj.ts`），所以 migration 寫錯測試會抓到。

**測試檔的約定**（沒有測試框架，全手寫）：

- 每個斷言 `push` 一行 `✅ …` 或 `❌ …` 到 `results`，結尾 `console.log(results.join("\n"))`，有 `❌` 就 `process.exit(1)`。runner 靠數這兩個 emoji 統計。
- 檔名規則：`tests/_<主題>.ts` = 純邏輯單元測試；`tests/flow/flow-<主題>.ts` = 直接 import 路由的 `POST`／`GET` 跑完整 API 流程。只有 `_*.ts` 和 `flow/*.ts` 會被 `npm test` 收進去（`tests/_mobile-check.mjs`、`_zimo-preview.mjs` 是手動腳本）。
- 檔頭註解要寫清楚「這支在驗什麼、哪一條規則、誰在哪天拍板」——整個 repo 都是這個風格，照著寫。

---

## 省量紀律（Vercel 請求數，2026-11-01 起）

這是會被測試強制的硬規則，不是建議：

- `public/{tiles,mahjong-fx,fonts,home}` 一律 `max-age=31536000, immutable`（`lib/staticCache.ts` → `next.config.ts`）。**換素材必須改檔名或加版本號**（`storm-wall.webp` → `storm-wall.v2.webp`），同檔名換內容會讓老玩家一年看到舊檔且無法從伺服器清除。`scripts/asset-hashes.mjs` 與 `tests/_save-requests.ts` 會擋下來。
- **正式站（big2-three.vercel.app）不跑自動測試、不跑大量驗收腳本。** 功能驗收在本機預覽站（`next start` + 假 Supabase + `NEXT_PUBLIC_MJ_PREVIEW=1`）做；正式站只做少量健康檢查，資料庫比對直接連 DB、不經 Vercel。
- 新增前端輪詢前先看 `syncPolicy.ts`：預設是「推播為主、輪詢當保險」，不要退回固定間隔輪詢。

---

## 資料庫 migration

- `supabase/schema.sql`、`mahjong-schema.sql` 是最初的建表；之後全部用 `supabase/migrations/<YYYYMMDD>_<名稱>.sql`，**每一份都要配一支 `_rollback.sql`**，整份包在 `begin; … commit;` 裡。
- 麻將四張表（`mj_rooms`、`mj_players`、`match_records`、`match_record_players`）已經鎖死 RLS：anon／authenticated 完全讀不到寫不了，伺服器一律用 service role。大老二的 `big2_*` 仍用公開金鑰讀寫，**不要順手把它們一起鎖掉**。
- migration 寫完請加進 PGlite 測試（`tests/_sql-*.ts` 或 `tests/support/pg-mj.ts` 的清單），`npm test` 才驗得到。

---

## 規則文件是 SSOT

- `MAHJONG_RULES.md` — 台灣麻將 16 張玩法與完整台數表（含搶槓、一砲多響、海底不能槓等細節）。
- `RULES.md` — 大老二牌型與壓牌規則。

改計分或判胡之前先對照這兩份；兩者與實作不一致時**先問，不要自己擇一**。規則的每一條都標了是誰在哪一天拍板，新規則也照這個格式補註解。

---

## Git 慣例

- 不在 `main` 上直接開發：`feat/mj-<主題>` 或 `fix/mj-<主題>` 分支，驗收通過後 merge 回 main。
- commit 訊息用中文，動詞開頭（`新增：…`／`修正…`／`修：…`）；merge commit 記錄分支名、被 merge 的 commit、複審結果與測試狀況。
